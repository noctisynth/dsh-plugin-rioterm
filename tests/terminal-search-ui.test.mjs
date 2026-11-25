import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { terminalMessages } from '../src/pages/terminal/messages.ts';
import { defaultEffectivePreferences } from '../src/preferences/values.ts';
import { EMPTY_SEARCH_RESULT } from '../src/terminal/search.ts';

const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { TerminalSearch } = await jiti.import(
  '../src/pages/terminal/terminal-search.tsx',
);
const { TerminalPage } = await jiti.import(
  '../src/pages/terminal/terminal-page.tsx',
);
const { act } = TestRenderer;
const tKey = (k) => terminalMessages.en[k];

// Provide just the DOM ports this overlay owns. Dispatch the section's native
// capture handlers *before* the actual EventTarget listeners that stand in for Rio.
function panel(t, overrides = {}) {
  const doc = { hidden: false, hasFocus: () => true };
  const captures = new Map();
  const shell = new EventTarget();
  const shellKeys = [];
  for (const type of ['keyup', 'keydown']) {
    shell.addEventListener(type, (e) => shellKeys.push([e.type, e.key]));
  }
  const section = {
    addEventListener(type, fn, capture) {
      assert.equal(
        capture,
        true,
        'Must intercept before native textarea handlers',
      );
      assert.equal(captures.has(type), false);
      captures.set(type, fn);
    },
    removeEventListener(type, fn, capture) {
      assert.equal(capture, true);
      assert.equal(fn, captures.get(type));
      captures.delete(type);
    },
    querySelector: () => ({ contains: (el) => el === shell }),
  };
  const focus = [];
  const focusable = (name) => ({
    focus() {
      doc.activeElement = this;
      focus.push(name);
    },
    select() {
      focus.push('select');
    },
  });
  const field = focusable('field');
  const trigger = focusable('trigger');
  const root = {
    ownerDocument: doc,
    closest: (selector) =>
      selector === '[data-rio-terminal]' ? section : null,
    contains: (el) => el === field || el === trigger,
    querySelector: () => trigger,
  };
  const calls = [];
  let props = {
    status: 'connected',
    t: tKey,
    search(query, direction) {
      calls.push([query, direction]);
      return query === 'absent'
        ? { index: 0, count: 0, truncated: false }
        : { index: 1, count: 1000, truncated: true };
    },
    clearSearch: () => calls.push('clear'),
    focusTerminal() {
      doc.activeElement = shell;
      focus.push('shell');
    },
    searchRevision: 0,
    ...overrides,
  };
  const element = () => React.createElement(TerminalSearch, props);
  let tree;
  act(() => {
    tree = TestRenderer.create(element(), {
      createNodeMock: (el) => (el.type === 'input' ? field : root),
    });
  });
  const input = () => tree.root.findByType('input');
  const button = (key) =>
    tree.root
      .findAllByType('button')
      .find((b) => b.props['aria-label'] === tKey(key));
  const send = (type, target, key, data = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      key,
      ...data,
    });
    Object.defineProperty(e, 'target', { value: target });
    act(() => {
      captures.get(type)?.(e);
      if (e.cancelBubble) return;
      if (target === shell) shell.dispatchEvent(e);
      if (type === 'keydown' && target === field) {
        input().props.onKeyDown({
          key,
          ...data,
          nativeEvent: e,
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation(),
        });
      }
    });
    return e.defaultPrevented;
  };
  const unmount = () => {
    if (tree) act(() => tree.unmount());
    tree = undefined;
    assert.equal(captures.size, 0);
  };
  t.after(unmount);
  return {
    get tree() {
      return tree;
    },
    input,
    button,
    doc,
    field,
    shell,
    shellKeys,
    focus,
    calls,
    send,
    open: () => act(() => button('findOutput').props.onClick()),
    change: (value) =>
      act(() => input().props.onChange({ currentTarget: { value } })),
    tick: (ms) => act(() => t.mock.timers.tick(ms)),
    update: (delta) => {
      props = { ...props, ...delta };
      act(() => tree.update(element()));
    },
    count: () => tree.root.findByProps({ role: 'status' }).children.join(''),
    unmount,
  };
}

for (const [platform, isMac] of [
  ['MacIntel', true],
  ['Linux x86_64', false],
]) {
  test(`only the terminal section consumes its platform find chords (${platform})`, (t) => {
    t.mock.getter(globalThis, 'navigator', () => ({ platform }));
    const p = panel(t);
    const key = (data) => p.send('keydown', p.shell, 'f', data);
    assert.equal(key({ ctrlKey: true }), false); // Ctrl+F remains a shell binding.
    assert.equal(key({ metaKey: true, shiftKey: true }), false);
    assert.equal(key({ ctrlKey: true, shiftKey: true, altKey: true }), false);
    assert.equal(
      key({ ctrlKey: true, shiftKey: true, isComposing: true }),
      false,
    );
    assert.equal(key({ ctrlKey: true, shiftKey: true, keyCode: 229 }), false);
    assert.equal(key({ metaKey: true }), isMac);
    assert.equal(key({ ctrlKey: true, shiftKey: true }), true);
    assert.deepEqual(p.focus, isMac ? ['field', 'field', 'select'] : ['field']);
    assert.equal(p.shellKeys.length, isMac ? 5 : 6);
    // Key release can be retargeted to the textarea even though it did not own keydown.
    assert.equal(p.send('keyup', p.shell, 'f'), true);
    assert.equal(p.send('keydown', p.field, 'Escape'), true);
    assert.equal(p.focus.at(-1), 'shell');
    assert.equal(p.send('keydown', p.shell, 'Escape', { repeat: true }), true);
    assert.equal(p.send('keyup', p.shell, 'Escape'), true);
    assert.equal(p.send('keydown', p.shell, 'Escape'), false);
    assert.deepEqual(p.shellKeys.at(-1), ['keydown', 'Escape']);
    assert.deepEqual(p.calls, ['clear']);
  });
}

test('typing is debounced, explicit navigation commits the latest text, and revisions refresh in place', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = panel(t);
  assert.equal(p.tree.root.findAllByType('input').length, 0);
  assert.ok(p.button('findOutput').props.title.includes(tKey('findOutput')));
  p.open();
  assert.equal(p.input().props['aria-label'], tKey('findOutput'));
  assert.equal(p.count(), '');
  assert.equal(p.button('findNext').props.disabled, true);
  p.change('ab');
  p.tick(50);
  p.change('abc');
  p.tick(99);
  assert.deepEqual(p.calls, []);
  p.tick(1);
  assert.deepEqual(p.calls, [['abc', 'first']]);
  assert.equal(p.count(), '1 / 1000+');
  p.send('keydown', p.field, 'Enter');
  p.send('keydown', p.field, 'Enter', { shiftKey: true });
  assert.deepEqual(p.calls.slice(-2), [
    ['abc', 'next'],
    ['abc', 'previous'],
  ]);
  p.change('other');
  act(() => p.button('findNext').props.onClick());
  p.tick(200);
  assert.deepEqual(p.calls.at(-1), ['other', 'next']);
  p.update({ searchRevision: 1 });
  assert.deepEqual(p.calls.at(-1), ['other', 'refresh']);
  assert.deepEqual(p.focus, ['field']);
  p.change('absent');
  p.tick(100);
  assert.equal(p.count(), tKey('findNone'));
  assert.equal(p.button('findPrevious').props.disabled, true);
  p.change('');
  p.tick(100);
  assert.equal(p.count(), '');
  assert.equal(p.calls.at(-1), 'clear');
  assert.deepEqual(p.shellKeys, []);
});

for (const { name, queries, result, count, disabled } of [
  {
    name: 'consecutive no-match edits reuse EMPTY_SEARCH_RESULT',
    queries: ['absent', 'absent-long', 'absent-longer-than-the-output'],
    result: EMPTY_SEARCH_RESULT,
    count: tKey('findNone'),
    disabled: true,
  },
  {
    name: 'different queries reuse the same nonempty result object',
    queries: ['alpha', 'beta', 'gamma'],
    result: Object.freeze({ index: 1, count: 2, truncated: false }),
    count: '1 / 2',
    disabled: false,
  },
]) {
  test(`each completed query clears pending when ${name}`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const p = panel(t, {
      search(query, direction) {
        calls.push([query, direction]);
        return result;
      },
    });
    p.open();
    for (const [index, query] of queries.entries()) {
      p.change(query);
      assert.equal(p.count(), tKey('findPending'));
      assert.equal(p.input().props['aria-busy'], true);
      assert.equal(
        p.tree.root.findAllByProps({ 'data-rio-search-loading': 'true' })
          .length,
        1,
      );
      p.tick(99);
      assert.equal(calls.length, index);
      p.tick(1);
      assert.deepEqual(calls.at(-1), [query, 'first']);
      // No parent update, revision, or additional keystroke may be needed to
      // render completion when the engine returns the previous result by identity.
      assert.equal(p.count(), count, `completed query: ${query}`);
      assert.equal(p.input().props['aria-busy'], false);
      assert.equal(
        p.tree.root.findAllByProps({ 'data-rio-search-loading': 'true' })
          .length,
        0,
      );
      assert.equal(p.button('findPrevious').props.disabled, disabled);
      assert.equal(p.button('findNext').props.disabled, disabled);
      p.tick(1000);
      assert.equal(calls.length, index + 1);
      assert.equal(p.count(), count);
    }
    assert.deepEqual(p.focus, ['field']);
    assert.deepEqual(p.shellKeys, []);
  });
}

test('waiting and pending feedback share a fixed input inset without moving the field or navigation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const p = panel(t, {
    status: 'loading',
    search(query, direction) {
      calls.push([query, direction]);
      return EMPTY_SEARCH_RESULT;
    },
  });
  const loading = () =>
    p.tree.root.findAllByProps({ 'data-rio-search-loading': 'true' });
  const feedback = () =>
    p.tree.root.findByProps({ 'data-rio-search-feedback': 'true' });
  const hasClass = (node, className) =>
    node.props.className.split(/\s+/).includes(className);
  p.open();
  const field = p.input();
  const slot = feedback();
  const next = p.button('findNext');
  assert.equal(hasClass(field.parent, 'rio:relative'), true);
  assert.equal(slot.parent, field.parent);
  for (const className of [
    'rio:pointer-events-none',
    'rio:absolute',
    'rio:inset-y-0',
    'rio:end-2',
    'rio:w-24',
  ]) {
    assert.equal(hasClass(slot, className), true, className);
  }
  assert.equal(slot.props['aria-hidden'], 'true');
  assert.equal(loading().length, 0);
  assert.equal(p.count(), '');
  assert.equal(
    hasClass(p.tree.root.findByProps({ role: 'status' }), 'rio:sr-only'),
    true,
  );
  p.change('long-query-with-no-match');
  p.tick(1000);
  assert.equal(p.count(), tKey('findWaiting'));
  assert.equal(p.input().props['aria-busy'], true);
  assert.deepEqual(calls, []);
  assert.equal(loading().length, 1);
  const spinner = loading()[0];
  assert.equal(spinner.type, 'svg');
  assert.equal(spinner.props['aria-hidden'], 'true');
  assert.equal(slot.findAll((node) => node === spinner).length, 1);
  assert.equal(hasClass(spinner, 'rio:animate-search-spin'), true);
  assert.equal(hasClass(spinner, 'rio:motion-reduce:animate-none'), true);
  p.update({ status: 'readonly' });
  assert.equal(p.count(), tKey('findPending'));
  assert.equal(loading().length, 1);
  p.tick(100);
  assert.deepEqual(calls, [['long-query-with-no-match', 'first']]);
  assert.equal(p.count(), tKey('findNone'));
  assert.equal(p.input().props['aria-busy'], false);
  assert.equal(p.input().props.title, tKey('findNone'));
  assert.equal(loading().length, 0);
  assert.equal(feedback(), slot);
  assert.equal(p.input(), field);
  assert.equal(p.button('findNext'), next);
  const visibleResult = slot.findByProps({ title: tKey('findNone') });
  assert.equal(visibleResult.children.join(''), tKey('findNone'));
  assert.equal(hasClass(visibleResult, 'rio:truncate'), true);
  p.change('');
  assert.equal(p.count(), '');
  assert.equal(p.input().props['aria-busy'], false);
  assert.equal(loading().length, 0);
  assert.equal(feedback(), slot);
  assert.deepEqual(p.focus, ['field']);
});

test('IME edits never navigate, close, or scan intermediate text; timers stop on dismissal', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = panel(t);
  p.open();
  act(() => p.input().props.onCompositionStart());
  p.change('han');
  p.tick(200);
  assert.equal(p.send('keydown', p.field, 'Enter'), false);
  assert.equal(p.send('keydown', p.field, 'Escape'), false);
  assert.deepEqual(p.calls, []);
  act(() =>
    p.input().props.onCompositionEnd({ currentTarget: { value: '汉' } }),
  );
  p.tick(100);
  assert.deepEqual(p.calls, [['汉', 'first']]);
  assert.equal(p.send('keydown', p.field, 'Enter', { keyCode: 229 }), false);
  p.change('unfinished');
  p.send('keydown', p.field, 'Escape');
  p.tick(1000);
  assert.deepEqual(p.calls, [['汉', 'first'], 'clear']);
  assert.deepEqual(p.shellKeys, []);
});

test('loading, readonly, focus moving elsewhere and deactivation do not transfer PTY focus', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = panel(t, { status: 'loading' }),
    b = panel(t);
  a.open();
  a.change('err');
  a.tick(200);
  assert.equal(a.count(), tKey('findWaiting'));
  assert.deepEqual(a.calls, []);
  a.update({ status: 'readonly' });
  a.tick(100);
  assert.deepEqual(a.calls, [['err', 'first']]);
  assert.deepEqual(b.calls, []);
  assert.equal(b.tree.root.findAllByType('input').length, 0);
  a.send('keydown', a.field, 'Escape');
  assert.deepEqual(a.focus, ['field', 'trigger']);
  a.open();
  a.doc.activeElement = {};
  a.update({ status: 'reconnecting' });
  a.update({ status: 'connected' });
  act(() => a.button('findClose').props.onClick());
  assert.deepEqual(a.focus, ['field', 'trigger', 'field']);
  a.open();
  a.doc.hidden = true;
  a.send('keydown', a.field, 'Escape');
  assert.equal(a.focus.includes('shell'), false);
  b.open();
  b.change('pending');
  b.unmount();
  a.tick(200);
  assert.deepEqual(b.calls, ['clear']);
  assert.deepEqual(b.focus, ['field']);
});

test('selected page owns the search UI; switching panes discards the draft without replacing or resizing the viewport', () => {
  const props = {
    t: tKey,
    appearance: {
      subscribe: () => () => {},
      getSnapshot: () => defaultEffectivePreferences,
    },
    session: {},
    issueLaunch: assert.fail,
    openNew: assert.fail,
  };
  const render = (active, visible = true) =>
    React.createElement(TerminalPage, { ...props, active, visible });
  let tree;
  act(() => {
    tree = TestRenderer.create(render(true));
  });
  const viewport = () =>
    tree.root.find((n) => n.type === 'div' && n.props['data-rio-viewport']);
  const original = viewport();
  const style = original.props.style;
  const open = () => act(() => tree.root.findByType('button').props.onClick());
  try {
    open();
    act(() =>
      tree.root
        .findByType('input')
        .props.onChange({ currentTarget: { value: 'private to this pane' } }),
    );
    assert.deepEqual(viewport().children, []);
    assert.deepEqual(viewport().props.style, style);
    for (const state of [
      [false, true],
      [true, false],
    ]) {
      act(() => tree.update(render(...state)));
      assert.equal(tree.root.findAllByType('input').length, 0);
      assert.equal(tree.root.findAllByType('button').length, 0);
    }
    act(() => tree.update(render(true)));
    open();
    assert.equal(tree.root.findByType('input').props.value, '');
    assert.equal(viewport(), original);
  } finally {
    act(() => tree.unmount());
  }
});
