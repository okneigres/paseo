/**
 * @vitest-environment jsdom
 */
import { act, fireEvent } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import React, { useCallback } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SidebarFindProvider, useSidebarFind } from "./sidebar-find";

const ROWS = [
  { key: "workspace:a", label: "paseo" },
  { key: "project:b", label: "Sidebar work" },
  { key: "workspace:c", label: "sidebar-find" },
];

function Probe() {
  const find = useSidebarFind();
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => find?.setQuery(event.target.value),
    [find],
  );
  const handleNext = useCallback(() => find?.step(1), [find]);
  if (!find) return null;
  return (
    <div>
      <span data-testid="active">{find.activeKey ?? "none"}</span>
      <span data-testid="position">{`${find.activeIndex}/${find.matches.length}`}</span>
      <input data-testid="query" value={find.query} onChange={handleChange} />
      <button type="button" data-testid="next" onClick={handleNext} />
    </div>
  );
}

describe("SidebarFindProvider", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <SidebarFindProvider rows={ROWS}>
          <Probe />
        </SidebarFindProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  const read = (testId: string) => container?.querySelector(`[data-testid="${testId}"]`);

  it("jumps to the first match as the query is typed", () => {
    act(() => {
      fireEvent.change(read("query")!, { target: { value: "SIDEBAR" } });
    });

    expect(read("active")?.textContent).toBe("project:b");
    expect(read("position")?.textContent).toBe("0/2");
  });

  it("walks to the next match and wraps at the end", () => {
    act(() => {
      fireEvent.change(read("query")!, { target: { value: "sidebar" } });
    });
    act(() => {
      fireEvent.click(read("next")!);
    });
    expect(read("active")?.textContent).toBe("workspace:c");
    expect(read("position")?.textContent).toBe("1/2");

    act(() => {
      fireEvent.click(read("next")!);
    });
    expect(read("active")?.textContent).toBe("project:b");
    expect(read("position")?.textContent).toBe("0/2");
  });

  it("reports no matches for text no row holds", () => {
    act(() => {
      fireEvent.change(read("query")!, { target: { value: "zzz" } });
    });

    expect(read("active")?.textContent).toBe("none");
    expect(read("position")?.textContent).toBe("-1/0");
  });

  it("returns to the first match after the query changes again", () => {
    act(() => {
      fireEvent.change(read("query")!, { target: { value: "sidebar" } });
    });
    act(() => {
      fireEvent.click(read("next")!);
    });
    act(() => {
      fireEvent.change(read("query")!, { target: { value: "paseo" } });
    });

    expect(read("active")?.textContent).toBe("workspace:a");
    expect(read("position")?.textContent).toBe("0/1");
  });
});
