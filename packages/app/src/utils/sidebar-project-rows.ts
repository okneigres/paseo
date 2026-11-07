import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSeparator } from "@/stores/sidebar-separators-store";

/**
 * One row of the project list. Projects and separators share one list, and therefore one order
 * and one drag interaction, so they share one row type.
 */
export type SidebarProjectRow =
  | { kind: "project"; key: string; project: SidebarProjectEntry }
  | { kind: "separator"; key: string; separator: SidebarSeparator };

const SEPARATOR_KEY_PREFIX = "separator:";

/** The order-store key for a separator. Project keys are project view keys, so the two never clash. */
export function sidebarSeparatorOrderKey(id: string): string {
  return `${SEPARATOR_KEY_PREFIX}${id}`;
}

function separatorIdFromOrderKey(key: string): string | null {
  return key.startsWith(SEPARATOR_KEY_PREFIX) ? key.slice(SEPARATOR_KEY_PREFIX.length) : null;
}

/**
 * The list's rows in stored order.
 *
 * Keys the order knows but the data does not are dropped (a removed project, a deleted
 * separator); rows the order does not know appear at the top — a project the user just created is
 * what they are looking for — while a new separator joins the end of the list.
 */
export function buildSidebarProjectRows(input: {
  projects: readonly SidebarProjectEntry[];
  separators: readonly SidebarSeparator[];
  projectOrder: readonly string[];
}): SidebarProjectRow[] {
  const projectByKey = new Map(input.projects.map((project) => [project.viewKey, project]));
  const separatorById = new Map(input.separators.map((separator) => [separator.id, separator]));
  const rows: SidebarProjectRow[] = [];
  const placed = new Set<string>();

  for (const key of input.projectOrder) {
    const project = projectByKey.get(key);
    if (project) {
      rows.push({ kind: "project", key, project });
      placed.add(key);
      continue;
    }
    const separatorId = separatorIdFromOrderKey(key);
    const separator = separatorId ? separatorById.get(separatorId) : undefined;
    if (separator) {
      rows.push({ kind: "separator", key, separator });
      placed.add(key);
    }
  }

  const unseenProjects: SidebarProjectRow[] = [];
  for (const project of input.projects) {
    if (!placed.has(project.viewKey)) {
      unseenProjects.push({ kind: "project", key: project.viewKey, project });
    }
  }
  rows.unshift(...unseenProjects);
  for (const separator of input.separators) {
    const key = sidebarSeparatorOrderKey(separator.id);
    if (!placed.has(key)) {
      rows.push({ kind: "separator", key, separator });
    }
  }

  return rows;
}
