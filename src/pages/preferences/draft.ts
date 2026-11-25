import {
  ansiNames,
  colorPattern,
  preferenceDefaults,
  type RioOverrides,
  validatedOverrides,
} from '../../preferences/values.ts';

type Scalar = Exclude<keyof RioOverrides, 'palette'>;
export type Field = Scalar | (typeof ansiNames)[number];
// A missing key means inherit. Text, including unfinished numbers and hex colors,
// stays editable until validation. Each ANSI cell is an independent edit.
export type Fields = Partial<Record<Field, string>>;
const scalars = (
  Object.keys(preferenceDefaults) as (keyof RioOverrides)[]
).filter((key): key is Scalar => key !== 'palette');
const allFields = [...scalars, ...ansiNames];

export function fieldsFrom(overrides: RioOverrides): Fields {
  const fields: Fields = {};
  for (const key of scalars) {
    const value = overrides[key];
    if (value !== undefined && value !== '') fields[key] = String(value);
  }
  ansiNames.forEach((name, index) => {
    const color = overrides.palette?.[index];
    if (color) fields[name] = color;
  });
  return fields;
}

export function changeField(fields: Fields, key: Field, text: string): Fields {
  const result = { ...fields };
  if (text === '') delete result[key];
  else result[key] = text;
  return result;
}

export function sameFields(left: Fields, right: Fields): boolean {
  return allFields.every((key) => left[key] === right[key]);
}

// Apply only the user's edits onto the new version, including intentional removals.
export function reapplyEdits(
  before: Fields,
  after: Fields,
  latest: Fields,
): Fields {
  const result = { ...latest };
  for (const key of allFields) {
    if (before[key] === after[key]) continue;
    const text = after[key];
    if (text === undefined) delete result[key];
    else result[key] = text;
  }
  return result;
}

function fieldValue(key: Scalar, text: string): string | boolean | number {
  switch (typeof preferenceDefaults[key]) {
    case 'number':
      // Number(' ') and Number('0x10') must not turn typos into valid settings.
      return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : Number.NaN;
    case 'boolean':
      if (text === 'true') return true;
      if (text === 'false') return false;
      return text;
    default:
      return text;
  }
}

export function validateFields(fields: Fields): {
  next: RioOverrides;
  invalid: Field[];
} {
  const next: RioOverrides = {};
  const invalid: Field[] = [];
  for (const key of scalars) {
    const text = fields[key];
    if (text === undefined) continue;
    try {
      const entry = validatedOverrides({ [key]: fieldValue(key, text) });
      // Config sentinels and empty lists aren't valid nonempty entries in this form.
      if (entry[key] === undefined) invalid.push(key);
      else Object.assign(next, entry);
    } catch {
      invalid.push(key);
    }
  }
  const palette = ansiNames.map((name) => {
    const color = fields[name] ?? '';
    if (color && !colorPattern.test(color)) invalid.push(name);
    return color;
  });
  if (palette.some(Boolean)) next.palette = palette;
  return { next, invalid };
}
