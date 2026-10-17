import { describe, expect, it } from "vitest";
import pino from "pino";

import { SherpaOnnxParakeetSTT } from "./sherpa-parakeet-stt.js";
import { findQuietCut } from "./sherpa-parakeet-realtime-session.js";
import type { SherpaParakeetSttConfig } from "./sherpa-parakeet-stt.js";
import type { TranscriptionResult } from "../../../speech-provider.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class TestSherpaOnnxParakeetStt extends SherpaOnnxParakeetSTT {
  public readonly calls: Array<{ audio: Buffer; format: string }> = [];
  public readonly pending: Array<ReturnType<typeof createDeferred<TranscriptionResult>>> = [];

  constructor() {
    super(
      { engine: { sampleRate: 16000 } } as unknown as SherpaParakeetSttConfig,
      pino({ level: "silent" }),
    );
  }

  override async transcribeAudio(
    audioBuffer: Buffer,
    format: string,
  ): Promise<TranscriptionResult> {
    this.calls.push({ audio: Buffer.from(audioBuffer), format });
    const deferred = createDeferred<TranscriptionResult>();
    this.pending.push(deferred);
    return deferred.promise;
  }
}

describe("SherpaOnnxParakeetSTT session", () => {
  it("snapshots segment ids and buffers before async transcription starts", async () => {
    const provider = new TestSherpaOnnxParakeetStt();
    const session = provider.createSession({
      logger: pino({ level: "silent" }),
      language: "en",
    });

    const committed: Array<{ segmentId: string; previousSegmentId: string | null }> = [];
    const transcripts: Array<{ segmentId: string; transcript: string; isFinal: boolean }> = [];

    session.on("committed", (payload) => {
      committed.push(payload);
    });
    session.on("transcript", (payload) => {
      transcripts.push(payload);
    });

    await session.connect();

    session.appendPcm16(Buffer.from([1, 2, 3, 4]));
    session.commit();
    session.appendPcm16(Buffer.from([5, 6, 7, 8]));
    session.commit();

    expect(committed).toHaveLength(2);
    expect(committed[1]?.segmentId).not.toBe(committed[0]?.segmentId);
    expect(committed[0]?.previousSegmentId).toBeNull();
    expect(committed[1]?.previousSegmentId).toBe(committed[0]?.segmentId);

    expect(provider.calls).toEqual([
      { audio: Buffer.from([1, 2, 3, 4]), format: "audio/pcm;rate=16000" },
      { audio: Buffer.from([5, 6, 7, 8]), format: "audio/pcm;rate=16000" },
    ]);

    provider.pending[0]?.resolve({ text: "first", duration: 1 });
    provider.pending[1]?.resolve({ text: "second", duration: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcripts).toHaveLength(2);
    expect(transcripts).toEqual([
      expect.objectContaining({
        segmentId: committed[0].segmentId,
        transcript: "first",
        isFinal: true,
      }),
      expect.objectContaining({
        segmentId: committed[1].segmentId,
        transcript: "second",
        isFinal: true,
      }),
    ]);
  });

  describe("long speech", () => {
    const SAMPLE_RATE = 16000;

    // Loud samples everywhere except a pause, so the only sensible place to cut is the pause.
    function speechWithPause(seconds: number, pauseStart: number, pauseEnd: number): Buffer {
      const samples = new Int16Array(seconds * SAMPLE_RATE);
      for (let i = 0; i < samples.length; i += 1) {
        const second = i / SAMPLE_RATE;
        samples[i] = second >= pauseStart && second < pauseEnd ? 0 : i % 2 === 0 ? 4000 : -4000;
      }
      return Buffer.from(samples.buffer);
    }

    const flush = async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    };

    it("reads a long utterance in pieces while it is still being spoken", async () => {
      const provider = new TestSherpaOnnxParakeetStt();
      const session = provider.createSession({ logger: pino({ level: "silent" }) });
      const transcripts: Array<{ transcript: string; isFinal: boolean }> = [];
      session.on("transcript", (payload) => transcripts.push(payload));
      await session.connect();

      // 30 s with a pause around 22 s: past the 25 s limit, so a first piece is cut off.
      session.appendPcm16(speechWithPause(30, 21.5, 22.5));
      await flush();

      expect(provider.calls).toHaveLength(1);
      const cutSeconds = provider.calls[0].audio.length / 2 / SAMPLE_RATE;
      expect(cutSeconds).toBeGreaterThan(21.5);
      expect(cutSeconds).toBeLessThan(22.5);

      provider.pending[0].resolve({ text: "начало", duration: 1 });
      await flush();
      expect(transcripts).toEqual([
        expect.objectContaining({ transcript: "начало", isFinal: false }),
      ]);

      session.commit();
      await flush();
      expect(provider.calls).toHaveLength(2);
      // What is left is the rest of the 30 s, not everything again.
      expect(provider.calls[1].audio.length + provider.calls[0].audio.length).toBe(
        30 * 2 * SAMPLE_RATE,
      );

      provider.pending[1].resolve({ text: "конец", duration: 1 });
      await flush();
      expect(transcripts.at(-1)).toEqual(
        expect.objectContaining({ transcript: "начало конец", isFinal: true }),
      );
    });

    it("joins every piece of a very long utterance in order", async () => {
      const provider = new TestSherpaOnnxParakeetStt();
      const session = provider.createSession({ logger: pino({ level: "silent" }) });
      const transcripts: Array<{ transcript: string; isFinal: boolean }> = [];
      session.on("transcript", (payload) => transcripts.push(payload));
      await session.connect();

      for (let chunk = 0; chunk < 3; chunk += 1) {
        session.appendPcm16(speechWithPause(30, 21.5, 22.5));
        await flush();
      }
      session.commit();
      await flush();

      // Pieces are read one at a time, so answer them as they come.
      for (let index = 0; index < 20; index += 1) {
        await flush();
        const deferred = provider.pending[index];
        if (!deferred) break;
        deferred.resolve({ text: `p${index}`, duration: 1 });
      }
      await flush();

      const pieces = provider.pending.length;
      expect(pieces).toBeGreaterThanOrEqual(3);
      // No single read is longer than the limit, however long the utterance was.
      for (const call of provider.calls) {
        expect(call.audio.length / 2 / SAMPLE_RATE).toBeLessThanOrEqual(25.5);
      }
      const final = transcripts.find((entry) => entry.isFinal);
      // Reads start in the order asked, except the remainder, which starts at commit
      // beside the first piece; its text still goes last.
      const labels = Array.from({ length: pieces }, (_, i) => `p${i}`);
      const [first, remainder, ...rest] = labels;
      expect(final?.transcript).toBe([first, ...rest, remainder].join(" "));
    });

    it("keeps the final low-confidence only when every piece was", async () => {
      const provider = new TestSherpaOnnxParakeetStt();
      const session = provider.createSession({ logger: pino({ level: "silent" }) });
      const transcripts: Array<{
        transcript: string;
        isFinal: boolean;
        isLowConfidence?: boolean;
      }> = [];
      session.on("transcript", (payload) => transcripts.push(payload));
      await session.connect();

      session.appendPcm16(speechWithPause(30, 21.5, 22.5));
      await flush();
      session.commit();
      await flush();
      provider.pending[0].resolve({ text: "", duration: 1, isLowConfidence: true });
      provider.pending[1].resolve({ text: "слова", duration: 1 });
      await flush();

      const final = transcripts.find((entry) => entry.isFinal);
      expect(final?.transcript).toBe("слова");
      expect(final?.isLowConfidence).toBeUndefined();
    });
  });
});

describe("findQuietCut", () => {
  it("lands in the quietest stretch of the search range", () => {
    const rate = 16000;
    const samples = new Int16Array(10 * rate);
    for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 3000 : -3000;
    for (let i = 7 * rate; i < 8 * rate; i += 1) samples[i] = 0;
    const cut = findQuietCut(Buffer.from(samples.buffer), 5 * rate * 2, 10 * rate * 2, 1600 * 2);
    expect(cut / 2 / rate).toBeGreaterThan(7);
    expect(cut / 2 / rate).toBeLessThan(8);
  });
});
