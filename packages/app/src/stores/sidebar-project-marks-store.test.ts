import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarProjectMarksStore } from "./sidebar-project-marks-store";

describe("sidebar project marks store", () => {
  beforeEach(() => {
    useSidebarProjectMarksStore.setState({ markedProjectViewKeys: [] });
  });

  it("marks a project and unmarks it again", () => {
    const store = useSidebarProjectMarksStore.getState();

    store.toggleMark("srv/project-a");
    expect(useSidebarProjectMarksStore.getState().markedProjectViewKeys).toEqual(["srv/project-a"]);

    store.toggleMark("srv/project-a");
    expect(useSidebarProjectMarksStore.getState().markedProjectViewKeys).toEqual([]);
  });

  it("toggles one project without touching the others", () => {
    const store = useSidebarProjectMarksStore.getState();
    store.toggleMark("srv/project-a");
    store.toggleMark("srv/project-b");

    store.toggleMark("srv/project-a");

    expect(useSidebarProjectMarksStore.getState().markedProjectViewKeys).toEqual(["srv/project-b"]);
  });
});
