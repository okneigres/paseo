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
import { rereadAudio } from "./voice-reread.js";
import type { VoiceTurnSpool } from "./voice-turn-spool.js";

// How long a turn's text may take before it counts as slow. Slow is a signal, never a
// deadline: the turn keeps its audio and keeps waiting, because dropping or cutting short
// what the user said is worse than waiting. A slow turn is also read again from its saved
// audio, beside the first attempt, and whichever finishes first is delivered.
const VOICE_FINAL_TRANSCRIPT_SLOW_MS = 10_000;
// Reading the last stretch of a long utterance takes a while even when the earlier
// stretches were read as the user spoke, so slow is judged against the utterance.
const VOICE_FINAL_TRANSCRIPT_SLOW_PER_AUDIO_SECOND_MS = 150;
const VOICE_FINAL_TRANSCRIPT_SLOW_MAX_MS = 60_000;
const VOICE_FINAL_TRANSCRIPT_SLOW_REPEAT_MS = 30_000;
const MAX_REREAD_ATTEMPTS = 3;
const REREAD_RETRY_DELAY_MS = 3_000;

function slowTranscriptThresholdMs(audioSeconds: number): number {
  return Math.min(
    VOICE_FINAL_TRANSCRIPT_SLOW_MAX_MS,
    VOICE_FINAL_TRANSCRIPT_SLOW_MS +
      Math.round(audioSeconds * VOICE_FINAL_TRANSCRIPT_SLOW_PER_AUDIO_SECOND_MS),
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
  /** The text of a finished turn is taking long; the turn keeps waiting and is read again. */
  onTranscriptionSlow?(input: { turnId: string; waitedMs: number }): void | Promise<void>;
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
  // Watches for a slow turn; it never delivers anything.
  timeout: ReturnType<typeof setTimeout>;
  slowMs: number;
  stoppedAt: number;
  // What the transcriber was given for this turn, so it can be read again.
  audio: Buffer[];
  audioBytes: number;
  // This turn and the earlier turns whose audio it contains, in the spool until delivered.
  spoolIds: string[];
  rereadAttempts: number;
  rereading: boolean;
  rereadTimer: ReturnType<typeof setTimeout> | null;
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
  /** Keeps each turn's audio on disk until its text has been delivered. */
  spool?: VoiceTurnSpool;
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
  // Spool ids of the turns already merged into the utterance in progress.
  let utteranceSpoolIds: string[] = [];
  let pendingDelivery: {
    transcript: VoiceFinalTranscript;
    audio: Buffer[];
    audioBytes: number;
    spoolIds: string[];
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
    deliverTranscript(pending.transcript, pending.spoolIds);
  }

  // The audio leaves the spool only once the agent has the text.
  function deliverTranscript(transcript: VoiceFinalTranscript, spoolIds: string[]): void {
    void runSerial(async () => {
      await params.callbacks.onFinalTranscript(transcript);
      for (const id of spoolIds) {
        params.spool?.remove(id);
      }
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

  function fireFinalTranscript(turn: FinalizingVoiceTurn): void {
    if (turn.fired || currentFinalizingTurn?.turnId !== turn.turnId) {
      return;
    }
    completeTurn(turn, assembleFinalTranscript(turn));
  }

  // The text of a turn is ready, from the first reading or from a re-read; whichever comes
  // first is delivered and the other is ignored.
  function completeTurn(turn: FinalizingVoiceTurn, finalTranscript: VoiceFinalTranscript): void {
    if (turn.fired) {
      return;
    }
    turn.fired = true;
    clearTimeout(turn.timeout);
    if (turn.rereadTimer) {
      clearTimeout(turn.rereadTimer);
    }
    if (currentFinalizingTurn?.turnId === turn.turnId) {
      currentFinalizingTurn = null;
    }

    if (mergeGraceMs > 0) {
      deliverPending();
      pendingDelivery = {
        transcript: finalTranscript,
        audio: turn.audio,
        audioBytes: turn.audioBytes,
        spoolIds: turn.spoolIds,
        timer: setTimeout(deliverPending, mergeGraceMs),
      };
      return;
    }

    deliverTranscript(finalTranscript, turn.spoolIds);
  }

  function watchForSlowTurn(turn: FinalizingVoiceTurn, afterMs: number): void {
    turn.timeout = setTimeout(() => {
      if (turn.fired) {
        return;
      }
      const waitedMs = Date.now() - turn.stoppedAt;
      params.logger.warn(
        {
          turnId: turn.turnId,
          waitedMs,
          committedSegments: turn.committedSegmentIds.length,
          receivedFinals: turn.finalTranscriptSegmentIds.size,
          rereadAttempts: turn.rereadAttempts,
        },
        "voice_turn.final_transcript_slow",
      );
      void Promise.resolve(
        params.callbacks.onTranscriptionSlow?.({ turnId: turn.turnId, waitedMs }),
      ).catch(() => undefined);
      startReread(turn, "slow");
      watchForSlowTurn(turn, VOICE_FINAL_TRANSCRIPT_SLOW_REPEAT_MS);
    }, afterMs);
  }

  // Read the turn's saved audio again on a session of its own. The first reading is left
  // running; if it finishes first this one is ignored.
  function startReread(turn: FinalizingVoiceTurn, reason: "slow" | "stt_error" | "retry"): void {
    if (turn.fired || turn.rereading || turn.rereadAttempts >= MAX_REREAD_ATTEMPTS) {
      return;
    }
    turn.rereading = true;
    turn.rereadAttempts += 1;
    const attempt = turn.rereadAttempts;
    params.logger.warn({ turnId: turn.turnId, attempt, reason }, "voice_turn.reread_started");

    void rereadAudio({
      stt: params.stt,
      language: params.sttLanguage,
      audio: turn.audio,
      logger: params.logger.child({ component: "stt-reread" }),
    }).then(
      (result) => {
        turn.rereading = false;
        if (turn.fired) {
          return;
        }
        params.logger.info({ turnId: turn.turnId, attempt }, "voice_turn.reread_completed");
        const transcript = result.text.trim();
        completeTurn(turn, {
          segmentId: turn.turnId,
          transcript,
          ...(result.language ? { language: result.language } : {}),
          ...(result.isLowConfidence && transcript.length === 0 ? { isLowConfidence: true } : {}),
          durationMs: Math.max(0, Date.now() - turn.startedAt),
        });
      },
      (error: unknown) => {
        turn.rereading = false;
        params.logger.warn(
          { err: error, turnId: turn.turnId, attempt },
          "voice_turn.reread_failed",
        );
        if (!turn.fired && turn.rereadAttempts < MAX_REREAD_ATTEMPTS) {
          turn.rereadTimer = setTimeout(
            () => startReread(turn, "retry"),
            REREAD_RETRY_DELAY_MS * attempt,
          );
        }
      },
    );
  }

  function maybeFireFinalTranscript(turn: FinalizingVoiceTurn): void {
    if (turn.fired || turn.committedSegmentIds.length === 0) {
      return;
    }

    const allCommittedSegmentsFinal = turn.committedSegmentIds.every((segmentId) =>
      turn.finalTranscriptSegmentIds.has(segmentId),
    );
    if (allCommittedSegmentsFinal) {
      fireFinalTranscript(turn);
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
    // The turn that was being read when the recognizer failed is read again from its audio.
    if (currentFinalizingTurn && !currentFinalizingTurn.fired) {
      startReread(currentFinalizingTurn, "stt_error");
    }
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
        utteranceSpoolIds = [];
        const previous = pendingDelivery ?? overlapped;
        if (previous && previous.audioBytes + prerollBytes <= maxBytes) {
          if (pendingDelivery) {
            clearTimeout(pendingDelivery.timer);
            pendingDelivery = null;
          } else if (overlapped) {
            clearTimeout(overlapped.timeout);
            if (overlapped.rereadTimer) clearTimeout(overlapped.rereadTimer);
            overlapped.fired = true;
            for (const segmentId of overlapped.committedSegmentIds) {
              supersededSegmentIds.add(segmentId);
            }
          }
          utteranceSpoolIds = previous.spoolIds;
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

    const sampleRate = sttSession?.requiredSampleRate ?? 16_000;
    const audioSeconds = utteranceBytes / 2 / sampleRate;
    const slowMs = slowTranscriptThresholdMs(audioSeconds);
    const finalizingTurn: FinalizingVoiceTurn = {
      turnId,
      startedAt,
      committedSegmentIds: [],
      transcriptsBySegmentId: new Map(),
      finalTranscriptSegmentIds: new Set(),
      transcriptMetaBySegmentId: new Map(),
      timeout: setTimeout(() => undefined, 0),
      slowMs,
      stoppedAt: endedAt,
      audio: turnAudio,
      audioBytes: turnAudioBytes,
      spoolIds: [...utteranceSpoolIds, turnId],
      rereadAttempts: 0,
      rereading: false,
      rereadTimer: null,
      fired: false,
    };
    clearTimeout(finalizingTurn.timeout);
    watchForSlowTurn(finalizingTurn, slowMs);
    // On disk before anything is attempted, so a crash from here on loses nothing.
    params.spool?.save({
      id: turnId,
      sampleRate,
      startedAt,
      supersedes: utteranceSpoolIds,
      audio: turnAudio,
    });
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
        if (currentFinalizingTurn?.rereadTimer) {
          clearTimeout(currentFinalizingTurn.rereadTimer);
        }
        detector.close();
        sttSession?.close();
        resampler?.reset();
        sttResampler?.reset();
        resampler = null;
        sttResampler = null;
        sttSession = null;
        prerollChunks = [];
        prerollBytes = 0;
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
