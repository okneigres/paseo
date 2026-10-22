import { describe, expect, it } from "vitest";
import { defaultTextFileView } from "./view-default";

describe("defaultTextFileView", () => {
  it("opens notes in the editor they are written in", () => {
    expect(defaultTextFileView("README.md")).toBe("source");
    expect(defaultTextFileView("docs/notes.markdown")).toBe("source");
    expect(defaultTextFileView("NOTES.MD")).toBe("source");
  });

  it("opens a rendered page on its preview", () => {
    expect(defaultTextFileView("plan.html")).toBe("preview");
    expect(defaultTextFileView("docs/PLAN.HTM")).toBe("preview");
  });

  it("falls back to the preview for names without a note extension", () => {
    expect(defaultTextFileView("Dockerfile")).toBe("preview");
    expect(defaultTextFileView("")).toBe("preview");
  });
});
