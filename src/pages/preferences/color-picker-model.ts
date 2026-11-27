export type PickerRgba = {
  r: number;
  g: number;
  b: number;
  /** Keep alpha as a byte: untouched 0x80 must not become rounded 50%. */
  a: number;
  hasAlpha: boolean;
};

export type PickerHsv = { h: number; s: number; v: number };

export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

const byte = (value: number) => Math.round(clamp(value, 0, 255));
const hexByte = (value: number) => byte(value).toString(16).padStart(2, '0');

export function parseHex(value: string | undefined): PickerRgba | undefined {
  if (
    !value ||
    value.trim() !== value ||
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
  ) {
    return undefined;
  }
  const expanded =
    value.length < 6
      ? Array.from(value.slice(1), (digit) => digit + digit).join('')
      : value.slice(1);
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
    hasAlpha: expanded.length === 8,
  };
}

export function rgbaToHex(color: PickerRgba): string {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}${color.hasAlpha || byte(color.a) !== 255 ? hexByte(color.a) : ''}`;
}

export function rgbToHsv(
  color: Pick<PickerRgba, 'r' | 'g' | 'b'>,
  fallbackHue = 0,
): PickerHsv {
  const r = clamp(color.r, 0, 255) / 255;
  const g = clamp(color.g, 0, 255) / 255;
  const b = clamp(color.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = clamp(fallbackHue, 0, 360);
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(color: PickerHsv): Pick<PickerRgba, 'r' | 'g' | 'b'> {
  const h = clamp(color.h, 0, 360) % 360;
  const s = clamp(color.s, 0, 1);
  const v = clamp(color.v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const sectors = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ] as const;
  const [r, g, b] = sectors[Math.floor(h / 60)] ?? sectors[0];
  return {
    r: byte((r + m) * 255),
    g: byte((g + m) * 255),
    b: byte((b + m) * 255),
  };
}

export function alphaPercent(alpha: number): number {
  return Math.round((byte(alpha) / 255) * 1000) / 10;
}

export function withAlphaPercent(
  color: PickerRgba,
  percent: number,
): PickerRgba {
  const a = byte((clamp(percent, 0, 100) / 100) * 255);
  return { ...color, a, hasAlpha: color.hasAlpha || a !== 255 };
}
