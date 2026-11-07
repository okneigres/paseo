/**
 * Whether a workspace row should name its host, or whether the row above already did.
 *
 * The sidebar names a host once per run of rows: the header row, the leading ("open workspace")
 * row, or the sibling directly above owns the name; the rest stay quiet.
 */
export function shouldShowHostLabel(input: {
  workspace: { serverId: string; workspaceKey: string };
  /** Position within `rows`, or 0 for a row rendered above the list. */
  index: number;
  rows: readonly { serverId: string; workspaceKey: string }[];
  /** A row rendered above the list that still belongs to the same run. */
  leading?: { serverId: string; workspaceKey: string } | null;
  /** Server of whatever sits above the list when there is no leading row (a project header). */
  fallbackServerId?: string | null;
}): boolean {
  const { workspace, index, rows, leading, fallbackServerId } = input;
  let previousServerId: string | null | undefined = fallbackServerId;
  if (index > 0) {
    previousServerId = rows[index - 1]?.serverId;
  } else if (leading && leading.workspaceKey !== workspace.workspaceKey) {
    previousServerId = leading.serverId;
  }
  return previousServerId !== workspace.serverId;
}
