import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHECKED_CHECKLIST_BOX,
  checklistExtensionsForFile,
  CROSSED_CHECKLIST_BOX,
  EMPTY_CHECKLIST_BOX,
} from "./checklist";

const mounted: EditorView[] = [];

function mount(doc: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: checklistExtensionsForFile("notes.md") }),
  });
  mounted.push(view);
  return view;
}

/** A real click on the box, where the box actually is. */
function clickBox(view: EditorView, position: number): void {
  const coords = view.coordsAtPos(position);
  if (!coords) throw new Error("the box has no coordinates to click");
  view.contentDOM.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: coords.left + 2,
      clientY: coords.top + coords.bottom - (coords.top + coords.bottom) / 2,
    }),
  );
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

describe("clicking a box", () => {
  it("walks it through empty, done, crossed and back", () => {
    const view = mount(`${EMPTY_CHECKLIST_BOX} milk`);

    clickBox(view, 0);
    expect(view.state.doc.toString()).toBe(`${CHECKED_CHECKLIST_BOX} milk`);

    clickBox(view, 0);
    expect(view.state.doc.toString()).toBe(`${CROSSED_CHECKLIST_BOX} milk`);

    clickBox(view, 0);
    expect(view.state.doc.toString()).toBe(`${EMPTY_CHECKLIST_BOX} milk`);
  });
});
