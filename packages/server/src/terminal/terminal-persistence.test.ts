import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const createdOptions: Array<{ id?: string; initialOutput?: string }> = [];
  const outputListeners = new Map<string, (message: { type: "output"; data: string }) => void>();
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
      initialOutput?: string;
    }) {
      createdOptions.push(options);
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
    getTerminal(id: string) {
      return {
        subscribe(listener: (message: { type: "output"; data: string }) => void) {
          outputListeners.set(id, listener);
          return () => outputListeners.delete(id);
        },
      };
    },
    async getTerminalState() {
      return {
        revision: 1,
        state: {
          rows: 1,
          cols: 20,
          grid: [[{ char: "h" }, { char: "i" }]],
          scrollback: [],
          cursor: { row: 0, col: 2 },
        },
      };
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
  return {
    manager: manager as unknown as TerminalManager,
    created,
    createdOptions,
    output: (id: string) => outputListeners.get(id)?.({ type: "output", data: "x" }),
    kill: manager.killTerminal,
  };
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

  it("replays saved history into the restored terminal and drops it on close", async () => {
    dir = mkdtempSync(join(tmpdir(), "terminal-persistence-"));
    const path = join(dir, "terminals.json");
    vi.useFakeTimers();
    try {
      const first = createFakeManager();
      const firstWrapped = withTerminalPersistence(first.manager, { path });
      const a = await firstWrapped.createTerminal({ cwd: "/w", workspaceId: "ws", name: "A" });
      first.output(a.id);
      await vi.advanceTimersByTimeAsync(2500);
      firstWrapped.killAll();
      await vi.advanceTimersByTimeAsync(10);

      const second = createFakeManager();
      const secondWrapped = withTerminalPersistence(second.manager, { path });
      await secondWrapped.getTerminals("/w");
      expect(second.createdOptions[0]?.id).toBe(a.id);
      expect(second.createdOptions[0]?.initialOutput).toContain("hi");
      expect(second.createdOptions[0]?.initialOutput).toContain("restored");

      second.kill(a.id);
      expect(existsSync(join(dir, "terminal-history", `${a.id}.ansi`))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
