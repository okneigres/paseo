import { describe, expect, it } from "vitest";
import {
  CHECKED_CHECKLIST_BOX,
  EMPTY_CHECKLIST_BOX,
  isMarkdownOrTextFile,
  isChecklistTypedPair,
  nextChecklistBox,
} from "./checklist";

describe("checklist boxes", () => {
  it("knows the prose files: markdown and plain text", () => {
    expect(isMarkdownOrTextFile("notes.md")).toBe(true);
    expect(isMarkdownOrTextFile("Notes.MD")).toBe(true);
    expect(isMarkdownOrTextFile("todo.txt")).toBe(true);
    expect(isMarkdownOrTextFile("notes.markdown")).toBe(true);
    expect(isMarkdownOrTextFile("main.ts")).toBe(false);
    expect(isMarkdownOrTextFile("readme")).toBe(false);
  });

  it("turns the two typed pairs into an empty box", () => {
    expect(isChecklistTypedPair("[]")).toBe(true);
    expect(isChecklistTypedPair("хъ")).toBe(true);
    expect(isChecklistTypedPair("()")).toBe(false);
    expect(isChecklistTypedPair("x]")).toBe(false);
  });

  it("flips a box both ways and leaves other characters alone", () => {
    expect(nextChecklistBox(EMPTY_CHECKLIST_BOX)).toBe(CHECKED_CHECKLIST_BOX);
    expect(nextChecklistBox(CHECKED_CHECKLIST_BOX)).toBe(EMPTY_CHECKLIST_BOX);
    expect(nextChecklistBox("x")).toBeNull();
    expect(nextChecklistBox(" ")).toBeNull();
  });
});
