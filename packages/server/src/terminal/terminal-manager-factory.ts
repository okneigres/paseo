import type { TerminalManager } from "./terminal-manager.js";
import { withTerminalPersistence } from "./terminal-persistence.js";
import { createWorkerTerminalManager } from "./worker-terminal-manager.js";

export interface ConfiguredTerminalManagerOptions {
  getTerminalActivityUrl?: () => string | null;
  persistence?: {
    path: string;
    detach?: boolean;
    logger?: { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void };
  };
}

export function createConfiguredTerminalManager(
  options: ConfiguredTerminalManagerOptions = {},
): TerminalManager {
  const manager = createWorkerTerminalManager({
    getTerminalActivityUrl: options.getTerminalActivityUrl,
  });
  return options.persistence ? withTerminalPersistence(manager, options.persistence) : manager;
}
