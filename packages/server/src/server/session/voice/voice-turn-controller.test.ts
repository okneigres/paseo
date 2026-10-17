import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import pino from "pino";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionCommittedEvent,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";
import type {
  TurnDetectionProvider,
  TurnDetectionSession,
} from "../../speech/turn-detection-provider.js";
import { createVoiceTurnController } from "./voice-turn-controller.js";

class FakeTurnDetectionSession extends EventEmitter implements TurnDetectionSession {
  public readonly requiredSampleRate = 16000;
  public readonly appendedChunks: Buffer[] = [];

  async connect(): Promise<void> {}

  appendPcm16(chunk: Buffer): void {
    this.appendedChunks.push(chunk);
  }

  flush(): void {}
  reset(): void {}
  close(): void {}
}

class FakeSttSession extends EventEmitter implements StreamingTranscriptionSession {
  public readonly requiredSampleRate: number;
  public readonly appendedChunks: Buffer[] = [];
  public connectCount = 0;
  public closeCount = 0;
  public commitCount = 0;

  constructor(requiredSampleRate = 16000) {
    super();
    this.requiredSampleRate = requiredSampleRate;
  }

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  appendPcm16(chunk: Buffer): void {
    this.appendedChunks.push(chunk);
  }

  commit(): void {
    this.commitCount += 1;
  }

  clear(): void {}

  close(): void {
    this.closeCount += 1;
  }

  emitTranscript(event: StreamingTranscriptionEvent): void {
    this.emit("transcript", event);
  }

  emitCommitted(event: StreamingTranscriptionCommittedEvent): void {
    this.emit("committed", event);
  }

  emitError(error: unknown): void {
    this.emit("error", error);
  }
}

function createFakeTurnDetectionProvider(session: FakeTurnDetectionSession): TurnDetectionProvider {
  return {
    id: "local",
    createSession() {
      return session;
    },
  };
}

function createFakeSttProvider(
  sessions: FakeSttSession[],
  captureLanguage?: (language: string | undefined) => void,
): SpeechToTextProvider {
  return {
    id: "local",
    createSession(params) {
      captureLanguage?.(params.language);
      const session = new FakeSttSession();
      sessions.push(session);
      return session;
    },
  };
}

async function settleSerialQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createFakeSpool() {
  const entries = new Map<string, { supersedes: string[]; audioBytes: number }>();
  return {
    entries,
    save: vi.fn((turn: { id: string; supersedes: string[]; audio: Buffer[] }) => {
      entries.set(turn.id, {
        supersedes: turn.supersedes,
        audioBytes: turn.audio.reduce((sum, chunk) => sum + chunk.length, 0),
      });
    }),
    remove: vi.fn((id: string) => {
      entries.delete(id);
    }),
    list: vi.fn(() => []),
  };
}

function createControllerHarness(options?: {
  sttLanguage?: string;
  mergeGraceMs?: number;
  spool?: ReturnType<typeof createFakeSpool>;
}) {
  const detector = new FakeTurnDetectionSession();
  const sttSessions: FakeSttSession[] = [];
  let lastSttLanguage: string | undefined;
  const stt = createFakeSttProvider(sttSessions, (language) => {
    lastSttLanguage = language;
  });
  const onSpeechStarted = vi.fn(async () => {});
  const onSpeechStopped = vi.fn(async () => {});
  const onSpeechSustained = vi.fn(async () => {});
  const onPartialTranscript = vi.fn(
    async (_input: { segmentId: string; transcript: string }) => {},
  );
  const onFinalTranscript = vi.fn(
    async (_input: {
      segmentId: string;
      transcript: string;
      language?: string;
      avgLogprob?: number;
      isLowConfidence?: boolean;
      durationMs: number;
    }) => {},
  );
  const onError = vi.fn();
  const onTranscriptionSlow = vi.fn();

  const controller = createVoiceTurnController({
    logger: pino({ level: "silent" }),
    turnDetection: createFakeTurnDetectionProvider(detector),
    stt,
    sttLanguage: options?.sttLanguage,
    mergeGraceMs: options?.mergeGraceMs,
    spool: options?.spool,
    callbacks: {
      onSpeechStarted,
      onSpeechSustained,
      onSpeechStopped,
      onPartialTranscript,
      onFinalTranscript,
      onTranscriptionSlow,
      onError,
    },
  });

  return {
    controller,
    detector,
    sttSessions,
    getLastSttLanguage: () => lastSttLanguage,
    onSpeechStarted,
    onSpeechSustained,
    onSpeechStopped,
    onPartialTranscript,
    onFinalTranscript,
    onTranscriptionSlow,
    onError,
  };
}

describe("voice turn controller", () => {
  it("passes configured language to streaming STT", async () => {
    const harness = createControllerHarness({ sttLanguage: "pt" });

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();

    expect(harness.getLastSttLanguage()).toBe("pt");
  });

  it("forwards audio to the detector and streaming STT without submitting buffered utterances", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    await harness.controller.appendClientChunk({
      audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    await harness.controller.appendClientChunk({
      audioBase64: Buffer.from([5, 6, 7, 8]).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });
    harness.detector.emit("speech_stopped");
    await settleSerialQueue();

    expect(harness.detector.appendedChunks).toEqual([
      Buffer.from([1, 2, 3, 4]),
      Buffer.from([5, 6, 7, 8]),
    ]);
    expect(harness.sttSessions[0]?.appendedChunks).toEqual([
      Buffer.from([1, 2, 3, 4]),
      Buffer.from([5, 6, 7, 8]),
    ]);
    expect(harness.onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(harness.onSpeechStopped).toHaveBeenCalledTimes(1);
    expect(harness.onFinalTranscript).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("keeps only the last two seconds of audio from before speech was confirmed", async () => {
    const harness = createControllerHarness();
    const oneSecond = 16000 * 2;

    await harness.controller.start();
    for (let second = 0; second < 6; second += 1) {
      await harness.controller.appendClientChunk({
        audioBase64: Buffer.alloc(oneSecond, second + 1).toString("base64"),
        format: "audio/pcm;rate=16000;bits=16",
      });
    }
    expect(harness.sttSessions[0]?.appendedChunks).toEqual([]);

    harness.detector.emit("speech_started");
    await settleSerialQueue();
    await harness.controller.appendClientChunk({
      audioBase64: Buffer.alloc(oneSecond, 9).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });

    expect(harness.sttSessions[0]?.appendedChunks).toEqual([
      Buffer.alloc(oneSecond, 5),
      Buffer.alloc(oneSecond, 6),
      Buffer.alloc(oneSecond, 9),
    ]);
  });

  it("holds audio between turns back from the transcriber", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    harness.detector.emit("speech_stopped");
    await settleSerialQueue();
    await harness.controller.appendClientChunk({
      audioBase64: Buffer.alloc(32000, 1).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });

    expect(harness.sttSessions[0]?.appendedChunks).toEqual([]);
  });

  it("treats speech_started as sustained for detectors that confirm late", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();

    expect(harness.onSpeechSustained).toHaveBeenCalledTimes(1);
  });

  it("waits for speech_sustained before interrupting when the detector reports it", async () => {
    const harness = createControllerHarness();
    (harness.detector as { emitsSpeechSustained?: boolean }).emitsSpeechSustained = true;

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    expect(harness.onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(harness.onSpeechSustained).not.toHaveBeenCalled();

    harness.detector.emit("speech_sustained");
    await settleSerialQueue();
    expect(harness.onSpeechSustained).toHaveBeenCalledTimes(1);
  });

  it("ignores speech_sustained outside a captured turn", async () => {
    const harness = createControllerHarness();
    (harness.detector as { emitsSpeechSustained?: boolean }).emitsSpeechSustained = true;

    await harness.controller.start();
    harness.detector.emit("speech_sustained");
    await settleSerialQueue();

    expect(harness.onSpeechSustained).not.toHaveBeenCalled();
  });

  describe("merging speech that follows a finished turn", () => {
    const chunk = (value: number) => ({
      audioBase64: Buffer.alloc(3200, value).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });

    async function finishTurn(
      harness: ReturnType<typeof createControllerHarness>,
      text: string,
      segmentId: string,
    ) {
      harness.detector.emit("speech_stopped");
      await settleSerialQueue();
      harness.sttSessions[0]?.emitCommitted({ segmentId, previousSegmentId: null });
      harness.sttSessions[0]?.emitTranscript({
        segmentId,
        transcript: text,
        isFinal: true,
      });
      await settleSerialQueue();
    }

    it("holds a finished turn for the grace period before delivering it", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness({ mergeGraceMs: 1500 });
        await harness.controller.start();
        harness.detector.emit("speech_started");
        await settleSerialQueue();
        await harness.controller.appendClientChunk(chunk(1));
        await finishTurn(harness, "один", "segment-1");

        expect(harness.onFinalTranscript).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1600);
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe("один");
      } finally {
        vi.useRealTimers();
      }
    });

    it("transcribes earlier audio again with new speech and delivers only the combined text", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness({ mergeGraceMs: 1500 });
        await harness.controller.start();
        harness.detector.emit("speech_started");
        await settleSerialQueue();
        await harness.controller.appendClientChunk(chunk(1));
        await finishTurn(harness, "раз", "segment-1");
        await vi.advanceTimersByTimeAsync(500);

        // The user keeps talking before the grace period ends.
        await harness.controller.appendClientChunk(chunk(2));
        harness.detector.emit("speech_started");
        await settleSerialQueue();
        await harness.controller.appendClientChunk(chunk(3));

        const fed = harness.sttSessions[0]?.appendedChunks.map((buffer) => buffer[0]);
        // First utterance, then the same audio again, the gap, and the new speech.
        expect(fed).toEqual([1, 1, 2, 3]);

        await finishTurn(harness, "раз два", "segment-2");
        await vi.advanceTimersByTimeAsync(1600);
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe("раз два");
      } finally {
        vi.useRealTimers();
      }
    });

    it("starts fresh once the grace period has passed", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness({ mergeGraceMs: 1500 });
        await harness.controller.start();
        harness.detector.emit("speech_started");
        await settleSerialQueue();
        await harness.controller.appendClientChunk(chunk(1));
        await finishTurn(harness, "раз", "segment-1");
        await vi.advanceTimersByTimeAsync(1600);
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);

        harness.detector.emit("speech_started");
        await settleSerialQueue();
        await harness.controller.appendClientChunk(chunk(2));

        expect(harness.sttSessions[0]?.appendedChunks.map((buffer) => buffer[0])).toEqual([1, 2]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("delivers immediately when merging is off", async () => {
      const harness = createControllerHarness();
      await harness.controller.start();
      harness.detector.emit("speech_started");
      await settleSerialQueue();
      await finishTurn(harness, "раз", "segment-1");

      expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
    });
  });

  it("reads a turn again with the next speech when its text has not come back yet", async () => {
    const harness = createControllerHarness();
    const chunk = (value: number) => ({
      audioBase64: Buffer.alloc(3200, value).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    await harness.controller.appendClientChunk(chunk(1));
    harness.detector.emit("speech_stopped");
    await settleSerialQueue();
    harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });

    // The user talks again before segment-1 has been read.
    await harness.controller.appendClientChunk(chunk(2));
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    await harness.controller.appendClientChunk(chunk(3));
    expect(harness.sttSessions[0]?.appendedChunks.map((buffer) => buffer[0])).toEqual([1, 1, 2, 3]);

    // The late text of the first segment is not delivered on its own.
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "раз",
      isFinal: true,
    });
    await settleSerialQueue();
    expect(harness.onFinalTranscript).not.toHaveBeenCalled();

    harness.detector.emit("speech_stopped");
    await settleSerialQueue();
    harness.sttSessions[0]?.emitCommitted({
      segmentId: "segment-2",
      previousSegmentId: "segment-1",
    });
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-2",
      transcript: "раз два",
      isFinal: true,
    });
    await settleSerialQueue();

    expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
    expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe("раз два");
  });

  it("does not barge in on silence-only chunks", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    await harness.controller.appendClientChunk({
      audioBase64: Buffer.from([0, 0, 0, 0]).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });
    await harness.controller.appendClientChunk({
      audioBase64: Buffer.from([0, 0, 0, 0]).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });
    await settleSerialQueue();

    expect(harness.detector.appendedChunks).toEqual([
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0, 0, 0, 0]),
    ]);
    expect(harness.onSpeechStarted).not.toHaveBeenCalled();
    expect(harness.onSpeechStopped).not.toHaveBeenCalled();
    expect(harness.onFinalTranscript).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it("fires onPartialTranscript exactly once for the first non-empty partial in a turn", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();

    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "hello",
      isFinal: false,
    });
    await settleSerialQueue();
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "hello again",
      isFinal: false,
    });
    await settleSerialQueue();

    expect(harness.onPartialTranscript).toHaveBeenCalledTimes(1);
    expect(harness.onPartialTranscript).toHaveBeenCalledWith({
      segmentId: "segment-1",
      transcript: "hello",
    });
  });

  it("does not fire onPartialTranscript for filler-only partials, but fires once the partial grows past the filler", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();

    for (const transcript of ["uh", "uh,", "Um", "uh um", "hmm"]) {
      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-1",
        transcript,
        isFinal: false,
      });
      await settleSerialQueue();
    }

    expect(harness.onPartialTranscript).not.toHaveBeenCalled();

    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "uh hello",
      isFinal: false,
    });
    await settleSerialQueue();

    expect(harness.onPartialTranscript).toHaveBeenCalledTimes(1);
    expect(harness.onPartialTranscript).toHaveBeenCalledWith({
      segmentId: "segment-1",
      transcript: "uh hello",
    });
  });

  it("does not fire onPartialTranscript for empty or whitespace-only partials", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();

    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "",
      isFinal: false,
    });
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "   ",
      isFinal: false,
    });
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "ignored final",
      isFinal: true,
    });
    await settleSerialQueue();

    expect(harness.onPartialTranscript).not.toHaveBeenCalled();
  });

  it("does not fire onPartialTranscript from VAD speech_started alone", async () => {
    vi.useFakeTimers();
    try {
      const harness = createControllerHarness();

      await harness.controller.start();
      harness.detector.emit("speech_started");
      await settleSerialQueue();

      await vi.advanceTimersByTimeAsync(5_000);
      await settleSerialQueue();

      expect(harness.onSpeechStarted).toHaveBeenCalledTimes(1);
      expect(harness.onPartialTranscript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits the streaming STT segment when speech stops", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    harness.detector.emit("speech_stopped");
    await settleSerialQueue();

    expect(harness.sttSessions[0]?.commitCount).toBe(1);
  });

  it("fires onFinalTranscript after speech stop, commit, and final transcript", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    harness.detector.emit("speech_stopped");
    await settleSerialQueue();

    harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: "  hello there  ",
      isFinal: true,
      language: "en",
      avgLogprob: -0.2,
      isLowConfidence: false,
    });
    await settleSerialQueue();

    expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
    expect(harness.onFinalTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: "segment-1",
        transcript: "hello there",
        language: "en",
        avgLogprob: -0.2,
        durationMs: expect.any(Number),
      }),
    );
  });

  it("assembles multiple committed final transcripts in commit order", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    harness.detector.emit("speech_started");
    await settleSerialQueue();
    harness.detector.emit("speech_stopped");
    await settleSerialQueue();

    harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    harness.sttSessions[0]?.emitCommitted({
      segmentId: "segment-2",
      previousSegmentId: "segment-1",
    });
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-2",
      transcript: " world ",
      isFinal: true,
    });
    harness.sttSessions[0]?.emitTranscript({
      segmentId: "segment-1",
      transcript: " hello ",
      isFinal: true,
    });
    await settleSerialQueue();

    expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
    expect(harness.onFinalTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: "segment-1",
        transcript: "hello world",
      }),
    );
  });

  it("waits for every committed segment instead of delivering what arrived by a deadline", async () => {
    vi.useFakeTimers();
    try {
      const harness = createControllerHarness();

      await harness.controller.start();
      harness.detector.emit("speech_started");
      await settleSerialQueue();
      harness.detector.emit("speech_stopped");
      await settleSerialQueue();

      harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      harness.sttSessions[0]?.emitCommitted({
        segmentId: "segment-2",
        previousSegmentId: "segment-1",
      });
      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-1",
        transcript: "hello",
        isFinal: true,
      });

      // Half of the turn has been read; delivering it now would cut the rest off.
      await vi.advanceTimersByTimeAsync(60_000);
      await settleSerialQueue();
      expect(harness.onFinalTranscript).not.toHaveBeenCalled();

      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-2",
        transcript: "world",
        isFinal: true,
      });
      await settleSerialQueue();

      expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
      expect(harness.onFinalTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentId: "segment-1",
          transcript: "hello world",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not include stale uncommitted finals once committed segments are known", async () => {
    vi.useFakeTimers();
    try {
      const harness = createControllerHarness();

      await harness.controller.start();
      harness.detector.emit("speech_started");
      await settleSerialQueue();
      harness.detector.emit("speech_stopped");
      await settleSerialQueue();

      harness.sttSessions[0]?.emitTranscript({
        segmentId: "stale-segment",
        transcript: "stale text",
        isFinal: true,
      });
      harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      harness.sttSessions[0]?.emitCommitted({
        segmentId: "segment-2",
        previousSegmentId: "segment-1",
      });
      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-1",
        transcript: "fresh text",
        isFinal: true,
      });
      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-2",
        transcript: "and more",
        isFinal: true,
      });
      await settleSerialQueue();

      expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
      expect(harness.onFinalTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentId: "segment-1",
          transcript: "fresh text and more",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  describe("a turn whose text is slow", () => {
    const tenSeconds = {
      audioBase64: Buffer.alloc(16000 * 2 * 10, 1).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    };

    async function stopLongTurn(harness: ReturnType<typeof createControllerHarness>, tens = 1) {
      await harness.controller.start();
      harness.detector.emit("speech_started");
      await settleSerialQueue();
      for (let i = 0; i < tens; i += 1) {
        await harness.controller.appendClientChunk(tenSeconds);
      }
      harness.detector.emit("speech_stopped");
      await settleSerialQueue();
      harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    }

    async function flushReread() {
      for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(0);
    }

    it("is never delivered cut short, however long it takes", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness();
        await stopLongTurn(harness);
        // Partial text that never became a final is not what the agent gets.
        harness.sttSessions[0]?.emitTranscript({
          segmentId: "segment-1",
          transcript: "hello",
          isFinal: false,
        });

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await settleSerialQueue();
        expect(harness.onFinalTranscript).not.toHaveBeenCalled();

        harness.sttSessions[0]?.emitTranscript({
          segmentId: "segment-1",
          transcript: "hello there",
          isFinal: true,
        });
        await settleSerialQueue();
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe("hello there");
      } finally {
        vi.useRealTimers();
      }
    });

    it("is reported as slow and read again from its saved audio", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness();
        await stopLongTurn(harness);
        expect(harness.sttSessions).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(12_000);
        await flushReread();

        expect(harness.onTranscriptionSlow).toHaveBeenCalledTimes(1);
        expect(harness.sttSessions).toHaveLength(2);
        const reread = harness.sttSessions[1]!;
        expect(Buffer.concat(reread.appendedChunks).length).toBe(16000 * 2 * 10);
        expect(reread.commitCount).toBe(1);
        expect(harness.onFinalTranscript).not.toHaveBeenCalled();

        reread.emitTranscript({
          segmentId: "reread",
          transcript: "from the second reading",
          isFinal: true,
        });
        await flushReread();
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe(
          "from the second reading",
        );

        // The first reading answering later changes nothing.
        harness.sttSessions[0]?.emitTranscript({
          segmentId: "segment-1",
          transcript: "late",
          isFinal: true,
        });
        await settleSerialQueue();
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets the first reading win when it answers during the second", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness();
        await stopLongTurn(harness);
        await vi.advanceTimersByTimeAsync(12_000);
        await flushReread();

        harness.sttSessions[0]?.emitTranscript({
          segmentId: "segment-1",
          transcript: "first",
          isFinal: true,
        });
        await settleSerialQueue();
        harness.sttSessions[1]?.emitTranscript({
          segmentId: "reread",
          transcript: "second",
          isFinal: true,
        });
        await flushReread();

        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe("first");
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits longer to call a long utterance slow", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness();
        // Ninety seconds of speech.
        await stopLongTurn(harness, 9);

        await vi.advanceTimersByTimeAsync(10_500);
        expect(harness.onTranscriptionSlow).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(14_000);
        expect(harness.onTranscriptionSlow).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads the turn again at once when the recognizer fails, and tries again if that fails", async () => {
      vi.useFakeTimers();
      try {
        const harness = createControllerHarness();
        await stopLongTurn(harness);

        harness.sttSessions[0]?.emitError(new Error("worker exited"));
        await flushReread();
        expect(harness.sttSessions.length).toBeGreaterThanOrEqual(3); // reconnect and re-read
        const firstReread = harness.sttSessions.find(
          (session) => session.commitCount === 1 && session !== harness.sttSessions[0],
        );
        expect(firstReread).toBeDefined();
        expect(Buffer.concat(firstReread!.appendedChunks).length).toBe(16000 * 2 * 10);

        firstReread!.emitError(new Error("still failing"));
        await flushReread();
        // Nothing is delivered from a failed attempt, and another attempt is scheduled.
        expect(harness.onFinalTranscript).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(3_100);
        await flushReread();
        const rereads = harness.sttSessions.filter(
          (session) => session.commitCount === 1 && session !== harness.sttSessions[0],
        );
        expect(rereads.length).toBeGreaterThanOrEqual(2);

        rereads
          .at(-1)!
          .emitTranscript({ segmentId: "reread", transcript: "recovered", isFinal: true });
        await flushReread();
        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(harness.onFinalTranscript.mock.calls[0][0].transcript).toBe("recovered");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("the on-disk copy of a turn's audio", () => {
    const chunk = (value: number) => ({
      audioBase64: Buffer.alloc(3200, value).toString("base64"),
      format: "audio/pcm;rate=16000;bits=16",
    });

    async function speak(harness: ReturnType<typeof createControllerHarness>, value: number) {
      harness.detector.emit("speech_started");
      await settleSerialQueue();
      await harness.controller.appendClientChunk(chunk(value));
      harness.detector.emit("speech_stopped");
      await settleSerialQueue();
    }

    it("is saved when the user stops and removed once the agent has the text", async () => {
      const spool = createFakeSpool();
      const harness = createControllerHarness({ spool });
      await harness.controller.start();
      await speak(harness, 1);

      expect(spool.save).toHaveBeenCalledTimes(1);
      expect(spool.entries.size).toBe(1);

      harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-1",
        transcript: "раз",
        isFinal: true,
      });
      await settleSerialQueue();

      expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
      expect(spool.entries.size).toBe(0);
    });

    it("stays when delivering the text fails, so it can be recovered", async () => {
      const spool = createFakeSpool();
      const harness = createControllerHarness({ spool });
      harness.onFinalTranscript.mockRejectedValueOnce(new Error("agent unavailable"));
      await harness.controller.start();
      await speak(harness, 1);

      harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      harness.sttSessions[0]?.emitTranscript({
        segmentId: "segment-1",
        transcript: "раз",
        isFinal: true,
      });
      await settleSerialQueue();

      expect(spool.entries.size).toBe(1);
    });

    it("keeps earlier turns until the merged turn is delivered, and does not duplicate them", async () => {
      vi.useFakeTimers();
      try {
        const spool = createFakeSpool();
        const harness = createControllerHarness({ mergeGraceMs: 1500, spool });
        await harness.controller.start();
        await speak(harness, 1);
        harness.sttSessions[0]?.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
        harness.sttSessions[0]?.emitTranscript({
          segmentId: "segment-1",
          transcript: "раз",
          isFinal: true,
        });
        await settleSerialQueue();
        await vi.advanceTimersByTimeAsync(500);

        // Speech resumes inside the grace period: the second turn contains the first.
        await speak(harness, 2);
        const saved = spool.save.mock.calls.map(([turn]) => turn);
        expect(saved).toHaveLength(2);
        expect(saved[1].supersedes).toEqual([saved[0].id]);
        expect(spool.entries.size).toBe(2);

        harness.sttSessions[0]?.emitCommitted({
          segmentId: "segment-2",
          previousSegmentId: "segment-1",
        });
        harness.sttSessions[0]?.emitTranscript({
          segmentId: "segment-2",
          transcript: "раз два",
          isFinal: true,
        });
        await settleSerialQueue();
        await vi.advanceTimersByTimeAsync(1600);

        expect(harness.onFinalTranscript).toHaveBeenCalledTimes(1);
        expect(spool.entries.size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("reports STT errors and attempts one reconnect", async () => {
    const harness = createControllerHarness();

    await harness.controller.start();
    const firstSession = harness.sttSessions[0];
    firstSession?.emitError(new Error("stream failed"));
    await settleSerialQueue();

    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "stream failed" }),
    );
    expect(firstSession?.closeCount).toBe(1);
    expect(harness.sttSessions).toHaveLength(2);
    expect(harness.sttSessions[1]?.connectCount).toBe(1);
  });
});
