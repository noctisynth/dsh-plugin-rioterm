import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mountTerminalView } from '../src/pages/terminal/terminal-mount.ts';
import { beginAutoFocus } from '../src/rio/keyboard-input.ts';
import { ResourceError } from '../src/rio/wasm-loader.ts';

// Exercise the same page lifecycle with deferred ports, not a mock React renderer or a real PTY.
function fixture({ knownIdentity = true, autoFocus = true } = {}) {
  const events = [];
  const engine = Promise.withResolvers();
  const environment = Promise.withResolvers();
  const tab = { visible: true, active: true };
  const requests = [];
  const preferences = { autoFocus };
  let bindings;
  let panel;
  const options = {
    ticket: 'launch-once',
    tabState: () => tab,
    beginAutoFocus() {
      if (!preferences.autoFocus) return;
      const request = new AbortController();
      requests.push(request);
      return request;
    },
    onState: (state) => events.push(['state', state]),
    loadEngine: () => {
      events.push('load');
      return engine.promise;
    },
    session: {
      needsLaunch: () => false,
      environment(signal) {
        events.push('environment');
        signal.addEventListener('abort', () => events.push('aborted'));
        return environment.promise;
      },
      mount(ticket, limits, target) {
        panel = target;
        events.push(['mount', ticket, limits, target.visible]);
        return {
          reconnect() {
            events.push('reconnect');
            if (knownIdentity) target.status('reconnecting');
            return knownIdentity;
          },
          input: (...args) => events.push(['input', ...args]),
          resize: (...args) => events.push(['resize', ...args]),
          setVisible: (value) => events.push(['attachment visible', value]),
          detach: () => events.push('detach'),
        };
      },
    },
    createScreen(limits, input) {
      bindings = input;
      events.push(['screen', limits]);
      return {
        search(query, direction) {
          events.push(['search', query, direction]);
          return { index: 1, count: 3, truncated: false };
        },
        clearSearch: () => events.push('clear search'),
        focus: () => events.push('focus'),
        focusIfInteractive: () => events.push('autofocus'),
        setVisible: (value) => events.push(['screen visible', value]),
        setPreferences: (value) => events.push(['render preferences', value]),
        dispose: () => events.push('dispose'),
      };
    },
  };
  return {
    options,
    events,
    engine,
    environment,
    get input() {
      return bindings;
    },
    get panel() {
      return panel;
    },
    tab,
    preferences,
    requests,
  };
}

const loading = ['state', { status: 'loading' }];
test('an idle page does not download WASM, discover a shell or consume a launch ticket', () => {
  const f = fixture();
  f.options.session.needsLaunch = () => true;
  const view = mountTerminalView(f.options);
  view.retry();
  view.dispose();
  assert.deepEqual(f.events, [['state', { status: 'idle' }]]);
});

test('find navigates only the current local screen, even read-only, and never acquires input', async () => {
  const f = fixture({ autoFocus: false });
  const view = mountTerminalView(f.options);
  const empty = { index: 0, count: 0, truncated: false };
  assert.deepEqual(view.search('error', 'first'), empty);
  f.engine.resolve();
  f.environment.resolve({});
  await setImmediate();
  f.panel.status('readonly');
  f.events.length = 0;
  assert.deepEqual(view.search('error', 'next'), {
    index: 1,
    count: 3,
    truncated: false,
  });
  view.focusTerminal();
  f.tab.active = false; // A visible split is still allowed to display its output, not navigate another search.
  assert.deepEqual(view.search('error', 'previous'), empty);
  view.clearSearch();
  assert.deepEqual(f.events, [['search', 'error', 'next'], 'clear search']);
  view.dispose();
  f.tab.active = true;
  assert.deepEqual(view.search('error', 'refresh'), empty);
});

test('disposing during either async preflight cannot attach a stale page or report late failure', async () => {
  const before = fixture();
  const first = mountTerminalView(before.options);
  first.dispose();
  before.engine.resolve();
  await setImmediate();
  assert.deepEqual(before.events, [loading, 'load']);

  const after = fixture();
  const second = mountTerminalView(after.options);
  after.engine.resolve();
  await setImmediate();
  second.dispose();
  second.dispose();
  after.environment.reject(Error('late'));
  await setImmediate();
  assert.deepEqual(after.events, [loading, 'load', 'environment', 'aborted']);
});

test('one mount forwards visibility and input only to its attachment and releases it before the screen', async () => {
  const f = fixture();
  const view = mountTerminalView(f.options);
  const limits = {
    maxCols: 120,
    maxRows: 40,
    maxInputBytes: 128,
    maxBufferedBytes: 512,
    scrollback: 100,
  };
  f.tab.visible = false;
  view.syncTabState();
  f.engine.resolve();
  f.environment.resolve(limits);
  await setImmediate();
  assert.deepEqual(f.events.splice(0), [
    loading,
    'load',
    'environment',
    ['screen', limits],
    ['screen visible', false],
    ['mount', 'launch-once', limits, false],
  ]);
  view.setPreferences({ fontSize: 18 });
  assert.deepEqual(f.events.splice(0), [
    ['render preferences', { fontSize: 18 }],
  ]);
  f.tab.visible = true;
  view.syncTabState();
  f.panel.status('connected');
  f.input.input('你', true);
  f.input.resize(90, 30);
  assert.deepEqual(f.events.splice(0), [
    ['screen visible', true],
    ['attachment visible', true],
    ['state', { status: 'connected' }],
    ['input', '你', true],
    ['resize', 90, 30],
  ]);
  view.dispose();
  view.dispose();
  f.panel.status('failed');
  f.input.input('stale', true);
  f.tab.visible = true;
  view.syncTabState();
  assert.deepEqual(f.events, [
    'detach',
    ['screen visible', false],
    'dispose',
    'aborted',
  ]);
});

test('open and each actual selection focus once after the host pane handoff, including switches between visible splits', async () => {
  const f = fixture();
  const view = mountTerminalView(f.options);
  const count = () => f.events.filter((e) => e === 'autofocus').length;
  assert.equal(f.requests.length, 1); // Already listening, even before WASM.
  f.engine.resolve();
  f.environment.resolve({});
  await setImmediate();
  f.panel.status('opening');
  assert.equal(count(), 0);
  f.panel.status('connected');
  assert.equal(count(), 0); // DSH can focus its pane after committing the active tab.
  await Promise.resolve();
  assert.equal(count(), 1);
  assert.equal(f.requests[0].signal.aborted, true); // No permanent document listeners.
  for (const field of ['active', 'visible']) {
    f.tab[field] = false;
    view.syncTabState();
    f.tab[field] = true;
    view.syncTabState();
    view.syncTabState();
    view.setPreferences({ autoFocus: true, fontSize: 15 });
    f.panel.status('connected'); // Another state frame is not an activation.
    await Promise.resolve();
  }
  assert.equal(count(), 3);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(
    f.events.filter((e) => e[0] === 'attachment visible'),
    [
      ['attachment visible', false],
      ['attachment visible', true],
    ],
  ); // Merely selecting another split leaves this PTY visible.
  f.panel.status('reconnecting');
  f.panel.status('connected');
  await Promise.resolve();
  assert.equal(count(), 3);
  view.dispose();
});

test('a retained tab may still be inert during child layout; focus waits for the parent handoff without retrying later', async () => {
  for (const revealedBeforeHandoff of [true, false]) {
    const f = fixture();
    let inert = false;
    const container = {
      ownerDocument: {
        hidden: false,
        hasFocus: () => true,
        addEventListener() {},
      },
      closest: () => (inert ? {} : null),
    };
    f.options.beginAutoFocus = () => beginAutoFocus(container);
    const createScreen = f.options.createScreen;
    f.options.createScreen = (...args) => {
      const screen = createScreen(...args);
      const focus = screen.focusIfInteractive;
      // The real keyboard binding rechecks inert/visibility at this point.
      screen.focusIfInteractive = () => {
        if (!inert) focus();
      };
      return screen;
    };
    const view = mountTerminalView(f.options);
    const count = () => f.events.filter((e) => e === 'autofocus').length;
    f.engine.resolve();
    f.environment.resolve({});
    await setImmediate();
    f.panel.status('connected');
    await Promise.resolve();
    assert.equal(count(), 1, 'new tabs still receive their first focus');

    f.tab.active = false;
    f.tab.visible = false;
    view.syncTabState();
    inert = true; // DockKit retains the old tab's DOM with an inert host.
    f.tab.active = true;
    f.tab.visible = true;
    view.syncTabState(); // Rio child layout runs before DockKit parent layout.
    assert.equal(
      count(),
      1,
      'never focus synchronously into the old inert DOM',
    );
    if (revealedBeforeHandoff) inert = false; // Parent layout clears inert.
    await Promise.resolve();
    assert.equal(count(), revealedBeforeHandoff ? 2 : 1);

    inert = false;
    view.syncTabState();
    f.panel.status('connected');
    await Promise.resolve();
    assert.equal(count(), revealedBeforeHandoff ? 2 : 1, 'no late focus retry');
    f.panel.status('reconnecting');
    f.panel.status('connected');
    await Promise.resolve();
    assert.equal(
      count(),
      revealedBeforeHandoff ? 2 : 1,
      'reconnect never steals focus',
    );
    view.dispose();
  }
});

test('an interrupted activation never claims a later shell or reconnect, even on duplicate visible notifications', async () => {
  for (const mode of [
    'pre-WASM interaction',
    'snapshot wait interaction',
    'hidden',
    'unselected split',
    'disabled then enabled',
    'reconnecting',
    'readonly',
    'disposed',
  ]) {
    const f = fixture();
    const view = mountTerminalView(f.options);
    if (mode === 'pre-WASM interaction') f.requests[0].abort();
    f.engine.resolve();
    f.environment.resolve({});
    await setImmediate();
    if (mode === 'snapshot wait interaction') f.requests[0].abort();
    if (mode === 'hidden') f.tab.visible = false;
    if (mode === 'unselected split') f.tab.active = false;
    if (mode === 'disabled then enabled') {
      view.setPreferences({ autoFocus: false });
      view.setPreferences({ autoFocus: true });
    }
    if (mode === 'reconnecting' || mode === 'readonly') f.panel.status(mode);
    if (mode === 'disposed') view.dispose();
    view.syncTabState();
    view.syncTabState();
    f.panel.status('connected');
    await Promise.resolve();
    assert.equal(f.events.includes('autofocus'), false, mode);
    assert.equal(f.requests.length, 1, mode);
    assert.equal(f.requests[0].signal.aborted, true, mode);
    view.dispose();
  }
});

test('leaving a connected tab before the queued handoff cannot focus it or consume the next activation', async () => {
  const f = fixture();
  const view = mountTerminalView(f.options);
  f.engine.resolve();
  f.environment.resolve({});
  await setImmediate();
  f.panel.status('connected');
  f.tab.active = false;
  view.syncTabState();
  await Promise.resolve();
  assert.equal(f.events.includes('autofocus'), false);
  f.tab.active = true;
  view.syncTabState();
  f.tab.active = false;
  view.syncTabState();
  f.tab.active = true;
  view.syncTabState();
  await Promise.resolve();
  assert.equal(f.events.filter((e) => e === 'autofocus').length, 1);
  view.dispose();
});

test('enabling autofocus or restoring a background split waits for a new selection', async () => {
  for (const initiallyActive of [false, true]) {
    const f = fixture({ autoFocus: !initiallyActive });
    f.tab.active = initiallyActive;
    const view = mountTerminalView(f.options);
    f.engine.resolve();
    f.environment.resolve({});
    await setImmediate();
    f.panel.status('connected');
    f.preferences.autoFocus = true;
    view.setPreferences(f.preferences);
    view.syncTabState();
    await Promise.resolve();
    assert.equal(f.requests.length, 0);
    f.tab.active = false;
    view.syncTabState();
    f.tab.active = true;
    view.syncTabState();
    await Promise.resolve();
    assert.equal(f.events.includes('autofocus'), true);
    view.dispose();
  }
});

test('manual reconnect and takeover reuse the mounted screen and environment', async () => {
  const f = fixture();
  const view = mountTerminalView(f.options);
  f.engine.resolve();
  f.environment.resolve({});
  await setImmediate();
  const original = f.panel;
  for (const status of ['disconnected', 'readonly']) {
    original.status(status);
    f.events.length = 0;
    view.retry(true);
    view.retry(true); // stale click after recovery started
    await setImmediate();
    original.status('connected');
    f.input.input('x', true);
    assert.equal(f.panel, original);
    assert.deepEqual(f.events, [
      'reconnect',
      ['state', { status: 'reconnecting' }],
      'focus', // Immediately, never upon later connection.
      ['state', { status: 'connected' }],
      ['input', 'x', true],
    ]);
  }
  f.events.length = 0;
  original.status('reconnecting'); // Automatic recovery, even before the first auto-focus.
  original.status('connected');
  assert.deepEqual(f.events, [
    ['state', { status: 'reconnecting' }],
    ['state', { status: 'connected' }],
  ]);
  for (const status of ['missing', 'exited', 'failed']) {
    original.status(status);
    f.events.length = 0;
    view.retry();
    assert.deepEqual(f.events, []);
  }
  original.status('readonly');
  f.tab.visible = false;
  view.syncTabState();
  f.events.length = 0;
  view.retry(true);
  assert.deepEqual(f.events, []);
  view.dispose();
});

test('retry without a known identity fences the old screen and repeats only the original preflight', async () => {
  const f = fixture({ knownIdentity: false });
  const limits = {};
  const view = mountTerminalView(f.options);
  f.engine.resolve();
  f.environment.resolve(limits);
  await setImmediate();
  const oldPanel = f.panel;
  const oldInput = f.input;
  oldPanel.status('disconnected');
  f.events.length = 0;
  view.retry(true);
  await setImmediate();
  oldPanel.status('connected');
  oldInput.input('stale', true);
  assert.notEqual(f.panel, oldPanel);
  assert.deepEqual(f.events, [
    'reconnect',
    'detach',
    ['screen visible', false],
    'dispose',
    'aborted',
    loading,
    'load',
    'environment',
    ['screen', limits],
    ['screen visible', true],
    ['mount', 'launch-once', limits, true],
  ]);
  view.dispose();
});

test('resource retry reloads the engine and can finish the original launch', async () => {
  const f = fixture();
  f.options.loadEngine = async (reload) => {
    f.events.push(['load', reload]);
    if (!reload) throw new ResourceError('fetch');
  };
  const limits = {};
  f.environment.resolve(limits);
  const view = mountTerminalView(f.options);
  await setImmediate();
  assert.deepEqual(f.events.splice(0), [
    loading,
    ['load', false],
    ['state', { status: 'resourceFailed', detail: 'fetch' }],
  ]);
  view.retry();
  await setImmediate();
  assert.deepEqual(f.events, [
    loading,
    ['load', true],
    'environment',
    ['screen', limits],
    ['screen visible', true],
    ['mount', 'launch-once', limits, true],
  ]);
  view.dispose();
});

test('engine resource, instantiation and host errors keep their distinct recovery states', async () => {
  for (const [phase, error, status] of [
    ['engine', new ResourceError('resource'), 'resourceFailed'],
    ['engine', Error('compile'), 'wasmFailed'],
    ['environment', Error('host'), 'disconnected'],
  ]) {
    const f = fixture();
    const view = mountTerminalView(f.options);
    if (phase === 'environment') {
      f.engine.resolve();
      await setImmediate();
    }
    f[phase].reject(error);
    await setImmediate();
    assert.deepEqual(f.events.at(-1), [
      'state',
      { status, detail: error.message },
    ]);
    assert.equal(f.panel, undefined);
    if (status === 'wasmFailed') {
      f.events.length = 0;
      view.retry();
      await setImmediate();
      assert.deepEqual(f.events, []);
    }
    view.dispose();
  }
});
