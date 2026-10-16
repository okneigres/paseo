import { describe, expect, it } from "vitest";
import { CAPTURE_WORKLET_NAME, CAPTURE_WORKLET_SOURCE } from "./capture-worklet";

interface Posted {
  pcm: ArrayBuffer;
  rms: number;
}

// Runs the real worklet source in a stand-in for the audio worklet scope.
function createProcessor(sampleRate: number, flushSamples: number) {
  const posted: Posted[] = [];
  let ProcessorClass:
    | (new (options: unknown) => {
        port: unknown;
        process(inputs: Float32Array[][]): boolean;
      })
    | null = null;
  class AudioWorkletProcessor {
    port = {
      postMessage: (message: Posted) => {
        posted.push(message);
      },
    };
  }
  const registerProcessor = (name: string, processor: typeof ProcessorClass) => {
    expect(name).toBe(CAPTURE_WORKLET_NAME);
    ProcessorClass = processor;
  };
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", CAPTURE_WORKLET_SOURCE)(
    AudioWorkletProcessor,
    registerProcessor,
    sampleRate,
  );
  const processor = new ProcessorClass!({ processorOptions: { targetRate: 16000, flushSamples } });
  return { processor, posted };
}

function feed(processor: { process(i: Float32Array[][]): boolean }, samples: Float32Array) {
  for (let offset = 0; offset < samples.length; offset += 128) {
    processor.process([[samples.subarray(offset, offset + 128)]]);
  }
}

function toInt16(posted: Posted[]): number[] {
  return posted.flatMap((message) => Array.from(new Int16Array(message.pcm)));
}

describe("capture worklet", () => {
  it("turns 48 kHz input into 16 kHz samples, a third as many", () => {
    const { processor, posted } = createProcessor(48000, 160);
    feed(processor, new Float32Array(48000).fill(0.5));
    const pcm = toInt16(posted);
    expect(pcm.length).toBe(16000);
    expect(Math.abs(pcm[100] - 0.5 * 0x7fff)).toBeLessThan(2);
  });

  it("handles a non-integer ratio without drift between blocks", () => {
    const { processor, posted } = createProcessor(44100, 160);
    feed(processor, new Float32Array(44100).fill(0.25));
    const pcm = toInt16(posted);
    // One second of input is within a sample or two of 16000 outputs.
    expect(Math.abs(pcm.length - 16000)).toBeLessThanOrEqual(160);
    for (const value of pcm.slice(10)) {
      expect(Math.abs(value - 0.25 * 0x7fff)).toBeLessThan(2);
    }
  });

  it("averages instead of dropping samples, so a tone above 8 kHz is weakened", () => {
    const { processor, posted } = createProcessor(48000, 160);
    const tone = new Float32Array(48000);
    for (let i = 0; i < tone.length; i += 1) tone[i] = Math.sin((2 * Math.PI * 12000 * i) / 48000);
    feed(processor, tone);
    const pcm = toInt16(posted).slice(100);
    const peak = Math.max(...pcm.map((value) => Math.abs(value))) / 0x7fff;
    // Plain decimation would keep the full amplitude of the folded tone.
    expect(peak).toBeLessThan(0.4);
  });

  it("reports the input level and clips overshoot", () => {
    const { processor, posted } = createProcessor(16000, 160);
    feed(processor, new Float32Array(1600).fill(2));
    expect(posted[0].rms).toBeCloseTo(2, 5);
    expect(Math.max(...toInt16(posted))).toBe(0x7fff);
  });

  it("keeps running when there is no input", () => {
    const { processor } = createProcessor(48000, 160);
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
  });
});
