/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePcm16Wav } from "@/utils/pcm16-wav";

const start = vi.fn(async () => undefined);
const stop = vi.fn(async () => undefined);
let capture: { onPcmSegment: (segment: string) => void } | null = null;

vi.mock("@/hooks/use-dictation-audio-source", () => ({
  useDictationAudioSource: (options: { onPcmSegment: (segment: string) => void }) => {
    capture = options;
    return { start, stop, volume: 0.5 };
  },
}));

import { useDictationRecording } from "./use-dictation-recording";

/** The audio source hands over base64 of little-endian 16-bit PCM. */
function segment(samples: number[]): string {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
  return bytes.toString("base64");
}

describe("useDictationRecording", () => {
  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
    capture = null;
  });

  it("joins the recorded segments into one WAV", async () => {
    const { result } = renderHook(() => useDictationRecording());

    await act(async () => {
      await result.current.start();
    });
    act(() => capture?.onPcmSegment(segment([1, 2, 3])));
    act(() => capture?.onPcmSegment(segment([4, 5])));

    let recording: Awaited<ReturnType<typeof result.current.confirm>> = null;
    await act(async () => {
      recording = await result.current.confirm();
    });

    expect(recording).not.toBeNull();
    const parsed = parsePcm16Wav(recording!.bytes.buffer as ArrayBuffer);
    expect(parsed?.sampleRate).toBe(16000);
    expect(Array.from(parsed?.samples ?? [])).toEqual([1, 2, 3, 4, 5]);
    expect(recording!.durationMs).toBe(Math.round((5 / 16000) * 1000));
    expect(result.current.status).toBe("idle");
  });

  it("hands back nothing when no audio arrived", async () => {
    const { result } = renderHook(() => useDictationRecording());

    await act(async () => {
      await result.current.start();
    });
    let recording: Awaited<ReturnType<typeof result.current.confirm>> = null;
    await act(async () => {
      recording = await result.current.confirm();
    });

    expect(recording).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("drops what was recorded when the recording is cancelled", async () => {
    const { result } = renderHook(() => useDictationRecording());

    await act(async () => {
      await result.current.start();
    });
    act(() => capture?.onPcmSegment(segment([9, 9])));
    await act(async () => {
      await result.current.cancel();
    });

    let recording: Awaited<ReturnType<typeof result.current.confirm>> = "unset" as never;
    await act(async () => {
      recording = await result.current.confirm();
    });

    expect(recording).toBeNull();
  });
});
