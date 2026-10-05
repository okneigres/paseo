import { Asset } from "expo-asset";

/**
 * The files the prose face is drawn from, with the weight each of them answers for.
 *
 * The face ships as font files in the app rather than through a package: the no-ligature build the
 * editor reads in is not published to npm, so the two weights the rendered view uses are bundled
 * beside the editor, with the licence they come under.
 */
const PROSE_FONT_FILES = [
  {
    weight: "400",
    module: require("../../../assets/fonts/jetbrains-mono-nl/JetBrainsMonoNL-Regular.ttf"),
  },
  {
    weight: "600",
    module: require("../../../assets/fonts/jetbrains-mono-nl/JetBrainsMonoNL-SemiBold.ttf"),
  },
] as const;

let loading: Promise<void> | null = null;

/** Puts the prose face in the document once; calling it again is free. */
export function loadProseFont(): Promise<void> {
  loading ??= Promise.all(
    PROSE_FONT_FILES.map(async ({ module, weight }) => {
      const asset = Asset.fromModule(module);
      await asset.downloadAsync();
      const face = new FontFace("JetBrains Mono NL", `url(${asset.localUri ?? asset.uri})`, {
        weight,
      });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return loading;
}
