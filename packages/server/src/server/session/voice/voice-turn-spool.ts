import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";

import { paseoHome } from "./voice-input-dump.js";

/**
 * A turn's audio, on disk, from the moment the user stops speaking until its text has been
 * delivered to the agent. If the daemon dies in between, nothing is lost: the audio is read
 * again on the next start.
 */
export interface SpooledVoiceTurn {
  id: string;
  agentId: string | null;
  sampleRate: number;
  startedAt: number;
  /** Earlier turns whose audio this one contains; they are not recovered separately. */
  supersedes: string[];
  audio: Buffer;
}

export interface VoiceTurnSpool {
  save(turn: Omit<SpooledVoiceTurn, "audio" | "agentId"> & { audio: Buffer[] }): void;
  remove(id: string): void;
  list(): SpooledVoiceTurn[];
}

interface SpoolMetadata {
  agentId: string | null;
  sampleRate: number;
  startedAt: number;
  supersedes: string[];
}

export function voiceTurnSpoolDirectory(): string {
  return join(paseoHome(), "voice-pending");
}

export function createVoiceTurnSpool(options: {
  agentId: string | null;
  logger: Logger;
  directory?: string;
}): VoiceTurnSpool {
  const directory = options.directory ?? voiceTurnSpoolDirectory();
  const audioPath = (id: string) => join(directory, `${id}.pcm`);
  const metadataPath = (id: string) => join(directory, `${id}.json`);

  function writeAtomic(path: string, data: Buffer | string): void {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, data);
    renameSync(temporary, path);
  }

  return {
    save(turn) {
      try {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeAtomic(audioPath(turn.id), Buffer.concat(turn.audio));
        const metadata: SpoolMetadata = {
          agentId: options.agentId,
          sampleRate: turn.sampleRate,
          startedAt: turn.startedAt,
          supersedes: turn.supersedes,
        };
        writeAtomic(metadataPath(turn.id), JSON.stringify(metadata));
      } catch (error) {
        // Losing the safety net must not stop the turn itself.
        options.logger.warn({ err: error, turnId: turn.id }, "voice_turn.spool_save_failed");
      }
    },

    remove(id) {
      try {
        rmSync(audioPath(id), { force: true });
        rmSync(metadataPath(id), { force: true });
      } catch (error) {
        options.logger.warn({ err: error, turnId: id }, "voice_turn.spool_remove_failed");
      }
    },

    list() {
      let names: string[];
      try {
        names = readdirSync(directory).filter((name) => name.endsWith(".json"));
      } catch {
        return [];
      }
      const turns: SpooledVoiceTurn[] = [];
      for (const name of names) {
        const id = name.slice(0, -".json".length);
        try {
          const metadata = JSON.parse(readFileSync(metadataPath(id), "utf8")) as SpoolMetadata;
          turns.push({
            id,
            agentId: metadata.agentId ?? null,
            sampleRate: metadata.sampleRate,
            startedAt: metadata.startedAt,
            supersedes: Array.isArray(metadata.supersedes) ? metadata.supersedes : [],
            audio: readFileSync(audioPath(id)),
          });
        } catch {
          // A half-written entry; it is replaced when its turn is saved again.
        }
      }
      const covered = new Set(turns.flatMap((turn) => turn.supersedes));
      return turns
        .filter((turn) => !covered.has(turn.id))
        .sort((left, right) => left.startedAt - right.startedAt);
    },
  };
}
