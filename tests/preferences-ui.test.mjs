import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { compileUiStyles } from '../build/ui-styles.ts';
import { validateFields } from '../src/pages/preferences/draft.ts';
import { preferenceMessages } from '../src/pages/preferences/messages.ts';
import { PreferenceAutosave } from '../src/pages/preferences/preference-autosave.ts';
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

function clock(tc) {
  tc.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  return (ms) => act(async () => tc.mock.timers.tick(ms));
}

const settled = () => act(async () => {});

function mount(test, editor, options, t = translate) {
  let tree;
  const draft = new PreferenceAutosave(editor);
  const disconnect = draft.connect();
  const element = (hostFonts = fonts, locale = t) =>
    React.createElement(PreferencesPage, { draft, hostFonts, t: locale });
  act(() => {
    tree = TestRenderer.create(element(), options);
  });
  test.after(() => {
    act(() => tree.unmount());
    disconnect();
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
    updateLocale: (locale) => act(() => tree.update(element(fonts, locale))),
    blur: (name) => act(() => field(name).props.onBlur()),
  };
}

test('fonts start independently inherited; a clean form follows Host changes without writing an effective value', async (tc) => {
  const tick = clock(tc);
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
  assert.equal(view.status(), en.invalidStatus);
  view.click(en.discard);
  assert.equal(view.button('Save'), undefined);
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
  assert.equal(view.status(), en.pending);
  assert.deepEqual(editor.writes, []);
  await tick(600);
  assert.deepEqual(editor.writes, [
    { revision: 7, next: { fontFamily: '"思源等宽", monospace' } },
  ]);
  assert.equal(view.status(), en.saved);
  view.publish({ user: { fontSize: 20 }, revision: 9 });
  assert.equal(view.field('fontFamily').props.value, '');
  assert.equal(view.field('fontSize').props.value, '20');
});

test('typed blank waits for debounce, but inherit buttons apply immediately; restore requires a second explicit click', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor({
    user: { fontFamily: 'monospace', fontSize: 20, altIsMeta: false },
    base: { altIsMeta: true },
  });
  const view = mount(tc, editor);
  view.input('fontSize', '');
  view.input('scrollback', '0');
  await tick(599);
  assert.deepEqual(editor.writes, []);
  view.click(`${en.useInherited}: ${en.altIsMeta}`);
  assert.equal(view.field('altIsMeta').props.checked, true);
  assert.deepEqual(editor.writes[0], {
    revision: 7,
    next: { fontFamily: 'monospace', fontSize: 20 },
  });
  await settled();
  await tick(1);
  assert.deepEqual(editor.writes[1], {
    revision: 8,
    next: { fontFamily: 'monospace', scrollback: 0 },
  });
  view.click(en.restore);
  assert.ok(view.button(en.confirmRestore));
  assert.equal(view.field('scrollback').props.value, '0');
  await tick(6000);
  view.click(en.keepSettings);
  assert.equal(view.button(en.confirmRestore), undefined);
  assert.equal(editor.writes.length, 2);
  view.click(en.restore);
  view.click(en.confirmRestore);
  assert.deepEqual(editor.writes[2], { revision: 9, next: {} });
  await settled();
  assert.equal(view.field('fontFamily').props.value, '');
  assert.equal(
    view.field('fontSize').props.placeholder,
    String(fonts.fontSize),
  );
});

function enclosingSections(node) {
  const sections = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'details') sections.push(parent);
  }
  return sections;
}

function sectionTitle(section) {
  const summary = section.children[0];
  assert.equal(summary.type, 'summary');
  return summary
    .findByProps({ id: summary.props['aria-labelledby'] })
    .children.join('');
}

test('four localized group headings and common settings are visible; only detailed color and Canvas controls need disclosure', (tc) => {
  for (const copy of Object.values(preferenceMessages)) {
    const view = mount(
      tc,
      new Editor({ user: { renderer: 'canvas', predictiveEcho: true } }),
      undefined,
      (key) => copy[key],
    );
    const groups = view.tree.root
      .findByType('fieldset')
      .findAllByType('section', { deep: false });
    assert.deepEqual(
      groups.map((group) =>
        group
          .findByProps({ id: group.props['aria-labelledby'] })
          .children.join(''),
      ),
      [copy.fontLayout, copy.colors, copy.interaction, copy.rendering],
    );
    const visibleFields = [
      [
        'fontFamily',
        'fontSize',
        'lineHeight',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'fit',
      ],
      ['ansiPreset', 'boldBright'],
      ['scrollback', 'altIsMeta', 'detectUrls', 'autoFocus'],
      ['renderer'],
    ];
    for (const [index, names] of visibleFields.entries()) {
      assert.deepEqual(enclosingSections(groups[index]), []);
      assert.equal(
        groups[index].findByProps({
          id: groups[index].props['aria-labelledby'],
        }).type,
        'h4',
      );
      for (const name of names) {
        const field = view.field(name);
        assert.ok(groups[index].findAll((node) => node === field).length, name);
        assert.deepEqual(enclosingSections(field), [], name);
      }
    }
    const [baseColors] = enclosingSections(view.field(colorFields[0]));
    const [ansiColors] = enclosingSections(view.field(ansiNames[0]));
    assert.notEqual(baseColors, ansiColors);
    for (const [names, details] of [
      [colorFields, baseColors],
      [ansiNames, ansiColors],
    ]) {
      assert.ok(groups[1].findAllByType('details').includes(details));
      for (const name of names)
        assert.deepEqual(enclosingSections(view.field(name)), [details]);
    }
    for (const name of [
      'cursorStyle',
      'predictiveEcho',
      'latencyThreshold',
      'predictionStyle',
    ]) {
      assert.deepEqual(enclosingSections(view.field(name)).map(sectionTitle), [
        copy.canvasControls,
      ]);
    }
    assert.deepEqual(enclosingSections(view.button(copy.restore)), []);
    assert.equal(view.status(), copy.saved);
  }
});

test('editing, host changes and locale switches reuse the same disclosure and input nodes', (tc) => {
  const editor = new Editor();
  const view = mount(tc, editor);
  const field = view.field('fontSize');
  const [disclosure] = enclosingSections(view.field('brightWhite'));
  view.input('fontSize', '23');
  view.publish({ revision: 8, user: { scrollback: 1024 } });
  view.updateFonts({ fontFamily: 'monospace', fontSize: 20 });
  view.updateLocale((key) => preferenceMessages.zh[key]);
  assert.equal(view.field('fontSize'), field);
  assert.equal(enclosingSections(view.field('brightWhite'))[0], disclosure);
  assert.deepEqual(enclosingSections(field), []);
  assert.equal(disclosure.props.open, undefined);
  assert.equal(field.props.value, '23');
  assert.ok(view.button(preferenceMessages.zh.keepEdits));
  assert.deepEqual(editor.writes, []);
});

test('padding is always visible in both locales, with labeled units, range and rendered defaults', (tc) => {
  for (const copy of Object.values(preferenceMessages)) {
    const view = mount(tc, new Editor(), undefined, (key) => copy[key]);
    const section = view.tree.root
      .findAllByType('fieldset')
      .find(
        (group) =>
          group.props['aria-labelledby'] &&
          group.findAllByProps({ name: 'paddingTop', type: 'text' }).length,
      );
    const groupLabel = view.tree.root.findByProps({
      id: section.props['aria-labelledby'],
    });
    assert.equal(groupLabel.children.join(''), copy.padding);
    assert.deepEqual(enclosingSections(section), []);
    for (const [name, fallback] of Object.entries({
      paddingTop: '16',
      paddingRight: '8',
      paddingBottom: '8',
      paddingLeft: '8',
    })) {
      const { props } = section.findByProps({ name, type: 'text' });
      assert.equal(props.value, '');
      assert.equal(props.placeholder, fallback);
      assert.equal(props.inputMode, 'numeric');
      const label = section.findByProps({ htmlFor: props.id });
      assert.ok(
        props['aria-label']
          .toLowerCase()
          .includes(label.children.join('').toLowerCase()),
      );
      assert.equal(props['aria-label'], copy[name]);
      assert.match(copy[name], /px/);
      const hint = view.tree.root.findByProps({
        id: props['aria-describedby'],
      });
      assert.ok(hint.children.join('').includes(copy.paddingHelp));
      assert.match(hint.children.join(''), /0–64/);
    }
  }
});

test('padding saves only edited sides, including zero; clear and restore use the inherited spacing', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor({ base: { paddingBottom: 0, paddingLeft: 23 } });
  const view = mount(tc, editor);
  assert.equal(view.field('paddingBottom').props.placeholder, '0');
  assert.equal(view.field('paddingLeft').props.placeholder, '23');
  view.input('paddingTop', '0');
  view.input('paddingRight', '64');
  view.input('paddingLeft', '31');
  assert.deepEqual(editor.writes, []);
  await tick(600);
  assert.deepEqual(editor.writes[0].next, {
    paddingTop: 0,
    paddingRight: 64,
    paddingLeft: 31,
  });
  assert.equal(view.field('paddingTop').props.value, '0');
  view.input('paddingRight', '');
  view.input('paddingBottom', '12');
  await tick(600);
  assert.deepEqual(editor.writes[1].next, {
    paddingTop: 0,
    paddingBottom: 12,
    paddingLeft: 31,
  });
  view.click(en.restore);
  view.click(en.confirmRestore);
  await settled();
  assert.equal(view.field('paddingTop').props.value, '');
  assert.equal(view.field('paddingTop').props.placeholder, '16');
  assert.equal(view.field('paddingLeft').props.placeholder, '23');
  assert.deepEqual(editor.writes[2].next, {});
});

test('invalid padding stays editable and is named in the error summary; blur never sends it', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor();
  const view = mount(tc, editor);
  for (const [name, value] of Object.entries({
    paddingTop: '-1',
    paddingRight: '65',
    paddingBottom: '1.5',
    paddingLeft: '8px',
  })) {
    view.input(name, value);
    assert.equal(view.field(name).props.value, value);
    assert.equal(view.field(name).props['aria-invalid'], true);
    const summary = view.tree.root.findByProps({ 'aria-label': en.invalid });
    assert.deepEqual(enclosingSections(summary), []);
    assert.ok(
      summary
        .findAllByType('button')
        .some((button) => button.children.join('') === en[name]),
    );
    assert.equal(view.status(), en.invalidStatus);
    view.blur(name);
    await tick(600);
    assert.deepEqual(editor.writes, []);
    view.input(name, '');
    assert.equal(view.field(name).props['aria-invalid'], undefined);
  }
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
  assert.deepEqual(editor.writes[0], {
    revision: 7,
    next: { cursorStyle: 'bar' },
  });
  await settled();
  assert.equal(view.field('cursorStyle').props.value, 'bar');
  assert.equal(view.field('predictiveEcho').props.checked, false);
  assert.deepEqual(view.byName('latencyThreshold'), []);
  view.toggle('predictiveEcho', true);
  await settled();
  view.input('latencyThreshold', '0');
  view.blur('latencyThreshold');
  await settled();
  view.input('predictionStyle', 'dim');
  view.toggle('autoFocus', true);
  view.toggle('fit', false);
  view.input('renderer', 'dom');
  assert.deepEqual(view.byName('predictionStyle'), []);
  await settled();
  assert.deepEqual(editor.writes.at(-1).next, {
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
  await settled();
  assert.match(en.echoHint, /password/);
});

test('bold bright exposes localized scope and saves explicit auto separately from inheritance', async (tc) => {
  for (const copy of Object.values(preferenceMessages)) {
    const user = { ansiPreset: 'dsh', palette: palette({ 12: '#abc' }) };
    const editor = new Editor({ base: { boldBright: 'never' }, user });
    const view = mount(tc, editor, undefined, (key) => copy[key]);
    const field = view.field('boldBright');
    assert.equal(field.props.value, '');
    const label = view.tree.root.findByProps({ htmlFor: field.props.id });
    assert.equal(label.children.join(''), copy.boldBright);
    const hint = view.tree.root.findByProps({
      id: field.props['aria-describedby'],
    });
    assert.equal(hint.children.join(''), copy.boldBrightHint);
    assert.match(copy.boldBrightHint, /0–7/);
    assert.deepEqual(
      field
        .findAllByType('option')
        .map((node) => [node.props.value, node.children.join('')]),
      [
        ['', `${copy.inherited}: ${copy.never}`],
        ['auto', copy.auto],
        ['always', copy.always],
        ['never', copy.never],
      ],
    );
    assert.deepEqual(editor.writes, []);
    view.input('boldBright', 'auto');
    assert.deepEqual(editor.writes, [
      { revision: 7, next: { ...user, boldBright: 'auto' } },
    ]);
    await settled();
    assert.equal(field.props.value, 'auto');
    view.input('boldBright', '');
    assert.deepEqual(editor.writes[1], { revision: 8, next: user });
    await settled();
    assert.equal(field.props.value, '');
    assert.equal(view.status(), copy.saved);
  }
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
  assert.deepEqual(editor.writes[0].next, {
    palette: palette({ 1: '#ff00ff80' }),
  });
  await settled();
  view.input('selectionBackground', '#abcd');
  const selected = pickers.find(
    (node) =>
      node.props['aria-label'] ===
      `${en.chooseColor}: ${en.selectionBackground}`,
  );
  assert.equal(selected.props.value, '#aabbcc');
  view.event(selected, { value: '#112233' });
  assert.equal(view.field('selectionBackground').props.value, '#112233dd');
  assert.equal(editor.writes.length, 2);
  await settled();
  assert.deepEqual(editor.writes[1].next, {
    selectionBackground: '#112233dd',
    palette: palette({ 1: '#ff00ff80' }),
  });
  view.input('red', '');
  assert.equal(editor.writes.length, 2);
  view.blur('red');
  await settled();
  const transparent = pickers.find(
    (node) =>
      node.props['aria-label'] === `${en.chooseColor}: ${en.foreground}`,
  );
  assert.equal(transparent.props.value, '#aabbcc');
  const descriptions = transparent.props['aria-describedby']
    .split(' ')
    .map((id) => view.tree.root.findByProps({ id }).children.join(''));
  assert.ok(descriptions.includes(`${en.opacity}: 0%`));
  view.event(transparent, { value: '#778899' });
  assert.equal(view.field('foreground').props.value, '#77889900');
  await settled();
  assert.deepEqual(editor.writes[3].next, {
    foreground: '#77889900',
    selectionBackground: '#112233dd',
  });
});

test('dirty revisions retain the draft; reapplying merges individual fields/cells and saves them without clobbering unrelated changes', async (tc) => {
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
  assert.equal(view.status(), en.conflict);
  assert.deepEqual(editor.writes, []);
  view.click(en.keepEdits);
  assert.equal(view.field('scrollback').props.value, '123');
  assert.equal(view.field('green').props.value, '#333');
  await settled();
  assert.deepEqual(editor.writes, [
    {
      revision: 8,
      next: { fontSize: 21, scrollback: 123, palette: palette({ 2: '#333' }) },
    },
  ]);
  view.input('fontSize', '22');
  view.publish({ revision: 10, user: { fontSize: 16 } });
  view.click(en.discard);
  assert.equal(view.field('fontSize').props.value, '16');
  assert.equal(view.status(), en.saved);
});

test('loading, read-only, outstanding writes, rejection and transport errors never silently lose edits', async (tc) => {
  const tick = clock(tc);
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
  view.blur('fontSize');
  assert.equal(view.status(), en.saving);
  assert.equal(view.tree.root.findByType('fieldset').props.disabled, false);
  view.input('fontSize', '23');
  assert.equal(view.field('fontSize').props.value, '23');
  assert.equal(editor.writes.length, 1);
  await act(async () => finish(false));
  assert.ok(JSON.stringify(view.tree.toJSON()).includes(en.rejected));
  assert.equal(view.status(), en.failed);
  assert.equal(view.field('fontSize').props.value, '23');
  await tick(1200);
  assert.equal(editor.writes.length, 1);
  editor.reply = async () => {
    throw new Error('Host offline');
  };
  view.click(en.retry);
  await settled();
  assert.ok(JSON.stringify(view.tree.toJSON()).includes('Host offline'));
  view.publish({
    status: 'unavailable',
    writable: false,
    revision: undefined,
    user: {},
  });
  assert.ok(view.status().includes(en.unavailable));
  assert.equal(view.field('fontSize').props.value, '23');
  assert.equal(view.tree.root.findByType('fieldset').props.disabled, true);
  assert.equal(editor.writes.length, 2);
});

test('unfinished or invalid values remain editable, but never reach the host', async (tc) => {
  const tick = clock(tc);
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
  await tick(600);
  assert.equal(view.status(), en.invalidStatus);
  assert.deepEqual(editor.writes, []);
  view.input('fontSize', '12');
  view.blur('fontSize');
  await settled();
  assert.deepEqual(editor.writes[0].next, { fontSize: 12 });
});

test('reviewing an invalid ANSI slot opens its disclosure before focusing, without changing the draft', (tc) => {
  const paletteSection = { open: false };
  let focused = false;
  const editor = new Editor();
  const view = mount(tc, editor, {
    createNodeMock: ({ type }) =>
      type === 'fieldset'
        ? {
            contains: (node) => node === paletteSection,
            querySelector: (selector) => {
              assert.equal(selector, '[name="brightWhite"]');
              return {
                closest: () => paletteSection,
                focus: () => {
                  assert.ok(paletteSection.open);
                  focused = true;
                },
              };
            },
          }
        : null,
  });
  view.input('scrollback', '11');
  view.input('brightWhite', '#X');
  assert.equal(focused, false);
  view.click(en.brightWhite);
  assert.equal(focused, true);
  assert.equal(view.field('brightWhite').props.value, '#X');
  assert.equal(view.field('scrollback').props.value, '11');
  assert.deepEqual(editor.writes, []);
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
    await settled();
    view.input('latencyThreshold', '9999');
    if (hide === 'renderer') view.input('renderer', 'dom');
    else view.toggle('predictiveEcho', false);
    assert.deepEqual(view.byName('latencyThreshold'), []);
    await settled();
    assert.equal(view.status(), en.invalidStatus);
    view.click(en.undoLatency);
    await settled();
    assert.equal(view.status(), en.saved);
    assert.deepEqual(editor.writes.at(-1).next, {
      ...user,
      [hide]: hide === 'renderer' ? 'dom' : false,
      predictionStyle: 'dim',
    });
  }
});

test('IME candidates stay local across debounce and blur; only the committed family is saved', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor();
  const view = mount(tc, editor);
  const field = view.field('fontFamily');
  view.blur('fontFamily');
  act(() => field.props.onCompositionStart({ currentTarget: { value: '' } }));
  view.input('fontFamily', 'xia');
  view.blur('fontFamily');
  await tick(1200);
  assert.equal(field.props.value, 'xia');
  assert.deepEqual(editor.writes, []);
  act(() =>
    field.props.onCompositionEnd({ currentTarget: { value: '霞鹜文楷' } }),
  );
  assert.equal(view.status(), en.pending);
  await tick(600);
  assert.deepEqual(editor.writes, [
    { next: { fontFamily: '"霞鹜文楷"' }, revision: 7 },
  ]);
});

test('a focused field keeps the typed spelling across canonical acknowledgements but follows genuinely different settings', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor();
  const view = mount(tc, editor);
  const input = view.field('lineHeight');
  act(() => input.props.onFocus());
  view.input('lineHeight', '1.');
  await tick(600);
  assert.deepEqual(editor.writes, [{ revision: 7, next: { lineHeight: 1 } }]);
  assert.equal(input.props.value, '1.');
  view.input('lineHeight', '1.25');
  await tick(600);
  assert.equal(editor.writes[1].next.lineHeight, 1.25);
  view.publish({ revision: 10, user: { lineHeight: 2 } });
  assert.equal(input.props.value, '2');
  view.blur('lineHeight');
  assert.equal(editor.writes.length, 2);
});

test('IME holds pending padding and never saves a numeric candidate; other fields can still save', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor();
  const view = mount(tc, editor);
  const input = view.field('paddingTop');
  view.input('paddingTop', '1');
  act(() => input.props.onCompositionStart({ currentTarget: { value: '1' } }));
  view.input('paddingTop', '12');
  view.blur('paddingTop');
  view.input('paddingLeft', '4');
  await tick(800);
  assert.deepEqual(editor.writes, [{ revision: 7, next: { paddingLeft: 4 } }]);
  act(() => input.props.onCompositionEnd({ currentTarget: { value: '20' } }));
  await tick(600);
  assert.deepEqual(editor.writes[1], {
    revision: 8,
    next: { paddingLeft: 4, paddingTop: 20 },
  });
});

test('hiding a composing Canvas field resumes only its last committed edit', async (tc) => {
  const tick = clock(tc);
  const editor = new Editor({
    user: { renderer: 'canvas', predictiveEcho: true },
  });
  const view = mount(tc, editor);
  const input = view.field('latencyThreshold');
  view.input('latencyThreshold', '100');
  act(() =>
    input.props.onCompositionStart({ currentTarget: { value: '100' } }),
  );
  view.input('latencyThreshold', '105');
  view.input('renderer', 'dom');
  await settled();
  assert.deepEqual(view.byName('latencyThreshold'), []);
  await tick(600);
  assert.deepEqual(
    editor.writes.map(({ next }) => next),
    [
      { renderer: 'dom', predictiveEcho: true },
      { renderer: 'dom', predictiveEcho: true, latencyThreshold: 100 },
    ],
  );
});

test('explicit clear restores focus; typing, successful autosave and external updates leave focus alone', async (tc) => {
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
  await settled();
  view.click(`${en.clear}: ${en.foreground}`);
  await settled();
  assert.deepEqual(focused, ['detectUrls', 'foreground']);
  view.input('fontSize', '20');
  view.publish({ revision: 10, user: { fontSize: 22 } });
  assert.deepEqual(focused, ['detectUrls', 'foreground']);
  view.click(en.reviewIssue);
  assert.deepEqual(focused, ['detectUrls', 'foreground', 'status']);
  view.click(en.keepEdits);
  await settled();
  assert.equal(view.button(en.reviewIssue), undefined);
  assert.deepEqual(focused, ['detectUrls', 'foreground', 'status', 'status']);
});

test('standalone scoped page has localized native controls, associated labels and compiled rio: utilities', async (tc) => {
  const view = mount(
    tc,
    new Editor({ user: { renderer: 'canvas', predictiveEcho: true } }),
  );
  const root = view.tree.root.findByProps({ 'data-rio-ui': 'preferences' });
  assert.ok(root.props.className.split(' ').includes('rio:@container'));
  // Every ordinary row uses its panel's width to switch from one column to two.
  for (const name of [
    'fontFamily',
    'paddingTop',
    'scrollback',
    'fit',
    'renderer',
  ]) {
    let row = view.field(name).parent;
    while (row && !row.props.className?.includes('rio:@min-[30rem]:grid-cols-'))
      row = row.parent;
    assert.ok(row, `missing responsive row for ${name}`);
  }
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
  const preview = root.findByProps({
    role: 'img',
    'aria-label': en.previewColors,
  });
  assert.equal(preview.children.length, ansiNames.length);
  const css = await compileUiStyles();
  assert.match(css, /@container\s*\(.*?30rem/);
  for (const node of [root, ...elements]) {
    if (node.type === 'p' && node.children[0] === en.fontSample)
      assert.deepEqual(node.props.style, fonts);
    else if (node.parent === preview) {
      assert.equal(node.type, 'span');
      assert.deepEqual(Object.keys(node.props.style), ['backgroundColor']);
      assert.match(
        node.props.style.backgroundColor,
        /^#[\da-f]{6}([\da-f]{2})?$/i,
      );
    } else assert.equal(node.props.style, undefined);
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
