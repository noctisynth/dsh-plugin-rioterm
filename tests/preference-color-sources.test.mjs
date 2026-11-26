import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createJiti } from 'jiti';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { defaultTheme } from 'rioterm';
import { fieldsFrom, validateFields } from '../src/pages/preferences/draft.ts';
import { preferenceMessages } from '../src/pages/preferences/messages.ts';
import { ansiNames } from '../src/preferences/values.ts';

const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { ColorFields } = await jiti.import(
  '../src/pages/preferences/color-fields.tsx',
);
const { PreferencesPage } = await jiti.import(
  '../src/pages/preferences/preferences-page.tsx',
);
const { PreferenceAutosave } = await jiti.import(
  '../src/pages/preferences/preference-autosave.ts',
);
const { Select, SelectContent, SelectItem, SelectValue } = await jiti.import(
  '../src/components/ui/select.tsx',
);
const { act } = TestRenderer;

// Keep real Radix components in no-document mode for configuration callbacks.
// Browser menu/keyboard behavior is covered by the separate jsdom Select tests.
const originalGlobals = new Map(
  ['window', 'HTMLFormElement'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
before(() => {
  globalThis.HTMLFormElement = class HTMLFormElement {};
  globalThis.window = {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
  };
});
after(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function selectRoot(trigger) {
  for (let node = trigger.parent; node; node = node.parent)
    if (node.type === Select && typeof node.props.onValueChange === 'function')
      return node;
  assert.fail(`Missing Select root for ${trigger.props.name}`);
}
const palette = (slots) => Object.assign(Array(16).fill(''), slots);

function sourceText(tree, input) {
  const id = input.props['aria-describedby'].split(' ')[0];
  const description = tree.root.findByProps({ id });
  assert.equal(description.props.className, 'rio:sr-only');
  assert.equal(description.props.hidden, undefined);
  assert.equal(description.props['aria-hidden'], undefined);
  return description.children.join('');
}

function mount(tc, copy) {
  let tree;
  const changes = [];
  function render(user, profile) {
    const fields = fieldsFrom(user);
    const form = {
      fields,
      base: fieldsFrom(profile),
      sourcesReady: true,
      writable: true,
      invalid: validateFields(fields).invalid,
      change: (...args) => changes.push(args),
      t: (key) => copy[key],
    };
    const el = React.createElement(ColorFields, { form });
    act(() => {
      if (tree) tree.update(el);
      else tree = TestRenderer.create(el);
    });
  }
  render({}, {});
  tc.after(() => act(() => tree.unmount()));
  const field = (name) => tree.root.findByProps({ type: 'text', name });
  const source = (name) => sourceText(tree, field(name));
  const description = (name, suffix) =>
    tree.root.findByProps({ id: `${field(name).props.id}-${suffix}` });
  const picker = (label) =>
    tree.root.findByProps({
      type: 'color',
      'aria-label': `${copy.chooseColor}: ${label}`,
    });
  const clears = () =>
    tree.root
      .findAllByType('button')
      .filter((node) =>
        node.props['aria-label']?.startsWith(`${copy.clear}: `),
      );
  return { render, field, source, description, picker, clears, changes };
}

for (const [lang, copy] of Object.entries(preferenceMessages)) {
  test(`${lang}: blank fields identify renderer defaults, not a fabricated inherited hex`, (tc) => {
    const view = mount(tc, copy);
    assert.equal(copy.defaultValue, lang === 'zh' ? '默认' : 'Default');
    const defaults = {
      foreground: 'colorDshText',
      background: 'colorDshBackground',
      cursor: 'colorCurrentText',
      selectionForeground: 'colorSystemText',
      selectionBackground: 'colorSystemHighlight',
      ...Object.fromEntries(ansiNames.map((name) => [name, 'colorRioPalette'])),
    };
    for (const [name, sourceKey] of Object.entries(defaults)) {
      assert.equal(view.field(name).props.value, '');
      const defaultHex = ansiNames.includes(name)
        ? defaultTheme[name]
        : undefined;
      assert.equal(
        view.field(name).props.placeholder,
        defaultHex ?? copy.defaultValue,
      );
      assert.equal(
        view.source(name),
        `${copy.inherited}: ${copy[sourceKey]}${defaultHex ? ` ${defaultHex}` : ''}`,
      );
      const picker = view.picker(
        ansiNames.includes(name)
          ? `${ansiNames.indexOf(name)} · ${copy[name]}`
          : copy[name],
      );
      assert.equal(
        picker.props['aria-describedby'].split(' ')[0],
        view.field(name).props['aria-describedby'].split(' ')[0],
      );
      if (defaultHex) {
        assert.equal(picker.props.value, defaultHex);
        assert.ok(!picker.props['aria-describedby'].includes('opacity'));
      }
    }
    // When the theme hex is unknown, the native picker's seed stays behind
    // a neutral affordance. It never appears as a preference or a swatch.
    const picker = view.picker(copy.foreground);
    assert.deepEqual(
      picker.parent.findByProps({ 'aria-hidden': 'true' }).children,
      ['+'],
    );
    assert.match(view.source('cursor'), /currentColor/);
    assert.match(view.source('selectionForeground'), /HighlightText/);
    assert.match(view.source('selectionBackground'), /Highlight(?!Text)/);
    assert.match(view.source('brightCyan'), /rioterm/);
    assert.equal(view.clears().length, 0);
    assert.deepEqual(view.changes, []);
  });

  test(`${lang}: overrides describe their clear target; profile colors inherit independently by field and ANSI index`, (tc) => {
    const view = mount(tc, copy);
    const local = {
      foreground: '#abc8',
      cursor: '#faf',
      palette: palette({ 1: '#999', 15: '#fff' }),
    };
    const profile = {
      foreground: '#fed',
      background: '#222',
      selectionForeground: '#ddd',
      palette: palette({ 1: '#222', 2: '#343' }),
    };
    view.render(local, profile);
    const afterClear = `${copy.colorOverride} · ${copy.ifCleared}: `;
    assert.equal(
      view.source('foreground'),
      `${afterClear}${copy.colorProfile} #fed`,
    );
    assert.equal(
      view.source('background'),
      `${copy.inherited}: ${copy.colorProfile} #222`,
    );
    assert.equal(
      view.source('selectionForeground'),
      `${copy.inherited}: ${copy.colorProfile} #ddd`,
    );
    assert.equal(
      view.source('cursor'),
      `${afterClear}${copy.colorCurrentText} #abc8`,
    );
    assert.equal(view.source('red'), `${afterClear}${copy.colorProfile} #222`);
    assert.equal(
      view.source('green'),
      `${copy.inherited}: ${copy.colorProfile} #343`,
    );
    assert.equal(
      view.source('brightWhite'),
      `${afterClear}${copy.colorRioPalette} ${defaultTheme.brightWhite}`,
    );
    assert.equal(view.clears().length, 4);

    // A new profile may supply a cursor independent of the effective text.
    view.render(local, { ...profile, cursor: '#f09' });
    assert.equal(
      view.source('cursor'),
      `${afterClear}${copy.colorProfile} #f09`,
    );
    // Explicit clear only drops this slot from the user layer, not its profile fallback.
    const clear = view
      .clears()
      .find(
        (node) => node.props['aria-label'] === `${copy.clear}: 1 · ${copy.red}`,
      );
    act(() => clear.props.onClick());
    assert.deepEqual(view.changes, [['red', '', 'immediate']]);
    view.render({ ...local, palette: palette({ 15: '#fff' }) }, profile);
    assert.equal(view.field('red').props.value, '');
    assert.equal(view.field('red').props.placeholder, '#222');
    assert.equal(
      view.source('red'),
      `${copy.inherited}: ${copy.colorProfile} #222`,
    );
    assert.equal(view.clears().length, 3);
  });

  test(`${lang}: a blank cursor follows text from draft or profile, preserving alpha only on an explicit pick`, (tc) => {
    const view = mount(tc, copy);
    view.render({ foreground: '#abc0' }, { foreground: '#def8' });
    assert.equal(view.field('cursor').props.value, '');
    assert.equal(
      view.source('cursor'),
      `${copy.inherited}: ${copy.colorCurrentText} #abc0`,
    );
    assert.equal(view.picker(copy.cursor).props.value, '#aabbcc');
    const opacity = view.description('cursor', 'opacity');
    assert.equal(opacity.children.join(''), `${copy.opacity}: 0%`);
    assert.ok(!opacity.props.className.includes('sr-only'));
    assert.ok(
      view
        .picker(copy.cursor)
        .props['aria-describedby'].includes(opacity.props.id),
    );
    // After restore (empty draft), preview follows the profile text. No value is pinned.
    view.render({}, { foreground: '#def8' });
    assert.equal(
      view.source('cursor'),
      `${copy.inherited}: ${copy.colorCurrentText} #def8`,
    );
    const picker = view.picker(copy.cursor);
    assert.equal(picker.props.value, '#ddeeff');
    assert.deepEqual(view.changes, []);
    act(() => picker.props.onChange({ currentTarget: { value: '#123456' } }));
    assert.deepEqual(view.changes, [['cursor', '#12345688', 'immediate']]);
    view.render({ cursor: '#bad-input' }, { cursor: '#abcd' });
    assert.ok(
      !view.picker(copy.cursor).props['aria-describedby'].includes('opacity'),
    );
    assert.equal(view.field('cursor').props['aria-invalid'], true);
    const error = view.description('cursor', 'error');
    assert.equal(error.children.join(''), copy.invalidColor);
    assert.ok(!error.props.className.includes('sr-only'));
    assert.ok(
      view.field('cursor').props['aria-describedby'].includes(error.props.id),
    );
    assert.equal(
      view.source('cursor'),
      `${copy.colorOverride} · ${copy.ifCleared}: ${copy.colorProfile} #abcd`,
    );
  });

  test(`${lang}: switching the palette immediately saves only the preset, not 16 materialized colors`, async (tc) => {
    const copyOfBase = { ansiPreset: 'dsh', palette: palette({ 1: '#abcd' }) };
    const user = { palette: palette({ 2: '#123456' }) };
    let snapshot = {
      status: 'ready',
      writable: true,
      revision: 5,
      base: copyOfBase,
      user,
      value: { ...copyOfBase, ...user },
    };
    const saves = [];
    const listeners = new Set();
    const editor = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      save: async (next, revision) => {
        assert.equal(revision, snapshot.revision);
        saves.push([next, revision]);
        snapshot = {
          ...snapshot,
          user: next,
          revision: revision + 1,
          value: { ...copyOfBase, ...next },
        };
        for (const listener of listeners) listener();
        return true;
      },
    };
    const draft = new PreferenceAutosave(editor);
    tc.after(draft.connect());
    let tree;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(PreferencesPage, {
          draft,
          t: (key) => copy[key],
          hostFonts: { fontSize: 14, fontFamily: 'monospace' },
        }),
      );
    });
    tc.after(() => act(() => tree.unmount()));
    const input = (name) => tree.root.findByProps({ type: 'text', name });
    const select = tree.root.find(
      (node) =>
        node.type === 'button' &&
        node.props.role === 'combobox' &&
        node.props.name === 'ansiPreset',
    );
    const choose = (value) =>
      act(async () => {
        selectRoot(select).props.onValueChange(value);
      });
    assert.equal(select.props.value, 'dsh');
    assert.equal(select.findByType(SelectValue).props.children, copy.dsh);
    const content = React.Children.toArray(
      selectRoot(select).props.children,
    ).find((child) => child.type === SelectContent);
    assert.ok(content);
    assert.deepEqual(
      React.Children.toArray(content.props.children).map((item) => {
        assert.equal(item.type, SelectItem);
        return [item.props.value, item.props.children];
      }),
      [
        ['rio', copy.rio],
        ['dsh', copy.dsh],
      ],
    );
    const preview = (slot) =>
      tree.root
        .findByProps({ role: 'img', 'aria-label': copy.previewColors })
        .findAllByType('span')[slot].props.style.backgroundColor;
    assert.equal(preview(4).toLowerCase(), '#3465a4');
    assert.equal(preview(2), '#123456');
    assert.equal(input('blue').props.placeholder.toLowerCase(), '#3465a4');
    assert.equal(input('red').props.placeholder, '#abcd');
    assert.equal(input('green').props.value, '#123456');
    assert.deepEqual(saves, []);
    await choose('rio');
    assert.equal(preview(4), defaultTheme.blue);
    assert.equal(preview(2), '#123456');
    assert.equal(input('blue').props.placeholder, defaultTheme.blue);
    assert.equal(input('red').props.placeholder, '#abcd');
    assert.equal(input('green').props.value, '#123456');
    assert.deepEqual(saves, [[{ ...user, ansiPreset: 'rio' }, 5]]);
    await act(async () => {
      tree.root
        .find(
          (node) =>
            node.type === 'button' &&
            node.props['aria-label'] ===
              `${copy.useInherited}: ${copy.ansiPreset}`,
        )
        .props.onClick();
    });
    assert.equal(select.props.value, 'dsh');
    assert.equal(input('blue').props.placeholder.toLowerCase(), '#3465a4');
    assert.deepEqual(saves[1], [user, 6]);
  });

  test(`${lang}: unknown profile state never claims a default; a ready read-only profile still has sources`, (tc) => {
    let snapshot = {
      status: 'loading',
      writable: false,
      revision: undefined,
      user: {},
      value: {},
      base: {},
    };
    let notify;
    const editor = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      save: () =>
        assert.fail('incoming snapshots and draft edits must not save'),
    };
    const publish = (delta) =>
      act(() => {
        snapshot = { ...snapshot, ...delta };
        notify();
      });
    const draft = new PreferenceAutosave(editor);
    tc.after(draft.connect());
    let tree;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(PreferencesPage, {
          draft,
          t: (key) => copy[key],
          hostFonts: { fontSize: 16, fontFamily: 'monospace' },
        }),
      );
    });
    tc.after(() => act(() => tree.unmount()));
    const field = (name) => tree.root.findByProps({ type: 'text', name });
    const source = (name) => sourceText(tree, field(name));
    assert.equal(source('red'), copy.colorSourceUnavailable);
    publish({ status: 'ready', revision: 1, base: { foreground: '#123' } });
    assert.ok(tree.root.findByType('fieldset').props.disabled);
    assert.equal(
      source('foreground'),
      `${copy.inherited}: ${copy.colorProfile} #123`,
    );
    publish({ writable: true });
    act(() =>
      field('foreground').props.onChange({ currentTarget: { value: '#abc' } }),
    );
    publish({
      status: 'unavailable',
      writable: false,
      revision: undefined,
      base: {},
    });
    assert.equal(field('foreground').props.value, '#abc');
    assert.equal(
      source('foreground'),
      `${copy.colorOverride} · ${copy.colorSourceUnavailable}`,
    );
    assert.equal(source('background'), copy.colorSourceUnavailable);
    assert.equal(field('red').props.placeholder, undefined);
  });
}
