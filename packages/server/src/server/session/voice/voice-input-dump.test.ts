import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVoiceInputDump } from "./voice-input-dump.js";

describe("openVoiceInputDump", () => {
  const original = process.env.PASEO_HOME;
  let home: string;
  afterEach(() => {
    process.env.PASEO_HOME = original;
    if (original === undefined) delete process.env.PASEO_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("does nothing unless the flag file exists", () => {
    home = mkdtempSync(join(tmpdir(), "paseo-voice-dump-"));
    process.env.PASEO_HOME = home;
    expect(openVoiceInputDump()).toBeNull();
  });

  it("writes a playable WAV and a notes file", () => {
    home = mkdtempSync(join(tmpdir(), "paseo-voice-dump-"));
    process.env.PASEO_HOME = home;
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "debug-voice-input"), "");

    const dump = openVoiceInputDump();
    expect(dump).not.toBeNull();
    const samples = Buffer.alloc(32000); // one second at 16 kHz
    dump!.writeChunk(samples, "audio/pcm;rate=16000;bits=16");
    dump!.note("speech_started");
    dump!.close();

    const wav = readFileSync(dump!.path);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(40)).toBe(32000);
    expect(wav.length).toBe(44 + 32000);
    const notes = readFileSync(dump!.path.replace(/\.wav$/, ".txt"), "utf8");
    expect(notes).toBe("1.00s speech_started\n");
  });
});
