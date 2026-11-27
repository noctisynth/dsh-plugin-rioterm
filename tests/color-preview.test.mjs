import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createJiti } from 'jiti';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { fieldsFrom, validateFields } from '../src/pages/preferences/draft.ts';
import { preferenceMessages } from '../src/pages/preferences/messages.ts';
import { ansiNames, colorFields } from '../src/preferences/values.ts';
import { defaultAnsiColor } from '../src/rio/theme-defaults.ts';

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
const { act } = TestRenderer;

// Real Radix controls stay in no-document mode; the preview itself is only text.
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

const rendererDefaults = {
  color: 'var(--dsw-alias-label-primary, CanvasText)',
  backgroundColor: 'var(--dsw-alias-bg-base, Canvas)',
};
const palette = (slots) => Object.assign(Array(16).fill(''), slots);

function mount(tc, copy) {
  let tree;
  const changes = [];
  const noop = () => {};
  const render = (fields = {}, base = {}, sourcesReady = true) => {
    const form = {
      fields: Object.freeze({ ...fields }),
      base: Object.freeze({ ...base }),
      sourcesReady,
      writable: true,
      invalid: validateFields(fields).invalid,
      change: (...args) => changes.push(args),
      flushField: noop,
      holdField: noop,
      releaseField: noop,
      t: (key) => {
        assert.equal(typeof copy[key], 'string', `Missing copy: ${key}`);
        return copy[key];
      },
    };
    act(() => {
      const element = React.createElement(ColorFields, { form });
      if (tree) tree.update(element);
      else tree = TestRenderer.create(element);
    });
  };
  render();
  tc.after(() => act(() => tree.unmount()));
  const figure = () => tree.root.findByType('figure');
  const sample = () =>
    figure().find(
      (node) => node.type === 'div' && node.props.style?.backgroundColor,
    );
  const selected = () =>
    figure().find(
      (node) =>
        node.type === 'span' && node.children.join('') === copy.selectionSample,
    );
  const ansi = () =>
    figure()
      .findByProps({ role: 'img', 'aria-label': copy.previewColors })
      .findAllByType('span')
      .map((node) => node.props.style.backgroundColor);
  const fallbackHints = () =>
    figure().findAll(
      (node) =>
        node.type === 'p' &&
        node.children.join('') === copy.colorPreviewFallback,
    );
  return {
    tree,
    render,
    figure,
    sample,
    selected,
    ansi,
    fallbackHints,
    changes,
    bold: () => figure().findByType('strong'),
    cursor: () => figure().findByProps({ 'aria-hidden': 'true' }),
  };
}

for (const [lang, copy] of Object.entries(preferenceMessages)) {
  test(`${lang}: color preview is standalone under the heading, before options, with no controls`, (tc) => {
    const view = mount(tc, copy);
    const section = view.tree.toJSON();
    assert.equal(section.type, 'section');
    assert.equal(section.children[0].type, 'header');
    assert.equal(
      section.children[0].children[1].children.join(''),
      copy.colorSummary,
    );
    assert.equal(section.children[1].type, 'figure');
    assert.equal(section.children[2].type, 'section');
    const figure = view.figure();
    assert.equal(figure.props['data-rio-preview'], 'color');
    assert.equal(figure.props['aria-label'], copy.colorPreview);
    const caption = figure.findByType('figcaption');
    assert.equal(caption.children.join(''), copy.colorPreview);
    assert.match(caption.props.className, /rio:text-muted-foreground/);
    for (const utility of [
      'rio:m-0',
      'rio:grid',
      'rio:w-full',
      'rio:gap-2',
      'rio:py-2',
    ])
      assert.ok(figure.props.className.split(' ').includes(utility));
    assert.equal(
      figure.findAll((node) =>
        ['input', 'button', 'select', 'textarea', 'label'].includes(node.type),
      ).length,
      0,
    );
    assert.equal(
      view.tree.root.findAllByProps({
        role: 'img',
        'aria-label': copy.previewColors,
      }).length,
      1,
    );
    assert.deepEqual(view.sample().props.style, rendererDefaults);
    assert.ok(
      view
        .sample()
        .findAllByType('div')
        .some((node) => node.children.join('') === copy.colorSample),
    );
    assert.deepEqual(view.selected().props.style, {
      color: 'HighlightText',
      backgroundColor: 'Highlight',
    });
    assert.equal(view.cursor().props.style.backgroundColor, 'currentColor');
    assert.equal(view.cursor().props['aria-hidden'], 'true');
    assert.equal(view.fallbackHints().length, 0);
    assert.deepEqual(view.changes, []);
  });

  test(`${lang}: valid drafts preserve alpha and override only their own profile and ANSI slots`, (tc) => {
    const view = mount(tc, copy);
    const fields = {
      foreground: '#abc8',
      red: '#f008',
      brightWhite: '#12345678',
      selectionBackground: '#1234',
    };
    const base = {
      foreground: '#fff',
      background: '#def0',
      cursor: '#f09',
      selectionForeground: '#fed',
      red: '#111',
      green: '#456',
    };
    view.render(fields, base);
    assert.deepEqual(view.sample().props.style, {
      color: '#aabbcc88',
      backgroundColor: '#ddeeff00',
    });
    assert.deepEqual(view.selected().props.style, {
      color: '#ffeedd',
      backgroundColor: '#11223344',
    });
    assert.equal(view.cursor().props.style.backgroundColor, '#ff0099');
    const colors = view.ansi();
    assert.equal(colors[1], '#ff000088');
    assert.equal(colors[2], '#445566');
    assert.equal(colors[15], '#12345678');
    for (const index of [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
      assert.equal(colors[index], defaultAnsiColor(ansiNames[index]));
    for (const name of ansiNames.slice(0, 8)) {
      const token = view
        .figure()
        .find(
          (node) =>
            node.type === 'span' && node.children.join('') === copy[name],
        );
      assert.equal(token.props.style.color, colors[ansiNames.indexOf(name)]);
    }
    assert.equal(view.fallbackHints().length, 0);
    assert.deepEqual(view.changes, []);
    view.render({}, base);
    assert.equal(view.sample().props.style.color, '#ffffff');
    assert.equal(view.ansi()[1], '#111111');
    assert.equal(view.ansi()[15], defaultAnsiColor('brightWhite'));
    assert.deepEqual(view.changes, []);
  });

  test(`${lang}: preset and bold-bright modes update live without changing independent overrides`, (tc) => {
    const view = mount(tc, copy);
    const base = {
      ansiPreset: 'dsh',
      blue: '#123',
      brightBlue: '#abc',
      red: '#fed',
    };
    for (const ansiPreset of ['rio', 'dsh']) {
      for (const boldBright of ['auto', 'always', 'never']) {
        view.render({ ansiPreset, boldBright, green: '#a12' }, base);
        const bright =
          boldBright === 'always' ||
          (boldBright === 'auto' && ansiPreset === 'dsh');
        assert.equal(
          view.bold().props.style.color,
          bright ? '#aabbcc' : '#112233',
        );
        assert.equal(view.bold().children.join(''), copy.boldSample);
        assert.equal(view.ansi()[0], defaultAnsiColor('black', ansiPreset));
        assert.equal(view.ansi()[1], '#ffeedd');
        assert.equal(view.ansi()[2], '#aa1122');
      }
    }
    view.render({}, { ansiPreset: 'dsh', boldBright: 'never' });
    assert.equal(
      view.bold().props.style.color,
      defaultAnsiColor('blue', 'dsh'),
    );
    view.render({}, { ansiPreset: 'dsh' });
    assert.equal(
      view.bold().props.style.color,
      defaultAnsiColor('brightBlue', 'dsh'),
    );
    view.render();
    assert.equal(
      view.bold().props.style.color,
      defaultAnsiColor('blue', 'rio'),
    );
    assert.deepEqual(view.changes, []);
  });

  test(`${lang}: incomplete and malicious color drafts never enter preview styles`, (tc) => {
    const view = mount(tc, copy);
    const malicious = [
      '#12',
      'red',
      'var(--untrusted)',
      'url(https://example.invalid/pixel)',
      '#123; background: url(https://example.invalid/pixel)',
      'expression(alert(1))',
    ];
    for (const text of malicious) {
      const fields = Object.fromEntries(
        [...colorFields, ...ansiNames].map((name) => [name, text]),
      );
      view.render(fields, {
        foreground: '#1234',
        background: '#5678',
        red: '#a12',
        blue: '#12',
        brightBlue: text,
      });
      assert.deepEqual(view.sample().props.style, {
        color: '#11223344',
        backgroundColor: '#55667788',
      });
      assert.equal(view.ansi()[1], '#aa1122');
      assert.equal(view.ansi()[4], defaultAnsiColor('blue'));
      assert.equal(view.ansi()[12], defaultAnsiColor('brightBlue'));
      assert.deepEqual(view.selected().props.style, {
        color: 'HighlightText',
        backgroundColor: 'Highlight',
      });
      assert.equal(view.cursor().props.style.backgroundColor, 'currentColor');
      assert.equal(view.fallbackHints().length, 1);
      for (const node of view
        .figure()
        .findAll((node) => Boolean(node.props.style))) {
        for (const value of Object.values(node.props.style)) {
          assert.notEqual(value, text);
          assert.ok(
            /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value) ||
              [
                ...Object.values(rendererDefaults),
                'HighlightText',
                'Highlight',
                'currentColor',
              ].includes(value),
            `Unsafe preview style: ${value}`,
          );
        }
      }
    }
    view.render({ foreground: '#bad-input', background: '#bad-input' });
    assert.deepEqual(view.sample().props.style, rendererDefaults);
    view.render({ foreground: '#fff' });
    assert.equal(view.fallbackHints().length, 0);
    assert.deepEqual(view.changes, []);
  });

  test(`${lang}: unknown profile sources never produce a false color preview`, (tc) => {
    const view = mount(tc, copy);
    for (const fields of [{}, { foreground: '#abc', ansiPreset: 'dsh' }]) {
      view.render(fields, {}, false);
      assert.equal(view.tree.root.findAllByType('figure').length, 0);
      assert.equal(
        view.tree.root.findAllByProps({
          role: 'img',
          'aria-label': copy.previewColors,
        }).length,
        0,
      );
      assert.ok(view.tree.root.findAllByType('input').length > 0);
    }
    view.render({}, { foreground: '#123' }, true);
    assert.equal(view.sample().props.style.color, '#112233');
    assert.deepEqual(view.changes, []);
  });
}

test('mounting and updating a ready preview never saves or materializes inherited colors', async (tc) => {
  const copy = preferenceMessages.en;
  let snapshot = {
    status: 'ready',
    writable: true,
    revision: 4,
    user: { foreground: '#abc8', palette: palette({ 2: '#1234' }) },
    base: {
      background: '#def0',
      ansiPreset: 'dsh',
      palette: palette({ 1: '#f00' }),
    },
    value: {},
  };
  const writes = [];
  let notify;
  const editor = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      notify = listener;
      return () => {};
    },
    save: (...args) => {
      writes.push(args);
      return Promise.resolve(true);
    },
  };
  const draft = new PreferenceAutosave(editor);
  tc.after(draft.connect());
  let tree;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(PreferencesPage, {
        draft,
        t: (key) => copy[key],
        hostFonts: { fontSize: 14, fontFamily: 'monospace' },
      }),
    );
  });
  tc.after(() => act(() => tree.unmount()));
  assert.equal(
    tree.root.findByProps({ 'data-rio-preview': 'color' }).type,
    'figure',
  );
  assert.deepEqual(writes, []);
  const originalUser = structuredClone(snapshot.user);
  await act(async () => {
    snapshot = {
      ...snapshot,
      base: { ...snapshot.base, ansiPreset: 'rio', background: '#1238' },
    };
    notify();
  });
  assert.deepEqual(snapshot.user, originalUser);
  assert.deepEqual(writes, []);
  assert.deepEqual(fieldsFrom(snapshot.user), {
    foreground: '#abc8',
    green: '#1234',
  });
});
