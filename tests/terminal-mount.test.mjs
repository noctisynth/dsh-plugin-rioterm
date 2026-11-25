import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { mountTerminalView } from '../src/pages/terminal/terminal-mount.ts';
import { ResourceError } from '../src/rio/wasm-loader.ts';

// Exercise the same page lifecycle with deferred ports, not a mock React renderer or a real PTY.
function fixture() {
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
        setVisible: (value) => events.push(['screen visible', value]),
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
  assert.equal(mountTerminalView(f.options), undefined);
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
    view.dispose();
  }
});
