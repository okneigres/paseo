import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isMarkdownOrTextFile } from "./checklist";

/** The face the notes call for the prose files. Nothing here bundles it — see the editor's import. */
const PROSE_FONT_FAMILY = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Markdown and text files are read as prose, so they take Inter where the code editor takes mono. */
export function proseFontExtension(filename: string): Extension {
  if (!isMarkdownOrTextFile(filename)) {
    return [];
  }
  const family = { fontFamily: PROSE_FONT_FAMILY };
  return EditorView.theme({ "&": family, ".cm-content": family });
}
