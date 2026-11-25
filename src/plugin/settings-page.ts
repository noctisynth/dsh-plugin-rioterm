import { createElement, useSyncExternalStore } from 'react';
import {
  type PreferenceTranslate,
  preferenceMessages,
} from '../pages/preferences/messages.ts';
import { PreferencesPage } from '../pages/preferences/preferences-page.tsx';
import type { Observable, PreferenceEditor } from '../preferences/editor.ts';
import type { HostFonts } from '../preferences/values.ts';
import type { ClientContext } from './context.ts';
import { RIO_PREFERENCES_NAMESPACE } from './preferences.ts';

interface Props {
  editor: PreferenceEditor;
  fonts: Observable<HostFonts>;
  t: PreferenceTranslate;
}
function SettingsSlot({ editor, fonts, t }: Props) {
  const hostFonts = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  return createElement(PreferencesPage, { editor, hostFonts, t });
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
  ctx.effect(
    () =>
      ctx.slots.inject(slot, () =>
        ctx.slots.register(
          {
            name: slot,
            key: RIO_PREFERENCES_NAMESPACE,
            locale: ns,
            inject: () => ({ editor, fonts }),
          },
          SettingsSlot,
        ),
      ),
    'rio: bundle settings',
  );
}
