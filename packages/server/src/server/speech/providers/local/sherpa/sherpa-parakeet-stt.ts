import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type pino from "pino";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
  TranscriptionResult,
} from "../../../speech-provider.js";
import { Pcm16MonoResampler } from "../../../../agent/pcm16-resampler.js";
import {
  parsePcm16MonoWav,
  parsePcmRateFromFormat,
  pcm16lePeakAbs,
  pcm16leToFloat32,
} from "../../../audio.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";
import { findQuietCut } from "./sherpa-parakeet-realtime-session.js";

// See sherpa-parakeet-realtime-session.ts: the recognizer reads about ten seconds of
// audio per second of work, so a long utterance is cut at a pause and read in pieces
// while the user is still talking, instead of all at once when they stop.
const FREEZE_AFTER_MS = 25_000;
const FREEZE_SEARCH_MS = 6_000;
const QUIET_WINDOW_MS = 100;

export interface SherpaParakeetSttConfig {
  engine: SherpaOfflineRecognizerEngine;
  silencePeakThreshold?: number;
}

export class SherpaOnnxParakeetSTT implements SpeechToTextProvider {
  private readonly engine: SherpaOfflineRecognizerEngine;
  private readonly silencePeakThreshold: number;
  private readonly logger: pino.Logger;
  public readonly id = "local" as const;

  constructor(config: SherpaParakeetSttConfig, logger: pino.Logger) {
    this.engine = config.engine;
    this.silencePeakThreshold = config.silencePeakThreshold ?? 300;
    this.logger = logger.child({ module: "speech", provider: "local", component: "parakeet-stt" });
  }

  public createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession {
    const emitter = new EventEmitter();
    const logger = params.logger.child({ provider: "local", component: "parakeet-stt-session" });
    const requiredSampleRate = this.engine.sampleRate;
    let connected = false;
    let segmentId = uuidv4();
    let previousSegmentId: string | null = null;
    let pcm16: Buffer = Buffer.alloc(0);
    // Pieces cut off the front of the utterance, in order, each being read already.
    let frozen: Array<Promise<TranscriptionResult>> = [];
    let finishedText: string[] = [];
    const format = `audio/pcm;rate=${requiredSampleRate}`;
    const bytesFor = (ms: number) => Math.round((requiredSampleRate * 2 * ms) / 1000) & ~1;
    // Reads run one at a time, in the order they were asked for.
    let chain: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
      const run = chain.then(task, task);
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    const joinTexts = (texts: string[]) =>
      texts
        .map((text) => text.trim())
        .filter((text) => text.length > 0)
        .join(" ");

    const freezeLongSpeech = () => {
      const limit = bytesFor(FREEZE_AFTER_MS);
      while (pcm16.length >= limit) {
        const cut = findQuietCut(
          pcm16,
          limit - bytesFor(FREEZE_SEARCH_MS),
          limit,
          bytesFor(QUIET_WINDOW_MS),
        );
        const head = pcm16.subarray(0, cut);
        pcm16 = Buffer.from(pcm16.subarray(cut));
        const index = frozen.length;
        const piece = enqueue(() => this.transcribeAudio(head, format));
        frozen.push(piece);
        const pieceSegmentId = segmentId;
        const pieces = frozen;
        // Text so far is what a caller falls back on if the final never arrives.
        void piece.then(
          (result) => {
            if (pieces !== frozen) return;
            finishedText[index] = result.text;
            emitter.emit("transcript", {
              segmentId: pieceSegmentId,
              transcript: joinTexts(finishedText),
              isFinal: false,
            });
          },
          () => undefined,
        );
      }
    };

    return {
      requiredSampleRate,
      async connect() {
        connected = true;
      },
      appendPcm16(chunk: Buffer) {
        if (!connected) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }
        pcm16 = pcm16.length === 0 ? chunk : Buffer.concat([pcm16, chunk]);
        freezeLongSpeech();
      },
      commit: () => {
        if (!connected) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }

        const committedId = segmentId;
        const prev = previousSegmentId;
        const committedPcm16 = pcm16;
        const committedPieces = frozen;
        previousSegmentId = committedId;
        segmentId = uuidv4();
        pcm16 = Buffer.alloc(0);
        frozen = [];
        finishedText = [];
        emitter.emit("committed", { segmentId: committedId, previousSegmentId: prev });

        void (async () => {
          try {
            // Only the remainder is left to read; it starts at once, beside any piece still being read.
            const tail = await this.transcribeAudio(committedPcm16, format);
            const results = [...(await Promise.all(committedPieces)), tail];
            if (results.length === 1) {
              const rt = results[0];
              emitter.emit("transcript", {
                segmentId: committedId,
                transcript: rt.text,
                isFinal: true,
                language: rt.language,
                logprobs: rt.logprobs,
                avgLogprob: rt.avgLogprob,
                isLowConfidence: rt.isLowConfidence,
              });
              return;
            }
            const text = joinTexts(results.map((result) => result.text));
            const allLowConfidence = results.every((result) => result.isLowConfidence === true);
            emitter.emit("transcript", {
              segmentId: committedId,
              transcript: text,
              isFinal: true,
              language: results.find((result) => result.language)?.language,
              ...(allLowConfidence || text.length === 0 ? { isLowConfidence: true } : {}),
            });
          } catch (err) {
            emitter.emit("error", err);
          } finally {
            logger.debug({ bytes: committedPcm16.length }, "Parakeet session reset");
          }
        })();
      },
      clear() {
        pcm16 = Buffer.alloc(0);
        frozen = [];
        finishedText = [];
        segmentId = uuidv4();
      },
      close() {
        connected = false;
        pcm16 = Buffer.alloc(0);
        frozen = [];
        finishedText = [];
      },
      on(event: "committed" | "transcript" | "error", handler: (payload: never) => void) {
        emitter.on(event, handler as (...args: unknown[]) => void);
        return undefined;
      },
    };
  }

  public async transcribeAudio(audioBuffer: Buffer, format: string): Promise<TranscriptionResult> {
    const start = Date.now();

    let inputRate: number;
    let pcm16: Buffer;

    if (format.toLowerCase().includes("audio/wav")) {
      const parsed = parsePcm16MonoWav(audioBuffer);
      inputRate = parsed.sampleRate;
      pcm16 = parsed.pcm16;
    } else if (format.toLowerCase().includes("audio/pcm")) {
      inputRate = parsePcmRateFromFormat(format, this.engine.sampleRate) ?? this.engine.sampleRate;
      pcm16 = audioBuffer;
    } else {
      throw new Error(`Unsupported audio format for sherpa Parakeet STT: ${format}`);
    }

    const peak = pcm16lePeakAbs(pcm16);
    if (peak < this.silencePeakThreshold) {
      return { text: "", duration: Date.now() - start, isLowConfidence: true };
    }

    let pcmForModel = pcm16;
    if (inputRate !== this.engine.sampleRate) {
      const resampler = new Pcm16MonoResampler({ inputRate, outputRate: this.engine.sampleRate });
      pcmForModel = resampler.processChunk(pcm16);
      inputRate = this.engine.sampleRate;
    }

    const peakForModel = pcm16lePeakAbs(pcmForModel);
    const peakFloat = peakForModel / 32768.0;
    const targetPeak = 0.6;
    const maxGain = 50;
    const gain =
      peakFloat > 0 && peakFloat < targetPeak ? Math.min(maxGain, targetPeak / peakFloat) : 1;

    const stream = this.engine.createStream();
    try {
      const floatSamples = pcm16leToFloat32(pcmForModel, gain);
      this.engine.acceptWaveform(stream, inputRate, floatSamples);
      // Off the worker's thread when possible: voice activity detection shares this process.
      if (typeof this.engine.recognizer.decodeAsync === "function") {
        await this.engine.recognizer.decodeAsync(stream);
      } else {
        this.engine.recognizer.decode(stream);
      }
      const result = this.engine.recognizer.getResult(stream);
      const text = String(
        (typeof result === "object" && result && "text" in result ? result.text : undefined) ??
          result ??
          "",
      ).trim();
      const duration = Date.now() - start;
      this.logger.debug({ duration, textLength: text.length }, "Parakeet transcription complete");
      return { text, duration, ...(text.length === 0 ? { isLowConfidence: true } : {}) };
    } finally {
      try {
        stream.free?.();
      } catch {
        // ignore
      }
    }
  }
}
