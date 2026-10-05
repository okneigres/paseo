import { Asset } from "expo-asset";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isMarkdownOrTextFile } from "./checklist";

/** The face the notes call for the prose files. */
const PROSE_FONT_FAMILY = '"Roboto Condensed", system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * The files the face is drawn from, with the ranges the package draws each of them for.
 *
 * The package's own stylesheet cannot be used here: its `url(./files/…)` is relative to the document,
 * and the dev server answers that with the app's HTML, so the face silently never loads. Requiring
 * the files instead hands back URLs the browser can fetch. Only the subsets the notes need are
 * bundled — Latin, and both Cyrillic ranges — so the rest of the package stays out of the app.
 */
const PROSE_FONT_SUBSETS = [
  {
    name: "cyrillic-ext",
    range: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F",
  },
  { name: "cyrillic", range: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" },
  {
    name: "latin",
    range:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  },
] as const;

const PROSE_FONT_WEIGHTS = ["400", "600"] as const;

const PROSE_FONT_MODULES: readonly number[] = [
  require("@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-ext-400-normal.woff2"),
  require("@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-400-normal.woff2"),
  require("@fontsource/roboto-condensed/files/roboto-condensed-latin-400-normal.woff2"),
  require("@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-ext-600-normal.woff2"),
  require("@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-600-normal.woff2"),
  require("@fontsource/roboto-condensed/files/roboto-condensed-latin-600-normal.woff2"),
];

let loading: Promise<void> | null = null;

/** Puts the prose face in the document once; calling it again is free. */
export function loadProseFont(): Promise<void> {
  loading ??= Promise.all(
    PROSE_FONT_MODULES.map(async (module, position) => {
      const weight = PROSE_FONT_WEIGHTS[Math.floor(position / PROSE_FONT_SUBSETS.length)];
      const subset = PROSE_FONT_SUBSETS[position % PROSE_FONT_SUBSETS.length];
      const asset = Asset.fromModule(module);
      await asset.downloadAsync();
      const source = asset.localUri ?? asset.uri;
      const face = new FontFace("Roboto Condensed", `url(${source})`, {
        weight,
        unicodeRange: subset.range,
      });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return loading;
}

/** Markdown and text files are read as prose, so they take Roboto Condensed where the code takes mono. */
export function proseFontExtension(filename: string): Extension {
  if (!isMarkdownOrTextFile(filename)) {
    return [];
  }
  const family = { fontFamily: PROSE_FONT_FAMILY };
  return EditorView.theme({ "&": family, ".cm-content": family });
}
