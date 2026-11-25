import {
  ansiPresets,
  boldBrightModes,
  colorFields,
  fontSizeRange,
  latencyRange,
  lineHeightRange,
  paddingRange,
  preferenceDefaults,
  type RioOverrides,
  type RioPreferenceValues,
  scrollbackRange,
} from './schema-values.ts';

// Local family names only. Never treat an input as CSS, a font URL or a resource to fetch.
export const fontFamilyMaxLength = 256;
export const fontFamilyPattern = /^[\p{L}\p{M}\p{N} _.'",-]*$/u;
export const colorPattern = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const generics = new Set(
  'serif sans-serif monospace cursive fantasy system-ui ui-serif ui-sans-serif ui-monospace ui-rounded emoji math fangsong -apple-system blinkmacsystemfont'.split(
    ' ',
  ),
);
function family(value: string): string {
  return value
    .split(',')
    .map((v) =>
      v
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter(Boolean)
    .map((name) =>
      generics.has(name.toLowerCase()) ? name : `"${name.replaceAll('"', '')}"`,
    )
    .join(', ');
}
function numeric(
  value: unknown,
  range: readonly [number, number],
  integer = true,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    value >= range[0] &&
    value <= range[1]
  );
}
function color(value: unknown): value is string {
  return (
    typeof value === 'string' && (value === '' || colorPattern.test(value))
  );
}
function assign(
  target: RioOverrides,
  key: keyof RioPreferenceValues,
  v: unknown,
  stored: boolean,
): void {
  switch (key) {
    case 'fontFamily':
      if (
        typeof v === 'string' &&
        v.length <= fontFamilyMaxLength &&
        fontFamilyPattern.test(v)
      ) {
        const f = family(v);
        if (f.length <= fontFamilyMaxLength) {
          if (f) target.fontFamily = f;
          return;
        }
      }
      break;
    case 'fontSize':
      if (stored && v === 0) return;
      if (numeric(v, fontSizeRange)) {
        target.fontSize = v;
        return;
      }
      break;
    case 'paddingTop':
    case 'paddingRight':
    case 'paddingBottom':
    case 'paddingLeft':
      if (numeric(v, paddingRange)) {
        target[key] = v;
        return;
      }
      break;
    case 'scrollback':
      if (stored && v === -1) return;
      if (numeric(v, scrollbackRange)) {
        target.scrollback = v;
        return;
      }
      break;
    case 'lineHeight':
      if (numeric(v, lineHeightRange, false)) {
        target.lineHeight = v;
        return;
      }
      break;
    case 'latencyThreshold':
      if (numeric(v, latencyRange)) {
        target.latencyThreshold = v;
        return;
      }
      break;
    case 'fit':
    case 'autoFocus':
    case 'predictiveEcho':
    case 'altIsMeta':
    case 'detectUrls':
      if (typeof v === 'boolean') {
        target[key] = v;
        return;
      }
      break;
    case 'ansiPreset': {
      const preset = ansiPresets.find((choice) => choice === v);
      if (preset) {
        target.ansiPreset = preset;
        return;
      }
      break;
    }
    case 'boldBright': {
      const mode = boldBrightModes.find((choice) => choice === v);
      if (mode) {
        target.boldBright = mode;
        return;
      }
      break;
    }
    case 'renderer':
      if (v === 'dom' || v === 'canvas') {
        target.renderer = v;
        return;
      }
      break;
    case 'predictionStyle':
      if (v === 'underline' || v === 'dim') {
        target.predictionStyle = v;
        return;
      }
      break;
    case 'cursorStyle':
      if (v === 'block' || v === 'bar' || v === 'underline') {
        target.cursorStyle = v;
        return;
      }
      break;
    case 'palette':
      if (
        Array.isArray(v) &&
        (v.length === 0 || v.length === 16) &&
        Array.from(v).every(color)
      ) {
        if (v.some(Boolean)) target.palette = [...v];
        return;
      }
      break;
    default:
      if (colorFields.includes(key) && color(v)) {
        if (v) target[key] = v;
        return;
      }
  }
  throw new TypeError(`Invalid Rio preference: ${key}`);
}
function overrides(input: unknown, strict: boolean): RioOverrides {
  const target: RioOverrides = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    if (strict) throw new TypeError('Expected a Rio preferences object');
    return target;
  }
  for (const key of Object.keys(
    preferenceDefaults,
  ) as (keyof RioPreferenceValues)[]) {
    if (!Object.hasOwn(input, key)) continue;
    try {
      assign(target, key, (input as Record<string, unknown>)[key], !strict);
    } catch (e) {
      if (strict) throw e;
    }
  }
  return target;
}
export const validatedOverrides = (v: unknown): RioOverrides =>
  overrides(v, true);
export const readOverrides = (v: unknown): RioOverrides => overrides(v, false);
