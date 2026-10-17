import { EventEmitter } from "node:events";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DualSpeechToTextProvider } from "./dual-stt.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "./speech-provider.js";

// A recognizer that answers when told to, the way a provider session does: it announces
// the segment when commit() is called and delivers its text later.
class FakeSide extends EventEmitter {
  requiredSampleRate = 16000;
  readonly audio: Buffer[] = [];
  private count = 0;
  private lastSegment: string | null = null;
  connectError: Error | null = null;
  commitError: Error | null = null;

  async connect() {
    if (this.connectError) throw this.connectError;
  }
  appendPcm16(chunk: Buffer) {
    this.audio.push(chunk);
  }
  commit() {
    if (this.commitError) throw this.commitError;
    this.count += 1;
    const segmentId = `${this.name}-${this.count}`;
    this.emit("committed", { segmentId, previousSegmentId: this.lastSegment });
    this.lastSegment = segmentId;
  }
  clear() {}
  close() {}
  constructor(readonly name: string) {
    super();
  }
  answer(segmentNumber: number, text: string, extra: Partial<StreamingTranscriptionEvent> = {}) {
    this.emit("transcript", {
      segmentId: `${this.name}-${segmentNumber}`,
      transcript: text,
      isFinal: true,
      ...extra,
    });
  }
  fail(message: string) {
    this.emit("error", new Error(message));
  }
}

function providerOf(side: FakeSide): SpeechToTextProvider {
  return {
    id: "local",
    createSession: () => side as unknown as StreamingTranscriptionSession,
  } as unknown as SpeechToTextProvider;
}

function setup(options: { stragglerGraceMs?: number } = {}) {
  const a = new FakeSide("a");
  const b = new FakeSide("b");
  const provider = new DualSpeechToTextProvider(
    providerOf(a),
    providerOf(b),
    { primary: "STT A", secondary: "STT B GigaAM" },
    options,
  );
  const session = provider.createSession({ logger: pino({ level: "silent" }) });
  const finals: Array<{
    segmentId: string;
    transcript: string;
    isLowConfidence?: boolean;
    language?: string;
  }> = [];
  const committed: Array<{ segmentId: string; previousSegmentId: string | null }> = [];
  const errors: Error[] = [];
  session.on("transcript", (event) => {
    if (event.isFinal) finals.push(event);
  });
  session.on("committed", (event) => committed.push(event));
  session.on("error", (error) => errors.push(error as Error));
  return { a, b, session, finals, committed, errors };
}

describe("dual speech-to-text", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives both models the same audio", async () => {
    const { a, b, session } = setup();
    await session.connect();
    session.appendPcm16(Buffer.from([1, 2]));
    session.appendPcm16(Buffer.from([3, 4]));
    expect(a.audio).toEqual([Buffer.from([1, 2]), Buffer.from([3, 4])]);
    expect(b.audio).toEqual(a.audio);
  });

  it("delivers both texts in one labelled transcript, whichever answers first", async () => {
    const { a, b, session, finals, committed } = setup();
    await session.connect();
    session.commit();

    expect(committed).toHaveLength(1);
    b.answer(1, "привет мир", { isLowConfidence: false });
    expect(finals).toHaveLength(0);
    a.answer(1, "Привет, мир.", { language: "ru" });

    expect(finals).toHaveLength(1);
    expect(finals[0].segmentId).toBe(committed[0].segmentId);
    expect(finals[0].transcript).toBe("[STT A] Привет, мир.\n[STT B GigaAM] привет мир");
    expect(finals[0].language).toBe("ru");
  });

  it("keeps two turns in flight apart", async () => {
    const { a, b, session, finals, committed } = setup();
    await session.connect();
    session.commit();
    session.commit();

    // The second turn comes back first on one model, the first on the other.
    a.answer(2, "второй A");
    b.answer(1, "первый B");
    b.answer(2, "второй B");
    a.answer(1, "первый A");

    expect(committed).toHaveLength(2);
    const byId = new Map(finals.map((entry) => [entry.segmentId, entry.transcript]));
    expect(byId.get(committed[0].segmentId)).toBe("[STT A] первый A\n[STT B GigaAM] первый B");
    expect(byId.get(committed[1].segmentId)).toBe("[STT A] второй A\n[STT B GigaAM] второй B");
  });

  it("delivers the first model's text with a note when the second fails before answering", async () => {
    const { a, b, session, finals, errors } = setup();
    await session.connect();
    session.commit();
    a.answer(1, "всё сказанное");
    expect(finals).toHaveLength(0);

    b.fail("worker exited");

    expect(finals).toHaveLength(1);
    expect(finals[0].transcript).toBe(
      "[STT A] всё сказанное\n[STT B GigaAM] (no text: worker exited)",
    );
    expect(errors).toEqual([]);
  });

  it("keeps working on the first model alone when the second never connects", async () => {
    const { a, b, session, finals, errors } = setup();
    b.connectError = new Error("model files missing");
    await session.connect();

    session.commit();
    a.answer(1, "текст");
    session.commit();
    a.answer(2, "ещё текст");

    expect(finals.map((entry) => entry.transcript)).toEqual([
      "[STT A] текст\n[STT B GigaAM] (no text: model files missing)",
      "[STT A] ещё текст\n[STT B GigaAM] (no text: model files missing)",
    ]);
    expect(errors).toEqual([]);
  });

  it("delivers the second model's text when the first one fails", async () => {
    const { a, b, session, finals } = setup();
    await session.connect();
    session.commit();
    b.answer(1, "от второй модели");
    a.fail("first model died");

    expect(finals[0].transcript).toBe(
      "[STT A] (no text: first model died)\n[STT B GigaAM] от второй модели",
    );
  });

  it("gives up on a model that does not finish, after a bounded time, and says so", async () => {
    vi.useFakeTimers();
    const { a, b, session, finals } = setup({ stragglerGraceMs: 5_000 });
    await session.connect();
    session.commit();
    a.answer(1, "готово");

    await vi.advanceTimersByTimeAsync(4_900);
    expect(finals).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(finals).toHaveLength(1);
    expect(finals[0].transcript).toBe(
      "[STT A] готово\n[STT B GigaAM] (no text: it did not finish in time)",
    );

    // Its late answer changes nothing.
    b.answer(1, "поздно");
    expect(finals).toHaveLength(1);
  });

  it("does not wait on a timer when both answer", async () => {
    vi.useFakeTimers();
    const { a, b, session, finals } = setup({ stragglerGraceMs: 5_000 });
    await session.connect();
    session.commit();
    a.answer(1, "один");
    b.answer(1, "два");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finals).toHaveLength(1);
  });

  it("is silent when neither model heard anything", async () => {
    const { a, b, session, finals } = setup();
    await session.connect();
    session.commit();
    a.answer(1, "", { isLowConfidence: true });
    b.answer(1, "", { isLowConfidence: true });

    expect(finals).toHaveLength(1);
    expect(finals[0].transcript).toBe("");
    expect(finals[0].isLowConfidence).toBe(true);
  });

  it("says when one model heard nothing and the other did", async () => {
    const { a, b, session, finals } = setup();
    await session.connect();
    session.commit();
    a.answer(1, "слышно");
    b.answer(1, "");

    expect(finals[0].transcript).toBe("[STT A] слышно\n[STT B GigaAM] (nothing recognized)");
  });

  it("reports an error, and no text, only when both models failed", async () => {
    const { a, b, session, finals, errors } = setup();
    await session.connect();
    session.commit();
    a.fail("first down");
    expect(errors).toEqual([]);
    b.fail("second down");

    expect(finals).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Both speech-to-text models failed");
  });

  it("fails to connect only when the first model cannot", async () => {
    const { a, session } = setup();
    a.connectError = new Error("no first model");
    await expect(session.connect()).rejects.toThrow("no first model");
  });
});
