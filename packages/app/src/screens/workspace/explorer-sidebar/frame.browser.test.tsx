import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { expect, it } from "vitest";
import { MobilePanelsProvider } from "@/mobile-panels/provider";
import { MIN_EXPLORER_SIDEBAR_WIDTH } from "@/components/explorer-sidebar-layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { ExplorerFrame } from "./frame";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const WORKSPACE_STYLE = { flexDirection: "row", height: 200 } as const;
const FILL = { flex: 1 };

function setStoredExplorerWidth(persistenceKey: string, width: number | null): void {
  useWorkspaceLayoutStore.setState((state) => {
    const next = { ...state.explorerSidebarWidthByWorkspace };
    if (width === null) delete next[persistenceKey];
    else next[persistenceKey] = width;
    return { explorerSidebarWidthByWorkspace: next };
  });
}

it("opens the dock at its minimum width when no width is stored", async () => {
  setStoredExplorerWidth("workspace", null);
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(
        <MobilePanelsProvider>
          <View style={WORKSPACE_STYLE}>
            <View role="main" style={FILL} />
            <ExplorerFrame presentation="dock" isWorkspaceActive isOpen persistenceKey="workspace">
              <View role="complementary" style={FILL} />
            </ExplorerFrame>
          </View>
        </MobilePanelsProvider>,
      );
    });
    const width = () => host.querySelector('[role="complementary"]')?.getBoundingClientRect().width;
    await expect.poll(width).toBe(MIN_EXPLORER_SIDEBAR_WIDTH);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("measures dock allocation independently of the workspace owner", async () => {
  setStoredExplorerWidth("workspace", 320);
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const root = createRoot(host);
  let workspaceRenders = 0;

  function Workspace() {
    workspaceRenders++;
    return (
      <View style={WORKSPACE_STYLE}>
        <View role="main" style={FILL} />
        <ExplorerFrame presentation="dock" isWorkspaceActive isOpen persistenceKey="workspace">
          <View role="complementary" style={FILL} />
        </ExplorerFrame>
      </View>
    );
  }

  function dockWidth() {
    return host.querySelector('[role="complementary"]')?.getBoundingClientRect().width;
  }

  try {
    await act(async () => {
      root.render(
        <MobilePanelsProvider>
          <Workspace />
        </MobilePanelsProvider>,
      );
    });
    await expect.poll(dockWidth).toBe(320);
    const initialRenderCount = workspaceRenders;
    const dock = host.querySelector('[role="complementary"]');
    host.style.width = "620px";
    await expect.poll(dockWidth).toBe(260);
    expect(workspaceRenders).toBe(initialRenderCount);
    expect(host.querySelector('[role="complementary"]')).toBe(dock);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
