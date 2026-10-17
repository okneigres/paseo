import { describe, expect, it } from "vitest";

import { SherpaParakeetRealtimeTranscriptionSession } from "./sherpa-parakeet-realtime-session.js";
import type { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";

const SAMPLE_RATE = 16000;

// An engine that answers "read N seconds" for whatever it is given, and records each read.
function createFakeEngine() {
  const reads: number[] = [];
  let lastSeconds = 0;
  const engine = {
    sampleRate: SAMPLE_RATE,
    createStream: () => ({ free() {} }),
    acceptWaveform: (_stream: unknown, _rate: number, samples: Float32Array) => {
      lastSeconds = samples.length / SAMPLE_RATE;
    },
    recognizer: {
      decode: () => {
        reads.push(lastSeconds);
      },
      getResult: () => ({ text: `read ${Math.round(lastSeconds)}s` }),
    },
  } as unknown as SherpaOfflineRecognizerEngine;
  return { engine, reads };
}

function loud(seconds: number): Buffer {
  const samples = new Int16Array(seconds * SAMPLE_RATE);
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 5000 : -5000;
  return Buffer.from(samples.buffer);
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("realtime transcription session", () => {
  it("never reads more than the limit at once, however long the speech is", async () => {
    const { engine, reads } = createFakeEngine();
    const session = new SherpaParakeetRealtimeTranscriptionSession({
      engine,
      minDecodeIntervalMs: 60_000,
    });
    const finals: string[] = [];
    session.on("transcript", (event: { transcript: string; isFinal: boolean }) => {
      if (event.isFinal) finals.push(event.transcript);
    });
    await session.connect();

    for (let i = 0; i < 4; i += 1) {
      session.appendPcm16(loud(30));
      await settle();
    }
    session.commit();
    await settle();

    expect(finals).toHaveLength(1);
    expect(reads.length).toBeGreaterThanOrEqual(5);
    for (const seconds of reads) {
      expect(seconds).toBeLessThanOrEqual(25.5);
    }
    // 120 s of speech came back as the pieces, in order, with nothing missing.
    const covered = finals[0]
      .split(" read ")
      .join("|")
      .match(/\d+/g)
      ?.reduce((sum, value) => sum + Number(value), 0);
    expect(covered).toBeGreaterThanOrEqual(115);
    expect(covered).toBeLessThanOrEqual(125);
  });

  it("answers a short utterance with a read of just that audio", async () => {
    const { engine, reads } = createFakeEngine();
    const session = new SherpaParakeetRealtimeTranscriptionSession({
      engine,
      minDecodeIntervalMs: 60_000,
    });
    const finals: string[] = [];
    session.on("transcript", (event: { transcript: string; isFinal: boolean }) => {
      if (event.isFinal) finals.push(event.transcript);
    });
    await session.connect();

    session.appendPcm16(loud(5));
    session.commit();
    await settle();

    expect(finals).toEqual(["read 5s"]);
    // A first look while speaking, then the final; both are of the same five seconds.
    expect(reads.every((seconds) => seconds === 5)).toBe(true);
  });
});
