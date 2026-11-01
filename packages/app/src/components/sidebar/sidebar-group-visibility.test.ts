import { describe, expect, it } from "vitest";
import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import {
  selectSidebarGroupVisibility,
  WORKSPACES_VISIBLE_LIMIT,
  type SidebarGroupItem,
  type SidebarGroupVisibilityPolicy,
} from "./sidebar-group-visibility";

const LIMIT = WORKSPACES_VISIBLE_LIMIT;

interface Item extends SidebarGroupItem {
  id: number;
  statusBucket: SidebarStateBucket;
}

const serverId = "host-a";

function rows(statuses: readonly SidebarStateBucket[], rowServerId = serverId): Item[] {
  return statuses.map((statusBucket, index) => ({
    id: index + 1,
    serverId: rowServerId,
    workspaceId: `workspace-${index + 1}`,
    statusBucket,
  }));
}

const workspacePolicy: SidebarGroupVisibilityPolicy<Item> = {
  kind: "workspaces",
  getStatusBucket: (item) => item.statusBucket,
};

function selectionFor(item: SidebarGroupItem): ActiveWorkspaceSelection {
  return { serverId: item.serverId, workspaceId: item.workspaceId };
}

describe("selectSidebarGroupVisibility", () => {
  it("leads with a hidden open row while keeping the baseline order", () => {
    const items = rows(Array(LIMIT + 2).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      expanded: false,
      policy: workspacePolicy,
      selection: selectionFor(items[LIMIT + 1]!),
    });

    expect(result.leadingItem).toBe(items[LIMIT + 1]);
    expect(result.visibleItems).toEqual(items.slice(0, LIMIT));
    expect(result.canToggle).toBe(true);
  });

  it("leaves selected rows in place when they are already in the baseline", () => {
    const items = rows([...Array(LIMIT + 1).fill("done"), "running", "done"]);
    const expected = [...items.slice(0, LIMIT), items[LIMIT + 1]];

    for (const selectedIndex of [2, LIMIT + 1]) {
      const result = selectSidebarGroupVisibility({
        items,
        expanded: false,
        policy: workspacePolicy,
        selection: selectionFor(items[selectedIndex]!),
      });

      expect(result.leadingItem).toBeNull();
      expect(result.visibleItems).toEqual(expected);
      expect(result.canToggle).toBe(true);
    }
  });

  it("shows the whole group without a toggle when the open row is the only hidden row", () => {
    const items = rows(Array(LIMIT + 1).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      expanded: false,
      policy: workspacePolicy,
      selection: selectionFor(items[LIMIT]!),
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items);
    expect(result.canToggle).toBe(false);
  });

  it("keeps expanded groups in their original order", () => {
    const items = rows(Array(LIMIT + 2).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      expanded: true,
      policy: workspacePolicy,
      selection: selectionFor(items[LIMIT + 1]!),
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items);
    expect(result.canToggle).toBe(true);
  });

  it("applies the twenty-row limit to pinned groups", () => {
    const items = rows(Array(22).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      expanded: false,
      policy: { kind: "pinned" },
      selection: selectionFor(items[21]!),
    });

    expect(result.leadingItem).toBe(items[21]);
    expect(result.visibleItems).toEqual(items.slice(0, 20));
    expect(result.canToggle).toBe(true);
  });

  it("preserves the current limit when selection is null", () => {
    const items = rows(Array(LIMIT + 1).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      expanded: false,
      policy: workspacePolicy,
      selection: null,
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items.slice(0, LIMIT));
    expect(result.canToggle).toBe(true);
  });

  it("matches the open row by server and workspace identity", () => {
    const items = rows(Array(LIMIT + 2).fill("done"), "host-b");
    const result = selectSidebarGroupVisibility({
      items,
      expanded: false,
      policy: workspacePolicy,
      selection: { serverId: serverId, workspaceId: items[LIMIT + 1]!.workspaceId },
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items.slice(0, LIMIT));
    expect(result.canToggle).toBe(true);
  });
});
