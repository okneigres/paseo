import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { ensureExplorerSidebarOnWorkspaceEntry } from "@/workspace-tabs/explorer-sidebar";

const WORKSPACE_KEY = "server-1:workspace-1";

function explorerPane() {
  const state = useWorkspaceLayoutStore.getState();
  const layout = state.layoutByWorkspace[WORKSPACE_KEY];
  const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
  return paneId ? findPaneById(layout.root, paneId) : null;
}

function focusedExplorerTargetKind() {
  const state = useWorkspaceLayoutStore.getState();
  const layout = state.layoutByWorkspace[WORKSPACE_KEY];
  const pane = explorerPane();
  return collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target.kind;
}

const ENTRY = { isCompact: false, workspaceKey: WORKSPACE_KEY };

beforeEach(() => {
  usePanelStore.setState({ mobilePanel: { target: "agent", revision: 0 } });
  useWorkspaceLayoutStore.setState({
    layoutMode: "split-panes",
    sheetsByWorkspace: {},
    pullRequestTabAutoOpenedByWorkspace: {},
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
});

describe("ensureExplorerSidebarOnWorkspaceEntry", () => {
  it("docks a closed Explorer on Files", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "agent", agentId: "a" },
      intent: "reveal",
    });
    expect(explorerPane()?.hidden).toBe(true);

    ensureExplorerSidebarOnWorkspaceEntry(ENTRY);

    expect(explorerPane()?.hidden).toBeUndefined();
    expect(focusedExplorerTargetKind()).toBe("files");
  });

  it("leaves an open Explorer on the view the user chose", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.showExplorerSidebar(WORKSPACE_KEY);
    const paneId = explorerPane()!.id;
    store.selectTabInPane(WORKSPACE_KEY, paneId, "changes_tree");
    expect(focusedExplorerTargetKind()).toBe("changes_tree");

    ensureExplorerSidebarOnWorkspaceEntry(ENTRY);

    expect(focusedExplorerTargetKind()).toBe("changes_tree");
  });

  it("does not reopen after the user closes it again", () => {
    ensureExplorerSidebarOnWorkspaceEntry(ENTRY);
    useWorkspaceLayoutStore.getState().hideExplorerSidebar(WORKSPACE_KEY);

    expect(explorerPane()?.hidden).toBe(true);
  });

  it("keeps the workspace focus where it was", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "agent", agentId: "a" },
      intent: "reveal",
    });
    const focusedBefore =
      useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY].focusedPaneId;

    ensureExplorerSidebarOnWorkspaceEntry(ENTRY);

    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY].focusedPaneId).toBe(
      focusedBefore,
    );
  });

  it("leaves the compact overlay alone", () => {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "agent", agentId: "a" },
      intent: "reveal",
    });

    ensureExplorerSidebarOnWorkspaceEntry({ isCompact: true, workspaceKey: WORKSPACE_KEY });

    expect(explorerPane()?.hidden).toBe(true);
    expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
  });
});
