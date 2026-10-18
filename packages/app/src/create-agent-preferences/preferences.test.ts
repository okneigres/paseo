import { describe, expect, it } from "vitest";
import { CreateAgentPreferencesService } from "./service";
import {
  applyAgentProfilePreferences,
  mergeCreateAgentSelectionPreferences,
  mergeProviderPreferences,
  parseFormPreferences,
} from "./preferences";
import { FakeCreateAgentPreferenceStorage } from "./test-utils/fake-preference-storage";

describe("create agent preferences", () => {
  it("keeps the selected mode after saving model and thinking", async () => {
    const storage = new FakeCreateAgentPreferenceStorage();
    const preferences = new CreateAgentPreferencesService(storage);

    const modelWrite = preferences.update(null, (current) =>
      mergeProviderPreferences({
        preferences: current,
        provider: "codex",
        updates: { model: "gpt-5.5", thinkingByModel: { "gpt-5.5": "high" } },
      }),
    );
    await storage.nextWrite();

    const modeWrite = preferences.update(null, (current) =>
      mergeProviderPreferences({
        preferences: current,
        provider: "codex",
        updates: { mode: "full-access" },
      }),
    );

    expect(storage.pendingWriteCount()).toBe(1);
    storage.finishOldestWrite();
    await modelWrite;

    await storage.nextWrite();
    storage.finishOldestWrite();
    await modeWrite;

    expect(storage.savedGlobalPreferences()).toEqual({
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "gpt-5.5",
          thinkingByModel: { "gpt-5.5": "high" },
          mode: "full-access",
        },
      },
    });
  });

  it("does not commit a failed write or leak it into the next update", async () => {
    const storage = new FakeCreateAgentPreferenceStorage();
    const preferences = new CreateAgentPreferencesService(storage);

    const failedWrite = preferences.update(null, { provider: "claude" });
    await storage.nextWrite();
    storage.failOldestWrite(new Error("disk full"));
    await expect(failedWrite).rejects.toThrow("disk full");

    expect(await preferences.load(null)).toEqual({});

    const successfulWrite = preferences.update(null, { isolation: "worktree" });
    await storage.nextWrite();
    storage.finishOldestWrite();
    await successfulWrite;

    expect(storage.savedGlobalPreferences()).toEqual({ isolation: "worktree" });
  });

  it("flushes the full create-agent selection into provider preferences", async () => {
    const storage = new FakeCreateAgentPreferenceStorage();
    const preferences = new CreateAgentPreferencesService(storage);

    const saveSelection = preferences.update(null, (current) =>
      mergeCreateAgentSelectionPreferences({
        preferences: current,
        provider: "codex",
        modelId: "gpt-5.5",
        modeId: "full-access",
        thinkingOptionId: "high",
        featureValues: { fast_mode: true },
      }),
    );

    await storage.nextWrite();
    storage.finishOldestWrite();
    await saveSelection;

    expect(storage.savedGlobalPreferences()).toEqual({
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "gpt-5.5",
          mode: "full-access",
          thinkingByModel: { "gpt-5.5": "high" },
          featureValues: { fast_mode: true },
        },
      },
    });
  });

  it("does not erase a saved mode when a later partial update has no mode", () => {
    expect(
      mergeProviderPreferences({
        preferences: {
          provider: "codex",
          providerPreferences: {
            codex: {
              model: "gpt-5.5",
              mode: "full-access",
              thinkingByModel: { "gpt-5.5": "high" },
            },
          },
        },
        provider: "codex",
        updates: {
          model: "gpt-5.6",
          mode: undefined,
          thinkingByModel: undefined,
          featureValues: undefined,
        },
      }),
    ).toEqual({
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "gpt-5.6",
          mode: "full-access",
          thinkingByModel: { "gpt-5.5": "high" },
        },
      },
    });
  });

  it("erases a saved mode when a complete selection explicitly has no mode", () => {
    expect(
      mergeCreateAgentSelectionPreferences({
        preferences: {
          provider: "pi",
          providerPreferences: { pi: { model: "anthropic/sonnet", mode: "full-access" } },
        },
        provider: "pi",
        modelId: "anthropic/sonnet",
        modeId: null,
      }),
    ).toEqual({
      provider: "pi",
      providerPreferences: { pi: { model: "anthropic/sonnet" } },
    });
  });

  it("repairs the previous provider while applying a profile", () => {
    expect(
      applyAgentProfilePreferences({
        preferences: {
          provider: "pi",
          providerPreferences: {
            pi: { model: "anthropic/sonnet", mode: "full-access" },
            mock: { model: "ten-second-stream", mode: "load-test" },
          },
        },
        previousProvider: "pi",
        previousProviderModeIds: [],
        provider: "mock",
        modelId: "one-minute-stream",
        modeId: "approval-test",
        thinkingOptionId: "",
        featureValues: {},
      }),
    ).toEqual({
      provider: "mock",
      providerPreferences: {
        pi: { model: "anthropic/sonnet" },
        mock: { model: "one-minute-stream", mode: "approval-test", featureValues: {} },
      },
    });
  });

  it("loads invalid stored preferences as empty preferences", () => {
    expect(parseFormPreferences({ providerPreferences: { codex: { mode: 42 } } })).toEqual({});
  });

  it("strips the explicitly supported legacy location fields", () => {
    expect(
      parseFormPreferences({
        workingDir: "/old/workspace",
        provider: "codex",
        providerPreferences: {
          codex: {
            model: "gpt-5.4-mini",
            mode: "full-access",
            thinkingOptionId: "high",
          },
        },
        serverId: "old-host",
      }),
    ).toEqual({
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "gpt-5.4-mini",
          mode: "full-access",
          thinkingByModel: { "gpt-5.4-mini": "high" },
        },
      },
    });
  });

  it("rejects unknown persisted fields outside the explicit legacy shape", () => {
    expect(parseFormPreferences({ provider: "codex", surprise: true })).toEqual({});
  });

  it("persists and reloads the workspace isolation choice", async () => {
    const storage = new FakeCreateAgentPreferenceStorage();
    const preferences = new CreateAgentPreferencesService(storage);

    const save = preferences.update(null, { isolation: "worktree" });
    await storage.nextWrite();
    storage.finishOldestWrite();
    await save;

    expect(storage.savedGlobalPreferences()).toEqual({ isolation: "worktree" });
    expect(await new CreateAgentPreferencesService(storage).load(null)).toEqual({
      isolation: "worktree",
    });
  });

  it("preserves legacy favourites across preference writes until host migration", async () => {
    const favoriteModels = [{ provider: "claude", modelId: "opus" }];
    const storage = new FakeCreateAgentPreferenceStorage({ stored: { favoriteModels } });
    const preferences = new CreateAgentPreferencesService(storage);

    const save = preferences.update(null, { isolation: "worktree" });
    await storage.nextWrite();
    storage.finishOldestWrite();
    await save;

    expect(storage.savedGlobalPreferences()).toEqual({ favoriteModels, isolation: "worktree" });
  });

  it("treats stored preferences without an isolation choice as undefined", () => {
    expect(parseFormPreferences({ provider: "codex" }).isolation).toBeUndefined();
  });

  it("rejects an unknown isolation value as invalid stored preferences", () => {
    expect(parseFormPreferences({ provider: "codex", isolation: "sandbox" })).toEqual({});
  });

  it("persists and reloads a terminal launch target", async () => {
    const storage = new FakeCreateAgentPreferenceStorage();
    const preferences = new CreateAgentPreferencesService(storage);

    const save = preferences.update(null, {
      launchTarget: { kind: "terminal", profileId: "claude" },
    });
    await storage.nextWrite();
    storage.finishOldestWrite();
    await save;

    expect(storage.savedGlobalPreferences()).toEqual({
      launchTarget: { kind: "terminal", profileId: "claude" },
    });
    expect(await new CreateAgentPreferencesService(storage).load(null)).toEqual({
      launchTarget: { kind: "terminal", profileId: "claude" },
    });
  });

  it("treats stored preferences without a launch target as undefined, defaulting to chat", () => {
    expect(parseFormPreferences({ provider: "codex" }).launchTarget).toBeUndefined();
  });

  it("rejects a terminal launch target missing a profileId as invalid stored preferences", () => {
    expect(parseFormPreferences({ launchTarget: { kind: "terminal" } })).toEqual({});
  });

  it("rejects an unknown launch target kind as invalid stored preferences", () => {
    expect(parseFormPreferences({ launchTarget: { kind: "shell" } })).toEqual({});
  });

  it("keeps providers and models separate per workspace and falls back to the stored global", async () => {
    const storage = new FakeCreateAgentPreferenceStorage({
      stored: {
        provider: "claude",
        providerPreferences: { claude: { model: "opus" } },
      },
    });
    const preferences = new CreateAgentPreferencesService(storage);
    const firstWorkspace = "host-1:workspace-a";
    const secondWorkspace = "host-1:workspace-b";

    const firstWrite = preferences.update(firstWorkspace, (current) =>
      mergeProviderPreferences({
        preferences: current,
        provider: "codex",
        updates: { model: "gpt-5.5" },
      }),
    );
    await storage.nextWrite();
    storage.finishOldestWrite();
    await firstWrite;

    const secondWrite = preferences.update(secondWorkspace, (current) =>
      mergeProviderPreferences({
        preferences: current,
        provider: "deepseek",
        updates: { model: "deepseek-chat" },
      }),
    );
    await storage.nextWrite();
    storage.finishOldestWrite();
    await secondWrite;

    expect(await preferences.load(firstWorkspace)).toEqual({
      provider: "codex",
      providerPreferences: { claude: { model: "opus" }, codex: { model: "gpt-5.5" } },
    });
    expect(await preferences.load(secondWorkspace)).toEqual({
      provider: "deepseek",
      providerPreferences: { claude: { model: "opus" }, deepseek: { model: "deepseek-chat" } },
    });
    // A workspace the device has never seen inherits the host-wide fallback.
    expect(await preferences.load("host-1:workspace-c")).toEqual({
      provider: "claude",
      providerPreferences: { claude: { model: "opus" } },
    });
    expect(storage.savedGlobalPreferences()).toEqual({
      provider: "claude",
      providerPreferences: { claude: { model: "opus" } },
    });
    expect(storage.savedWorkspaces()).toEqual({
      [firstWorkspace]: {
        provider: "codex",
        providerPreferences: { claude: { model: "opus" }, codex: { model: "gpt-5.5" } },
      },
      [secondWorkspace]: {
        provider: "deepseek",
        providerPreferences: { claude: { model: "opus" }, deepseek: { model: "deepseek-chat" } },
      },
    });
  });

  it("writes the host-wide entry without disturbing workspace entries", async () => {
    const storage = new FakeCreateAgentPreferenceStorage({
      storedWorkspaces: { "host-1:workspace-a": { provider: "codex" } },
    });
    const preferences = new CreateAgentPreferencesService(storage);

    const save = preferences.update(null, { isolation: "worktree" });
    await storage.nextWrite();
    storage.finishOldestWrite();
    await save;

    expect(storage.savedGlobalPreferences()).toEqual({ isolation: "worktree" });
    expect(storage.savedWorkspaces()).toEqual({ "host-1:workspace-a": { provider: "codex" } });
    expect(await preferences.load("host-1:workspace-a")).toEqual({ provider: "codex" });
    expect(await preferences.load(null)).toEqual({ isolation: "worktree" });
  });
});
