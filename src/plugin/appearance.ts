import type { Observable, PreferenceEditor } from '../preferences/editor.ts';
import {
  type EffectiveRioPreferences,
  type HostFonts,
  resolvePreferences,
  terminalFontStack,
} from '../preferences/values.ts';
import type { ClientContext } from './context.ts';

/** DSH publishes immutable snapshots via theme/change, not a DOM mutation observer. */
export function createAppearance(
  ctx: ClientContext,
  editor: PreferenceEditor,
): Observable<EffectiveRioPreferences> & { hostFonts: Observable<HostFonts> } {
  const getTheme = () => ctx.theme.getTheme();
  const subscribeTheme = (listener: () => void) =>
    ctx.on('theme/change', listener);
  let previousTheme: ReturnType<typeof getTheme> | undefined;
  let fonts: HostFonts;
  const hostFonts = {
    subscribe: subscribeTheme,
    getSnapshot() {
      const theme = getTheme();
      if (previousTheme !== theme) {
        previousTheme = theme;
        const family = theme.fontFamilies.terminal;
        fonts = {
          fontFamily: family
            ? `${family}, ${terminalFontStack}`
            : terminalFontStack,
          fontSize: theme.fontSizes.terminal,
        };
      }
      return fonts;
    },
  };
  let previousValue:
    | ReturnType<PreferenceEditor['getSnapshot']>['value']
    | undefined;
  let previousRevision: number | undefined;
  let resolved: EffectiveRioPreferences;
  return {
    hostFonts,
    getSnapshot() {
      const { value } = editor.getSnapshot();
      const { revision } = getTheme();
      if (previousValue !== value || previousRevision !== revision) {
        previousValue = value;
        previousRevision = revision;
        resolved = resolvePreferences(value, hostFonts.getSnapshot(), revision);
      }
      return resolved;
    },
    subscribe(listener) {
      const offConfig = editor.subscribe(listener),
        offTheme = subscribeTheme(listener);
      return () => {
        offConfig();
        offTheme();
      };
    },
  };
}
