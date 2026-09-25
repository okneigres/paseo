import { describe, expect, it } from "vitest";
import { resolveWorkspaceStatusVisual } from "./workspace-status-visual";

describe("workspace status visual", () => {
  it("paints the idle dot with the project mark", () => {
    expect(resolveWorkspaceStatusVisual({ bucket: "done", loading: false, marked: true })).toBe(
      "marked",
    );
    expect(resolveWorkspaceStatusVisual({ bucket: "done", loading: false, marked: false })).toBe(
      "idle",
    );
  });

  it("leaves a status of the row's own alone", () => {
    expect(
      resolveWorkspaceStatusVisual({ bucket: "needs_input", loading: false, marked: true }),
    ).toBe("needs_input");
    expect(resolveWorkspaceStatusVisual({ bucket: "failed", loading: false, marked: true })).toBe(
      "kind",
    );
  });

  it("shows a starting row as loading, mark or no mark", () => {
    expect(resolveWorkspaceStatusVisual({ bucket: "done", loading: true, marked: true })).toBe(
      "loading",
    );
  });
});
