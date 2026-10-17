import { Buffer } from "node:buffer";
import type { Logger } from "pino";

import { Pcm16MonoResampler } from "../../agent/pcm16-resampler.js";
import type { SpeechToTextProvider } from "../../speech/speech-provider.js";

export interface RereadResult {
  text: string;
  language?: string;
  isLowConfidence?: boolean;
}

const CHUNK_SECONDS = 1;
const MIN_ATTEMPT_TIMEOUT_MS = 120_000;

/**
 * Read saved audio again on a session of its own, leaving the live one alone. This is how a
 * turn is recovered when its first reading fails or stalls: the audio is kept until the text
 * has been delivered, so it can always be read again.
 *
 * The attempt gives up after a generous time so the caller can try again, but a give-up here
 * never discards the audio.
 */
export async function rereadAudio(input: {
  stt: SpeechToTextProvider;
  language?: string;
  /** Audio at the rate the provider's sessions require, unless `sourceSampleRate` says otherwise. */
  audio: Buffer[];
  /** Rate of `audio` when it may differ from what the provider requires (a model was changed). */
  sourceSampleRate?: number;
  logger: Logger;
  timeoutMs?: number;
}): Promise<RereadResult> {
  const session = input.stt.createSession({
    logger: input.logger,
    language: input.language ?? "en",
  });
  const bytesPerChunk = session.requiredSampleRate * 2 * CHUNK_SECONDS;
  const totalBytes = input.audio.reduce((sum, chunk) => sum + chunk.length, 0);
  const audioSeconds = totalBytes / 2 / session.requiredSampleRate;
  const timeoutMs = input.timeoutMs ?? Math.max(MIN_ATTEMPT_TIMEOUT_MS, audioSeconds * 1000);

  return await new Promise<RereadResult>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        session.close();
      } catch {
        // already closed
      }
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("Reading the saved audio again timed out"))),
      timeoutMs,
    );

    session.on("transcript", (event) => {
      if (!event.isFinal) {
        return;
      }
      finish(() =>
        resolve({
          text: event.transcript,
          ...(event.language ? { language: event.language } : {}),
          ...(event.isLowConfidence !== undefined
            ? { isLowConfidence: event.isLowConfidence }
            : {}),
        }),
      );
    });
    session.on("error", (error) =>
      finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );

    session
      .connect()
      .then(() => {
        let whole: Buffer = Buffer.concat(input.audio);
        if (input.sourceSampleRate && input.sourceSampleRate !== session.requiredSampleRate) {
          whole = new Pcm16MonoResampler({
            inputRate: input.sourceSampleRate,
            outputRate: session.requiredSampleRate,
          }).processChunk(whole);
        }
        for (let offset = 0; offset < whole.length; offset += bytesPerChunk) {
          session.appendPcm16(whole.subarray(offset, offset + bytesPerChunk));
        }
        session.commit();
      })
      .catch((error: unknown) =>
        finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
      );
  });
}
