import z from '@deepseek-ai/schemastery';
import {
  ansiNames,
  preferenceDefaults as defaults,
  fontSizeRange,
  latencyRange,
  lineHeightRange,
  type RioPreferenceValues,
  scrollbackRange,
} from '../preferences/schema-values.ts';
import {
  colorPattern,
  fontFamilyMaxLength,
  fontFamilyPattern,
} from '../preferences/validation.ts';

function integer([min, max]: readonly [number, number]) {
  return z.number().min(min).max(max).step(1);
}

const color = z.union(['', z.string().pattern(colorPattern)]);
const palette = z
  .array(color.required())
  .min(ansiNames.length)
  .max(ansiNames.length);

// DSH Settings projects the volatile leaves of the active Loader entry's Config.
// These are Rio's *requested* choices, not resolved DSH fonts or per-session PTY limits.
export const Config = z.object({
  fontFamily: z
    .string()
    .max(fontFamilyMaxLength)
    .pattern(fontFamilyPattern)
    .default(defaults.fontFamily)
    .volatile(),
  fontSize: z
    .union([defaults.fontSize, integer(fontSizeRange)])
    .default(defaults.fontSize)
    .volatile(),
  lineHeight: z
    .number()
    .min(lineHeightRange[0])
    .max(lineHeightRange[1])
    // Schemastery's range comparisons alone admit NaN (e.g. YAML .nan).
    // Every finite JS number in [1, 3] is a multiple of EPSILON; no rounding.
    .step(Number.EPSILON)
    .default(defaults.lineHeight)
    .volatile(),
  scrollback: z
    .union([defaults.scrollback, integer(scrollbackRange)])
    .default(defaults.scrollback)
    .volatile(),
  altIsMeta: z.boolean().default(defaults.altIsMeta).volatile(),
  detectUrls: z.boolean().default(defaults.detectUrls).volatile(),
  autoFocus: z.boolean().default(defaults.autoFocus).volatile(),
  fit: z.boolean().default(defaults.fit).volatile(),
  foreground: color.default(defaults.foreground).volatile(),
  background: color.default(defaults.background).volatile(),
  cursor: color.default(defaults.cursor).volatile(),
  selectionForeground: color.default(defaults.selectionForeground).volatile(),
  selectionBackground: color.default(defaults.selectionBackground).volatile(),
  palette: z
    .union([z.const([] as string[]), palette])
    .default(defaults.palette)
    .volatile(),
  renderer: z
    .union(['dom', 'canvas'] as const)
    .default(defaults.renderer)
    .volatile(),
  cursorStyle: z
    .union(['block', 'bar', 'underline'] as const)
    .default(defaults.cursorStyle)
    .volatile(),
  predictiveEcho: z.boolean().default(defaults.predictiveEcho).volatile(),
  latencyThreshold: integer(latencyRange)
    .default(defaults.latencyThreshold)
    .volatile(),
  predictionStyle: z
    .union(['underline', 'dim'] as const)
    .default(defaults.predictionStyle)
    .volatile(),
} satisfies Record<keyof RioPreferenceValues, unknown>);

interface SettingsChild {
  settings: { configure(policy: { auto: false }, owner: unknown): () => void };
  effect(register: () => () => void, label: string): unknown;
}
export interface PreferenceHost {
  readonly fiber: unknown;
  inject(
    names: ['settings'],
    register: (child: SettingsChild) => void,
  ): unknown;
}

/** Advertise our native configuration page without making Settings a dependency of the WASM route. */
export function configurePreferencePage(ctx: PreferenceHost): void {
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      'dsh-plugin-rioterm: preferences page',
    );
  });
}
