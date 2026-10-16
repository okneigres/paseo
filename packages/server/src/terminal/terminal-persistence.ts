import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TerminalListItem, TerminalManager } from "./terminal-manager.js";

interface PersistedTerminal {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;
  title?: string;
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

/**
 * Keeps terminal identities (id, name, title, cwd, workspace) across daemon
 * restarts. Processes are not preserved: each recorded terminal comes back as a
 * fresh shell under the same id, so clients keep their tabs.
 */
export function withTerminalPersistence(
  inner: TerminalManager,
  options: { path: string; logger?: Logger },
): TerminalManager {
  const { path, logger } = options;
  const entries = new Map<string, PersistedTerminal>();
  let frozen = true;

  function save(): void {
    try {
      writePersistedTerminals(path, Array.from(entries.values()));
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
      }
    }
    for (const item of event.terminals) {
      entries.set(item.id, toPersisted(item));
    }
    save();
  });

  const restored = (async () => {
    const recorded = readPersistedTerminals(path);
    for (const entry of recorded) {
      try {
        await inner.createTerminal({
          id: entry.id,
          cwd: entry.cwd,
          workspaceId: entry.workspaceId,
          name: entry.name,
          ...(entry.title ? { title: entry.title } : {}),
        });
        entries.set(entry.id, entry);
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
      return inner.createTerminal(createOptions);
    },
    killAll() {
      // Shutdown, not a user close: keep the file so the next start restores it.
      frozen = true;
      inner.killAll();
    },
  };
}
