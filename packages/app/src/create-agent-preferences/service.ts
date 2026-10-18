import { AsyncStorageCreateAgentPreferenceStorage } from "./storage";
import {
  DEFAULT_FORM_PREFERENCES,
  parseFormPreferences,
  parseWorkspaceFormPreferences,
  resolveWorkspaceFormPreferences,
  type FormPreferences,
  type WorkspaceFormPreferences,
} from "./preferences";
import type { CreateAgentPreferenceStorage } from "./storage";

/** `serverId:workspaceId`; null addresses the host-wide fallback entry. */
export type WorkspacePreferencesKey = string;

export type FormPreferenceUpdate =
  | Partial<FormPreferences>
  | ((current: FormPreferences) => FormPreferences);

export class CreateAgentPreferencesService {
  private globalPreferences: FormPreferences = DEFAULT_FORM_PREFERENCES;
  private workspacePreferences: WorkspaceFormPreferences = {};
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: CreateAgentPreferenceStorage) {}

  async load(workspaceKey: WorkspacePreferencesKey | null): Promise<FormPreferences> {
    await this.loadState();
    return resolveWorkspaceFormPreferences({
      global: this.globalPreferences,
      workspaces: this.workspacePreferences,
      workspaceKey,
    });
  }

  async update(
    workspaceKey: WorkspacePreferencesKey | null,
    update: FormPreferenceUpdate,
  ): Promise<FormPreferences> {
    const previousWrite = this.writeQueue;
    const operation = this.applyQueuedUpdate(previousWrite, workspaceKey, update);

    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async loadState(): Promise<void> {
    if (this.isLoaded) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.readState();
    }
    return this.loadPromise;
  }

  private async readState(): Promise<void> {
    const [storedGlobal, storedWorkspaces] = await Promise.all([
      this.storage.readGlobal(),
      this.storage.readWorkspaces(),
    ]);
    this.globalPreferences = parseFormPreferences(storedGlobal);
    this.workspacePreferences = parseWorkspaceFormPreferences(storedWorkspaces);
    this.isLoaded = true;
  }

  private async applyQueuedUpdate(
    previousWrite: Promise<void>,
    workspaceKey: WorkspacePreferencesKey | null,
    update: FormPreferenceUpdate,
  ): Promise<FormPreferences> {
    await previousWrite;
    await this.loadState();
    const current = resolveWorkspaceFormPreferences({
      global: this.globalPreferences,
      workspaces: this.workspacePreferences,
      workspaceKey,
    });
    const next = parseFormPreferences(
      typeof update === "function" ? update(current) : { ...current, ...update },
    );

    // A workspace write never touches the host-wide fallback and vice versa.
    if (workspaceKey === null) {
      await this.storage.writeGlobal(next);
      this.globalPreferences = next;
    } else {
      const nextWorkspacePreferences = {
        ...this.workspacePreferences,
        [workspaceKey]: next,
      };
      await this.storage.writeWorkspaces(nextWorkspacePreferences);
      this.workspacePreferences = nextWorkspacePreferences;
    }
    this.isLoaded = true;
    return next;
  }
}

export const createAgentPreferencesService = new CreateAgentPreferencesService(
  new AsyncStorageCreateAgentPreferenceStorage(),
);
