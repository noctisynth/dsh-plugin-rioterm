import { useSyncExternalStore } from 'react';
import type { PreferenceAutosave } from './preference-autosave.ts';

/** A page only observes the queue: navigation must not drop an accepted edit. */
export function usePreferenceDraft(draft: PreferenceAutosave) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const {
    change,
    flushField,
    holdField,
    releaseField,
    undo,
    restore,
    retry,
    rebase,
    cancel,
  } = draft;
  return {
    ...state,
    change,
    flushField,
    holdField,
    releaseField,
    undo,
    restore,
    retry,
    rebase,
    cancel,
  };
}
