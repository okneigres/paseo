import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { editorTheme, type EditorVisualTheme } from "./extensions.web";
import { proseFontExtension } from "./prose-font";

/**
 * The prose face has to win over the editor's own theme, which sets the mono face at the code size on
 * the same root. The two are separate extensions, so the order they are added in decides it — this
 * pins the order the editor view uses.
 */
const CODE_SIZE = 12;
const READING_SIZE = 17;

const EDITOR_THEME: EditorVisualTheme = {
  colorScheme: "dark",
  background: "#101010",
  foreground: "#f0f0f0",
  cursor: "#f0f0f0",
  foregroundMuted: "#808080",
  border: "#303030",
  selection: "#204060",
  monoFont: "monospace",
  codeFontSize: CODE_SIZE,
  proseFontSize: READING_SIZE,
  syntax: {
    keyword: "#ff0000",
    comment: "#888888",
    string: "#00ff00",
    number: "#0000ff",
    literal: "#0000ff",
    function: "#ffff00",
    definition: "#ffff00",
    class: "#00ffff",
    type: "#00ffff",
    tag: "#ff00ff",
    attribute: "#ff00ff",
    property: "#ff00ff",
    variable: "#ff00ff",
    operator: "#ffffff",
    punctuation: "#ffffff",
    regexp: "#00ff00",
    escape: "#00ff00",
    meta: "#888888",
    heading: "#ffffff",
    link: "#00ffff",
  },
};

const mounted: EditorView[] = [];

function mountEditor(filename: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "# notes\n\ntext",
      extensions: [proseFontExtension(filename, READING_SIZE), editorTheme(EDITOR_THEME)],
    }),
  });
  mounted.push(view);
  return view;
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

describe("prose typography", () => {
  it("reads markdown at the reading size, not the code size", () => {
    const view = mountEditor("notes.md");
    expect(getComputedStyle(view.contentDOM).fontSize).toBe(`${READING_SIZE}px`);
  });

  it("keeps the code size for a source file", () => {
    const view = mountEditor("main.ts");
    expect(getComputedStyle(view.contentDOM).fontSize).toBe(`${CODE_SIZE}px`);
  });
});
