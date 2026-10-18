import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_FORM_PREFERENCES,
  mergeProviderPreferences,
  type FormPreferences,
  type ProviderPreferences,
} from "@/create-agent-preferences/preferences";
import {
  createAgentPreferencesService,
  type FormPreferenceUpdate,
  type WorkspacePreferencesKey,
} from "@/create-agent-preferences/service";

const FORM_PREFERENCES_QUERY_KEY = ["form-preferences"] as const;

function formPreferencesQueryKey(workspaceKey: WorkspacePreferencesKey | null) {
  return [...FORM_PREFERENCES_QUERY_KEY, workspaceKey] as const;
}

export type { FormPreferences, ProviderPreferences };

export { mergeProviderPreferences };

export interface UseFormPreferencesReturn {
  preferences: FormPreferences;
  isLoading: boolean;
  updatePreferences: (updates: FormPreferenceUpdate) => Promise<FormPreferences>;
}

/**
 * Reads and writes the create-agent form memory for one workspace. A null key
 * addresses the host-wide fallback, which is what callers with no workspace yet
 * (new-workspace setup, schedules) keep using.
 */
export function useFormPreferences(
  workspaceKey: WorkspacePreferencesKey | null = null,
): UseFormPreferencesReturn {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: formPreferencesQueryKey(workspaceKey),
    queryFn: () => createAgentPreferencesService.load(workspaceKey),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const preferences = data ?? DEFAULT_FORM_PREFERENCES;

  const updatePreferences = useCallback(
    async (updates: FormPreferenceUpdate) => {
      const next = await createAgentPreferencesService.update(workspaceKey, updates);
      queryClient.setQueryData<FormPreferences>(formPreferencesQueryKey(workspaceKey), next);
      if (workspaceKey === null) {
        // A host-wide write changes the fallback every workspace without its own
        // entry reads, so re-read the sibling queries instead of leaving them stale.
        await queryClient.invalidateQueries({ queryKey: FORM_PREFERENCES_QUERY_KEY });
      }
      return next;
    },
    [queryClient, workspaceKey],
  );

  return {
    preferences,
    isLoading: isPending,
    updatePreferences,
  };
}
