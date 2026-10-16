import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { renderTerminalSnapshotToAnsi } from "@getpaseo/protocol/terminal-snapshot";
import type { TerminalListItem, TerminalManager } from "./terminal-manager.js";
import { isDetachedSessionAlive, resolveDtachBinary } from "./terminal-detach.js";

interface PersistedTerminal {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;
  title?: string;
  // The shell's environment keeps the token it was started with, so a shell
  // that outlives the daemon needs the same token back.
  activityToken?: string;
}

interface PersistedTerminalFile {
  version: 1;
  terminals: PersistedTerminal[];
}

interface Logger {
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

function readPersistedTerminals(path: string): PersistedTerminal[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedTerminalFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.terminals)) {
      return [];
    }
    return parsed.terminals.filter(
      (entry): entry is PersistedTerminal =>
        typeof entry?.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.cwd === "string" &&
        typeof entry.workspaceId === "string",
    );
  } catch {
    return [];
  }
}

function writePersistedTerminals(path: string, terminals: PersistedTerminal[]): void {
  const file: PersistedTerminalFile = { version: 1, terminals };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, path);
}

function toPersisted(item: TerminalListItem): PersistedTerminal {
  return {
    id: item.id,
    name: item.name,
    cwd: item.cwd,
    workspaceId: item.workspaceId,
    ...(item.title ? { title: item.title } : {}),
  };
}

const HISTORY_SCROLLBACK_LINES = 1000;
const HISTORY_IDLE_SAVE_MS = 2000;
const HISTORY_MAX_WAIT_MS = 10000;
const HISTORY_FLUSH_TIMEOUT_MS = 1500;
// Undo what an interrupted full-screen program (htop, vim) leaves behind: alt
// screen, hidden cursor, mouse reporting, bracketed paste, application keys.
// Not RIS: that would wipe the restored scrollback.
const TERMINAL_MODE_RESET =
  "\u001b[?1049l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?2004l\u001b[?1l\u001b>\u001b[0m\u001b[?25h\u001b[?7h";
const RESTORED_MARKER = `${TERMINAL_MODE_RESET}\r\n\u001b[2m── restored after daemon restart ──\u001b[0m\r\n`;

function sessionsDirFor(terminalsPath: string): string {
  return join(dirname(terminalsPath), "terminal-sessions");
}

function historyPathFor(terminalsPath: string, id: string): string {
  return join(dirname(terminalsPath), "terminal-history", `${id}.ansi`);
}

function readHistory(
  terminalsPath: string,
  id: string,
  options: { shellSurvived: boolean },
): string | undefined {
  try {
    const raw = readFileSync(historyPathFor(terminalsPath, id), "utf8");
    if (!raw) {
      return undefined;
    }
    // A shell that kept running continues right under its old prompt; a fresh
    // one starts below a marker with the full-screen modes reset.
    return options.shellSurvived ? raw : raw + RESTORED_MARKER;
  } catch {
    return undefined;
  }
}

/**
 * Keeps terminal identities (id, name, title, cwd, workspace) across daemon
 * restarts. Processes are not preserved: each recorded terminal comes back as a
 * fresh shell under the same id, so clients keep their tabs.
 */
export function withTerminalPersistence(
  inner: TerminalManager,
  options: { path: string; logger?: Logger; detach?: boolean },
): TerminalManager {
  const { path, logger } = options;
  const detachDir = options.detach !== false && resolveDtachBinary() ? sessionsDirFor(path) : null;
  if (options.detach !== false && !detachDir) {
    logger?.warn({}, "dtach is not installed; terminal shells will not outlive the daemon");
  }
  const tokens = new Map<string, string>();
  const entries = new Map<string, PersistedTerminal>();
  let frozen = true;
  const watched = new Set<string>();
  const dirty = new Set<string>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const maxWaitTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function saveHistory(id: string): Promise<void> {
    dirty.delete(id);
    try {
      const snapshot = await inner.getTerminalState(id, {
        scrollbackLines: HISTORY_SCROLLBACK_LINES,
        includeWrapFlags: true,
      });
      if (!snapshot) {
        return;
      }
      const file = historyPathFor(path, id);
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, renderTerminalSnapshotToAnsi(snapshot.state));
      renameSync(tmp, file);
    } catch (error) {
      logger?.warn({ err: error, terminalId: id }, "Failed to persist terminal history");
    }
  }

  function clearHistoryTimers(id: string): void {
    clearTimeout(idleTimers.get(id));
    clearTimeout(maxWaitTimers.get(id));
    idleTimers.delete(id);
    maxWaitTimers.delete(id);
  }

  function runScheduledHistorySave(id: string): void {
    clearHistoryTimers(id);
    if (!frozen && dirty.has(id)) {
      void saveHistory(id);
    }
  }

  function markHistoryDirty(id: string): void {
    dirty.add(id);
    clearTimeout(idleTimers.get(id));
    idleTimers.set(
      id,
      setTimeout(() => runScheduledHistorySave(id), HISTORY_IDLE_SAVE_MS),
    );
    if (!maxWaitTimers.has(id)) {
      maxWaitTimers.set(
        id,
        setTimeout(() => runScheduledHistorySave(id), HISTORY_MAX_WAIT_MS),
      );
    }
  }

  function watchHistory(id: string): void {
    if (watched.has(id)) {
      return;
    }
    const session = inner.getTerminal(id);
    if (!session) {
      return;
    }
    watched.add(id);
    session.subscribe((message) => {
      if (message.type === "output") {
        markHistoryDirty(id);
      }
    });
  }

  function forgetHistory(id: string): void {
    watched.delete(id);
    dirty.delete(id);
    clearHistoryTimers(id);
    try {
      rmSync(historyPathFor(path, id), { force: true });
    } catch {
      // no-op
    }
  }

  async function flushHistories(): Promise<void> {
    const ids = Array.from(dirty);
    await Promise.race([
      Promise.all(ids.map((id) => saveHistory(id))),
      new Promise((resolve) => setTimeout(resolve, HISTORY_FLUSH_TIMEOUT_MS)),
    ]);
  }

  function save(): void {
    try {
      writePersistedTerminals(
        path,
        Array.from(entries.values()).map((entry) => {
          const activityToken = tokens.get(entry.id);
          return activityToken ? { ...entry, activityToken } : entry;
        }),
      );
    } catch (error) {
      logger?.warn({ err: error }, "Failed to persist terminals");
    }
  }

  inner.subscribeTerminalsChanged((event) => {
    if (frozen) {
      return;
    }
    for (const [id, entry] of entries) {
      if (entry.cwd === event.cwd) {
        entries.delete(id);
        if (!event.terminals.some((item) => item.id === id)) {
          forgetHistory(id);
          tokens.delete(id);
        }
      }
    }
    for (const item of event.terminals) {
      entries.set(item.id, toPersisted(item));
      watchHistory(item.id);
    }
    save();
  });

  const restored = (async () => {
    const recorded = readPersistedTerminals(path);
    for (const entry of recorded) {
      const shellSurvived = detachDir !== null && isDetachedSessionAlive(detachDir, entry.id);
      const history = readHistory(path, entry.id, { shellSurvived });
      if (entry.activityToken) {
        tokens.set(entry.id, entry.activityToken);
      }
      try {
        await inner.createTerminal({
          id: entry.id,
          ...(entry.activityToken ? { activityToken: entry.activityToken } : {}),
          ...(detachDir ? { detachDir } : {}),
          cwd: entry.cwd,
          workspaceId: entry.workspaceId,
          name: entry.name,
          ...(entry.title ? { title: entry.title } : {}),
          ...(history ? { initialOutput: history } : {}),
        });
        entries.set(entry.id, entry);
        watchHistory(entry.id);
      } catch (error) {
        logger?.warn({ err: error, terminalId: entry.id }, "Failed to restore terminal");
      }
    }
    frozen = false;
    save();
    if (recorded.length > 0) {
      logger?.info({ restored: entries.size, recorded: recorded.length }, "Restored terminals");
    }
  })();

  return {
    ...inner,
    async getTerminals(cwd, queryOptions) {
      await restored;
      return inner.getTerminals(cwd, queryOptions);
    },
    async createTerminal(createOptions) {
      await restored;
      if (!detachDir) {
        return inner.createTerminal(createOptions);
      }
      const id = createOptions.id ?? randomUUID();
      const activityToken = createOptions.activityToken ?? randomBytes(32).toString("base64url");
      tokens.set(id, activityToken);
      try {
        return await inner.createTerminal({ ...createOptions, id, activityToken, detachDir });
      } catch (error) {
        tokens.delete(id);
        throw error;
      }
    },
    killAll() {
      // Shutdown, not a user close: keep the files so the next start restores
      // them. Give pending histories a moment to land before the shells go.
      const pending = flushHistories();
      frozen = true;
      for (const id of Array.from(idleTimers.keys())) {
        clearHistoryTimers(id);
      }
      void pending.finally(() => inner.killAll());
    },
  };
}
