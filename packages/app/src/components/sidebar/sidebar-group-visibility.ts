import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";

export type SidebarGroupVisibilityPolicy<T> =
  | { kind: "pinned" }
  | { kind: "workspaces"; getStatusBucket: (item: T) => SidebarStateBucket };

// A placement can outrun its entry: a retained sidebar that is inactive (compact layout with the
// sidebar closed) or still waiting for sessions keeps an empty entry map. A missing entry renders
// no row, so it counts as Done and claims no slot past the limit.
export function createWorkspaceVisibilityPolicy<T extends { workspaceKey: string }>(
  entriesByKey: ReadonlyMap<string, { statusBucket: SidebarStateBucket }>,
): SidebarGroupVisibilityPolicy<T> {
  return {
    kind: "workspaces",
    getStatusBucket: (item) => entriesByKey.get(item.workspaceKey)?.statusBucket ?? "done",
  };
}

/** How many rows a pinned section shows before "Show more". */
export const PINNED_VISIBLE_LIMIT = 20;
/** How many project workspaces show before "Show more"; active rows beyond it stay visible. */
export const WORKSPACES_VISIBLE_LIMIT = 70;

export function selectSidebarGroupVisibility<T>(
  items: readonly T[],
  expanded: boolean,
  policy: SidebarGroupVisibilityPolicy<T>,
) {
  const limit = policy.kind === "pinned" ? PINNED_VISIBLE_LIMIT : WORKSPACES_VISIBLE_LIMIT;
  const baseline = items.filter(
    (item, index) =>
      index < limit || (policy.kind === "workspaces" && policy.getStatusBucket(item) !== "done"),
  );
  return {
    visibleItems: expanded ? items.slice() : baseline,
    canToggle: baseline.length < items.length,
  };
}
