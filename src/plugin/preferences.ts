import type {
  PreferenceEditor,
  PreferenceSnapshot,
} from '../preferences/editor.ts';
import {
  ansiNames,
  colorFields,
  preferenceDefaults,
  type RioOverrides,
  type RioPreferenceValues,
  readOverrides,
  validatedOverrides,
} from '../preferences/values.ts';

/** The profile entry id in this bundle's Cordis patch, not a session id or a browser storage key. */
export const RIO_PREFERENCES_NAMESPACE = 'dsh-plugin-rioterm';

type Field = keyof RioPreferenceValues;
type Mutation =
  | { op: 'set'; path: [Field]; value: RioPreferenceValues[Field] }
  | { op: 'unset'; path: [Field] };

interface FormSnapshot<T> {
  status: PreferenceSnapshot['status'];
  value: T | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
}
interface ConfigForm<T> {
  getSnapshot(): FormSnapshot<T>;
  subscribe(listener: () => void): () => void;
  mutate(ops: readonly Mutation[], expectedRevision?: number): Promise<boolean>;
}
/** Structural subset of the 0.2.2-rc.5 Client service; never import a Client plugin at runtime. */
export interface PreferenceConfigForms {
  get<T>(entryId: string): ConfigForm<T>;
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void;
}

const fields = Object.keys(preferenceDefaults) as Field[];
const empty: RioOverrides = Object.freeze({});
const inheritable = [
  'fontFamily',
  'fontSize',
  'scrollback',
  ...colorFields,
  'palette',
] as const;

// Existing profile patches may explicitly store an inheritance marker. Only
// match known literals: an unknown field or an unevaluated !!js is not ours to remove.
function hasInheritanceMarker(
  raw: unknown,
  key: (typeof inheritable)[number],
): boolean {
  if (raw === null || typeof raw !== 'object' || !Object.hasOwn(raw, key))
    return false;
  const value: unknown = Reflect.get(raw, key);
  if (key !== 'palette') return value === preferenceDefaults[key];
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      (value.length === ansiNames.length &&
        Array.from(value).every((color) => color === '')))
  );
}

function equal(a: RioOverrides[Field], b: RioOverrides[Field]): boolean {
  return (
    a === b ||
    (Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, i) => entry === b[i]))
  );
}

/** Unrelated settings updates can replace the entire mirror, including equal arrays. */
function layer(
  raw: unknown,
  previous: RioOverrides,
  base?: RioOverrides,
): RioOverrides {
  const next = readOverrides(raw);
  if (base) {
    // Only the effective projection fills these holes. The draft and future
    // writes still describe the user layer, never a copy of the profile/DSH defaults.
    for (const key of inheritable) {
      if (key === 'palette') continue;
      const fallback = base[key];
      if (
        fallback !== undefined &&
        next[key] === undefined &&
        hasInheritanceMarker(raw, key)
      ) {
        Object.assign(next, { [key]: fallback });
      }
    }
    // Cordis replaces a whole array, but each blank ANSI slot inherits independently.
    if (base.palette) {
      const colors = next.palette;
      next.palette = base.palette.map((fallback, i) => colors?.[i] || fallback);
    }
  }
  if (fields.every((key) => equal(next[key], previous[key]))) return previous;
  if (next.palette) Object.freeze(next.palette);
  return Object.freeze(next);
}

/** One window consumes the Host's shared mirror/ordered write queue, not a second preference store. */
export function createPreferenceEditor(
  configForms: Pick<PreferenceConfigForms, 'get'>,
): PreferenceEditor {
  const form = configForms.get<unknown>(RIO_PREFERENCES_NAMESPACE);
  let source: FormSnapshot<unknown> | undefined;
  let snapshot: PreferenceSnapshot = Object.freeze({
    status: 'loading',
    writable: false,
    revision: undefined,
    value: empty,
    base: empty,
    user: empty,
  });

  function getSnapshot(): PreferenceSnapshot {
    const wire = form.getSnapshot();
    if (wire === source) return snapshot;
    // An unavailable DSH form can still hold its *previous* values and revision.
    // Don't edit (or continue overriding the theme from) a no-longer-served namespace.
    const ready = wire.status === 'ready';
    const revision = ready ? wire.revision : undefined;
    const writable = ready && wire.writable && revision !== undefined;
    const base = ready ? layer(wire.base, snapshot.base) : empty;
    const value = ready ? layer(wire.value, snapshot.value, base) : empty;
    const user = ready ? layer(wire.user, snapshot.user) : empty;
    if (
      wire.status !== snapshot.status ||
      revision !== snapshot.revision ||
      writable !== snapshot.writable ||
      value !== snapshot.value ||
      base !== snapshot.base ||
      user !== snapshot.user
    ) {
      snapshot = Object.freeze({
        status: wire.status,
        revision,
        writable,
        value,
        base,
        user,
      });
    }
    source = wire;
    return snapshot;
  }

  return {
    getSnapshot,
    subscribe(listener) {
      let previous = getSnapshot();
      return form.subscribe(() => {
        const next = getSnapshot();
        if (next === previous) return;
        previous = next;
        listener();
      });
    },
    async save(next, revision) {
      const current = getSnapshot();
      if (!current.writable || current.revision !== revision) return false;
      const rawUser = source?.user;
      const overrides = validatedOverrides(next);
      const ops: Mutation[] = [];
      for (const field of fields) {
        const value = overrides[field];
        if (equal(value, current.user[field])) continue;
        ops.push(
          value === undefined
            ? { op: 'unset', path: [field] }
            : { op: 'set', path: [field], value },
        );
      }
      if (!ops.length) return true;
      // A real save also clears explicit legacy markers, behind the SAME fence.
      // Reading preferences, cancelling and an unchanged Save never migrate the document.
      for (const key of inheritable) {
        if (
          overrides[key] === undefined &&
          hasInheritanceMarker(rawUser, key)
        ) {
          ops.push({ op: 'unset', path: [key] });
        }
      }
      // Don't send effective values, rewrite the section, or optimistically publish a draft.
      // Only the provider commits/conflict-checks. A refusal is false; a transport failure rejects.
      return form.mutate(ops, revision);
    },
  };
}
