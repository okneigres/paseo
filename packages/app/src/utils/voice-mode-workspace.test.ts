import { describe, expect, it } from "vitest";
import { isVoiceModeWorkspaceTarget } from "./voice-mode-workspace";

const voice = {
  isVoiceMode: true,
  activeServerId: "host-a",
  activeAgentId: "agent-1",
};

describe("voice mode workspace target", () => {
  it("marks the workspace the voice agent lives in", () => {
    expect(
      isVoiceModeWorkspaceTarget({
        voice,
        agentWorkspaceId: "ws-1",
        serverId: "host-a",
        workspaceId: "ws-1",
      }),
    ).toBe(true);
  });

  it("leaves the other workspaces on the same host alone", () => {
    expect(
      isVoiceModeWorkspaceTarget({
        voice,
        agentWorkspaceId: "ws-1",
        serverId: "host-a",
        workspaceId: "ws-2",
      }),
    ).toBe(false);
  });

  it("does not follow the agent id onto another host", () => {
    expect(
      isVoiceModeWorkspaceTarget({
        voice: { ...voice, activeServerId: "host-b" },
        agentWorkspaceId: "ws-1",
        serverId: "host-a",
        workspaceId: "ws-1",
      }),
    ).toBe(false);
  });

  it("marks nothing while voice mode is off or the agent is gone", () => {
    expect(
      isVoiceModeWorkspaceTarget({
        voice: { ...voice, isVoiceMode: false },
        agentWorkspaceId: "ws-1",
        serverId: "host-a",
        workspaceId: "ws-1",
      }),
    ).toBe(false);
    expect(
      isVoiceModeWorkspaceTarget({
        voice,
        agentWorkspaceId: null,
        serverId: "host-a",
        workspaceId: "ws-1",
      }),
    ).toBe(false);
    expect(
      isVoiceModeWorkspaceTarget({
        voice: null,
        agentWorkspaceId: "ws-1",
        serverId: "host-a",
        workspaceId: "ws-1",
      }),
    ).toBe(false);
  });
});
