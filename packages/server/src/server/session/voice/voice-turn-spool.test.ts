import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import { createVoiceTurnSpool } from "./voice-turn-spool.js";

describe("voice turn spool", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function makeSpool(agentId: string | null = "agent-1") {
    const directory = mkdtempSync(join(tmpdir(), "paseo-voice-spool-"));
    directories.push(directory);
    return {
      directory,
      spool: createVoiceTurnSpool({ agentId, logger: pino({ level: "silent" }), directory }),
    };
  }

  it("keeps a turn's audio until it is removed", () => {
    const { spool, directory } = makeSpool();
    spool.save({
      id: "turn-1",
      sampleRate: 16000,
      startedAt: 10,
      supersedes: [],
      audio: [Buffer.from([1, 2]), Buffer.from([3, 4])],
    });

    const [turn] = spool.list();
    expect(turn).toMatchObject({ id: "turn-1", agentId: "agent-1", sampleRate: 16000 });
    expect(turn.audio).toEqual(Buffer.from([1, 2, 3, 4]));

    spool.remove("turn-1");
    expect(spool.list()).toEqual([]);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("lists a merged turn once, not the turns it contains", () => {
    const { spool } = makeSpool();
    spool.save({
      id: "a",
      sampleRate: 16000,
      startedAt: 1,
      supersedes: [],
      audio: [Buffer.from([1])],
    });
    spool.save({
      id: "b",
      sampleRate: 16000,
      startedAt: 2,
      supersedes: ["a"],
      audio: [Buffer.from([1, 2])],
    });
    spool.save({
      id: "c",
      sampleRate: 16000,
      startedAt: 3,
      supersedes: [],
      audio: [Buffer.from([9])],
    });

    expect(spool.list().map((turn) => turn.id)).toEqual(["b", "c"]);
  });

  it("skips half-written entries and an absent directory", () => {
    const { spool, directory } = makeSpool();
    expect(spool.list()).toEqual([]);
    rmSync(directory, { recursive: true, force: true });
    expect(spool.list()).toEqual([]);
  });
});
