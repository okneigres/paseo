import AsyncStorage from "@react-native-async-storage/async-storage";
import { readValidatedJson } from "@/storage/validated-storage";
import {
  FormPreferencesSchema,
  StoredFormPreferencesSchema,
  WorkspaceFormPreferencesSchema,
  type FormPreferences,
  type WorkspaceFormPreferences,
} from "./preferences";

export const CREATE_AGENT_PREFERENCES_STORAGE_KEY = "@paseo:create-agent-preferences";

/**
 * Per-workspace overrides live in their own key beside the host-wide entry so
 * the global key keeps the exact shape older builds and the favourites
 * migration already read from it.
 */
export const CREATE_AGENT_WORKSPACE_PREFERENCES_STORAGE_KEY =
  "@paseo:create-agent-preferences:workspaces";

export interface CreateAgentPreferenceStorage {
  readGlobal(): Promise<unknown>;
  writeGlobal(preferences: FormPreferences): Promise<void>;
  readWorkspaces(): Promise<unknown>;
  writeWorkspaces(workspaces: WorkspaceFormPreferences): Promise<void>;
}

export class AsyncStorageCreateAgentPreferenceStorage implements CreateAgentPreferenceStorage {
  async readGlobal(): Promise<unknown> {
    return readValidatedJson(
      AsyncStorage,
      CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      StoredFormPreferencesSchema,
    );
  }

  async writeGlobal(preferences: FormPreferences): Promise<void> {
    const result = FormPreferencesSchema.safeParse(preferences);
    if (!result.success) {
      await AsyncStorage.removeItem(CREATE_AGENT_PREFERENCES_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(CREATE_AGENT_PREFERENCES_STORAGE_KEY, JSON.stringify(result.data));
  }

  async readWorkspaces(): Promise<unknown> {
    return readValidatedJson(
      AsyncStorage,
      CREATE_AGENT_WORKSPACE_PREFERENCES_STORAGE_KEY,
      WorkspaceFormPreferencesSchema,
    );
  }

  async writeWorkspaces(workspaces: WorkspaceFormPreferences): Promise<void> {
    const result = WorkspaceFormPreferencesSchema.safeParse(workspaces);
    if (!result.success) {
      await AsyncStorage.removeItem(CREATE_AGENT_WORKSPACE_PREFERENCES_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(
      CREATE_AGENT_WORKSPACE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(result.data),
    );
  }
}
