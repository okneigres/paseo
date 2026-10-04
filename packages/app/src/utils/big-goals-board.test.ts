/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBigGoalsBoardAvailable, toggleBigGoalsBoard } from "./big-goals-board";

const HOST_ID = "__zjg-host";

function mountExtensionHost(): void {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
}

afterEach(() => {
  document.getElementById(HOST_ID)?.remove();
  vi.restoreAllMocks();
});

describe("big-goals board bridge", () => {
  it("reports the extension as absent until its host element is there", () => {
    expect(isBigGoalsBoardAvailable()).toBe(false);
    mountExtensionHost();
    expect(isBigGoalsBoardAvailable()).toBe(true);
  });

  it("sends the board the key event it listens for", () => {
    mountExtensionHost();
    const listener = vi.fn();
    window.addEventListener("keydown", listener);

    expect(toggleBigGoalsBoard()).toBe(true);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as KeyboardEvent;
    expect(event.code).toBe("KeyS");
    expect(event.altKey).toBe(true);
    expect(event.key).toBe("s");
  });

  it("does nothing when the extension is not on the page", () => {
    const listener = vi.fn();
    window.addEventListener("keydown", listener);

    expect(toggleBigGoalsBoard()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
