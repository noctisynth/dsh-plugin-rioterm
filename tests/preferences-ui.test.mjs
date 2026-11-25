import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { compileUiStyles } from '../build/ui-styles.ts';
import { validateFields } from '../src/pages/preferences/draft.ts';
import { preferenceMessages } from '../src/pages/preferences/messages.ts';
import { ansiNames, colorFields } from '../src/preferences/values.ts';

// Render the real React 18 components against the editor contract, never a shell or a browser.
const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { PreferencesPage } = await jiti.import(
  '../src/pages/preferences/preferences-page.tsx',
);
const { act } = TestRenderer;
const fonts = {
  fontFamily: '"霞鹜文楷等宽", ui-monospace, monospace',
  fontSize: 15,
};
const en = preferenceMessages.en;
const translate = (key) => {
  assert.ok(Object.hasOwn(en, key), `Missing English copy: ${key}`);
  return en[key];
};
const palette = (slots) => Object.assign(Array(16).fill(''), slots);

class Editor {
  listeners = new Set();
  writes = [];
  constructor(initial = {}) {
    this.snapshot = {
      status: 'ready',
      writable: true,
      revision: 7,
      user: {},
      base: {},
      value: {},
      ...initial,
    };
  }
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(delta) {
    this.snapshot = { ...this.snapshot, ...delta };
    for (const listener of this.listeners) listener();
  }
  async save(next, revision) {
    this.writes.push({ next: structuredClone(next), revision });
    if (this.reply) return this.reply(next, revision);
    assert.equal(revision, this.snapshot.revision);
    this.publish({
      revision: revision + 1,
      user: next,
      value: { ...this.snapshot.base, ...next },
    });
    return true;
  }
}

function mount(test, editor, options) {
  let tree;
  const element = (hostFonts = fonts) =>
    React.createElement(PreferencesPage, { editor, hostFonts, t: translate });
  act(() => {
    tree = TestRenderer.create(element(), options);
  });
  test.after(() => {
    act(() => tree.unmount());
    assert.equal(editor.listeners.size, 0);
  });
  const byName = (name) =>
    tree.root.findAll(
      (node) =>
        ['input', 'select'].includes(node.type) && node.props.name === name,
    );
  const field = (name) => {
    const hits = byName(name);
    assert.equal(hits.length, 1, name);
    return hits[0];
  };
  const button = (label) =>
    tree.root
      .findAllByType('button')
      .find(
        (node) =>
          (node.props['aria-label'] ?? node.children.join('')) === label,
      );
  const event = (node, props) =>
    act(() => node.props.onChange({ currentTarget: props }));
  const click = (label) => {
    const el = button(label);
    assert.ok(el && !el.props.disabled, label);
    act(() => el.props.onClick());
  };
  return {
    tree,
    field,
    byName,
    button,
    event,
    click,
    status: () => tree.root.findByProps({ role: 'status' }).children.join(''),
    input: (name, value) => event(field(name), { value }),
    toggle: (name, checked) => event(field(name), { checked }),
    publish: (delta) => act(() => editor.publish(delta)),
    updateFonts: (hostFonts) => act(() => tree.update(element(hostFonts))),
    save: () =>
      act(async () => {
        const el = button(en.save);
        assert.ok(!el.props.disabled);
        el.props.onClick();
      }),
  };
}

test('fonts start independently inherited; a clean form follows Host changes without writing an effective value', async (tc) => {
  const editor = new Editor({
    base: { fontSize: 19, foreground: '#def' },
    value: { fontSize: 19, fontFamily: fonts.fontFamily, foreground: '#def' },
  });
  const view = mount(tc, editor);
  assert.equal(view.field('fontSize').props.value, '');
  assert.equal(view.field('fontSize').props.placeholder, '19');
  assert.equal(view.field('fontFamily').props.value, '');
  assert.equal(view.field('fontFamily').props.placeholder, fonts.fontFamily);
  assert.ok(
    view.tree.root.findByType('bdi').children.includes(fonts.fontFamily),
  );
  assert.match(JSON.stringify(view.tree.toJSON()), /15.*px/);
  const sample = () =>
    view.tree.root.find(
      (node) => node.type === 'p' && node.children[0] === en.fontSample,
    ).props.style;
  assert.deepEqual(sample(), { fontFamily: fonts.fontFamily, fontSize: 19 });
  view.input('fontFamily', 'url(untrusted)');
  assert.deepEqual(sample(), { fontFamily: fonts.fontFamily, fontSize: 19 });
  assert.ok(JSON.stringify(view.tree.toJSON()).includes(en.fontFallback));
  view.click(en.cancel);
  assert.equal(view.button(en.save).props.disabled, true);
  assert.equal(view.status(), en.saved);
  view.input('fontFamily', '思源等宽, monospace');
  view.updateFonts({ fontFamily: '新等宽, monospace', fontSize: 17 });
  assert.equal(view.field('fontFamily').props.value, '思源等宽, monospace');
  assert.match(sample().fontFamily, /^"思源等宽", monospace, /);
  view.input('fontSize', '24');
  assert.equal(sample().fontSize, 24);
  view.input('fontSize', '');
  assert.equal(sample().fontSize, 19);
  assert.equal(view.field('fontFamily').props.placeholder, '新等宽, monospace');
  assert.equal(view.status(), en.unsaved);
  assert.deepEqual(editor.writes, []);
  await view.save();
  assert.deepEqual(editor.writes, [
    { revision: 7, next: { fontFamily: '"思源等宽", monospace' } },
  ]);
  assert.equal(view.status(), en.saved);
  view.publish({ user: { fontSize: 20 }, revision: 9 });
  assert.equal(view.field('fontFamily').props.value, '');
  assert.equal(view.field('fontSize').props.value, '20');
});

test('single-field unsets, zero history, cancel and restore are staged until Save', async (tc) => {
  const editor = new Editor({
    user: { fontFamily: 'monospace', fontSize: 20, altIsMeta: false },
    base: { altIsMeta: true },
  });
  const view = mount(tc, editor);
  view.input('fontSize', '');
  view.input('scrollback', '0');
  view.click(`${en.useInherited}: ${en.altIsMeta}`);
  assert.equal(view.field('altIsMeta').props.checked, true);
  view.click(en.cancel);
  assert.equal(view.field('fontSize').props.value, '20');
  assert.equal(view.field('scrollback').props.value, '');
  assert.equal(view.field('altIsMeta').props.checked, false);
  view.input('fontSize', '');
  view.input('scrollback', '0');
  await view.save();
  assert.deepEqual(editor.writes[0], {
    revision: 7,
    next: { fontFamily: 'monospace', altIsMeta: false, scrollback: 0 },
  });
  view.click(en.restore);
  assert.equal(view.field('fontFamily').props.value, '');
  assert.equal(view.field('scrollback').props.value, '');
  view.click(en.cancel);
  assert.equal(view.field('scrollback').props.value, '0');
  view.click(en.restore);
  assert.equal(editor.writes.length, 1);
  await view.save();
  assert.deepEqual(editor.writes[1], { revision: 8, next: {} });
});

test('Canvas-only controls follow the draft renderer and echo; hiding them does not destroy saved choices', async (tc) => {
  const editor = new Editor({
    base: { renderer: 'canvas' },
    user: { renderer: 'dom', cursorStyle: 'bar' },
  });
  const view = mount(tc, editor);
  for (const key of [
    'cursorStyle',
    'predictiveEcho',
    'latencyThreshold',
    'predictionStyle',
  ])
    assert.deepEqual(view.byName(key), []);
  view.input('renderer', '');
  assert.equal(view.field('cursorStyle').props.value, 'bar');
  assert.equal(view.field('predictiveEcho').props.checked, false);
  assert.deepEqual(view.byName('latencyThreshold'), []);
  view.toggle('predictiveEcho', true);
  view.input('latencyThreshold', '0');
  view.input('predictionStyle', 'dim');
  view.toggle('autoFocus', true);
  view.toggle('fit', false);
  view.input('renderer', 'dom');
  assert.deepEqual(view.byName('predictionStyle'), []);
  await view.save();
  assert.deepEqual(editor.writes[0].next, {
    renderer: 'dom',
    cursorStyle: 'bar',
    predictiveEcho: true,
    latencyThreshold: 0,
    predictionStyle: 'dim',
    autoFocus: true,
    fit: false,
  });
  view.input('renderer', 'canvas');
  assert.equal(view.field('predictionStyle').props.value, 'dim');
  assert.equal(view.field('latencyThreshold').props.value, '0');
  assert.match(en.echoHint, /password/);
});

test('colors offer native pickers and optional alpha hex; clearing one ANSI cell never pins the rest', async (tc) => {
  const editor = new Editor({
    base: { foreground: '#abc0', palette: palette({ 4: '#abc' }) },
    user: { palette: palette({ 1: '#ff00ff80', 2: '#abc' }) },
  });
  const view = mount(tc, editor);
  const pickers = view.tree.root.findAll(
    (node) => node.type === 'input' && node.props.type === 'color',
  );
  assert.equal(pickers.length, 5 + 16);
  for (const key of [...colorFields, ...ansiNames])
    assert.equal(view.field(key).props.type, 'text');
  assert.equal(view.field('blue').props.value, '');
  assert.equal(view.field('blue').props.placeholder, '#abc');
  view.click(`${en.clear}: 2 · ${en.green}`);
  view.input('selectionBackground', '#abcd');
  const selected = pickers.find(
    (node) =>
      node.props['aria-label'] ===
      `${en.chooseColor}: ${en.selectionBackground}`,
  );
  assert.equal(selected.props.value, '#aabbcc');
  view.event(selected, { value: '#112233' });
  assert.equal(view.field('selectionBackground').props.value, '#112233dd');
  await view.save();
  assert.deepEqual(editor.writes[0].next, {
    selectionBackground: '#112233dd',
    palette: palette({ 1: '#ff00ff80' }),
  });
  view.input('red', '');
  const transparent = pickers.find(
    (node) =>
      node.props['aria-label'] === `${en.chooseColor}: ${en.foreground}`,
  );
  assert.equal(transparent.props.value, '#aabbcc');
  const opacity = view.tree.root.findByProps({
    id: transparent.props['aria-describedby'],
  });
  assert.equal(opacity.children.join(''), `${en.opacity}: 0%`);
  view.event(transparent, { value: '#778899' });
  assert.equal(view.field('foreground').props.value, '#77889900');
  await view.save();
  assert.deepEqual(editor.writes[1].next, {
    foreground: '#77889900',
    selectionBackground: '#112233dd',
  });
});

test('dirty revisions retain the draft; reapplying merges individual fields/cells without writing or clobbering unrelated changes', async (tc) => {
  const editor = new Editor({
    user: { fontSize: 18, palette: palette({ 1: '#111' }) },
  });
  const view = mount(tc, editor);
  view.input('red', '');
  view.input('fontSize', '21');
  view.publish({
    revision: 8,
    user: {
      fontSize: 24,
      scrollback: 123,
      palette: palette({ 1: '#222', 2: '#333' }),
    },
  });
  assert.equal(view.field('fontSize').props.value, '21');
  assert.equal(view.field('red').props.value, '');
  assert.equal(view.button(en.save).props.disabled, true);
  view.click(en.keepEdits);
  assert.equal(view.field('scrollback').props.value, '123');
  assert.equal(view.field('green').props.value, '#333');
  assert.deepEqual(editor.writes, []);
  await view.save();
  assert.deepEqual(editor.writes, [
    {
      revision: 8,
      next: { fontSize: 21, scrollback: 123, palette: palette({ 2: '#333' }) },
    },
  ]);
  view.input('fontSize', '22');
  view.publish({ revision: 10, user: { fontSize: 16 } });
  view.click(en.cancel);
  assert.equal(view.field('fontSize').props.value, '16');
  assert.equal(view.status(), en.saved);
});

test('loading, read-only, outstanding writes, rejection and transport errors never silently lose edits', async (tc) => {
  const editor = new Editor({
    status: 'loading',
    writable: false,
    revision: undefined,
  });
  const view = mount(tc, editor);
  assert.equal(view.status(), en.loading);
  view.input('fontSize', '22'); // Even a direct handler cannot write through a disabled fieldset.
  assert.equal(view.field('fontSize').props.value, '');
  view.publish({ status: 'ready', revision: 4 });
  assert.equal(view.status(), en.readOnly);
  assert.equal(view.tree.root.findByType('fieldset').props.disabled, true);
  view.publish({ writable: true });
  view.input('fontSize', '22');
  let finish;
  editor.reply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const action = view.button(en.save).props.onClick;
  act(() => {
    action();
    action();
  });
  assert.equal(view.status(), en.saving);
  assert.equal(view.button(en.cancel).props.disabled, true);
  assert.equal(view.tree.root.findByType('fieldset').props.disabled, true);
  assert.equal(editor.writes.length, 1);
  await act(async () => finish(false));
  assert.ok(JSON.stringify(view.tree.toJSON()).includes(en.rejected));
  assert.equal(view.field('fontSize').props.value, '22');
  editor.reply = async () => {
    throw new Error('Host offline');
  };
  await view.save();
  assert.ok(JSON.stringify(view.tree.toJSON()).includes('Host offline'));
  view.publish({
    status: 'unavailable',
    writable: false,
    revision: undefined,
    user: {},
  });
  assert.ok(view.status().includes(en.unavailable));
  assert.equal(view.field('fontSize').props.value, '22');
  assert.equal(view.button(en.save).props.disabled, true);
  assert.equal(editor.writes.length, 2);
});

test('unfinished or invalid values remain editable, but never reach the host', async (tc) => {
  for (const [key, values] of Object.entries({
    fontFamily: ['url(untrusted)', 'a; b'],
    fontSize: ['0', '7', '49', '12.5', '0x10'],
    lineHeight: ['.9', '3.1'],
    scrollback: ['-1', '0.5', '100001', ' '],
    latencyThreshold: ['-1', '2001', '2.5'],
    foreground: ['#12', '#12345', 'red'],
    brightWhite: ['#GGG'],
  })) {
    for (const text of values)
      assert.deepEqual(
        validateFields({ [key]: text }).invalid,
        [key],
        `${key}: ${text}`,
      );
  }
  const editor = new Editor();
  const view = mount(tc, editor);
  view.input('fontSize', '1e');
  assert.equal(view.field('fontSize').props.value, '1e');
  assert.equal(view.field('fontSize').props['aria-invalid'], true);
  const save = view.button(en.save);
  assert.equal(save.props.disabled, true);
  act(() => save.props.onClick());
  assert.deepEqual(editor.writes, []);
  view.input('fontSize', '12');
  await view.save();
  assert.deepEqual(editor.writes[0].next, { fontSize: 12 });
});

test('a hidden invalid threshold can be undone in place without losing other edits or persisting its inherited value', async (tc) => {
  for (const hide of ['renderer', 'predictiveEcho']) {
    const user = {
      renderer: 'canvas',
      predictiveEcho: true,
      ...(hide === 'predictiveEcho' ? { latencyThreshold: 75 } : {}),
    };
    const editor = new Editor({ user, base: { latencyThreshold: 90 } });
    const view = mount(tc, editor);
    view.input('predictionStyle', 'dim');
    view.input('latencyThreshold', '9999');
    if (hide === 'renderer') view.input('renderer', 'dom');
    else view.toggle('predictiveEcho', false);
    assert.deepEqual(view.byName('latencyThreshold'), []);
    assert.equal(view.button(en.save).props.disabled, true);
    view.click(en.undoLatency);
    assert.deepEqual(editor.writes, []);
    await view.save();
    assert.deepEqual(editor.writes[0].next, {
      ...user,
      [hide]: hide === 'renderer' ? 'dom' : false,
      predictionStyle: 'dim',
    });
  }
});

test('explicit one-field resets and conflict resolution restore focus; incoming snapshots do not move it', (tc) => {
  const focused = [];
  const editor = new Editor({
    user: { detectUrls: false, foreground: '#ABC' },
  });
  const view = mount(tc, editor, {
    createNodeMock: ({ props }) => ({
      focus: () => focused.push(props.name ?? props.role),
    }),
  });
  view.click(`${en.useInherited}: ${en.detectUrls}`);
  view.click(`${en.clear}: ${en.foreground}`);
  view.publish({
    revision: 8,
    user: { detectUrls: false, foreground: '#ABC', fontSize: 22 },
  });
  assert.deepEqual(focused, ['detectUrls', 'foreground']);
  view.click(en.keepEdits);
  assert.deepEqual(focused, ['detectUrls', 'foreground', 'status']);
});

test('standalone scoped page has localized native controls, associated labels and compiled rio: utilities', async (tc) => {
  const view = mount(
    tc,
    new Editor({ user: { renderer: 'canvas', predictiveEcho: true } }),
  );
  const root = view.tree.root.findByProps({ 'data-rio-ui': 'preferences' });
  const elements = root.findAll((node) => typeof node.type === 'string');
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(preferenceMessages.zh).sort(),
  );
  const ids = elements.map((node) => node.props.id).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(
    root
      .findAllByType('details')
      .every((node) => node.props.open === undefined),
  );
  assert.equal(root.findAllByType('textarea').length, 0);
  const css = await compileUiStyles();
  for (const node of [root, ...elements]) {
    if (node.type === 'p' && node.children[0] === en.fontSample)
      assert.deepEqual(node.props.style, fonts);
    else assert.equal(node.props.style, undefined);
    assert.equal(node.props.autoFocus, undefined);
    if (node.type === 'button') assert.equal(node.props['data-slot'], 'button');
    if (['input', 'select'].includes(node.type) && !node.props['aria-label']) {
      assert.ok(
        node.props.id &&
          root
            .findAllByType('label')
            .some((label) => label.props.htmlFor === node.props.id),
      );
    }
    for (const ref of node.props['aria-describedby']?.split(' ') ?? [])
      assert.ok(ids.includes(ref), ref);
    for (const token of node.props.className?.split(' ') ?? []) {
      assert.ok(token.startsWith('rio:'), token);
      assert.ok(
        css.includes(`.${token.replace(/[^\w-]/g, (ch) => `\\${ch}`)}`),
        `no compiled utility for ${token}`,
      );
    }
  }
});
