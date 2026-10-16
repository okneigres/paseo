import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";

// Terminals run under `dtach`, which keeps the shell alive when the daemon (and
// with it the node-pty client attached to it) goes away. The same command
// attaches to a live session or starts a new one, so restore needs no branch.

let cachedDtach: string | null | undefined;

export function resolveDtachBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  if (cachedDtach !== undefined) {
    return cachedDtach;
  }
  cachedDtach = null;
  if (process.platform === "win32") {
    return cachedDtach;
  }
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, "dtach");
    try {
      accessSync(candidate, constants.X_OK);
      cachedDtach = candidate;
      break;
    } catch {
      // keep looking
    }
  }
  return cachedDtach;
}

export interface DetachedSessionPaths {
  socket: string;
  pidFile: string;
}

// Unix socket paths are short (about 100 bytes), so keep the names compact.
export function detachedSessionPaths(directory: string, terminalId: string): DetachedSessionPaths {
  return {
    socket: join(directory, `${terminalId}.sock`),
    pidFile: join(directory, `${terminalId}.pid`),
  };
}

export function prepareDetachDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function readDetachedShellPid(paths: DetachedSessionPaths): number | null {
  try {
    const pid = Number.parseInt(readFileSync(paths.pidFile, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isDetachedSessionAlive(directory: string, terminalId: string): boolean {
  const paths = detachedSessionPaths(directory, terminalId);
  if (!existsSync(paths.socket)) {
    return false;
  }
  const pid = readDetachedShellPid(paths);
  return pid !== null && isProcessAlive(pid);
}

// `sh -c` records the shell's pid, then becomes the shell.
export function wrapCommandForDetach(input: {
  dtach: string;
  paths: DetachedSessionPaths;
  command: string;
  args: string[];
}): { command: string; args: string[] } {
  return {
    command: input.dtach,
    args: [
      "-A",
      input.paths.socket,
      "-E",
      "-z",
      "-r",
      "winch",
      "/bin/sh",
      "-c",
      'echo $$ > "$1"; shift; exec "$@"',
      "paseo-detach",
      input.paths.pidFile,
      input.command,
      ...input.args,
    ],
  };
}

// The shell leads its own session, so signalling the group reaches its jobs too.
export function killDetachedShell(paths: DetachedSessionPaths, signal: NodeJS.Signals): void {
  const pid = readDetachedShellPid(paths);
  if (pid === null) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

export function removeDetachedSessionFiles(paths: DetachedSessionPaths): void {
  rmSync(paths.socket, { force: true });
  rmSync(paths.pidFile, { force: true });
}
