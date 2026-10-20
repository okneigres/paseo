import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";
import type { StyleProp, View, ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  advanceFindIndex,
  findKeysFromSignature,
  findKeySignature,
  findSidebarMatches,
  type SidebarFindRow,
} from "@/components/sidebar/sidebar-find-rows";

/** How many frames a reveal waits for its row to mount (a collapsed project opening, say). */
const REVEAL_FRAME_BUDGET = 8;

export interface SidebarFindValue {
  query: string;
  setQuery: (query: string) => void;
  clear: () => void;
  matches: readonly SidebarFindRow[];
  /** -1 while nothing matches. */
  activeIndex: number;
  activeKey: string | null;
  matchKeys: ReadonlySet<string>;
  step: (delta: number) => void;
  registerRow: (key: string, reveal: () => void) => () => void;
}

const SidebarFindContext = createContext<SidebarFindValue | null>(null);

/**
 * Find-as-you-type over the sidebar's own rows. Typing jumps to the first row whose label holds
 * the text; asking again walks the list, wrapping at the end. Nothing is filtered out — the list
 * keeps its shape and the match is scrolled to and lit.
 */
export function SidebarFindProvider({
  rows,
  children,
}: {
  rows: readonly SidebarFindRow[];
  children: ReactNode;
}) {
  const [query, setQueryState] = useState("");
  const [chosenIndex, setChosenIndex] = useState(0);

  const matches = useMemo(() => findSidebarMatches(rows, query), [query, rows]);
  const activeIndex = matches.length === 0 ? -1 : Math.min(chosenIndex, matches.length - 1);
  const activeKey = activeIndex >= 0 ? matches[activeIndex].key : null;
  const matchKeys = useMemo(() => new Set(matches.map((match) => match.key)), [matches]);

  const revealersRef = useRef(new Map<string, () => void>());
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const reveal = useCallback((key: string) => {
    let frames = 0;
    const attempt = () => {
      const runReveal = revealersRef.current.get(key);
      if (runReveal) {
        runReveal();
        return;
      }
      if (frames++ < REVEAL_FRAME_BUDGET) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, []);

  useEffect(() => {
    if (activeKey) reveal(activeKey);
  }, [activeKey, reveal]);

  const registerRow = useCallback((key: string, runReveal: () => void) => {
    revealersRef.current.set(key, runReveal);
    // A row that mounts while already active (an expanding project, a lifting row limit) has not
    // existed for the effect above, so it reveals itself once the layout settles.
    requestAnimationFrame(() => {
      if (activeKeyRef.current === key) runReveal();
    });
    return () => {
      if (revealersRef.current.get(key) === runReveal) revealersRef.current.delete(key);
    };
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setChosenIndex(0);
  }, []);

  const clear = useCallback(() => setQuery(""), [setQuery]);

  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setChosenIndex((current) =>
        advanceFindIndex(Math.min(current, matches.length - 1), matches.length, delta),
      );
    },
    [matches.length],
  );

  const value = useMemo<SidebarFindValue>(
    () => ({
      query,
      setQuery,
      clear,
      matches,
      activeIndex,
      activeKey,
      matchKeys,
      step,
      registerRow,
    }),
    [activeIndex, activeKey, clear, matchKeys, matches, query, registerRow, setQuery, step],
  );

  return <SidebarFindContext.Provider value={value}>{children}</SidebarFindContext.Provider>;
}

/** Null outside the provider, which is every sidebar list before the find bar is mounted. */
export function useSidebarFind(): SidebarFindValue | null {
  return useContext(SidebarFindContext);
}

export interface SidebarFindRowBinding {
  /** Callback ref for the row's own container. */
  ref: RefCallback<View>;
  isMatch: boolean;
  isActive: boolean;
}

/**
 * Registers a rendered row with the find bar and reports whether it is lit. Rows hand the bar
 * every key they answer to: a project block header is both the project row and its first
 * workspace row.
 */
export function useSidebarFindRow(keys: readonly string[]): SidebarFindRowBinding {
  const find = useSidebarFind();
  const nodeRef = useRef<View | null>(null);
  const signature = findKeySignature(keys);

  const ref = useCallback<RefCallback<View>>((node) => {
    nodeRef.current = node;
  }, []);

  const revealSelf = useCallback(() => {
    scrollNodeIntoView(nodeRef.current);
  }, []);

  useEffect(() => {
    if (!find) return;
    const unregisters = findKeysFromSignature(signature).map((key) =>
      find.registerRow(key, revealSelf),
    );
    return () => {
      for (const unregister of unregisters) unregister();
    };
  }, [find, revealSelf, signature]);

  const ownedKeys = useMemo(() => findKeysFromSignature(signature), [signature]);

  return {
    ref,
    isMatch: find ? ownedKeys.some((key) => find.matchKeys.has(key)) : false,
    isActive: find ? ownedKeys.some((key) => key === find.activeKey) : false,
  };
}

/**
 * Web rows are DOM nodes and scroll themselves; native rows sit in virtualized lists with no
 * content-offset handle on a plain ref, so there the highlight alone marks the match.
 */
function scrollNodeIntoView(node: View | null): void {
  if (!node) return;
  const scrollable = node as unknown as {
    scrollIntoView?: (options?: { block?: string; behavior?: string }) => void;
  };
  scrollable.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

const findRowStyles = StyleSheet.create((theme) => ({
  match: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  active: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
}));

/** The row's find paint: every match gets the hover tint, the active one the selected tint. */
export function sidebarFindRowStyle(
  binding: SidebarFindRowBinding,
): StyleProp<ViewStyle> | undefined {
  if (binding.isActive) return findRowStyles.active;
  if (binding.isMatch) return findRowStyles.match;
  return undefined;
}
