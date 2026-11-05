import { useEffect } from "react";
import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import {
  DEFAULT_PANE_ID,
  collectAllPanes,
  collectAllTabs,
} from "@/stores/workspace-layout-actions";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";

/** Whether any tab in the workspace is already a browser. */
function hasBrowserTab(tabs: ReturnType<typeof collectAllTabs>): boolean {
  return tabs.some((tab) => tab.target.kind === "browser");
}

/**
 * Every workspace gets one shot at the tiled browser: if it has no browser tab yet, the first
 * open after hydration splits a quarter-height pane on top of the agent area with about:blank.
 * The attempt is remembered for good, so a browser the user closes never comes back.
 */
export function useInitialBrowserPane(input: {
  workspaceKey: string | null;
  workspaceExists: boolean;
}): void {
  const layoutHydrated = useWorkspaceLayoutStoreHydrated();
  const { workspaceKey, workspaceExists } = input;

  useEffect(() => {
    if (!workspaceKey || !workspaceExists || !layoutHydrated || !getIsElectron()) {
      return;
    }
    const store = useWorkspaceLayoutStore.getState();
    if (store.initialBrowserPaneAttemptedByWorkspace[workspaceKey]) {
      return;
    }
    store.markInitialBrowserPaneAttempted(workspaceKey);

    const layout = store.layoutByWorkspace[workspaceKey];
    if (layout && hasBrowserTab(collectAllTabs(layout.root))) {
      return;
    }
    const targetPaneId = layout
      ? (layout.focusedPaneId ?? collectAllPanes(layout.root)[0]?.id ?? DEFAULT_PANE_ID)
      : DEFAULT_PANE_ID;
    const browserPaneId = store.splitPaneEmpty(workspaceKey, {
      targetPaneId,
      position: "top",
      // A quarter of the workspace height: enough for a page, the agent keeps the rest.
      sizes: [0.25, 0.75],
    });
    if (!browserPaneId) {
      return;
    }
    const { browserId } = createWorkspaceBrowser({ initialUrl: "about:blank" });
    store.openTab({
      workspaceKey,
      target: { kind: "browser", browserId },
      intent: "new",
      placement: { mode: "pane", paneId: browserPaneId },
    });
  }, [layoutHydrated, workspaceExists, workspaceKey]);
}
