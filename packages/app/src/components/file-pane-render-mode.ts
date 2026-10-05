export type FilePreviewRenderKind = "markdown" | "html";

export function isRenderedMarkdownFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function isRenderedHtmlFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm");
}

export function filePreviewRenderKind(filePath: string): FilePreviewRenderKind | null {
  if (isRenderedMarkdownFile(filePath)) return "markdown";
  if (isRenderedHtmlFile(filePath)) return "html";
  return null;
}

/**
 * Which mode a renderable file opens in. Notes open as source, in the editor, where they are written;
 * a rendered page is the only way to read HTML, so that one opens as a page.
 */
export function defaultFilePreviewMode(filePath: string): "preview" | "source" {
  return filePreviewRenderKind(filePath) === "markdown" ? "source" : "preview";
}
