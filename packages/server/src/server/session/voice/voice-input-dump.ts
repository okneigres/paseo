import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePcmRateFromFormat } from "../../speech/audio.js";

// Records exactly what voice mode receives from the client, as a WAV, with a
// text file of the turn events beside it, so a bad transcript can be replayed
// offline. Enabled by creating <paseo home>/debug-voice-input; no restart.

const WAV_HEADER_BYTES = 44;

export interface VoiceInputDump {
  readonly path: string;
  writeChunk(pcm16: Buffer, format: string): void;
  note(text: string): void;
  close(): void;
}

function paseoHome(): string {
  return process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
}

function buildWavHeader(sampleRate: number, dataBytes: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export function openVoiceInputDump(): VoiceInputDump | null {
  const home = paseoHome();
  if (!existsSync(join(home, "debug-voice-input"))) {
    return null;
  }
  const directory = join(home, "debug", "voice-input");
  mkdirSync(directory, { recursive: true });
  const base = join(directory, `voice-${new Date().toISOString().replace(/[:.]/g, "_")}`);
  const wavPath = `${base}.wav`;
  const notesPath = `${base}.txt`;
  const fd = openSync(wavPath, "w");
  writeSync(fd, buildWavHeader(16000, 0));

  let sampleRate = 16000;
  let dataBytes = 0;
  let closed = false;
  const elapsed = () => (dataBytes / 2 / sampleRate).toFixed(2);

  return {
    path: wavPath,
    writeChunk(pcm16, format) {
      if (closed) return;
      sampleRate = parsePcmRateFromFormat(format, sampleRate) ?? sampleRate;
      writeSync(fd, pcm16);
      dataBytes += pcm16.length;
    },
    note(text) {
      if (closed) return;
      appendFileSync(notesPath, `${elapsed()}s ${text}\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      writeSync(fd, buildWavHeader(sampleRate, dataBytes), 0, WAV_HEADER_BYTES, 0);
      closeSync(fd);
    },
  };
}
