import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * The two plain-text symbols this editor understands, the way the notes editor does: an empty box and
 * a done one. They are ordinary characters in the file — nothing but this extension gives them meaning.
 */
export const EMPTY_CHECKLIST_BOX = "❏";
export const CHECKED_CHECKLIST_BOX = "✔";

/** Typing either pair leaves an empty box behind. */
const TYPED_PAIRS = new Set(["[]", "хъ"]);

/** The files this editor treats as prose: boxes and the Inter face both belong to them. */
const CHECKLIST_EXTENSIONS = [".md", ".markdown", ".txt"];

export function isMarkdownOrTextFile(filename: string): boolean {
  const name = filename.trim().toLowerCase();
  return CHECKLIST_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function isChecklistTypedPair(pair: string): boolean {
  return TYPED_PAIRS.has(pair);
}

/** What a click on a box makes of it: empty becomes done, done becomes empty, anything else stays. */
export function nextChecklistBox(char: string): string | null {
  if (char === EMPTY_CHECKLIST_BOX) return CHECKED_CHECKLIST_BOX;
  if (char === CHECKED_CHECKLIST_BOX) return EMPTY_CHECKLIST_BOX;
  return null;
}

const boxTyping = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || text.length !== 1 || from === 0) {
    return false;
  }
  const pair = `${view.state.sliceDoc(from - 1, from)}${text}`;
  if (!isChecklistTypedPair(pair)) {
    return false;
  }
  const insert = `${EMPTY_CHECKLIST_BOX} `;
  view.dispatch({
    changes: { from: from - 1, to, insert },
    selection: EditorSelection.cursor(from - 1 + insert.length),
    userEvent: "input.type",
  });
  return true;
});

const boxClick = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) {
      return false;
    }
    const next = nextChecklistBox(view.state.sliceDoc(position, position + 1));
    if (next === null) {
      return false;
    }
    // The click belongs to the box, not to the caret: flipping it should not also move the cursor
    // into the middle of a line the user is reading.
    event.preventDefault();
    view.dispatch({ changes: { from: position, to: position + 1, insert: next } });
    return true;
  },
});

/** Boxes in the files that carry them, and nowhere else. */
export function checklistExtensionsForFile(filename: string): Extension[] {
  return isMarkdownOrTextFile(filename) ? [boxTyping, boxClick] : [];
}
