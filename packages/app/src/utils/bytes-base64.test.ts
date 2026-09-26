import { describe, expect, it } from "vitest";
import { encodeBytesToBase64 } from "./bytes-base64";

describe("encodeBytesToBase64", () => {
  it("encodes bytes the file APIs can write back", () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]);

    expect(encodeBytesToBase64(bytes)).toBe("aGVsbG8=");
  });

  it("encodes files larger than a single chunk call can carry", () => {
    const bytes = new Uint8Array(70_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }

    expect(encodeBytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
