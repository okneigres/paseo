import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSeparator } from "@/stores/sidebar-separators-store";
import { buildSidebarProjectRows, sidebarSeparatorOrderKey } from "./sidebar-project-rows";

function project(viewKey: string): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    hosts: [],
    workspaces: [],
  } as unknown as SidebarProjectEntry;
}

function separator(id: string, label = id): SidebarSeparator {
  return { id, label };
}

describe("buildSidebarProjectRows", () => {
  it("keeps the stored order, mixing projects and separators", () => {
    const rows = buildSidebarProjectRows({
      projects: [project("a"), project("b")],
      separators: [separator("s1"), separator("s2")],
      projectOrder: ["a", sidebarSeparatorOrderKey("s1"), "b", sidebarSeparatorOrderKey("s2")],
    });

    expect(rows.map((row) => row.key)).toEqual([
      "a",
      sidebarSeparatorOrderKey("s1"),
      "b",
      sidebarSeparatorOrderKey("s2"),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["project", "separator", "project", "separator"]);
  });

  it("appends rows the order has never seen, projects first", () => {
    const rows = buildSidebarProjectRows({
      projects: [project("a"), project("b")],
      separators: [separator("s1")],
      projectOrder: ["b"],
    });

    expect(rows.map((row) => row.key)).toEqual(["b", "a", sidebarSeparatorOrderKey("s1")]);
  });

  it("drops order keys whose project or separator is gone", () => {
    const rows = buildSidebarProjectRows({
      projects: [project("a")],
      separators: [],
      projectOrder: ["deleted-project", "a", sidebarSeparatorOrderKey("deleted-separator")],
    });

    expect(rows.map((row) => row.key)).toEqual(["a"]);
  });

  it("keeps a separator row when there are no projects at all", () => {
    const rows = buildSidebarProjectRows({
      projects: [],
      separators: [separator("s1", "Later")],
      projectOrder: [sidebarSeparatorOrderKey("s1")],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "separator", key: sidebarSeparatorOrderKey("s1") });
  });
});
