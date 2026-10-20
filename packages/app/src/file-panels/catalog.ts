import { filePanelExtension, resolveFilePanel, type FilePanelCandidate } from "./resolve";

const markdownPanel = {
  id: "builtin:markdown",
  files: { extensions: ["md", "markdown"] },
  document: "text",
  maxBytes: Infinity,
} as const satisfies FilePanelCandidate;

export const builtinFilePanels = [
  markdownPanel,
  {
    id: "builtin:html",
    files: { extensions: ["html", "htm"] },
    document: "text",
    maxBytes: Infinity,
  },
  {
    id: "builtin:image",
    files: { extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
    document: "bytes",
    maxBytes: Infinity,
  },
] as const satisfies readonly FilePanelCandidate[];

export function isRenderedMarkdownFile(path: string): boolean {
  return markdownPanel.files.extensions.some((extension) => extension === filePanelExtension(path));
}

/** Which rendered panel a file opens with, if any. */
export function filePreviewRenderKind(path: string): "markdown" | "html" | null {
  const { panel } = resolveFilePanel({
    file: { path, kind: "text", size: 0, hasBytes: false },
    candidates: builtinFilePanels,
    associations: {},
  });
  if (!panel) return null;
  const kind = panel.id.slice("builtin:".length);
  return kind === "markdown" || kind === "html" ? kind : null;
}

/**
 * Which mode a renderable file opens in. Notes open as source, in the editor, where they are written;
 * a rendered page is the only way to read HTML, so that one opens as a page.
 */
export function defaultFilePreviewMode(filePath: string): "preview" | "source" {
  return filePreviewRenderKind(filePath) === "markdown" ? "source" : "preview";
}
