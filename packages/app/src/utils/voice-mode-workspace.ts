import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/**
 * The part of the voice snapshot this rule reads. Voice mode is per agent while the sidebar only
 * knows workspaces, so the agent has to be resolved back to a workspace before a row can claim it.
 */
export interface VoiceModeTarget {
  isVoiceMode: boolean;
  activeServerId: string | null;
  activeAgentId: string | null;
}

/**
 * Whether the workspace running voice mode is the one this row stands for.
 *
 * The agent id alone is not enough: two hosts can name their agents alike, so the server has to
 * match too, and the agent is resolved to a workspace through the same `workspaceId` the workspace
 * tabs use to decide which agents belong to a workspace. An agent that is no longer in the store —
 * the turn is still running while the agent list is being replaced — resolves to no workspace
 * rather than to the wrong one.
 */
export function isVoiceModeWorkspaceTarget(input: {
  voice: VoiceModeTarget | null;
  /** Workspace the voice agent lives in, read from the session store by the caller. */
  agentWorkspaceId: string | null | undefined;
  serverId: string;
  workspaceId: string;
}): boolean {
  const { voice } = input;
  if (!voice?.isVoiceMode || !voice.activeAgentId || voice.activeServerId !== input.serverId) {
    return false;
  }
  const agentWorkspaceId = normalizeWorkspaceOpaqueId(input.agentWorkspaceId);
  if (!agentWorkspaceId) {
    return false;
  }
  return agentWorkspaceId === normalizeWorkspaceOpaqueId(input.workspaceId);
}
