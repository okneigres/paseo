import { Buffer } from "node:buffer";
import type { Logger } from "pino";
import { v4 as uuidv4 } from "uuid";

import { Pcm16MonoResampler } from "../../agent/pcm16-resampler.js";
import { parsePcmRateFromFormat } from "../../speech/audio.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";

const VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS = 10_000;
// Reading the last stretch of a long utterance takes a while even when the earlier
// stretches were read as the user spoke, so the wait grows with the utterance.
const VOICE_FINAL_TRANSCRIPT_TIMEOUT_PER_AUDIO_SECOND_MS = 150;
const VOICE_FINAL_TRANSCRIPT_TIMEOUT_MAX_MS = 60_000;

function finalTranscriptTimeoutMs(audioSeconds: number): number {
  return Math.min(
    VOICE_FINAL_TRANSCRIPT_TIMEOUT_MAX_MS,
    VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS +
      Math.round(audioSeconds * VOICE_FINAL_TRANSCRIPT_TIMEOUT_PER_AUDIO_SECOND_MS),
  );
}

const FILLER_PARTIAL_WORDS = new Set([
  "uh",
  "um",
  "ah",
  "eh",
  "er",
  "hmm",
  "mm",
  "mmm",
  "mhm",
  "huh",
  "uhhuh",
  "uh-huh",
  "oh",
]);

function isFillerOnlyPartial(transcript: string): boolean {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  return tokens.every((token) => FILLER_PARTIAL_WORDS.has(token));
}

type VoiceInputState =
  | { status: "idle" }
  | { status: "listening" }
  | {
      status: "capturing";
      utteranceId: string;
      startedAt: number;
    };

export interface VoiceTurnControllerCallbacks {
  onSpeechStarted(): Promise<void>;
  // Speech has lasted long enough to interrupt the assistant.
  onSpeechSustained?(): Promise<void>;
  onSpeechStopped(): Promise<void>;
  onPartialTranscript(input: { segmentId: string; transcript: string }): Promise<void>;
  onFinalTranscript(input: VoiceFinalTranscript): Promise<void>;
  onError(error: Error): void;
}

export interface VoiceTurnController {
  start(): Promise<void>;
  stop(): Promise<void>;
  appendClientChunk(input: { audioBase64: string; format: string }): Promise<void>;
}

interface TranscriptSegmentMeta {
  language?: string;
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

interface VoiceFinalTranscript {
  segmentId: string;
  transcript: string;
  language?: string;
  avgLogprob?: number;
  isLowConfidence?: boolean;
  durationMs: number;
}

interface FinalizingVoiceTurn {
  turnId: string;
  startedAt: number;
  committedSegmentIds: string[];
  transcriptsBySegmentId: Map<string, string>;
  finalTranscriptSegmentIds: Set<string>;
  transcriptMetaBySegmentId: Map<string, TranscriptSegmentMeta>;
  timeout: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  // What the transcriber was given for this turn, so it can be read again with what follows.
  audio: Buffer[];
  audioBytes: number;
  fired: boolean;
}

// Audio kept from before the detector confirms speech. The detector needs about
// 800 ms to confirm, so the words that started the turn are already in the past
// when speech_started fires. Everything older stays out of the transcriber: a
// long run of silence in front of an utterance makes the offline model return
// an empty transcript.
const STT_PREROLL_MS = 2000;

// Merging is bounded: audio older than this is delivered on its own.
const MAX_MERGED_AUDIO_MS = 300_000;

export function createVoiceTurnController(params: {
  logger: Logger;
  turnDetection: TurnDetectionProvider;
  stt: SpeechToTextProvider;
  sttLanguage?: string;
  /**
   * When positive, a finished turn is held this long before it is delivered. If the
   * user starts speaking again in that time, the earlier audio is transcribed again
   * together with the new speech and only the combined text is delivered.
   */
  mergeGraceMs?: number;
  callbacks: VoiceTurnControllerCallbacks;
}): VoiceTurnController {
  const mergeGraceMs = Math.max(0, params.mergeGraceMs ?? 0);
  const detector = params.turnDetection.createSession({
    logger: params.logger.child({ component: "turn-detection" }),
  });

  let state: VoiceInputState = { status: "idle" };
  let resampler: Pcm16MonoResampler | null = null;
  let sttSession: StreamingTranscriptionSession | null = null;
  let sttResampler: Pcm16MonoResampler | null = null;
  let inputRate = detector.requiredSampleRate;
  let sttInputRate = 0;
  let queued = Promise.resolve();
  let activeTranscriptSegmentId: string | null = null;
  let partialTranscriptFired = false;
  let reconnectAttemptedForTurn = false;
  const sealedTranscriptSegmentIds = new Set<string>();
  // Segments whose audio was handed on to a later turn; their own finals must not be delivered.
  const supersededSegmentIds = new Set<string>();
  let currentFinalizingTurn: FinalizingVoiceTurn | null = null;
  let prerollChunks: Buffer[] = [];
  let prerollBytes = 0;
  // Audio given to the transcriber for the utterance in progress, kept only when merging.
  let turnAudio: Buffer[] = [];
  let turnAudioBytes = 0;
  // Everything handed to the transcriber for the current utterance, whether or not merging is on.
  let utteranceBytes = 0;
  // Latest text seen for a segment before its final arrives: what we deliver if the final never does.
  const latestPartialBySegmentId = new Map<string, string>();
  let pendingDelivery: {
    transcript: VoiceFinalTranscript;
    audio: Buffer[];
    audioBytes: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function feedStt(session: StreamingTranscriptionSession, chunk: Buffer): void {
    session.appendPcm16(chunk);
    utteranceBytes += chunk.length;
    turnAudio.push(chunk);
    turnAudioBytes += chunk.length;
  }

  function deliverPending(): void {
    const pending = pendingDelivery;
    if (!pending) {
      return;
    }
    pendingDelivery = null;
    clearTimeout(pending.timer);
    void runSerial(async () => {
      await params.callbacks.onFinalTranscript(pending.transcript);
    });
  }

  function holdPreroll(session: StreamingTranscriptionSession, chunk: Buffer): void {
    // While merging, the quiet stretch between two utterances must still be there to join them.
    const prerollMs =
      mergeGraceMs > 0 ? Math.max(STT_PREROLL_MS, mergeGraceMs + 1500) : STT_PREROLL_MS;
    const maxBytes = Math.round((session.requiredSampleRate * 2 * prerollMs) / 1000);
    prerollChunks.push(chunk);
    prerollBytes += chunk.length;
    while (prerollChunks.length > 1 && prerollBytes - prerollChunks[0].length >= maxBytes) {
      prerollBytes -= prerollChunks[0].length;
      prerollChunks.shift();
    }
  }

  function flushPreroll(session: StreamingTranscriptionSession): void {
    const chunks = prerollChunks;
    prerollChunks = [];
    prerollBytes = 0;
    for (const chunk of chunks) {
      feedStt(session, chunk);
    }
  }

  function fail(error: unknown): void {
    params.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }

  function firePartialTranscript(segmentId: string, transcript: string): void {
    if (partialTranscriptFired || state.status !== "capturing") {
      return;
    }

    partialTranscriptFired = true;
    void runSerial(async () => {
      await params.callbacks.onPartialTranscript({ segmentId, transcript });
    });
  }

  function clearFinalizingTurnTimeout(): void {
    if (currentFinalizingTurn) {
      clearTimeout(currentFinalizingTurn.timeout);
    }
  }

  function getFinalizingTurnForSegment(segmentId: string): FinalizingVoiceTurn | null {
    if (!currentFinalizingTurn) {
      return null;
    }

    if (currentFinalizingTurn.committedSegmentIds.includes(segmentId)) {
      return currentFinalizingTurn;
    }

    if (currentFinalizingTurn.committedSegmentIds.length > 0) {
      return null;
    }

    if (activeTranscriptSegmentId && activeTranscriptSegmentId !== segmentId) {
      return null;
    }

    return currentFinalizingTurn;
  }

  function getOrderedFinalSegmentIds(turn: FinalizingVoiceTurn): string[] {
    if (turn.committedSegmentIds.length === 0) {
      return [...turn.finalTranscriptSegmentIds];
    }

    return turn.committedSegmentIds.filter((segmentId) =>
      turn.finalTranscriptSegmentIds.has(segmentId),
    );
  }

  function assembleFinalTranscript(turn: FinalizingVoiceTurn): VoiceFinalTranscript {
    const orderedFinalSegmentIds = getOrderedFinalSegmentIds(turn);
    const transcript = orderedFinalSegmentIds
      .map((segmentId) => turn.transcriptsBySegmentId.get(segmentId)?.trim() ?? "")
      .filter((segment) => segment.length > 0)
      .join(" ")
      .trim();
    const orderedFinalMeta = orderedFinalSegmentIds
      .map((segmentId) => turn.transcriptMetaBySegmentId.get(segmentId))
      .filter((meta): meta is TranscriptSegmentMeta => Boolean(meta));
    const language = orderedFinalMeta.find((meta) => meta.language)?.language;
    const singleSegmentMeta = orderedFinalMeta.length === 1 ? orderedFinalMeta[0] : null;
    const allLowConfidence =
      orderedFinalMeta.length > 0 &&
      orderedFinalMeta.every((meta) => meta.isLowConfidence === true);

    return {
      segmentId: turn.committedSegmentIds[0] ?? orderedFinalSegmentIds[0] ?? turn.turnId,
      transcript,
      ...(language ? { language } : {}),
      ...(singleSegmentMeta?.avgLogprob !== undefined
        ? { avgLogprob: singleSegmentMeta.avgLogprob }
        : {}),
      ...(allLowConfidence ? { isLowConfidence: true } : {}),
      durationMs: Math.max(0, Date.now() - turn.startedAt),
    };
  }

  function fireFinalTranscript(turn: FinalizingVoiceTurn, reason: "complete" | "timeout"): void {
    if (turn.fired || currentFinalizingTurn?.turnId !== turn.turnId) {
      return;
    }

    turn.fired = true;
    clearTimeout(turn.timeout);
    currentFinalizingTurn = null;

    if (reason === "timeout") {
      // The final did not come in time. Better the text read so far than an empty turn.
      for (const segmentId of turn.committedSegmentIds) {
        if (turn.finalTranscriptSegmentIds.has(segmentId)) continue;
        const partial = latestPartialBySegmentId.get(segmentId);
        if (!partial) continue;
        turn.transcriptsBySegmentId.set(segmentId, partial);
        turn.finalTranscriptSegmentIds.add(segmentId);
        params.logger.warn(
          { turnId: turn.turnId, segmentId, partialLength: partial.length },
          "voice_turn.final_transcript_timeout_used_partial",
        );
      }
    }
    for (const segmentId of turn.committedSegmentIds) {
      latestPartialBySegmentId.delete(segmentId);
    }

    const finalTranscript = assembleFinalTranscript(turn);
    if (reason === "timeout") {
      params.logger.warn(
        {
          turnId: turn.turnId,
          committedSegments: turn.committedSegmentIds.length,
          receivedFinals: turn.finalTranscriptSegmentIds.size,
          timeoutMs: turn.timeoutMs,
          transcriptLength: finalTranscript.transcript.length,
        },
        "voice_turn.final_transcript_timeout",
      );
    }

    if (mergeGraceMs > 0) {
      deliverPending();
      pendingDelivery = {
        transcript: finalTranscript,
        audio: turn.audio,
        audioBytes: turn.audioBytes,
        timer: setTimeout(deliverPending, mergeGraceMs),
      };
      return;
    }

    void runSerial(async () => {
      await params.callbacks.onFinalTranscript(finalTranscript);
    });
  }

  function maybeFireFinalTranscript(turn: FinalizingVoiceTurn): void {
    if (turn.fired || turn.committedSegmentIds.length === 0) {
      return;
    }

    const allCommittedSegmentsFinal = turn.committedSegmentIds.every((segmentId) =>
      turn.finalTranscriptSegmentIds.has(segmentId),
    );
    if (allCommittedSegmentsFinal) {
      fireFinalTranscript(turn, "complete");
    }
  }

  async function reconnectSttSession(): Promise<void> {
    const previousSession = sttSession;
    sttSession = null;
    sttResampler = null;
    sttInputRate = 0;
    previousSession?.close();

    try {
      const nextSession = createSttSession();
      await nextSession.connect();
      sttSession = nextSession;
      params.logger.info("voice_turn.stt_reconnected");
    } catch (error) {
      fail(error);
      params.logger.warn({ err: error }, "voice_turn.stt_reconnect_failed");
    }
  }

  function handleSttError(error: unknown): void {
    fail(error);
    params.logger.warn({ err: error }, "voice_turn.stt_error");
    if (reconnectAttemptedForTurn) {
      sttSession?.close();
      sttSession = null;
      return;
    }

    reconnectAttemptedForTurn = true;
    void runSerial(reconnectSttSession);
  }

  function handleFinalSttTranscript(event: StreamingTranscriptionEvent): void {
    if (supersededSegmentIds.has(event.segmentId)) {
      return;
    }
    const turn = getFinalizingTurnForSegment(event.segmentId);
    if (!turn || turn.fired) {
      return;
    }

    turn.transcriptsBySegmentId.set(event.segmentId, event.transcript);
    turn.finalTranscriptSegmentIds.add(event.segmentId);
    turn.transcriptMetaBySegmentId.set(event.segmentId, {
      ...(event.language ? { language: event.language } : {}),
      ...(event.avgLogprob !== undefined ? { avgLogprob: event.avgLogprob } : {}),
      ...(event.isLowConfidence !== undefined ? { isLowConfidence: event.isLowConfidence } : {}),
    });
    maybeFireFinalTranscript(turn);
  }

  function handlePartialSttTranscript(event: StreamingTranscriptionEvent): void {
    const partialText = event.transcript.trim();
    if (partialText) {
      latestPartialBySegmentId.set(event.segmentId, partialText);
    }
    if (state.status !== "capturing" || partialTranscriptFired) {
      return;
    }

    if (sealedTranscriptSegmentIds.has(event.segmentId)) {
      return;
    }

    if (activeTranscriptSegmentId && event.segmentId !== activeTranscriptSegmentId) {
      return;
    }

    const transcript = event.transcript.trim();
    if (!transcript) {
      return;
    }

    activeTranscriptSegmentId = event.segmentId;

    if (isFillerOnlyPartial(transcript)) {
      return;
    }

    firePartialTranscript(event.segmentId, transcript);
  }

  function handleSttTranscript(event: StreamingTranscriptionEvent): void {
    if (event.isFinal) {
      handleFinalSttTranscript(event);
      return;
    }

    handlePartialSttTranscript(event);
  }

  function createSttSession(): StreamingTranscriptionSession {
    const session = params.stt.createSession({
      logger: params.logger.child({ component: "stt" }),
      language: params.sttLanguage ?? "en",
    });
    session.on("transcript", handleSttTranscript);
    session.on("committed", ({ segmentId }) => {
      sealedTranscriptSegmentIds.add(segmentId);
      if (state.status === "capturing" && !activeTranscriptSegmentId) {
        activeTranscriptSegmentId = segmentId;
      }
      const turn = currentFinalizingTurn;
      if (turn && !turn.committedSegmentIds.includes(segmentId)) {
        turn.committedSegmentIds.push(segmentId);
        maybeFireFinalTranscript(turn);
      }
    });
    session.on("error", handleSttError);
    return session;
  }

  function runSerial(task: () => Promise<void>): Promise<void> {
    queued = queued.then(task).catch((error) => {
      fail(error);
    });
    return queued;
  }

  function updateDetectorResampler(parsedInputRate: number): void {
    if (parsedInputRate === inputRate) {
      return;
    }

    inputRate = parsedInputRate;
    resampler =
      inputRate === detector.requiredSampleRate
        ? null
        : new Pcm16MonoResampler({
            inputRate,
            outputRate: detector.requiredSampleRate,
          });
  }

  function updateSttResampler(
    session: StreamingTranscriptionSession,
    parsedInputRate: number,
  ): void {
    if (parsedInputRate === sttInputRate) {
      return;
    }

    sttInputRate = parsedInputRate;
    sttResampler =
      sttInputRate === session.requiredSampleRate
        ? null
        : new Pcm16MonoResampler({
            inputRate: sttInputRate,
            outputRate: session.requiredSampleRate,
          });
  }

  function pcmForDetector(pcm16: Buffer): Buffer {
    return resampler === null ? pcm16 : resampler.processChunk(pcm16);
  }

  function pcmForStt(
    session: StreamingTranscriptionSession,
    pcm16: Buffer,
    detectorPcm16: Buffer,
  ): Buffer {
    if (session.requiredSampleRate === detector.requiredSampleRate) {
      return detectorPcm16;
    }

    if (sttResampler === null) {
      return pcm16;
    }

    return sttResampler.processChunk(pcm16);
  }

  async function handleSpeechStarted(): Promise<void> {
    if (state.status === "capturing") {
      return;
    }

    utteranceBytes = 0;
    // Detectors that confirm late already vouch for the speech.
    const started = params.callbacks.onSpeechStarted();
    const sustained =
      !detector.emitsSpeechSustained && params.callbacks.onSpeechSustained
        ? params.callbacks.onSpeechSustained()
        : undefined;
    await started;
    await sustained;

    if (sttSession) {
      try {
        // A turn whose text has not come back yet is not dropped when the user speaks
        // again: its audio is read once more together with the new speech.
        const overlapped =
          currentFinalizingTurn && !currentFinalizingTurn.fired ? currentFinalizingTurn : null;
        const maxBytes = Math.round(
          (sttSession.requiredSampleRate * 2 * MAX_MERGED_AUDIO_MS) / 1000,
        );
        turnAudio = [];
        turnAudioBytes = 0;
        const previous = pendingDelivery ?? overlapped;
        if (previous && previous.audioBytes + prerollBytes <= maxBytes) {
          if (pendingDelivery) {
            clearTimeout(pendingDelivery.timer);
            pendingDelivery = null;
          } else if (overlapped) {
            clearTimeout(overlapped.timeout);
            overlapped.fired = true;
            for (const segmentId of overlapped.committedSegmentIds) {
              supersededSegmentIds.add(segmentId);
              latestPartialBySegmentId.delete(segmentId);
            }
          }
          for (const chunk of previous.audio) {
            feedStt(sttSession, chunk);
          }
          params.logger.info(
            {
              carriedMs: Math.round(
                ((previous.audioBytes / 2) * 1000) / sttSession.requiredSampleRate,
              ),
              reason: overlapped ? "still_reading" : "within_grace",
            },
            "voice_turn.merged_previous",
          );
        } else {
          deliverPending();
        }
        flushPreroll(sttSession);
      } catch (error) {
        handleSttError(error);
      }
    }

    const startedAt = Date.now();
    activeTranscriptSegmentId = null;
    partialTranscriptFired = false;
    reconnectAttemptedForTurn = false;
    clearFinalizingTurnTimeout();
    currentFinalizingTurn = null;
    state = {
      status: "capturing",
      utteranceId: uuidv4(),
      startedAt,
    };
    params.logger.info(
      {
        utteranceId: state.utteranceId,
      },
      "voice_turn.speech_started",
    );
  }

  async function handleSpeechStopped(): Promise<void> {
    if (state.status !== "capturing") {
      return;
    }

    const turnId = state.utteranceId;
    const startedAt = state.startedAt;
    const endedAt = Date.now();

    state = { status: "listening" };

    const audioSeconds = utteranceBytes / 2 / (sttSession?.requiredSampleRate ?? 16_000);
    const timeoutMs = finalTranscriptTimeoutMs(audioSeconds);
    const finalizingTurn: FinalizingVoiceTurn = {
      turnId,
      startedAt,
      committedSegmentIds: [],
      transcriptsBySegmentId: new Map(),
      finalTranscriptSegmentIds: new Set(),
      transcriptMetaBySegmentId: new Map(),
      timeout: setTimeout(() => {
        fireFinalTranscript(finalizingTurn, "timeout");
      }, timeoutMs),
      timeoutMs,
      audio: turnAudio,
      audioBytes: turnAudioBytes,
      fired: false,
    };
    currentFinalizingTurn = finalizingTurn;

    detector.reset();
    try {
      sttSession?.commit();
    } catch (error) {
      handleSttError(error);
    }

    await params.callbacks.onSpeechStopped();

    params.logger.info(
      {
        utteranceAgeMs: Math.max(0, endedAt - startedAt),
      },
      "voice_turn.speech_stopped",
    );
  }

  detector.on("speech_started", () => {
    void runSerial(handleSpeechStarted);
  });
  detector.on("speech_sustained", () => {
    void runSerial(async () => {
      if (state.status === "capturing") {
        await params.callbacks.onSpeechSustained?.();
      }
    });
  });
  detector.on("speech_stopped", () => {
    void runSerial(handleSpeechStopped);
  });
  detector.on("error", fail);

  return {
    async start(): Promise<void> {
      sttSession = createSttSession();
      await sttSession.connect();
      await detector.connect();
      state = { status: "listening" };
    },

    async stop(): Promise<void> {
      await runSerial(async () => {
        clearFinalizingTurnTimeout();
        detector.close();
        sttSession?.close();
        resampler?.reset();
        sttResampler?.reset();
        resampler = null;
        sttResampler = null;
        sttSession = null;
        prerollChunks = [];
        prerollBytes = 0;
        latestPartialBySegmentId.clear();
        if (pendingDelivery) {
          clearTimeout(pendingDelivery.timer);
          pendingDelivery = null;
        }
        turnAudio = [];
        turnAudioBytes = 0;
        currentFinalizingTurn = null;
        state = { status: "idle" };
      });
    },

    async appendClientChunk(input): Promise<void> {
      await runSerial(async () => {
        if (state.status === "idle") {
          return;
        }

        const pcm16 = Buffer.from(input.audioBase64, "base64");
        if (pcm16.length === 0) {
          return;
        }

        const parsedInputRate =
          parsePcmRateFromFormat(input.format, detector.requiredSampleRate) ??
          detector.requiredSampleRate;

        updateDetectorResampler(parsedInputRate);
        const currentSttSession = sttSession;
        if (currentSttSession) {
          updateSttResampler(currentSttSession, parsedInputRate);
        }

        const detectorPcm16 = pcmForDetector(pcm16);
        const sttPcm16 = currentSttSession
          ? pcmForStt(currentSttSession, pcm16, detectorPcm16)
          : null;
        if (detectorPcm16.length === 0 && (!sttPcm16 || sttPcm16.length === 0)) {
          return;
        }

        if (detectorPcm16.length > 0) {
          detector.appendPcm16(detectorPcm16);
        }

        if (sttPcm16 && sttPcm16.length > 0 && currentSttSession) {
          try {
            if (state.status === "capturing") {
              feedStt(currentSttSession, sttPcm16);
            } else {
              holdPreroll(currentSttSession, sttPcm16);
            }
          } catch (error) {
            handleSttError(error);
          }
        }
      });
    },
  };
}
