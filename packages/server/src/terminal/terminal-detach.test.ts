// POSIX-only: real dtach, real shells
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminal, type TerminalSession } from "./terminal.js";
import { isDetachedSessionAlive, resolveDtachBinary } from "./terminal-detach.js";

const available = process.platform !== "win32" && resolveDtachBinary() !== null;

async function eventually(check: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function screenText(session: TerminalSession): string {
  return session
    .getState()
    .grid.map((row) => row.map((cell) => cell.char).join(""))
    .join("\n");
}

function pidFrom(session: TerminalSession, tag: string): number | null {
  const match = new RegExp(`${tag}=(\\d+)`).exec(screenText(session));
  return match ? Number(match[1]) : null;
}

describe.skipIf(!available)("detached terminals", () => {
  const directories: string[] = [];
  const sessions: TerminalSession[] = [];
  afterEach(() => {
    for (const session of sessions.splice(0)) session.kill();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function makeDirectory(): string {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "paseo-detach-")));
    directories.push(directory);
    return directory;
  }

  it("keeps the shell running across detach and attaches to it again", async () => {
    const cwd = makeDirectory();
    const detachDir = makeDirectory();
    const open = async () => {
      const session = await createTerminal({
        id: "keep",
        cwd,
        workspaceId: "ws",
        shell: "/bin/sh",
        detachDir,
      });
      sessions.push(session);
      return session;
    };

    const first = await open();
    first.send({ type: "input", data: "echo FIRST=$$\r" });
    await eventually(() => pidFrom(first, "FIRST") !== null, "first shell pid");
    const shellPid = pidFrom(first, "FIRST");

    first.detach();
    await eventually(() => first.getExitInfo() !== null, "client exit");
    expect(isDetachedSessionAlive(detachDir, "keep")).toBe(true);

    const second = await open();
    second.send({ type: "input", data: "echo SECOND=$$\r" });
    await eventually(() => pidFrom(second, "SECOND") !== null, "second shell pid");
    expect(pidFrom(second, "SECOND")).toBe(shellPid);
  });

  it("ends the shell and removes its files when the terminal is killed", async () => {
    const cwd = makeDirectory();
    const detachDir = makeDirectory();
    const session = await createTerminal({
      id: "gone",
      cwd,
      workspaceId: "ws",
      shell: "/bin/sh",
      detachDir,
    });
    sessions.push(session);
    await eventually(() => existsSync(join(detachDir, "gone.pid")), "pid file");
    const pid = Number(readFileSync(join(detachDir, "gone.pid"), "utf8"));

    await session.killAndWait();
    await eventually(() => !isDetachedSessionAlive(detachDir, "gone"), "session gone");
    expect(existsSync(join(detachDir, "gone.sock"))).toBe(false);
    await eventually(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, "shell process exit");
  });

  it("reports a live session once the shell has started", async () => {
    const cwd = makeDirectory();
    const detachDir = makeDirectory();
    const session = await createTerminal({
      id: "fresh",
      cwd,
      workspaceId: "ws",
      shell: "/bin/sh",
      detachDir,
    });
    sessions.push(session);
    session.send({ type: "input", data: "echo FRESH=$$\r" });
    await eventually(() => pidFrom(session, "FRESH") !== null, "shell pid");
    expect(isDetachedSessionAlive(detachDir, "fresh")).toBe(true);
  });
});
