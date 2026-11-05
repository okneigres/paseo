import {
  collectAllTabs,
  type SplitNode,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

const HALF = 0.5;
const TILE_SIZES: [number, number] = [0.25, 0.75];

function isBrowserOnlyPane(node: SplitNode): boolean {
  if (node.kind !== "pane") {
    return false;
  }
  const tabs = collectAllTabs(node);
  return tabs.length > 0 && tabs.every((tab) => tab.target.kind === "browser");
}

function isHalfSized(sizes: readonly number[]): boolean {
  return (
    sizes.length === 2 &&
    Math.abs((sizes[0] ?? 0) - HALF) < 0.001 &&
    Math.abs((sizes[1] ?? 0) - HALF) < 0.001
  );
}

/**
 * Finds the browser-on-top split that the earlier build seeded at half height, so a workspace
 * opened before the quarter-height rule can be corrected once. A browser pane the user split
 * vertically on purpose is indistinguishable from that seed, so only the browser-only, top-slot,
 * exactly-halved shape qualifies.
 */
export function findHalfHeightBrowserTileGroup(layout: WorkspaceLayout): string | null {
  const walk = (node: SplitNode): string | null => {
    if (node.kind !== "group") {
      return null;
    }
    const { group } = node;
    const first = group.children[0];
    if (
      group.direction === "vertical" &&
      first !== undefined &&
      isBrowserOnlyPane(first) &&
      isHalfSized(group.sizes)
    ) {
      return group.id;
    }
    for (const child of group.children) {
      const found = walk(child);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return walk(layout.root);
}

export const BROWSER_TILE_SIZES = TILE_SIZES;
