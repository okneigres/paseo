import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Who the composer's messages are attributed to.
 *
 * `null` sends a message exactly as it was typed. Any other value prefixes it — `os:  ...` — which
 * is what lets one machine's transcript carry several people's remarks and be read apart later.
 */
export const COMPOSER_SPEAKERS = ["os"] as const;
export type ComposerSpeaker = (typeof COMPOSER_SPEAKERS)[number];

const STORAGE_KEY = "composer-speaker";
const STORE_VERSION = 1;

const PersistedStateSchema = z.strictObject({
  speaker: z.enum([...COMPOSER_SPEAKERS]).nullable(),
});

interface ComposerSpeakerStoreState {
  speaker: ComposerSpeaker | null;
  setSpeaker: (speaker: ComposerSpeaker | null) => void;
}

export const useComposerSpeakerStore = create<ComposerSpeakerStoreState>()(
  persist(
    (set) => ({
      speaker: null,
      setSpeaker: (speaker) => set({ speaker }),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ speaker: state.speaker }),
    },
  ),
);

/** The speaker the composer sends as. `null` sends messages unattributed. */
export function useComposerSpeaker(): ComposerSpeaker | null {
  return useComposerSpeakerStore((state) => state.speaker);
}
