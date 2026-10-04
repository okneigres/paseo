import { describe, expect, it } from "vitest";
import {
  CHECKED_CHECKLIST_BOX,
  EMPTY_CHECKLIST_BOX,
  isChecklistFile,
  isChecklistTypedPair,
  nextChecklistBox,
} from "./checklist";

describe("checklist boxes", () => {
  it("carries boxes in markdown and plain text only", () => {
    expect(isChecklistFile("notes.md")).toBe(true);
    expect(isChecklistFile("Notes.MD")).toBe(true);
    expect(isChecklistFile("todo.txt")).toBe(true);
    expect(isChecklistFile("notes.markdown")).toBe(true);
    expect(isChecklistFile("main.ts")).toBe(false);
    expect(isChecklistFile("readme")).toBe(false);
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
