import {
  type colorFields,
  preferenceDefaults,
  type RioOverrides,
  type RioPreferenceValues,
} from './schema-values.ts';

export * from './schema-values.ts';
export const terminalFontStack =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export interface HostFonts {
  fontFamily: string;
  fontSize: number;
}
export interface EffectiveRioPreferences
  extends Omit<
    RioPreferenceValues,
    (typeof colorFields)[number] | 'palette' | 'scrollback'
  > {
  scrollback?: number | undefined;
  themeRevision: number;
  theme: Partial<
    Pick<RioPreferenceValues, (typeof colorFields)[number] | 'palette'>
  >;
}
export function resolvePreferences(
  overrides: RioOverrides,
  fonts: HostFonts,
  themeRevision: number,
): EffectiveRioPreferences {
  const {
    fontFamily,
    fontSize,
    scrollback,
    palette,
    foreground,
    background,
    cursor,
    selectionForeground,
    selectionBackground,
    ...options
  } = { ...preferenceDefaults, ...overrides };
  return {
    ...options,
    themeRevision,
    fontFamily: fontFamily
      ? `${fontFamily}, ${terminalFontStack}`
      : fonts.fontFamily,
    fontSize: fontSize || fonts.fontSize,
    scrollback: scrollback < 0 ? undefined : scrollback,
    theme: {
      ...(foreground && { foreground }),
      ...(background && { background }),
      ...(cursor && { cursor }),
      ...(selectionForeground && { selectionForeground }),
      ...(selectionBackground && { selectionBackground }),
      ...(palette.length && { palette }),
    },
  };
}
export const defaultEffectivePreferences = resolvePreferences(
  {},
  { fontFamily: terminalFontStack, fontSize: 13 },
  0,
);
export {
  colorPattern,
  fontFamilyMaxLength,
  fontFamilyPattern,
  readOverrides,
  validatedOverrides,
} from './validation.ts';
