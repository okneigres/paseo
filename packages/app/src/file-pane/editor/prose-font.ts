import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isMarkdownOrTextFile } from "./checklist";

/** The face the notes call for the prose files. The files it is drawn from load from prose-font-assets. */
const PROSE_FONT_FAMILY = '"Roboto Condensed", system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Markdown and text files are read as prose, so they take Roboto Condensed at the size the rendered
 * view reads at, where the code files take the editor's mono face at its code size.
 */
export function proseFontExtension(filename: string, proseFontSize: number): Extension {
  if (!isMarkdownOrTextFile(filename)) {
    return [];
  }
  const prose = { fontFamily: PROSE_FONT_FAMILY, fontSize: `${proseFontSize}px` };
  return EditorView.theme({ "&": prose, ".cm-content": prose });
}
