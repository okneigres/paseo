import { Buffer } from "buffer";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDictationAudioSource } from "@/hooks/use-dictation-audio-source";
import { encodePcm16Wav } from "@/utils/pcm16-wav";

import { DURATION_TICK_MS, toError } from "./use-dictation.shared";

export type DictationRecordingStatus = "idle" | "recording" | "failed";

export interface DictationRecording {
  bytes: Uint8Array;
  durationMs: number;
}

export interface UseDictationRecordingOptions {
  onError?: (error: Error) => void;
}

export interface UseDictationRecordingResult {
  isRecording: boolean;
  isRecordingActive: () => boolean;
  volume: number;
  duration: number;
  error: string | null;
  status: DictationRecordingStatus;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  confirm: () => Promise<DictationRecording | null>;
}

/** The audio source emits mono 16-bit PCM at this rate, so the WAV header must match. */
const DICTATION_SAMPLE_RATE = 16000;

/** Segments arrive as base64-encoded little-endian 16-bit PCM. */
function decodePcm16Segment(base64: string): Int16Array {
  const bytes = Buffer.from(base64, "base64");
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(i * 2, true);
  }
  return samples;
}

/**
 * Records the microphone and hands back a WAV file when the user confirms.
 *
 * Unlike `useDictation`, nothing is streamed to the daemon: the capture stays
 * in memory until `confirm()` encodes it as a 16 kHz mono WAV.
 */
export function useDictationRecording(
  options: UseDictationRecordingOptions = {},
): UseDictationRecordingResult {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DictationRecordingStatus>("idle");

  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  const isRecordingActive = useCallback(() => isRecordingRef.current, []);

  const segmentsRef = useRef<Int16Array[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionGateRef = useRef(false);

  const stopDurationTracking = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const startDurationTracking = useCallback(() => {
    if (durationIntervalRef.current) {
      return;
    }
    durationIntervalRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, DURATION_TICK_MS);
  }, []);

  const clearSegments = useCallback(() => {
    segmentsRef.current = [];
  }, []);

  const stopRecording = useCallback(() => {
    stopDurationTracking();
    isRecordingRef.current = false;
    setIsRecording(false);
  }, [stopDurationTracking]);

  const finishFailedRecording = useCallback(
    (failure: unknown, context: string) => {
      const normalized = toError(failure);
      const hadAudio = segmentsRef.current.length > 0;
      clearSegments();
      stopRecording();
      setStatus(hadAudio ? "failed" : "idle");
      setError(normalized.message);
      onErrorRef.current?.(normalized);
      console.error(`[useDictationRecording] ${context}`, normalized);
    },
    [clearSegments, stopRecording],
  );

  const audio = useDictationAudioSource({
    onPcmSegment: (segment) => {
      const samples = decodePcm16Segment(segment);
      if (samples.length === 0) {
        return;
      }
      segmentsRef.current.push(samples);
    },
    onError: (err) => {
      onErrorRef.current?.(err);
    },
    onInterruption: () => {
      finishFailedRecording(
        new Error("Dictation was interrupted by another audio source."),
        "Recording interrupted",
      );
    },
  });

  const start = useCallback(async () => {
    if (actionGateRef.current || isRecordingRef.current) {
      return;
    }
    actionGateRef.current = true;
    clearSegments();
    setError(null);
    setDuration(0);
    setStatus("recording");

    try {
      await audio.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      startDurationTracking();
    } catch (err) {
      await audio.stop().catch(() => undefined);
      stopRecording();
      setStatus("idle");
      const normalized = toError(err);
      setError(normalized.message);
      onErrorRef.current?.(normalized);
      console.error("[useDictationRecording] Failed to start recording", normalized);
    } finally {
      actionGateRef.current = false;
    }
  }, [audio, clearSegments, startDurationTracking, stopRecording]);

  const cancel = useCallback(async () => {
    clearSegments();
    stopRecording();
    setDuration(0);
    setError(null);
    setStatus("idle");
    try {
      await audio.stop();
    } catch (err) {
      const normalized = toError(err);
      setError(normalized.message);
      onErrorRef.current?.(normalized);
      console.error("[useDictationRecording] Failed to stop recording", normalized);
    }
  }, [audio, clearSegments, stopRecording]);

  const confirm = useCallback(async (): Promise<DictationRecording | null> => {
    stopDurationTracking();
    try {
      // `stop()` flushes the trailing PCM segment, so read the buffer afterwards.
      await audio.stop();
    } catch (err) {
      finishFailedRecording(err, "Failed to stop recording");
      return null;
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
    }

    const segments = segmentsRef.current;
    if (segments.length === 0) {
      clearSegments();
      setDuration(0);
      setStatus("idle");
      return null;
    }

    const sampleCount = segments.reduce((total, segment) => total + segment.length, 0);
    const samples = new Int16Array(sampleCount);
    let offset = 0;
    for (const segment of segments) {
      samples.set(segment, offset);
      offset += segment.length;
    }
    clearSegments();
    setDuration(0);
    setStatus("idle");

    return {
      bytes: encodePcm16Wav({ sampleRate: DICTATION_SAMPLE_RATE, samples }),
      durationMs: Math.round((samples.length / DICTATION_SAMPLE_RATE) * 1000),
    };
  }, [audio, clearSegments, finishFailedRecording, stopDurationTracking]);

  return {
    isRecording,
    isRecordingActive,
    volume: audio.volume,
    duration,
    error,
    status,
    start,
    cancel,
    confirm,
  };
}
