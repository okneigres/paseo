import { describe, expect, it } from "vitest";
import { encodePcm16Wav, parsePcm16Wav } from "./pcm16-wav";

describe("encodePcm16Wav", () => {
  it("round-trips the samples it was given", () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    const encoded = encodePcm16Wav({ sampleRate: 16000, samples });

    expect(encoded.byteLength).toBe(44 + samples.length * 2);

    const parsed = parsePcm16Wav(encoded.buffer as ArrayBuffer);
    expect(parsed?.sampleRate).toBe(16000);
    expect(Array.from(parsed?.samples ?? [])).toEqual(Array.from(samples));
  });

  it("describes the bytes it writes", () => {
    const encoded = encodePcm16Wav({ sampleRate: 24000, samples: new Int16Array(4) });
    const text = new TextDecoder("latin1").decode(encoded.subarray(0, 4));
    const view = new DataView(encoded.buffer);

    expect(text).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(8);
  });
});
