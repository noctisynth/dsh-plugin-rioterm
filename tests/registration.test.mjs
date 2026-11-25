import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import TestRenderer from 'react-test-renderer';

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
  runInNewContext(script, {
    TextEncoder,
    TextDecoder,
    ...(document ? { document } : {}),
    AbortController,
    setTimeout,
    clearTimeout,
    crypto: webcrypto,
    localStorage: { length: 0, getItem: () => null },
    window: {
      __ModuleLoader__: { load: (entry) => registrations.push(entry) },
    },
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, manifest.name);
  return { manifest, factory: registrations[0].factory };
}
test('the client registers lazily under the published package name', async () => {
  const { factory } = await loadBundle();
  const requested = new Set();
  const client = factory((name) => {
    assert.equal(name, 'react');
    requested.add(name);
    return {};
  });
  assert.deepEqual([...requested], ['react']);
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
  const client = factory((name) => {
    assert.equal(name, 'react');
    return React;
  });
  assert.equal(styles.size, 1); // Merely loading or materializing the factory installs nothing.
  const noop = () => {};
  const slots = new Map();
  const tabTypes = [];
  const closeHandlers = [];
  const disposers = [];
  const operations = [];
  let form = { status: 'loading', writable: false };
  const listeners = new Set();
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
          mutate: () => assert.fail('opening the settings page must not write'),
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
    locale: { register: () => noop, bind: () => (key) => key },
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
    let settingsView;
    TestRenderer.act(() => {
      settingsView = TestRenderer.create(
        React.createElement(settings.render, {
          ...settings.def.inject(),
          view: 'page',
          t: (key) => key,
        }),
      );
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
        settingsView.root.findByProps({ role: 'status' }).children.join('');
      const locked = () =>
        settingsView.root.findByType('fieldset').props.disabled;
      const save = () =>
        settingsView.root
          .findAllByType('button')
          .find((node) => node.children.join('') === 'save');
      assert.equal(status(), 'loading');
      assert.equal(locked(), true);
      assert.equal(save().props.disabled, true);
      publish({ status: 'unavailable', writable: false });
      assert.equal(status(), 'unavailable');
      assert.equal(locked(), true);
      assert.equal(save().props.disabled, true);
      publish({
        status: 'ready',
        writable: true,
        revision: 1,
        user: {},
        value: {},
      });
      assert.equal(locked(), false);
      const fontSize = settingsView.root
        .findAllByType('input')
        .find((node) => node.props.name === 'fontSize');
      TestRenderer.act(() =>
        fontSize.props.onChange({ currentTarget: { value: '17' } }),
      );
      assert.equal(save().props.disabled, false);
      publish({ status: 'unavailable', writable: false });
      assert.equal(save().props.disabled, true);
      assert.equal(fontSize.props.value, '17'); // The page and its unsaved draft stay mounted.
      assert.deepEqual(operations, []); // Visiting the bundle never probes a shell.
    } finally {
      TestRenderer.act(() => settingsView.unmount());
      assert.equal(listeners.size, 0);
    }
    const slot = slots.get('sidebar.right.tab.guide.entry');
    assert.equal(slot.def.key, manifest.name);
    const opened = [];
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
    const page = body.render({
      ...services,
      t: (key) => key,
      useTabInfo: () => ({
        tab: { contentId: 'rio-1', visible: false, navigation: opts },
      }),
    });
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
  assert.deepEqual([...styles], [foreign]);
  assert.deepEqual(operations, []);
});
