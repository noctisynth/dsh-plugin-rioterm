import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// DSH loads this as a classic script. Evaluating it must only register a
// factory, without touching React, initializing WASM, or making requests.
async function loadBundle() {
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
  const { factory, manifest } = await loadBundle();
  const client = factory(() => ({
    createElement: (type, props) => ({ type, props }),
  }));
  const noop = () => {};
  const slots = new Map();
  const tabTypes = [];
  const closeHandlers = [];
  const disposers = [];
  const operations = [];
  client.apply({
    effect: (fn) => disposers.push(fn()),
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
    const slot = slots.get('sidebar.right.tab.guide.entry');
    assert.equal(slot.def.key, manifest.name);
    const opened = [];
    const button = slot.render({
      ...slot.def.inject('s'),
      title: 'Rio',
      useTabInfo: () => ({
        tab: { actions: { openTab: (...args) => opened.push(args) } },
      }),
    });
    assert.equal(button.type, 'button');
    assert.equal(opened.length, 0);
    button.props.onClick();
    assert.equal(opened.length, 1);
    const [[kind, opts]] = opened;
    assert.equal(kind, 'rio-terminal');
    assert.equal(opts.replaceTab, true);
    assert.deepEqual(Object.keys(opts.params), ['rioLaunch']);
    assert.match(opts.params.rioLaunch, /^[0-9a-f-]{36}$/i);
  } finally {
    for (const dispose of disposers.reverse()) dispose();
  }
  assert.deepEqual(operations, []);
});
