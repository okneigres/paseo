import path from "node:path";
import { session } from "electron";
import log from "electron-log/main";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";

/**
 * Unpacked Chrome extensions to run inside the app's own window.
 *
 * `PASEO_UNPACKED_EXTENSIONS` lists directories, separated by the platform's path delimiter. They
 * are loaded into the default session before any window exists, so their content scripts reach the
 * app's own page — that is how an extension that lives as a layer over web pages can sit over this
 * app too, with no separate browser.
 *
 * Electron supports a subset of the Chrome extension APIs. A load can therefore succeed while parts
 * of an extension stay inert — its background service worker, its toolbar action — and Electron
 * logs what it dropped.
 */
export function resolveUnpackedExtensionPaths(configured: string | undefined): string[] {
  return (configured ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function readConfiguredExtensionPaths(): Promise<string[]> {
  const fromEnvironment = resolveUnpackedExtensionPaths(process.env.PASEO_UNPACKED_EXTENSIONS);
  try {
    const settings = await getDesktopSettingsStore().get();
    return [...fromEnvironment, ...settings.extensions.unpacked];
  } catch (error) {
    log.warn("[extensions] could not read settings", { error });
    return fromEnvironment;
  }
}

export async function loadUnpackedExtensions(): Promise<void> {
  const extensionPaths = [...new Set(await readConfiguredExtensionPaths())];
  for (const extensionPath of extensionPaths) {
    try {
      const extension = await session.defaultSession.extensions.loadExtension(extensionPath);
      log.info("[extensions] loaded", {
        name: extension.name,
        version: extension.version,
        extensionPath,
      });
    } catch (error) {
      log.warn("[extensions] could not load", { extensionPath, error });
    }
  }
}
