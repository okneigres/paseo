import { useEffect } from "react";
import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { DEFAULT_PANE_ID } from "@/stores/workspace-layout-actions";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";

/**
 * A workspace the app just created opens tiled: an about:blank browser on top of the agent pane,
 * half the height each. Creation marks the workspace; the mark is consumed once, after the layout
 * hydrates, so reopened workspaces and manually closed browsers stay as the user left them.
 */
export function useInitialBrowserPane(input: {
  workspaceKey: string | null;
  workspaceExists: boolean;
}): void {
  const layoutHydrated = useWorkspaceLayoutStoreHydrated();
  const pending = useWorkspaceLayoutStore((state) =>
    input.workspaceKey ? state.initialBrowserPaneByWorkspace[input.workspaceKey] === true : false,
  );
  const { workspaceKey, workspaceExists } = input;

  useEffect(() => {
    if (!workspaceKey || !workspaceExists || !layoutHydrated || !pending || !getIsElectron()) {
      return;
    }
    const store = useWorkspaceLayoutStore.getState();
    if (!store.consumeInitialBrowserPane(workspaceKey)) {
      return;
    }
    const targetPaneId = store.layoutByWorkspace[workspaceKey]?.focusedPaneId ?? DEFAULT_PANE_ID;
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
  }, [layoutHydrated, pending, workspaceExists, workspaceKey]);
}
