import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import TestRenderer from 'react-test-renderer';

const hostModules = {
  react: React,
  'react-dom': ReactDOM,
  'react/jsx-runtime': JSXRuntime,
};
function hostRequire(name) {
  assert.ok(Object.hasOwn(hostModules, name), `unexpected external: ${name}`);
  return hostModules[name];
}
function choose(trigger, value) {
  for (let node = trigger.parent; node; node = node.parent) {
    if (typeof node.props.onValueChange === 'function') {
      node.props.onValueChange(value);
      return;
    }
  }
  assert.fail('missing Select value-change callback');
}

// DSH loads this as a classic script. Evaluating it must only register a
// factory, without touching React, initializing WASM, or making requests.
async function loadBundle(document) {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const script = await readFile(
    new URL(`../${manifest.exports['./client']}`, import.meta.url),
    'utf8',
  );
  const registrations = [];
  const globals = {
    TextEncoder,
    TextDecoder,
    HTMLFormElement: class HTMLFormElement {},
    AbortController,
    setTimeout,
    clearTimeout,
    crypto: webcrypto,
    localStorage: { length: 0, getItem: () => null },
    window: {
      setTimeout,
      clearTimeout,
      __ModuleLoader__: { load: (entry) => registrations.push(entry) },
    },
  };
  runInNewContext(script, globals);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, manifest.name);
  return {
    manifest,
    factory(require) {
      // Materialize without a DOM: this suite tests configuration callbacks and
      // stylesheet ownership, not popup layout. Real DOM interaction lives in select-ui.test.mjs.
      const client = registrations[0].factory(require);
      if (document) globals.document = document;
      return client;
    },
  };
}
test('the client registers lazily under the published package name', async () => {
  const { factory } = await loadBundle();
  const requested = new Set();
  const client = factory((name) => {
    requested.add(name);
    return hostRequire(name); // Definitions may use forwardRef; the factory mounts nothing.
  });
  assert.deepEqual([...requested].sort(), [
    'react',
    'react-dom',
    'react/jsx-runtime',
  ]);
  assert.equal(typeof client.apply, 'function');
});

test('loading the built plugin leaves existing terminals untouched; only its guide button issues a Rio launch ticket', async () => {
  // Only model the stylesheet ownership port; no browser or live DSH session is touched.
  const foreign = { dataset: { plugin: 'other-plugin' } };
  const styles = new Set([foreign]);
  const document = {
    createElement(name) {
      assert.equal(name, 'style');
      const node = {
        dataset: {},
        textContent: '',
        remove: () => styles.delete(node),
      };
      return node;
    },
    head: { appendChild: (node) => styles.add(node) },
  };
  const { factory, manifest } = await loadBundle(document);
  const client = factory(hostRequire);
  assert.equal(styles.size, 1); // Merely loading or materializing the factory installs nothing.
  const noop = () => {};
  const slots = new Map();
  const locales = new Map();
  const tabTypes = [];
  const closeHandlers = [];
  const disposers = [];
  const operations = [];
  let form = { status: 'loading', writable: false };
  const listeners = new Set();
  const writes = [];
  let nextWriteGate;
  const publish = (snapshot) =>
    TestRenderer.act(() => {
      form = snapshot;
      for (const notify of listeners) notify();
    });
  const hostTheme = {
    revision: 0,
    fontSizes: { terminal: 13 },
    fontFamilies: { terminal: '"Host Mono"' },
  };
  client.apply({
    effect: (fn) => disposers.push(fn()),
    configForms: {
      get: (entryId) => {
        assert.equal(entryId, manifest.name);
        return {
          getSnapshot: () => form,
          subscribe: (notify) => {
            listeners.add(notify);
            return () => listeners.delete(notify);
          },
          mutate: async (ops, revision) => {
            assert.equal(revision, form.revision);
            writes.push(structuredClone(ops));
            if (nextWriteGate) {
              const gate = nextWriteGate;
              nextWriteGate = undefined;
              await gate;
            }
            // DSH can accept an override equal to the inherited configuration without
            // creating a personal entry or advancing the effective-config revision.
            if (
              ops.length === 1 &&
              ops[0].op === 'set' &&
              ops[0].path[0] === 'fontSize' &&
              ops[0].value === form.base.fontSize
            )
              return true;
            const user = { ...form.user };
            for (const op of ops) {
              if (op.op === 'set') user[op.path[0]] = op.value;
              else delete user[op.path[0]];
            }
            form = { ...form, revision: revision + 1, user, value: user };
            for (const notify of listeners) notify();
            return true;
          },
        };
      },
      // No namespace is advertised when the detail page is first opened.
      whileServed: () => noop,
    },
    theme: {
      getTheme: () => hostTheme,
    },
    on: () => noop,
    remote: {
      terminal: new Proxy(
        {},
        {
          get: (_, name) => {
            operations.push(name);
            throw Error('Unexpected terminal operation');
          },
        },
      ),
    },
    locale: {
      register: (namespace, messages) => {
        locales.set(namespace, messages);
        return () => locales.delete(namespace);
      },
      bind: () => (key) => key,
    },
    slots: {
      inject: (_name, register) => register(),
      register: (def, render) => {
        slots.set(def.name, { def, render });
        return noop;
      },
    },
    sidebarRightTabs: {
      register: (def) => {
        tabTypes.push(def);
        return noop;
      },
    },
    sidebarRight: {
      active: () => ({ id: 'focused-occurrence' }),
      registerCloseHandler: (kind) => {
        closeHandlers.push(kind);
        return noop;
      },
      openTabs: {
        subscribe: () => noop,
        getSnapshot: () => [
          { sessionId: 's', kind: 'terminal', contentId: 'default-shell' },
          { sessionId: 's', kind: 'rio-wasm-demo', contentId: 'old-preview' },
        ],
      },
    },
  });
  try {
    assert.deepEqual(
      tabTypes.map((tab) => tab.kind),
      ['rio-terminal'],
    );
    assert.deepEqual(closeHandlers, ['rio-terminal']);
    const settings = slots.get('plugins.bundle.config');
    assert.equal(settings?.def.key, manifest.name);
    const messages = locales.get(settings.def.locale);
    const t = (key) => {
      assert.ok(messages.en[key], `missing English settings copy: ${key}`);
      assert.ok(messages.zh[key], `missing Chinese settings copy: ${key}`);
      return messages.zh[key];
    };
    const openSettings = () =>
      TestRenderer.create(
        React.createElement(settings.render, {
          ...settings.def.inject(),
          view: 'page',
          t,
        }),
      );
    let settingsView;
    TestRenderer.act(() => {
      settingsView = openSettings();
    });
    try {
      assert.equal(
        settingsView.root.findAll(
          (n) =>
            typeof n.type === 'string' &&
            n.props['data-rio-ui'] === 'preferences',
        ).length,
        1,
      );
      const status = () =>
        settingsView.root.findByProps({ role: 'status' }).props['aria-label'];
      const locked = () =>
        settingsView.root.findByType('fieldset').props.disabled;
      assert.equal(status(), t('loading'));
      assert.equal(locked(), true);
      publish({ status: 'unavailable', writable: false });
      assert.equal(status(), t('unavailable'));
      assert.equal(locked(), true);
      publish({
        status: 'ready',
        writable: true,
        revision: 1,
        base: { fontSize: 20 },
        user: {},
        value: { fontSize: 20 },
      });
      assert.equal(locked(), false);
      assert.deepEqual(writes, []); // Opening the page, even across Host events, never writes.
      const preset = settingsView.root
        .findAll(
          (node) => node.type === 'button' && node.props.role === 'combobox',
        )
        .find((node) => node.props.name === 'ansiPreset');
      const fontSize = settingsView.root
        .findAllByType('input')
        .find((node) => node.props.name === 'fontSize');
      await TestRenderer.act(async () => {
        fontSize.props.onChange({ currentTarget: { value: '20' } });
        fontSize.props.onBlur();
      });
      assert.equal(form.revision, 1);
      assert.deepEqual(form.user, {});
      await TestRenderer.act(async () => {
        choose(preset, 'dsh');
      });
      assert.deepEqual(writes, [
        [{ op: 'set', path: ['fontSize'], value: 20 }],
        [{ op: 'set', path: ['ansiPreset'], value: 'dsh' }],
      ]);
      // A second immediate choice queued behind an RPC must survive leaving the page.
      let release;
      nextWriteGate = new Promise((resolve) => {
        release = resolve;
      });
      const renderer = settingsView.root
        .findAll(
          (node) => node.type === 'button' && node.props.role === 'combobox',
        )
        .find((node) => node.props.name === 'renderer');
      TestRenderer.act(() => {
        choose(preset, 'rio');
        choose(renderer, 'canvas');
      });
      assert.equal(writes.length, 3);
      TestRenderer.act(() => settingsView.unmount());
      await TestRenderer.act(async () => {
        release();
      });
      assert.deepEqual(writes[3], [
        { op: 'set', path: ['renderer'], value: 'canvas' },
      ]);
      TestRenderer.act(() => {
        settingsView = openSettings();
      });
      const bold = settingsView.root
        .findAll(
          (node) => node.type === 'button' && node.props.role === 'combobox',
        )
        .find((node) => node.props.name === 'boldBright');
      assert.equal(bold.props.value, 'auto');
      await TestRenderer.act(async () => {
        choose(bold, 'always');
      });
      assert.deepEqual(writes[4], [
        { op: 'set', path: ['boldBright'], value: 'always' },
      ]);
      const reopenedFont = settingsView.root
        .findAllByType('input')
        .find((node) => node.props.name === 'fontSize');
      TestRenderer.act(() =>
        reopenedFont.props.onChange({ currentTarget: { value: '17' } }),
      );
      assert.equal(writes.length, 5); // Typing a valid number doesn't immediately mutate the host.
      publish({ status: 'unavailable', writable: false });
      assert.equal(locked(), true);
      assert.equal(reopenedFont.props.value, '17'); // The page and its unsaved draft stay mounted.
      assert.deepEqual(operations, []); // Visiting the bundle never probes a shell.
    } finally {
      TestRenderer.act(() => settingsView.unmount());
      assert.equal(listeners.size, 1); // The window owns the queue until the plugin is disposed.
    }
    const slot = slots.get('sidebar.right.tab.guide.entry');
    assert.equal(slot.def.key, manifest.name);
    const opened = [];
    const titleSlot = slots.get('sidebar.right.pane.tab.title');
    assert.equal(titleSlot.def.key, tabTypes[0].id);
    const titleView = TestRenderer.create(
      React.createElement(titleSlot.render, {
        useTabInfo: () => ({ tab: { title: 'Rio 终端' } }),
      }),
    );
    try {
      const icon = titleView.root.findByType(tabTypes[0].guide[0].icon);
      assert.equal(icon.props.size, 16);
      assert.deepEqual(
        titleView.root.findByProps({ 'data-rio-ui': 'tab-title' }).children,
        ['Rio 终端'],
      );
      assert.deepEqual(titleView.root.findAllByType('button'), []);
      assert.deepEqual(operations, []);
    } finally {
      titleView.unmount();
    }
    const guide = slot.render({
      ...slot.def.inject('s'),
      title: 'Rio',
      useTabInfo: () => ({
        tab: { actions: { openTab: (...args) => opened.push(args) } },
      }),
    });
    assert.equal(guide.props.title, 'Rio');
    const guideView = TestRenderer.create(guide);
    try {
      const button = guideView.root.findByType('button');
      assert.equal(button.findByType(tabTypes[0].guide[0].icon).props.size, 22);
      assert.equal(opened.length, 0);
      button.props.onClick();
    } finally {
      guideView.unmount();
    }
    assert.equal(opened.length, 1);
    const [[kind, opts]] = opened;
    assert.equal(kind, 'rio-terminal');
    assert.equal(opts.replaceTab, true);
    assert.deepEqual(Object.keys(opts.params), ['rioLaunch']);
    assert.match(opts.params.rioLaunch, /^[0-9a-f-]{36}$/i);
    // The sidebar owns tab identity/navigation; pages see only a session and actions.
    const body = slots.get('sidebar.right.pane.tab');
    const services = body.def.inject('s');
    const renderOccurrence = (id, visible) =>
      body.render({
        ...services,
        t: (key) => key,
        useTabInfo: () => ({
          tab: { id, contentId: 'rio-1', visible, navigation: opts },
        }),
      });
    const page = renderOccurrence('focused-occurrence', false);
    assert.equal(page.props.active, false);
    const splitSibling = renderOccurrence('another-occurrence', true);
    assert.equal(splitSibling.props.visible, true);
    assert.equal(splitSibling.props.active, false);
    assert.equal(
      renderOccurrence('focused-occurrence', true).props.active,
      true,
    );
    assert.equal(page.key, 'rio-1');
    assert.equal(page.props.launchTicket, opts.params.rioLaunch);
    assert.equal(page.props.visible, false);
    assert.equal(page.props.session, services.session('rio-1'));
    for (const action of ['close', 'dispose', 'retain']) {
      assert.equal(action in page.props.session, false);
    }
    assert.equal('tab' in page.props || 'useTabInfo' in page.props, false);
    assert.equal('session' in slot.def.inject('s'), false);
    assert.equal(styles.size, 2);
    const [sheet] = [...styles].filter((node) => node !== foreign);
    assert.equal(sheet.dataset.plugin, manifest.name);
    assert.equal(sheet.dataset.pluginCss, `${manifest.name}/terminal-ui`);
    assert.match(sheet.textContent, /@scope\s*\(\[data-rio-ui\]\)/);
    assert.ok(sheet.textContent.includes('.rio\\:absolute'));
    assert.doesNotMatch(
      sheet.textContent,
      /:root|:host|--tw-|@import|@font-face/,
    );
    assert.equal(opened.length, 1);
  } finally {
    for (const dispose of disposers.reverse()) dispose();
  }
  assert.equal(listeners.size, 0);
  assert.deepEqual([...styles], [foreign]);
  assert.deepEqual(operations, []);
});
