import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mountTerminalView } from '../src/pages/terminal/terminal-mount.ts';
import { ResourceError } from '../src/rio/wasm-loader.ts';

// Exercise the same page lifecycle with deferred ports, not a mock React renderer or a real PTY.
function fixture({ knownIdentity = true } = {}) {
  const events = [];
  const engine = Promise.withResolvers();
  const environment = Promise.withResolvers();
  let visible = true;
  let bindings;
  let panel;
  const options = {
    ticket: 'launch-once',
    isVisible: () => visible,
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
        focus: () => events.push('focus'),
        cancelAutoFocus: () => events.push('cancel autofocus'),
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
    hide() {
      visible = false;
    },
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
  f.hide();
  view.setVisible(false);
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
  view.setVisible(true);
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
  view.setVisible(true);
  assert.deepEqual(f.events, [
    'detach',
    ['screen visible', false],
    'dispose',
    'aborted',
  ]);
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
      'cancel autofocus',
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
    'cancel autofocus',
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
  f.hide();
  view.setVisible(false);
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
