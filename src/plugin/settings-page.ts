import { createElement, useSyncExternalStore } from 'react';
import {
  type PreferenceTranslate,
  preferenceMessages,
} from '../pages/preferences/messages.ts';
import { PreferenceAutosave } from '../pages/preferences/preference-autosave.ts';
import { PreferencesPage } from '../pages/preferences/preferences-page.tsx';
import type { Observable, PreferenceEditor } from '../preferences/editor.ts';
import type { HostFonts } from '../preferences/values.ts';
import type { ClientContext } from './context.ts';
import { RIO_PREFERENCES_NAMESPACE } from './preferences.ts';

interface Props {
  draft: PreferenceAutosave;
  fonts: Observable<HostFonts>;
  t: PreferenceTranslate;
}
function SettingsSlot({ draft, fonts, t }: Props) {
  const hostFonts = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  return createElement(PreferencesPage, { draft, hostFonts, t });
}
export function registerSettingsPage(
  ctx: ClientContext,
  editor: PreferenceEditor,
  fonts: Observable<HostFonts>,
) {
  const slot = 'plugins.bundle.config';
  const ns = 'rioTerminalPreferences';
  ctx.effect(
    () => ctx.locale.register(ns, preferenceMessages),
    'rio: settings locale',
  );
  // The form controls writability. Losing its namespace must not hide the page or discard a draft.
  ctx.effect(() => {
    // The window's settings slot owns queued writes, not individual mounted pages.
    // Leaving the details page must not lose a valid trailing edit or queued selection.
    const draft = new PreferenceAutosave(editor);
    const unregister = ctx.slots.inject(slot, () =>
      ctx.slots.register(
        {
          name: slot,
          key: RIO_PREFERENCES_NAMESPACE,
          locale: ns,
          inject: () => ({ draft, fonts }),
        },
        SettingsSlot,
      ),
    );
    const disconnect = draft.connect();
    return () => {
      disconnect();
      unregister();
    };
  }, 'rio: bundle settings');
}
