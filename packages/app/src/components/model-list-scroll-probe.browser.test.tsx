import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { FlatList, Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.stubGlobal("React", React));

interface Row {
  id: string;
}

const ROWS: Row[] = Array.from({ length: 200 }, (_, position) => ({ id: `model-${position}` }));
const SELECTED = "model-150";
const LIST_STYLE = { height: 400 };
const ROW_STYLE = { height: 44 };

/** What the model list does: declare the row layout, then aim at an index. */
function Probe({ selected }: { selected: string }) {
  const list = React.useRef<FlatList<Row>>(null);
  const index = ROWS.findIndex((row) => row.id === selected);

  React.useEffect(() => {
    list.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
  }, [index]);

  return (
    <FlatList<Row>
      ref={list}
      style={LIST_STYLE}
      data={ROWS}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      renderItem={renderItem}
    />
  );
}

function keyExtractor(item: Row): string {
  return item.id;
}

function getItemLayout(_data: ArrayLike<Row> | null | undefined, index: number) {
  return { length: ROW_STYLE.height, offset: index * ROW_STYLE.height, index };
}

function renderItem({ item }: { item: Row }) {
  return (
    <View testID={`row-${item.id}`} style={ROW_STYLE}>
      <Text>{item.id}</Text>
    </View>
  );
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/**
 * Pins the mechanism the model list relies on: without `getItemLayout` a virtualized list is only as
 * tall as the rows it has rendered, so an aim at a model far down the list cannot be placed.
 */
describe("aiming far down a virtualized list", () => {
  it("brings the model at the aimed index into view", async () => {
    const container = document.createElement("div");
    container.style.height = "400px";
    container.style.overflow = "hidden";
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe selected={SELECTED} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    const box = container.getBoundingClientRect();
    const row = container.querySelector(`[data-testid="row-${SELECTED}"]`);
    expect(row).not.toBeNull();
    const rect = row!.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(box.top);
    expect(rect.bottom).toBeLessThanOrEqual(box.bottom + 1);
  });
});
