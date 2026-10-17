import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";

import type { StreamingTranscriptionSession } from "../../../speech-provider.js";
import { pcm16lePeakAbs, pcm16leToFloat32 } from "../../../audio.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";

// The recognizer is offline: it reads a whole buffer at a time, and takes about a
// tenth of the audio's length to do it. Transcribing everything said so far when the
// speaker stops makes a long dictation (a minute and a half is ~11 s) outlast any
// reasonable wait for the final text. So once the buffer passes FREEZE_AFTER_MS, the
// part up to the nearest pause is cut off and transcribed in the background while the
// user is still talking; at commit only the short remainder is left to read.
const FREEZE_AFTER_MS = 25_000;
const FREEZE_SEARCH_MS = 6_000;
const QUIET_WINDOW_MS = 100;
const MIN_PARTIAL_INTERVAL_MS = 350;

/**
 * Byte offset of the middle of the quietest window in [fromByte, toByte), aligned to a
 * sample. Cutting there rarely splits a word.
 */
export function findQuietCut(
  pcm16: Buffer,
  fromByte: number,
  toByte: number,
  windowBytes: number,
): number {
  const start = Math.max(0, fromByte & ~1);
  const end = Math.min(pcm16.length, toByte & ~1);
  const window = Math.max(2, windowBytes & ~1);
  const step = Math.max(2, (window / 2) & ~1);
  let best = end;
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let offset = start; offset + window <= end; offset += step) {
    let energy = 0;
    for (let i = offset; i < offset + window; i += 2) {
      const sample = pcm16.readInt16LE(i);
      energy += sample * sample;
    }
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = offset + ((window / 2) & ~1);
    }
  }
  return best;
}

interface FrozenPiece {
  text: string;
  done: boolean;
}

export class SherpaParakeetRealtimeTranscriptionSession
  extends EventEmitter
  implements StreamingTranscriptionSession
{
  private readonly engine: SherpaOfflineRecognizerEngine;
  private connected = false;

  public readonly requiredSampleRate: number;
  private currentSegmentId: string | null = null;
  private previousSegmentId: string | null = null;
  private lastPartialText = "";

  // Audio of the current segment that has not been cut off yet.
  private pcm16: Buffer = Buffer.alloc(0);
  // Earlier parts of the segment, in order, transcribed (or being transcribed) already.
  private frozen: FrozenPiece[] = [];
  // Bumped whenever the segment is discarded, so results of stale decodes are dropped.
  private generation = 0;
  // Decodes run one at a time, in the order they were asked for.
  private chain: Promise<void> = Promise.resolve();
  private lastDecodeAt = 0;
  private lastDecodeMs = 0;
  private partialInFlight = false;
  private partialPending = false;
  private readonly minDecodeIntervalMs: number;

  constructor(params: { engine: SherpaOfflineRecognizerEngine; minDecodeIntervalMs?: number }) {
    super();
    this.engine = params.engine;
    this.requiredSampleRate = this.engine.sampleRate;
    this.minDecodeIntervalMs = params.minDecodeIntervalMs ?? MIN_PARTIAL_INTERVAL_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.currentSegmentId = uuidv4();
    this.connected = true;
  }

  appendPcm16(chunk: Buffer): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Parakeet realtime session not connected"));
      return;
    }

    try {
      this.pcm16 = this.pcm16.length === 0 ? chunk : Buffer.concat([this.pcm16, chunk]);
      this.freezeLongSpeech();
      void this.maybeDecodePartial();
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  commit(): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Parakeet realtime session not connected"));
      return;
    }

    const generation = this.generation;
    const segmentId = this.currentSegmentId;
    const previousSegmentId = this.previousSegmentId;
    const tail = this.pcm16;
    const frozen = this.frozen;

    void (async () => {
      try {
        // Queued behind the cut-off parts, so by the time this resolves they are done.
        const tailText = await this.enqueue(() => this.decode(tail));
        if (generation !== this.generation) {
          return;
        }
        const finalText = joinTexts([...frozen.map((piece) => piece.text), tailText]);

        this.emit("committed", { segmentId, previousSegmentId });
        this.emit("transcript", { segmentId, transcript: finalText, isFinal: true });

        this.previousSegmentId = segmentId;
        this.resetSegment();
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  clear(): void {
    if (!this.connected) {
      return;
    }
    this.resetSegment();
  }

  close(): void {
    this.connected = false;
    this.currentSegmentId = null;
    this.pcm16 = Buffer.alloc(0);
    this.frozen = [];
    this.generation += 1;
  }

  private resetSegment(): void {
    this.generation += 1;
    this.currentSegmentId = uuidv4();
    this.lastPartialText = "";
    this.pcm16 = Buffer.alloc(0);
    this.frozen = [];
    this.partialPending = false;
  }

  private bytesFor(ms: number): number {
    return Math.round((this.requiredSampleRate * 2 * ms) / 1000) & ~1;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Cut finished stretches of a long utterance off the buffer and transcribe them in the background. */
  private freezeLongSpeech(): void {
    const limit = this.bytesFor(FREEZE_AFTER_MS);
    while (this.pcm16.length >= limit) {
      const cut = findQuietCut(
        this.pcm16,
        limit - this.bytesFor(FREEZE_SEARCH_MS),
        limit,
        this.bytesFor(QUIET_WINDOW_MS),
      );
      const head = this.pcm16.subarray(0, cut);
      this.pcm16 = Buffer.from(this.pcm16.subarray(cut));
      const piece: FrozenPiece = { text: "", done: false };
      this.frozen.push(piece);
      const generation = this.generation;
      void this.enqueue(async () => {
        try {
          if (generation === this.generation) {
            piece.text = await this.decode(head);
          }
        } finally {
          piece.done = true;
        }
      }).catch((err) => {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  private async maybeDecodePartial(): Promise<void> {
    if (!this.connected || !this.currentSegmentId) {
      return;
    }
    // Later decodes are slower, so leave more room between them; never faster than the minimum.
    const interval = Math.max(this.minDecodeIntervalMs, this.lastDecodeMs * 2);
    if (Date.now() - this.lastDecodeAt < interval) {
      return;
    }
    if (this.partialInFlight) {
      this.partialPending = true;
      return;
    }
    // A cut-off part is still being read, so what we could show would be incomplete.
    if (this.frozen.some((piece) => !piece.done)) {
      return;
    }

    this.partialInFlight = true;
    const generation = this.generation;
    const segmentId = this.currentSegmentId;
    const frozenTexts = this.frozen.map((piece) => piece.text);
    const tail = this.pcm16;
    try {
      const started = Date.now();
      const tailText = await this.enqueue(() => this.decode(tail));
      this.lastDecodeAt = Date.now();
      this.lastDecodeMs = this.lastDecodeAt - started;
      if (generation !== this.generation) {
        return;
      }
      const text = joinTexts([...frozenTexts, tailText]);
      if (text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.emit("transcript", { segmentId, transcript: text, isFinal: false });
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.partialInFlight = false;
      if (this.partialPending) {
        this.partialPending = false;
        void this.maybeDecodePartial();
      }
    }
  }

  private async decode(pcm16: Buffer): Promise<string> {
    if (pcm16.length === 0) {
      return "";
    }

    const peak = pcm16lePeakAbs(pcm16);
    const peakFloat = peak / 32768.0;
    const targetPeak = 0.6;
    const maxGain = 50;
    const gain =
      peakFloat > 0 && peakFloat < targetPeak ? Math.min(maxGain, targetPeak / peakFloat) : 1;

    const stream = this.engine.createStream();
    try {
      const floatSamples = pcm16leToFloat32(pcm16, gain);
      this.engine.acceptWaveform(stream, this.engine.sampleRate, floatSamples);
      const recognizer = this.engine.recognizer;
      // Off the worker's thread when possible: voice activity detection shares this process.
      if (typeof recognizer.decodeAsync === "function") {
        await recognizer.decodeAsync(stream);
      } else {
        recognizer.decode(stream);
      }
      const result = recognizer.getResult(stream);
      return String(
        (typeof result === "object" && result && "text" in result ? result.text : undefined) ??
          result ??
          "",
      ).trim();
    } finally {
      try {
        stream.free?.();
      } catch {
        // ignore
      }
    }
  }
}

function joinTexts(texts: string[]): string {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join(" ");
}
