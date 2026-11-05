import { useEffect } from "react";
import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import {
  DEFAULT_PANE_ID,
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

/** Workspaces that never got past the launch tab are the ones that open with a browser. */
function isUntouchedWorkspaceLayout(layout: WorkspaceLayout): boolean {
  if (collectAllPanes(layout.root).length !== 1) {
    return false;
  }
  const tabs = collectAllTabs(layout.root);
  return tabs.length === 1 && tabs[0]?.target.kind === "new_tab";
}

const openedWorkspaceKeys = new Set<string>();

/**
 * A freshly opened workspace starts tiled: a browser on top of the agent, half the height each.
 * Only the untouched initial layout qualifies, so a browser the user closed stays closed.
 */
export function useInitialBrowserPane(input: {
  workspaceKey: string | null;
  workspaceExists: boolean;
}): void {
  const splitPaneEmpty = useWorkspaceLayoutStore((state) => state.splitPaneEmpty);
  const openTab = useWorkspaceLayoutStore((state) => state.openTab);
  const layout = useWorkspaceLayoutStore((state) =>
    input.workspaceKey ? (state.layoutByWorkspace[input.workspaceKey] ?? null) : null,
  );
  const { workspaceKey, workspaceExists } = input;

  useEffect(() => {
    if (!workspaceKey || !workspaceExists || !getIsElectron()) {
      return;
    }
    if (openedWorkspaceKeys.has(workspaceKey)) {
      return;
    }
    // A stored layout means the workspace was already used; only the fresh default qualifies.
    if (layout !== null && !isUntouchedWorkspaceLayout(layout)) {
      return;
    }
    openedWorkspaceKeys.add(workspaceKey);

    const targetPaneId = layout?.focusedPaneId ?? DEFAULT_PANE_ID;
    const browserPaneId = splitPaneEmpty(workspaceKey, { targetPaneId, position: "top" });
    if (!browserPaneId) {
      return;
    }
    const { browserId } = createWorkspaceBrowser({ initialUrl: "about:blank" });
    openTab({
      workspaceKey,
      target: { kind: "browser", browserId },
      intent: "new",
      placement: { mode: "pane", paneId: browserPaneId },
    });
  }, [layout, openTab, splitPaneEmpty, workspaceExists, workspaceKey]);
}
