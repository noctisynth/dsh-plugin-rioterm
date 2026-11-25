import assert from 'node:assert/strict';
import test from 'node:test';
import z from '@deepseek-ai/schemastery';
import { Config } from '../src/index.ts';
import {
  createPreferenceEditor,
  RIO_PREFERENCES_NAMESPACE,
} from '../src/plugin/preferences.ts';
import { preferenceDefaults } from '../src/preferences/values.ts';

function plain(schema, input) {
  return Object.fromEntries(
    Object.entries(schema(input)).map(([k, ref]) => [k, ref.get()]),
  );
}
function colors(slots) {
  return Object.assign(Array(16).fill(''), slots);
}

test('the Cordis Config exposes every preference as a serializable, volatile field', () => {
  for (const field of Object.keys(preferenceDefaults))
    assert.equal(Config.dict[field].meta.volatile, true, field);
  const recovered = new z(JSON.parse(JSON.stringify(Config)));
  assert.deepEqual(plain(recovered, {}), preferenceDefaults);
  const overrides = {
    scrollback: 0,
    fontSize: 48,
    lineHeight: 1.65,
    paddingTop: 0,
    paddingRight: 64,
    paddingBottom: 3,
    paddingLeft: 1,
    cursor: '#abcd',
    ansiPreset: 'dsh',
    boldBright: 'always',
    palette: colors({ 0: '#aabbccdd', 15: '#fff' }),
    renderer: 'canvas',
    altIsMeta: false,
    detectUrls: false,
    autoFocus: true,
    fit: false,
    predictiveEcho: true,
    latencyThreshold: 0,
    predictionStyle: 'dim',
    cursorStyle: 'bar',
  };
  assert.deepEqual(plain(recovered, overrides), {
    ...preferenceDefaults,
    ...overrides,
  });
  for (const invalid of [
    { fontFamily: 'url(https://example.invalid)' },
    { fontFamily: 'a'.repeat(257) },
    { fontSize: 7 },
    { fontSize: 12.5 },
    { fontSize: 49 },
    { lineHeight: 3.01 },
    { lineHeight: Number.NaN },
    { lineHeight: '1.3' },
    { paddingTop: -1 },
    { paddingRight: 65 },
    { paddingBottom: 1.5 },
    { paddingLeft: '4' },
    { scrollback: -2 },
    { scrollback: 100001 },
    { scrollback: 0.2 },
    { altIsMeta: 'false' },
    { detectUrls: 0 },
    { autoFocus: 1 },
    { fit: 'true' },
    { foreground: 'red' },
    { selectionBackground: '#00000' },
    { ansiPreset: 'automatic' },
    { boldBright: 'inherit' },
    { boldBright: false },
    { palette: ['#fff'] },
    { palette: Array(17).fill('#fff') },
    { palette: colors({ 1: null }) },
    { palette: colors({ 5: 'blue' }) },
    { renderer: 'webgl' },
    { cursorStyle: 'beam' },
    { predictiveEcho: 'yes' },
    { latencyThreshold: 2001 },
    { latencyThreshold: 1.5 },
    { predictionStyle: 'bold' },
  ])
    assert.throws(() => recovered(invalid), undefined, JSON.stringify(invalid));
});

// ConfigForm is a provider-owned external store. No profile, localStorage,
// DOM, network, or terminal service participates in these adapter tests.
function mirror(
  snapshot,
  mutate = () => assert.fail('unexpected settings write'),
) {
  const listeners = new Set();
  const form = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mutate,
  };
  return {
    editor: createPreferenceEditor({
      get(id) {
        assert.equal(id, RIO_PREFERENCES_NAMESPACE);
        return form;
      },
    }),
    publish(next) {
      snapshot = next;
      for (const notify of listeners) notify();
    },
  };
}
const ready = (user = {}, base = {}, revision = 0) => ({
  status: 'ready',
  writable: true,
  revision,
  user,
  base,
  value: { ...preferenceDefaults, ...base, ...user },
});

test('only accepted changes replace snapshots; sparse ANSI slots see lower colors without pinning them in the draft', async () => {
  const wire = ready(
    {
      fontSize: 0,
      scrollback: 0,
      altIsMeta: false,
      palette: colors({ 1: '#123' }),
    },
    { fontFamily: 'monospace', palette: colors({ 0: '#aaa', 1: '#bbb' }) },
    4,
  );
  const { editor, publish } = mirror(wire);
  const first = editor.getSnapshot();
  assert.deepEqual(first.user, {
    scrollback: 0,
    altIsMeta: false,
    palette: colors({ 1: '#123' }),
  });
  assert.deepEqual(first.value.palette, colors({ 0: '#aaa', 1: '#123' }));
  assert.deepEqual(first.base.palette, colors({ 0: '#aaa', 1: '#bbb' }));
  assert.equal(first.value.fontFamily, 'monospace');
  assert.equal(first.value.fontSize, undefined);
  assert.equal(editor.getSnapshot(), first);
  let changes = 0;
  const off = editor.subscribe(() => ++changes);
  publish(structuredClone(wire)); // An unrelated namespace invalidated the mirror.
  assert.equal(editor.getSnapshot(), first);
  assert.equal(changes, 0);
  const cleared = ready({ palette: colors({}) }, wire.base, 5);
  publish(cleared);
  assert.equal(changes, 1);
  assert.deepEqual(editor.getSnapshot().value.palette, first.base.palette);
  assert.equal(editor.getSnapshot().user.palette, undefined);
  assert.throws(() => {
    first.user.palette[0] = '#999';
  }, TypeError);
  publish({ ...cleared, status: 'unavailable' }); // Real DSH can keep old values/revision after withdrawal.
  assert.deepEqual(editor.getSnapshot(), {
    status: 'unavailable',
    writable: false,
    revision: undefined,
    user: {},
    base: {},
    value: {},
  });
  assert.equal(await editor.save({ fontSize: 18 }, 5), false);
  assert.equal(changes, 2);
  off();
  publish(wire);
  assert.equal(changes, 2);
});

test('the preset inherits, pins and clears independently of sparse profile/user palette slots', async () => {
  const base = { ansiPreset: 'dsh', palette: colors({ 0: '#111', 1: '#222' }) };
  const user = { palette: colors({ 1: '#333' }) };
  const writes = [];
  const { editor, publish } = mirror(ready(user, base), async (ops) => {
    writes.push(ops);
    return true;
  });
  assert.equal(editor.getSnapshot().value.ansiPreset, 'dsh');
  assert.equal(editor.getSnapshot().user.ansiPreset, undefined);
  const pinned = { ...user, ansiPreset: 'rio' };
  await editor.save(pinned, 0);
  publish(ready(pinned, base, 1));
  assert.equal(editor.getSnapshot().value.ansiPreset, 'rio');
  assert.deepEqual(
    editor.getSnapshot().value.palette,
    colors({ 0: '#111', 1: '#333' }),
  );
  await editor.save(user, 1);
  publish(ready(user, base, 2));
  assert.equal(editor.getSnapshot().value.ansiPreset, 'dsh');
  assert.deepEqual(writes, [
    [{ op: 'set', path: ['ansiPreset'], value: 'rio' }],
    [{ op: 'unset', path: ['ansiPreset'] }],
  ]);
});

test('explicit auto sets a user override; clearing unsets only boldBright and restores the profile mode', async () => {
  const user = { renderer: 'canvas' };
  const base = { ansiPreset: 'dsh', boldBright: 'never' };
  const pinned = { ...user, boldBright: 'auto' };
  const writes = [];
  const { editor, publish } = mirror(
    ready(user, base),
    async (ops, revision) => {
      writes.push([ops, revision]);
      return true;
    },
  );
  assert.equal(editor.getSnapshot().value.boldBright, 'never');
  assert.equal(await editor.save(pinned, 0), true);
  publish(ready(pinned, base, 1));
  assert.deepEqual(editor.getSnapshot().user, pinned);
  assert.equal(editor.getSnapshot().value.boldBright, 'auto');
  assert.equal(await editor.save(user, 1), true);
  publish(ready(user, base, 2));
  assert.deepEqual(editor.getSnapshot().user, user);
  assert.equal(editor.getSnapshot().value.boldBright, 'never');
  assert.deepEqual(writes, [
    [[{ op: 'set', path: ['boldBright'], value: 'auto' }], 0],
    [[{ op: 'unset', path: ['boldBright'] }], 1],
  ]);
});

test('explicit inheritance markers resolve through the profile and are only cleaned by a fenced user edit', async () => {
  const markers = {
    fontFamily: '',
    fontSize: 0,
    scrollback: -1,
    foreground: '',
    selectionBackground: '',
    palette: [],
  };
  const base = {
    fontFamily: 'monospace',
    fontSize: 17,
    scrollback: 0,
    foreground: '#abc',
    selectionBackground: '#def',
    palette: colors({ 7: '#aaa' }),
  };
  const raw = {
    ...markers,
    cursor: { __jsExpr: 'configuredCursor' },
    otherFeature: '',
  };
  const wire = ready(raw, base, 9);
  wire.value.cursor = '#777'; // Resolved by DSH, not a raw user literal we may rewrite.
  const writes = [];
  const { editor, publish } = mirror(wire, (ops, revision) => {
    writes.push([ops, revision]);
    return Promise.resolve(true);
  });
  const current = editor.getSnapshot();
  assert.deepEqual(current.user, {});
  for (const key of Object.keys(markers))
    assert.deepEqual(current.value[key], base[key], key);
  assert.equal(current.value.cursor, '#777');
  assert.equal(await editor.save({}, 9), true);
  assert.deepEqual(writes, []);
  assert.equal(await editor.save({ renderer: 'canvas' }, 9), true);
  assert.deepEqual(writes, [
    [
      [
        { op: 'set', path: ['renderer'], value: 'canvas' },
        ...Object.keys(markers).map((key) => ({ op: 'unset', path: [key] })),
      ],
      9,
    ],
  ]);
  publish(ready(markers, {}, 10));
  for (const key of Object.keys(markers))
    assert.equal(editor.getSnapshot().value[key], undefined, key);
});

test('save sends only the edited user paths as one fenced mutation; other windows see the accepted mirror, not the pending draft', async () => {
  const wire = ready(
    { cursor: '#abc', altIsMeta: true, palette: colors({ 2: '#222' }) },
    { fontSize: 18, palette: colors({ 1: '#111' }) },
    7,
  );
  const gate = Promise.withResolvers();
  const writes = [];
  const first = mirror(wire, (ops, revision) => {
    writes.push([ops, revision]);
    return gate.promise;
  });
  const second = mirror(structuredClone(wire));
  const baseline = first.editor.getSnapshot();
  const pending = first.editor.save(
    { scrollback: 0, altIsMeta: true, palette: colors({ 3: '#333' }) },
    baseline.revision,
  );
  assert.deepEqual(writes, [
    [
      [
        { op: 'set', path: ['scrollback'], value: 0 },
        { op: 'unset', path: ['cursor'] },
        { op: 'set', path: ['palette'], value: colors({ 3: '#333' }) },
      ],
      7,
    ],
  ]);
  assert.equal(first.editor.getSnapshot(), baseline);
  assert.deepEqual(second.editor.getSnapshot().user, baseline.user);
  const accepted = ready(
    { scrollback: 0, altIsMeta: true, palette: colors({ 3: '#333' }) },
    wire.base,
    8,
  );
  first.publish(accepted);
  second.publish(structuredClone(accepted));
  gate.resolve(true);
  assert.equal(await pending, true);
  assert.deepEqual(second.editor.getSnapshot(), first.editor.getSnapshot());
  assert.equal(await second.editor.save({}, 7), false); // No use of a newer revision on behalf of an old editor.
  assert.equal(
    await first.editor.save(first.editor.getSnapshot().user, 8),
    true,
  );
  assert.equal(writes.length, 1); // Cancel/discard simply reads the latest snapshot; no restorative write.
});

test('editing one edge to zero and resetting another never copies lower or unrelated overrides', async () => {
  const base = { paddingTop: 27, paddingRight: 0, paddingLeft: 42 };
  const user = { paddingTop: 0, paddingBottom: 5, renderer: 'canvas' };
  const writes = [];
  const { editor, publish } = mirror(
    ready(user, base, 4),
    async (ops, revision) => {
      writes.push([ops, revision]);
      return true;
    },
  );
  const next = { paddingBottom: 0, renderer: 'canvas' };
  assert.equal(await editor.save(next, 3), false);
  assert.equal(await editor.save(next, 4), true);
  assert.deepEqual(writes, [
    [
      [
        { op: 'unset', path: ['paddingTop'] },
        { op: 'set', path: ['paddingBottom'], value: 0 },
      ],
      4,
    ],
  ]);
  publish(ready(next, base, 5));
  const snapshot = editor.getSnapshot();
  assert.deepEqual(snapshot.user, next);
  assert.equal(snapshot.value.paddingTop, 27);
  assert.equal(snapshot.value.paddingRight, 0);
  assert.equal(snapshot.value.paddingBottom, 0);
  assert.equal(snapshot.value.paddingLeft, 42);
});

test('write refusal, transport error, invalid draft and read-only/loading state cannot masquerade as saved', async () => {
  const wire = ready({ lineHeight: 1.5 });
  const failure = new Error('connection lost');
  let calls = 0;
  const { editor, publish } = mirror(wire, async () => {
    if (++calls === 1) return false;
    throw failure;
  });
  const baseline = editor.getSnapshot();
  assert.equal(await editor.save({ lineHeight: 1.6 }, 0), false);
  await assert.rejects(editor.save({ lineHeight: 1.6 }, 0), failure);
  await assert.rejects(
    editor.save({ renderer: 'not-a-renderer' }, 0),
    /renderer/,
  );
  assert.equal(editor.getSnapshot(), baseline);
  publish({ ...wire, writable: false });
  assert.equal(await editor.save({}, 0), false);
  publish({ ...wire, status: 'loading', revision: undefined });
  assert.equal(await editor.save({}, 0), false);
  assert.equal(calls, 2);
});
