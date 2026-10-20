import { describe, expect, it } from "vitest";
import { isSidebarFindShortcut } from "./sidebar-find-shortcut";

const MAC = { isMac: true };
const OTHER = { isMac: false };

function chord(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "f",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("isSidebarFindShortcut", () => {
  it("is Command+Shift+F on macOS", () => {
    expect(isSidebarFindShortcut(chord({ metaKey: true, shiftKey: true }), MAC)).toBe(true);
    expect(isSidebarFindShortcut(chord({ key: "F", metaKey: true, shiftKey: true }), MAC)).toBe(
      true,
    );
  });

  it("is Control+Shift+F elsewhere", () => {
    expect(isSidebarFindShortcut(chord({ ctrlKey: true, shiftKey: true }), OTHER)).toBe(true);
  });

  it("stays clear of the pane Find binding", () => {
    expect(isSidebarFindShortcut(chord({ metaKey: true }), MAC)).toBe(false);
    expect(isSidebarFindShortcut(chord({ ctrlKey: true }), OTHER)).toBe(false);
  });

  it("ignores the other modifiers and keys", () => {
    expect(
      isSidebarFindShortcut(chord({ metaKey: true, ctrlKey: true, shiftKey: true }), MAC),
    ).toBe(false);
    expect(isSidebarFindShortcut(chord({ ctrlKey: true, shiftKey: true }), MAC)).toBe(false);
    expect(isSidebarFindShortcut(chord({ metaKey: true, shiftKey: true, altKey: true }), MAC)).toBe(
      false,
    );
    expect(isSidebarFindShortcut(chord({ key: "g", metaKey: true, shiftKey: true }), MAC)).toBe(
      false,
    );
  });
});
