import type { FormPreferences, WorkspaceFormPreferences } from "../preferences";
import type { CreateAgentPreferenceStorage } from "../storage";

interface PendingWrite {
  finish: () => void;
  fail: (error: Error) => void;
}

export class FakeCreateAgentPreferenceStorage implements CreateAgentPreferenceStorage {
  private storedGlobal: unknown;
  private storedWorkspaces: unknown;
  private readonly pendingWrites: PendingWrite[] = [];
  private readonly pendingWriteWaiters: Array<(write: PendingWrite) => void> = [];

  constructor(input: { stored?: unknown; storedWorkspaces?: unknown } = {}) {
    this.storedGlobal = input.stored ?? null;
    this.storedWorkspaces = input.storedWorkspaces ?? null;
  }

  async readGlobal(): Promise<unknown> {
    return this.storedGlobal;
  }

  async readWorkspaces(): Promise<unknown> {
    return this.storedWorkspaces;
  }

  writeGlobal(preferences: FormPreferences): Promise<void> {
    return this.enqueue(() => {
      this.storedGlobal = clone(preferences);
    });
  }

  writeWorkspaces(workspaces: WorkspaceFormPreferences): Promise<void> {
    return this.enqueue(() => {
      this.storedWorkspaces = clone(workspaces);
    });
  }

  nextWrite(): Promise<PendingWrite> {
    const next = this.pendingWrites[0];
    if (next) {
      return Promise.resolve(next);
    }
    const waiter = Promise.withResolvers<PendingWrite>();
    this.pendingWriteWaiters.push(waiter.resolve);
    return waiter.promise;
  }

  pendingWriteCount(): number {
    return this.pendingWrites.length;
  }

  finishOldestWrite(): void {
    const write = this.pendingWrites.shift();
    if (!write) {
      throw new Error("No pending create-agent preference write");
    }
    write.finish();
  }

  failOldestWrite(error: Error): void {
    const write = this.pendingWrites.shift();
    if (!write) {
      throw new Error("No pending create-agent preference write");
    }
    write.fail(error);
  }

  savedGlobalPreferences(): unknown {
    return this.storedGlobal;
  }

  savedWorkspaces(): unknown {
    return this.storedWorkspaces;
  }

  private enqueue(commit: () => void): Promise<void> {
    const pending = Promise.withResolvers<void>();
    const write: PendingWrite = {
      finish: () => {
        commit();
        pending.resolve();
      },
      fail: (error: Error) => {
        pending.reject(error);
      },
    };
    this.pendingWrites.push(write);
    this.pendingWriteWaiters.shift()?.(write);
    return pending.promise;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
