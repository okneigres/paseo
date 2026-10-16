import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  TerminalListItem,
  TerminalManager,
  TerminalsChangedListener,
} from "./terminal-manager.js";
import { withTerminalPersistence } from "./terminal-persistence.js";

function createFakeManager() {
  const items = new Map<string, TerminalListItem>();
  const listeners = new Set<TerminalsChangedListener>();
  const created: string[] = [];
  function emit(cwd: string) {
    const terminals = Array.from(items.values()).filter((item) => item.cwd === cwd);
    for (const listener of listeners) listener({ cwd, terminals });
  }
  const manager = {
    async createTerminal(options: {
      id?: string;
      cwd: string;
      workspaceId: string;
      name?: string;
      title?: string;
    }) {
      const id = options.id ?? `t${items.size + 1}`;
      created.push(id);
      items.set(id, {
        id,
        name: options.name ?? "Terminal",
        cwd: options.cwd,
        workspaceId: options.workspaceId,
        ...(options.title ? { title: options.title } : {}),
        activity: null,
      });
      emit(options.cwd);
      return { id } as never;
    },
    async getTerminals() {
      return [];
    },
    subscribeTerminalsChanged(listener: TerminalsChangedListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    killTerminal(id: string) {
      const item = items.get(id);
      items.delete(id);
      if (item) emit(item.cwd);
    },
    killAll() {
      items.clear();
    },
  };
  return { manager: manager as unknown as TerminalManager, created, kill: manager.killTerminal };
}

describe("withTerminalPersistence", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("restores terminals under their ids after a restart, but not closed ones", async () => {
    dir = mkdtempSync(join(tmpdir(), "terminal-persistence-"));
    const path = join(dir, "terminals.json");

    const first = createFakeManager();
    const firstWrapped = withTerminalPersistence(first.manager, { path });
    const a = await firstWrapped.createTerminal({ cwd: "/w", workspaceId: "ws", name: "A" });
    const b = await firstWrapped.createTerminal({ cwd: "/w", workspaceId: "ws", name: "B" });
    first.kill(b.id);
    firstWrapped.killAll();

    const second = createFakeManager();
    const secondWrapped = withTerminalPersistence(second.manager, { path });
    await secondWrapped.getTerminals("/w");
    expect(second.created).toEqual([a.id]);
    expect(
      JSON.parse(readFileSync(path, "utf8")).terminals.map((t: { id: string }) => t.id),
    ).toEqual([a.id]);
  });

  it("starts empty when the file is corrupt", async () => {
    dir = mkdtempSync(join(tmpdir(), "terminal-persistence-"));
    const path = join(dir, "terminals.json");
    writeFileSync(path, "{nope");
    const fake = createFakeManager();
    await withTerminalPersistence(fake.manager, { path }).getTerminals("/w");
    expect(fake.created).toEqual([]);
  });
});
