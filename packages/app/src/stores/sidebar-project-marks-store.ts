import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * A project the user marked as the one they are focused on.
 *
 * The mark carries no behaviour: it only paints the status dot the project row would otherwise
 * leave idle, so one glance down the rail says where the work is. Projects are addressed by their
 * view key — the same key the order store and the project menu use — so a mark follows a project
 * that moves, and a mark left on a project the user later removes simply stops being read.
 */
const STORAGE_KEY = "sidebar-project-marks";
const STORE_VERSION = 1;

const PersistedStateSchema = z.strictObject({
  markedProjectViewKeys: z.array(z.string().min(1)),
});

interface SidebarProjectMarksStoreState {
  markedProjectViewKeys: string[];
  toggleMark: (projectViewKey: string) => void;
}

export const useSidebarProjectMarksStore = create<SidebarProjectMarksStoreState>()(
  persist(
    (set) => ({
      markedProjectViewKeys: [],
      toggleMark: (projectViewKey) =>
        set((state) => ({
          markedProjectViewKeys: state.markedProjectViewKeys.includes(projectViewKey)
            ? state.markedProjectViewKeys.filter((key) => key !== projectViewKey)
            : [...state.markedProjectViewKeys, projectViewKey],
        })),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ markedProjectViewKeys: state.markedProjectViewKeys }),
    },
  ),
);

/** Whether a project is marked. Rows with no project of their own — pinned rows — pass null. */
export function useIsSidebarProjectMarked(projectViewKey: string | null): boolean {
  return useSidebarProjectMarksStore((state) =>
    projectViewKey === null ? false : state.markedProjectViewKeys.includes(projectViewKey),
  );
}
