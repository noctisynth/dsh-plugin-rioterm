import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppearance } from '../src/plugin/appearance.ts';
import {
  paddingFields,
  readOverrides,
  resolvePreferences,
  terminalFontStack,
  validatedOverrides,
} from '../src/preferences/values.ts';

test('inherited fonts track the terminal role independently, including after clearing an override', () => {
  const listeners = new Set(),
    themeListeners = new Set();
  const listen = (set, fn) => {
    set.add(fn);
    return () => set.delete(fn);
  };
  let revision = 0;
  const theme = (terminal, size) => ({
    revision: ++revision,
    fontFamilies: { terminal, code: 'wrong' },
    fontSizes: { terminal: size, text: 18 },
  });
  let current = theme('"宿主字体"', 13),
    settings = { value: {} };
  const appearance = createAppearance(
    {
      theme: { getTheme: () => current },
      on: (event, fn) => {
        assert.equal(event, 'theme/change');
        return listen(themeListeners, fn);
      },
    },
    { getSnapshot: () => settings, subscribe: (fn) => listen(listeners, fn) },
  );
  const seen = [];
  const stop = appearance.subscribe(() => seen.push(appearance.getSnapshot()));
  const save = (v) => {
    settings = { value: validatedOverrides(v) };
    for (const fn of listeners) fn();
  };
  const publish = (t) => {
    current = t;
    for (const fn of themeListeners) fn();
  };
  const get = appearance.getSnapshot;
  assert.equal(get().fontSize, 13);
  assert.equal(get().fontFamily, `"宿主字体", ${terminalFontStack}`);
  assert.equal(get(), get());
  save({ fontSize: 20 });
  publish(theme('"新字体"', 14));
  assert.equal(get().fontSize, 20);
  assert.equal(get().fontFamily, `"新字体", ${terminalFontStack}`);
  save({ fontFamily: 'Rio Mono' });
  publish(theme('', 17));
  assert.equal(get().fontSize, 17);
  assert.equal(get().fontFamily, `"Rio Mono", ${terminalFontStack}`);
  save({});
  assert.equal(get().fontFamily, terminalFontStack);
  assert.equal(seen.length, 5);
  stop();
  assert.equal(listeners.size + themeListeners.size, 0);
});

test('padding defaults and overrides resolve per edge; zero is a value and omission resets it', () => {
  const edges = (overrides) => {
    const resolved = resolvePreferences(
      overrides,
      { fontFamily: '', fontSize: 13 },
      0,
    );
    return paddingFields.map((field) => resolved[field]);
  };
  assert.deepEqual(edges({}), [16, 8, 8, 8]);
  for (const [index, field] of paddingFields.entries()) {
    for (const value of [0, 64]) {
      const overrides = { [field]: value };
      assert.deepEqual(validatedOverrides(overrides), overrides);
      assert.deepEqual(readOverrides(overrides), overrides);
      assert.deepEqual(edges(overrides), [16, 8, 8, 8].with(index, value));
    }
    for (const value of [-1, 65, 2.5, NaN, Infinity, '8', null]) {
      assert.throws(
        () => validatedOverrides({ [field]: value }),
        new RegExp(field),
      );
      assert.deepEqual(readOverrides({ [field]: value, fontSize: 15 }), {
        fontSize: 15,
      });
    }
  }
});

test('appearance forwards the requested bold-bright mode without pinning the palette or resolving auto', () => {
  const fonts = { fontFamily: 'monospace', fontSize: 13 };
  for (const ansiPreset of ['rio', 'dsh']) {
    assert.equal(
      resolvePreferences({ ansiPreset }, fonts, 0).boldBright,
      'auto',
    );
    for (const boldBright of ['auto', 'always', 'never']) {
      const request = { boldBright, ansiPreset };
      assert.deepEqual(validatedOverrides(request), request);
      const appearance = resolvePreferences(readOverrides(request), fonts, 0);
      assert.equal(appearance.boldBright, boldBright);
      assert.equal(appearance.ansiPreset, ansiPreset);
    }
  }
});

test('reject malformed drafts; isolate invalid persisted fields rather than losing all overrides', () => {
  const bad = [
    { renderer: 'webgl' },
    { ansiPreset: 'automatic' },
    { boldBright: 'inherit' },
    { boldBright: true },
    { fontFamily: 'url(https://invalid.test)' },
    { fontFamily: 'x; color:red' },
    { foreground: 'red; display:none' },
    { palette: ['#fff'] },
    { scrollback: 0.5 },
    { lineHeight: Infinity },
    { fontSize: 6 },
    { fontSize: 0 },
    { scrollback: -1 },
  ];
  for (const v of bad) {
    assert.throws(() => validatedOverrides(v));
    assert.deepEqual(readOverrides({ ...v, detectUrls: false }), {
      detectUrls: false,
    });
  }
  assert.deepEqual(
    readOverrides({
      fontSize: 0,
      scrollback: -1,
      fontFamily: '',
      foreground: '',
      palette: Array(16).fill(''),
    }),
    {},
  );
  assert.deepEqual(
    validatedOverrides({
      scrollback: 0,
      latencyThreshold: 0,
      altIsMeta: false,
      detectUrls: true,
    }),
    { scrollback: 0, latencyThreshold: 0, altIsMeta: false, detectUrls: true },
  );
  const v = validatedOverrides({
    fontFamily: '霞鹜文楷, monospace',
    foreground: '#CDEF',
  });
  assert.deepEqual(v, {
    fontFamily: '"霞鹜文楷", monospace',
    foreground: '#CDEF',
  });
  assert.deepEqual(validatedOverrides(v), v);
});
