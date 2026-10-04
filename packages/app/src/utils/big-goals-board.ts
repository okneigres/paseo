/**
 * The big-goals extension (a Chrome extension the user loads unpacked) draws its board as a layer
 * over whatever page it runs on, and toggles it on Alt+S — `graph.js` listens for
 * `e.altKey && e.code === 'KeyS'` on `window`. Its own toolbar button sends the tab the same toggle;
 * this app has no toolbar, so the header button dispatches the key event the board listens for.
 *
 * The extension marks every page it reaches with a host element, which is how the button knows it
 * has something to talk to.
 */
const EXTENSION_HOST_ELEMENT_ID = "__zjg-host";

export function isBigGoalsBoardAvailable(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.getElementById(EXTENSION_HOST_ELEMENT_ID) !== null;
}

/** Toggles the board. Returns false when the extension is not running on this page. */
export function toggleBigGoalsBoard(): boolean {
  if (!isBigGoalsBoardAvailable() || typeof window === "undefined") {
    return false;
  }

  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      altKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
  return true;
}
