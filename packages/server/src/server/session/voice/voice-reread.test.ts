import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import pino from "pino";

import { rereadAudio } from "./voice-reread.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";

class FakeSession extends EventEmitter {
  readonly requiredSampleRate = 16000;
  readonly chunks: Buffer[] = [];
  committed = false;
  closed = false;
  constructor(private readonly behaviour: "final" | "error" | "silent") {
    super();
  }
  async connect() {}
  appendPcm16(chunk: Buffer) {
    this.chunks.push(chunk);
  }
  commit() {
    this.committed = true;
    if (this.behaviour === "final") {
      setImmediate(() =>
        this.emit("transcript", { segmentId: "s", transcript: " привет ", isFinal: true }),
      );
    }
    if (this.behaviour === "error") {
      setImmediate(() => this.emit("error", new Error("recognizer died")));
    }
  }
  clear() {}
  close() {
    this.closed = true;
  }
}

function providerFor(session: FakeSession): SpeechToTextProvider {
  return {
    id: "local",
    createSession: () => session as unknown as StreamingTranscriptionSession,
    transcribeAudio: async () => ({ text: "", duration: 0 }),
  } as unknown as SpeechToTextProvider;
}

describe("rereadAudio", () => {
  const logger = pino({ level: "silent" });

  it("feeds all the audio to a session of its own and returns the final text", async () => {
    const session = new FakeSession("final");
    const audio = [Buffer.alloc(40000, 1), Buffer.alloc(40000, 2)];

    const result = await rereadAudio({ stt: providerFor(session), audio, logger });

    expect(result.text).toBe(" привет ");
    expect(Buffer.concat(session.chunks)).toEqual(Buffer.concat(audio));
    // One-second pieces, like live audio.
    expect(session.chunks.every((chunk) => chunk.length <= 32000)).toBe(true);
    expect(session.committed).toBe(true);
    expect(session.closed).toBe(true);
  });

  it("rejects when the recognizer fails, leaving the caller to try again", async () => {
    const session = new FakeSession("error");
    await expect(
      rereadAudio({ stt: providerFor(session), audio: [Buffer.alloc(100)], logger }),
    ).rejects.toThrow("recognizer died");
    expect(session.closed).toBe(true);
  });

  it("rejects after its time limit when nothing comes back", async () => {
    const session = new FakeSession("silent");
    await expect(
      rereadAudio({ stt: providerFor(session), audio: [Buffer.alloc(100)], logger, timeoutMs: 20 }),
    ).rejects.toThrow("timed out");
    expect(session.closed).toBe(true);
  });
});
