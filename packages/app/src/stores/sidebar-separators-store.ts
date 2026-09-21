import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * A named rule the user drops between projects.
 *
 * It carries no behaviour beyond its label and its place in the project order — the order store
 * keeps `separator:<id>` keys next to project view keys, so dragging a separator is the same
 * operation as dragging a project.
 */
export interface SidebarSeparator {
  id: string;
  label: string;
}

const STORAGE_KEY = "sidebar-separators";
const STORE_VERSION = 1;

const SidebarSeparatorSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string(),
});

const PersistedStateSchema = z.strictObject({
  separators: z.array(SidebarSeparatorSchema),
});

interface SidebarSeparatorsStoreState {
  separators: SidebarSeparator[];
  /** Returns the new separator's id, so the caller can put it in the project order. */
  addSeparator: (label: string) => string;
  renameSeparator: (id: string, label: string) => void;
  removeSeparator: (id: string) => void;
}

function createSeparatorId(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `separator_${value}`;
}

export const useSidebarSeparatorsStore = create<SidebarSeparatorsStoreState>()(
  persist(
    (set) => ({
      separators: [],
      addSeparator: (label) => {
        const id = createSeparatorId();
        set((state) => ({ separators: [...state.separators, { id, label }] }));
        return id;
      },
      renameSeparator: (id, label) =>
        set((state) => ({
          separators: state.separators.map((separator) =>
            separator.id === id ? { ...separator, label } : separator,
          ),
        })),
      removeSeparator: (id) =>
        set((state) => ({
          separators: state.separators.filter((separator) => separator.id !== id),
        })),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ separators: state.separators }),
    },
  ),
);
