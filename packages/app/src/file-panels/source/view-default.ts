import type { TextFileView } from "./toolbar";

/**
 * The view a note opens on: the editor it is written in. A rendered page is the only way to read
 * HTML, so that panel still opens on its Preview. Plain text panels have no view of their own.
 */
export function defaultTextFileView(path: string): TextFileView {
  const name = path.trim().split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return extension === "md" || extension === "markdown" ? "source" : "preview";
}
