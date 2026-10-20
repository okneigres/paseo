import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";

/**
 * A row the sidebar find bar can jump to. `key` is what the row registers itself under; the same
 * physical row can answer to two keys (a project block's header stands in for both the project and
 * its first workspace), which is why rows register a list of keys rather than one.
 */
export interface SidebarFindRow {
  key: string;
  label: string;
}

const PROJECT_KEY_PREFIX = "project:";
const WORKSPACE_KEY_PREFIX = "workspace:";
const KEY_SEPARATOR = "\u0000";

export function projectFindKey(projectViewKey: string): string {
  return `${PROJECT_KEY_PREFIX}${projectViewKey}`;
}

export function workspaceFindKey(workspaceKey: string): string {
  return `${WORKSPACE_KEY_PREFIX}${workspaceKey}`;
}

export function workspaceKeyFromFindKey(key: string): string | null {
  return key.startsWith(WORKSPACE_KEY_PREFIX) ? key.slice(WORKSPACE_KEY_PREFIX.length) : null;
}

/** The keys a row answers to, packed so hook dependency arrays can compare them by value. */
export function findKeySignature(keys: readonly string[]): string {
  return keys.join(KEY_SEPARATOR);
}

export function findKeysFromSignature(signature: string): string[] {
  return signature ? signature.split(KEY_SEPARATOR) : [];
}

/**
 * The rows the sidebar shows, in the order it shows them: pinned workspaces first, then either the
 * project headers with their workspaces (project mode) or the flat grouped rows.
 *
 * A pinned workspace that also sits inside its project is listed once, where the user sees it
 * first — pinned above the projects.
 */
export function buildSidebarFindRows(input: {
  groupMode: SidebarGroupMode;
  projects: readonly SidebarProjectEntry[];
  pinnedChats: readonly SidebarWorkspacePlacement[];
  workspaceGroups: readonly SidebarWorkspaceGroup[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  workspaceTitleSource: WorkspaceTitleSource;
}): SidebarFindRow[] {
  const rows: SidebarFindRow[] = [];
  const seen = new Set<string>();

  const push = (key: string, label: string | null | undefined) => {
    const trimmed = label?.trim() ?? "";
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    rows.push({ key, label: trimmed });
  };

  const labelOf = (workspace: SidebarWorkspacePlacement) => {
    const entry = input.workspaceEntriesByKey.get(workspace.workspaceKey);
    if (!entry) return workspace.name;
    return resolveSidebarWorkspacePrimaryLabel({
      workspace: entry,
      workspaceTitleSource: input.workspaceTitleSource,
    });
  };

  for (const pinned of input.pinnedChats) {
    push(workspaceFindKey(pinned.workspaceKey), labelOf(pinned));
  }

  if (input.groupMode === "project") {
    for (const project of input.projects) {
      push(projectFindKey(project.viewKey), project.projectName);
      for (const workspace of project.workspaces) {
        push(workspaceFindKey(workspace.workspaceKey), labelOf(workspace));
      }
    }
  } else {
    for (const group of input.workspaceGroups) {
      for (const workspace of group.rows) {
        push(workspaceFindKey(workspace.workspaceKey), labelOf(workspace));
      }
    }
  }

  return rows;
}

/** Case-insensitive substring search over the row labels, in list order. */
export function findSidebarMatches(
  rows: readonly SidebarFindRow[],
  query: string,
): SidebarFindRow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return rows.filter((row) => row.label.toLocaleLowerCase().includes(needle));
}

/** Where a step from `index` lands, wrapping at both ends. */
export function advanceFindIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  const from = ((index % count) + count) % count;
  return (((from + delta) % count) + count) % count;
}
