export interface SidebarFindShortcutPlatform {
  isMac: boolean;
}

/**
 * Command+Shift+F on macOS, Control+Shift+F elsewhere: the workspace search field.
 *
 * Shift is what keeps this apart from the pane Find binding in `@/pane-find/find-shortcut`,
 * which deliberately refuses shifted chords. The platform is a parameter so the predicate stays
 * testable without React Native or a DOM.
 */
export function isSidebarFindShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  platform: SidebarFindShortcutPlatform,
): boolean {
  const primaryModifier = platform.isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return primaryModifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === "f";
}
