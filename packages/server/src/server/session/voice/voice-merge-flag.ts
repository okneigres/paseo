import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_MERGE_GRACE_MS = 1500;

/**
 * Experiment switch. When <paseo home>/voice-merge exists, a finished voice turn is
 * held for the number of milliseconds written in it (1500 if empty) and merged with
 * speech that follows. Read each time voice mode starts, so no restart is needed.
 */
export function readVoiceMergeGraceMs(): number {
  const home = process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
  const file = join(home, "voice-merge");
  if (!existsSync(file)) {
    return 0;
  }
  try {
    const value = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MERGE_GRACE_MS;
  } catch {
    return DEFAULT_MERGE_GRACE_MS;
  }
}
