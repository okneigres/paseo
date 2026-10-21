import { filePanelExtension, type FilePanelCandidate } from "./resolve";

const renderingPanels = [
  {
    id: "builtin:markdown",
    builtin: true,
    files: { extensions: ["md", "markdown"] },
    fileKind: "text",
  },
  {
    id: "builtin:html",
    builtin: true,
    files: { extensions: ["html", "htm"] },
    fileKind: "text",
  },
  {
    id: "builtin:image",
    builtin: true,
    files: { extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
    fileKind: "image",
  },
] as const satisfies readonly FilePanelCandidate[];

/** Paseo's editor. Every text file has it, so a text file always opens with some panel. */
export const sourceFilePanel = {
  id: "builtin:source",
  builtin: true,
  files: "all",
  fileKind: "text",
} as const satisfies FilePanelCandidate;

export type RenderingFilePanel = (typeof renderingPanels)[number];
export type SourceFilePanel = typeof sourceFilePanel;

/**
 * Every panel a host offers, in resolver order: the built-ins that render a file, then plugin
 * panels, then Source. Source is last so it is the default only when nothing else claims the file.
 */
export function filePanelCatalog<Plugin extends FilePanelCandidate>(
  pluginPanels: readonly Plugin[],
): readonly (RenderingFilePanel | Plugin | SourceFilePanel)[] {
  return [...renderingPanels, ...pluginPanels, sourceFilePanel];
}

/** Whether a file is a note: markdown, which is written and read in Source. */
export function isRenderedMarkdownFile(path: string): boolean {
  const extension = filePanelExtension(path);
  return renderingPanels[0].files.extensions.some((entry) => entry === extension);
}

/**
 * Which panel an unassociated file opens with. Notes open as source, in the editor where they are
 * written; a rendered page is the only way to read HTML, so there the rendering panel keeps it.
 */
export function defaultFilePanelId(path: string): string | null {
  return isRenderedMarkdownFile(path) ? sourceFilePanel.id : null;
}
