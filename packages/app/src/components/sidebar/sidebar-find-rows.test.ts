import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import {
  advanceFindIndex,
  buildSidebarFindRows,
  findSidebarMatches,
  projectFindKey,
  workspaceFindKey,
} from "./sidebar-find-rows";

function entry(overrides: Partial<SidebarWorkspaceEntry> = {}): SidebarWorkspaceEntry {
  return {
    workspaceKey: "srv:ws-root",
    serverId: "srv",
    workspaceId: "ws-root",
    projectViewKey: "project-1",
    projectName: "paseo",
    workspaceDirectory: "/repo",
    workspaceDirectoryLabel: "/repo",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "paseo",
    title: null,
    currentBranch: null,
    statusBucket: "done",
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    statusEnteredAt: null,
    archivingAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<SidebarProjectEntry> = {}): SidebarProjectEntry {
  return {
    viewKey: "project-1",
    projectName: "paseo",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      {
        serverId: "srv",
        projectId: "project-1",
        iconWorkingDir: "/repo",
        worktreeSupport: "supported",
      },
    ],
    workspaces: [],
    ...overrides,
  };
}

function rowsOf(workspaces: SidebarWorkspaceEntry[]) {
  return new Map(workspaces.map((workspace) => [workspace.workspaceKey, workspace]));
}

describe("buildSidebarFindRows", () => {
  it("lists pinned workspaces first, then the project header and its workspaces", () => {
    const root = entry({ workspaceKey: "srv:root", name: "paseo" });
    const feature = entry({
      workspaceKey: "srv:feature",
      name: "sidebar-find",
      projectViewKey: "project-1",
    });
    const rows = buildSidebarFindRows({
      groupMode: "project",
      projects: [
        project({
          workspaces: [
            {
              workspaceKey: root.workspaceKey,
              serverId: "srv",
              workspaceId: "root",
              projectViewKey: "project-1",
              projectName: "paseo",
              projectKind: "git",
              workspaceKind: "checkout",
              name: "paseo",
            },
            {
              workspaceKey: feature.workspaceKey,
              serverId: "srv",
              workspaceId: "feature",
              projectViewKey: "project-1",
              projectName: "paseo",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "sidebar-find",
            },
          ],
        }),
      ],
      pinnedChats: [
        {
          workspaceKey: feature.workspaceKey,
          serverId: "srv",
          workspaceId: "feature",
          projectViewKey: "project-1",
          projectName: "paseo",
          projectKind: "git",
          workspaceKind: "worktree",
          name: "sidebar-find",
        },
      ],
      workspaceGroups: [],
      workspaceEntriesByKey: rowsOf([root, feature]),
      workspaceTitleSource: "title",
    });

    expect(rows.map((row) => row.key)).toEqual([
      workspaceFindKey("srv:feature"),
      projectFindKey("project-1"),
      workspaceFindKey("srv:root"),
    ]);
    expect(rows[0].label).toBe("sidebar-find");
  });

  it("lists only the grouped rows when the sidebar groups by status", () => {
    const working = entry({ workspaceKey: "srv:working", name: "working-one" });
    const done = entry({ workspaceKey: "srv:done", name: "done-one" });
    const groups: SidebarWorkspaceGroup[] = [
      {
        key: "working",
        label: "Working",
        leading: { kind: "status", bucket: "running" },
        rows: [working],
      },
      { key: "done", label: "Done", leading: { kind: "status", bucket: "done" }, rows: [done] },
    ];

    const rows = buildSidebarFindRows({
      groupMode: "status",
      projects: [project()],
      pinnedChats: [],
      workspaceGroups: groups,
      workspaceEntriesByKey: rowsOf([working, done]),
      workspaceTitleSource: "title",
    });

    expect(rows.map((row) => row.label)).toEqual(["working-one", "done-one"]);
  });

  it("matches the branch name when the sidebar titles rows by branch", () => {
    const workspace = entry({ name: "ws-1", currentBranch: "feat/sidebar-find" });
    const rows = buildSidebarFindRows({
      groupMode: "status",
      projects: [],
      pinnedChats: [],
      workspaceGroups: [
        {
          key: "done",
          label: "Done",
          leading: { kind: "status", bucket: "done" },
          rows: [workspace],
        },
      ],
      workspaceEntriesByKey: rowsOf([workspace]),
      workspaceTitleSource: "branch",
    });

    expect(rows[0].label).toBe("feat/sidebar-find");
  });
});

describe("findSidebarMatches", () => {
  const rows = [
    { key: "a", label: "Paseo" },
    { key: "b", label: "sidebar-find" },
    { key: "c", label: "Sidebar Agent" },
  ];

  it("matches case-insensitively and keeps list order", () => {
    expect(findSidebarMatches(rows, "SIDEBAR").map((row) => row.key)).toEqual(["b", "c"]);
  });

  it("trims the query and ignores a blank one", () => {
    expect(findSidebarMatches(rows, "  find  ").map((row) => row.key)).toEqual(["b"]);
    expect(findSidebarMatches(rows, "   ")).toEqual([]);
  });

  it("returns nothing when the text sits in no label", () => {
    expect(findSidebarMatches(rows, "zzz")).toEqual([]);
  });
});

describe("advanceFindIndex", () => {
  it("steps forward and wraps at the end", () => {
    expect(advanceFindIndex(0, 3, 1)).toBe(1);
    expect(advanceFindIndex(2, 3, 1)).toBe(0);
  });

  it("steps backward and wraps at the start", () => {
    expect(advanceFindIndex(0, 3, -1)).toBe(2);
  });

  it("stays at zero with nothing to step through", () => {
    expect(advanceFindIndex(0, 0, 1)).toBe(0);
    expect(advanceFindIndex(4, 0, -1)).toBe(0);
  });
});
