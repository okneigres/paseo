import type pino from "pino";

export interface TurnDetectionSession {
  /**
   * Required PCM16LE sample rate for `appendPcm16()`.
   * Callers are responsible for resampling before appending.
   */
  requiredSampleRate: number;

  connect(): Promise<void>;
  appendPcm16(pcm16le: Buffer): void;
  flush(): void;
  reset(): void;
  close(): void;

  /**
   * True when the session fires `speech_sustained` after speech has lasted long
   * enough to interrupt the assistant. `speech_started` then fires earlier, to
   * start capturing short words. Sessions without it use `speech_started` for both.
   */
  readonly emitsSpeechSustained?: boolean;

  on(event: "speech_started", handler: () => void): unknown;
  on(event: "speech_sustained", handler: () => void): unknown;
  on(event: "speech_stopped", handler: () => void): unknown;
  on(event: "error", handler: (err: unknown) => void): unknown;
}

export interface TurnDetectionProvider {
  id: "openai" | "local" | (string & {});
  createSession(params: { logger: pino.Logger }): TurnDetectionSession;
}
