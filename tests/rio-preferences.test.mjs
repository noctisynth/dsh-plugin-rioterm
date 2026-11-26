import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import {
  handleKeyboardEvent,
  initWasm,
  PredictionEngine,
  Terminal,
} from 'rioterm';
import { defaultEffectivePreferences as defaults } from '../src/preferences/values.ts';
import { RioTerminal } from '../src/rio/terminal.ts';
import { RioViewport } from '../src/rio/viewport.ts';

before(async () =>
  initWasm(
    await readFile(
      new URL('../wasm/librio_wasm_bg.wasm', import.meta.resolve('rioterm')),
    ),
  ),
);
const key = (key, extra = {}) => ({
  type: 'keydown',
  key,
  code: `Key${key.toUpperCase()}`,
  ...extra,
});
function coreFixture(t, preferences = defaults) {
  const inputs = [],
    sizes = [];
  const core = new RioTerminal({
    preferences,
    cols: 40,
    rows: 3,
    scrollback: 7,
    onInput: (...args) => inputs.push(args),
    onResize: (...args) => sizes.push(args),
  });
  t.after(() => core.dispose());
  return { core, inputs, sizes };
}

test('Alt default matches the unconfigured 0.1.8 WASM encoder; live and replacement cores use the chosen setting', (t) => {
  const native = new Terminal();
  t.after(() => native.dispose());
  const bytes = [];
  native.onData((chunk) => bytes.push([...chunk]));
  for (const flag of [undefined, false, true]) {
    if (flag !== undefined) native.setAltIsMeta(flag);
    handleKeyboardEvent(native, key('x', { altKey: true }));
  }
  assert.deepEqual(bytes, [[27, 120], [120], [27, 120]]);
  assert.equal(defaults.altIsMeta, true);
  const { core, inputs } = coreFixture(t);
  core.writable = true;
  core.key(key('x', { altKey: true }));
  core.setPreferences({ ...defaults, altIsMeta: false });
  core.key(key('x', { altKey: true }));
  core.snapshot(10, 4, 'replayed\x1b[6n');
  core.key(key('x', { altKey: true }));
  assert.deepEqual(inputs, [
    ['\x1bx', true],
    ['x', true],
    ['x', true],
  ]);
});

test('the current ring survives preference changes, fresh cores are capped by the host, PTY LF is never rewritten', (t) => {
  const { core, inputs } = coreFixture(t, { ...defaults, scrollback: 99999 });
  const data = Array.from({ length: 18 }, (_, i) => `row${i}`).join('\r\n');
  core.write(data);
  assert.equal(core.term.historySize(), 7);
  const original = core.term;
  core.setPreferences({ ...defaults, scrollback: 0, detectUrls: false });
  assert.equal(core.term, original);
  assert.equal(core.term.historySize(), 7);
  core.snapshot(37, 3, data);
  assert.notEqual(core.term, original);
  assert.equal(core.term.historySize(), 0);
  assert.equal(core.term.options.detectUrls, false);
  core.setPreferences({ ...defaults, scrollback: 2 });
  core.snapshot(23, 3, data);
  assert.equal(core.term.historySize(), 2);
  core.setPreferences({ ...defaults, scrollback: undefined });
  core.snapshot(19, 4, 'ab\nc');
  assert.equal(core.term.textRow(1), '  c');
  assert.equal(core.term.options.scrollback, 7);
  assert.deepEqual([core.term.options.cols, core.term.options.rows], [19, 4]);
  assert.deepEqual(inputs, []);
});

test('only direct committed key frames reach a predictor, after the WASM borrow ends', (t) => {
  const { core, inputs } = coreFixture(t, {
    ...defaults,
    renderer: 'canvas',
    predictiveEcho: true,
  });
  const engine = new PredictionEngine(core.term, { latencyThreshold: 0 });
  const predictions = [];
  const predict = (bytes) => {
    engine.onInput(bytes);
    predictions.push([...bytes]);
  };
  core.writable = true;
  assert.equal(core.key(key('k'), predict), true);
  assert.equal(engine.overlay(core.term.snapshot()).cells[0].codepoint, 107); // Raw upstream overlay, not the masked plugin paint.
  core.write('\x1b[6n');
  core.text('paste', true);
  core.text('中文');
  core.key(key('i', { isComposing: true }), predict);
  core.key(key('i', { keyCode: 229 }), predict);
  core.visible = false;
  core.key(key('i'), predict);
  core.visible = true;
  core.writable = false;
  core.key(key('i'), predict);
  core.writable = true;
  core.setPreferences({
    ...defaults,
    renderer: 'canvas',
    predictiveEcho: false,
  });
  core.key(key('x'), predict);
  assert.deepEqual(predictions, [[107]]);
  assert.deepEqual(inputs, [
    ['k', true],
    ['\x1b[1;1R', false],
    ['paste', true],
    ['中文', true],
    ['x', true],
  ]);
});

// Drive RioViewport's measured-renderer and animation-frame ports, not a mock browser or pixel renderer.
function viewport(t, preferences = defaults) {
  const fixture = coreFixture(t, preferences);
  const { core } = fixture;
  const mounted = [],
    events = [],
    frames = new Set();
  let ratio = 1;
  const view = new RioViewport(core, preferences, {
    mount(term, p) {
      const cellWidth = p.fontSize * ratio,
        cellHeight = p.fontSize * p.lineHeight;
      term.setCellSize(cellWidth, cellHeight); // Same public API that each upstream renderer calls.
      const index = mounted.length;
      mounted.push({ term, p });
      events.push(`mount ${index}`);
      return {
        cellWidth,
        cellHeight,
        dispose() {
          events.push(`dispose ${index}`);
        },
      };
    },
    box: () => ({ width: 400, height: 200 }),
    metricsChanged: () => events.push('metrics'),
    nextFrame(run) {
      frames.add(run);
      return () => frames.delete(run);
    },
  });
  t.after(() => view.dispose());
  return {
    ...fixture,
    view,
    mounted,
    events,
    frames,
    metric(value) {
      ratio = value;
    },
    paint() {
      for (const f of [...frames]) {
        frames.delete(f);
        f();
      }
    },
  };
}

test('view changes and late fonts preserve the parsed grid, scroll position, selection and partial VT state', (t) => {
  const p = {
    ...defaults,
    fontFamily: '"Fixture Mono", monospace',
    fontSize: 10,
    lineHeight: 2,
    theme: { foreground: '#cccccc', palette: Array(16).fill('#125987') },
  };
  const { core, inputs, sizes, view, mounted, events, metric } = viewport(t, p);
  core.writable = true;
  core.write('zero\r\none\r\ntwo\r\nthree\r\nfour\r\nfive');
  core.term.scrollLines(1);
  core.term.selectionBegin(0, 0);
  core.term.selectionUpdate(1, 1, true);
  const original = core.term;
  const state = () => [
    core.term.dump(),
    core.term.historySize(),
    core.term.displayOffset(),
    core.term.getSelection(),
    core.term.options.cols,
    core.term.options.rows,
  ];
  const previous = state();
  core.write('\x1b[');
  const equivalent = {
    ...p,
    themeRevision: 20,
    scrollback: 0,
    altIsMeta: false,
    detectUrls: false,
    predictiveEcho: true,
    cursorStyle: 'bar',
    theme: { ...p.theme, palette: [...p.theme.palette] },
  };
  view.setPreferences(equivalent);
  assert.equal(mounted.length, 1); // Core-only, Canvas-only, host palette revision and equal theme fields.
  view.setPreferences({
    ...equivalent,
    theme: { ...equivalent.theme, selectionForeground: '#112233' },
  });
  assert.deepEqual(events, ['mount 0', 'mount 1', 'dispose 0']);
  assert.deepEqual(sizes, []); // No resize traffic for a recolor with the same metrics.
  view.fontsLoaded([{ family: 'Unrelated' }]);
  assert.equal(mounted.length, 2);
  metric(2);
  view.fontsLoaded([{ family: "'fixture mono'" }]);
  assert.equal(mounted.length, 3);
  assert.deepEqual(sizes, [[20, 10]]);
  view.setPreferences({ ...equivalent, fontSize: 20, lineHeight: 1.25 });
  assert.deepEqual(sizes, [
    [20, 10],
    [10, 8],
  ]);
  assert.equal(core.term, original);
  assert.deepEqual(state(), previous);
  core.write('6n'); // Changing fonts did not drop the unfinished ESC [.
  assert.deepEqual(inputs, [['\x1b[3;5R', false]]);
  assert.equal(
    mounted.every((m) => m.term === original),
    true,
  );
});

for (const renderer of ['dom', 'canvas']) {
  test(`${renderer} search icon visibility never rebuilds the screen or sends terminal traffic`, (t) => {
    const p = { ...defaults, renderer };
    const { view, mounted, sizes, inputs, core } = viewport(t, p);
    core.writable = true;
    core.write('retained output');
    const original = core.term;
    const output = core.term.dump();
    view.setPreferences({ ...p, searchIconAlwaysVisible: true });
    view.setPreferences({ ...p, searchIconAlwaysVisible: false });
    assert.equal(mounted.length, 1);
    assert.ok(core.term === original);
    assert.equal(core.term.dump(), output);
    assert.deepEqual(sizes, []);
    assert.deepEqual(inputs, []);
  });
  test(`${renderer} repaints effective ANSI changes without replacing the grid or proposing a resize`, (t) => {
    const p = { ...defaults, renderer };
    const { view, mounted, sizes, inputs, core } = viewport(t, p);
    core.writable = true;
    core.write('same grid\x1b[');
    view.setPreferences({ ...p, boldBright: 'never' }); // Equivalent to auto for Rio.
    view.setPreferences({ ...p, boldBright: 'always' });
    view.setPreferences({ ...p, ansiPreset: 'dsh' });
    view.setPreferences({ ...p, ansiPreset: 'dsh', boldBright: 'always' }); // Equivalent to DSH auto.
    view.setPreferences({ ...p, ansiPreset: 'dsh', boldBright: 'never' });
    view.setPreferences(p);
    assert.deepEqual(
      mounted.map(({ p }) => [p.ansiPreset, p.boldBright]),
      [
        ['rio', 'auto'],
        ['rio', 'always'],
        ['dsh', 'auto'],
        ['dsh', 'never'],
        ['rio', 'auto'],
      ],
    );
    assert.ok(mounted.every(({ term }) => term === core.term));
    assert.deepEqual(sizes, []);
    core.write('6n');
    assert.deepEqual(inputs, [['\x1b[1;10R', false]]);
  });
}

test('fit can stop and resume without resizing locally or letting a hidden/readonly view propose', (t) => {
  const p = { ...defaults, fontSize: 10, lineHeight: 2, fit: false };
  const { core, view, sizes } = viewport(t, p);
  core.writable = true;
  view.fit();
  core.fit(400, 200, 10, 20);
  core.resize(53, 4);
  core.write('\x1b[4;53H!');
  assert.deepEqual(sizes, []);
  core.visible = false;
  view.setPreferences({ ...p, fit: true });
  core.visible = true;
  core.writable = false;
  view.fit();
  view.setPreferences({ ...p, fontSize: 20 });
  view.setPreferences({ ...p, fontSize: 20, fit: true });
  assert.deepEqual(sizes, []);
  core.writable = true;
  view.setPreferences(p);
  view.setPreferences({ ...p, fit: true });
  assert.deepEqual(sizes, [[40, 10]]);
  assert.equal(core.term.options.cols, 53);
  assert.equal(core.term.textRow(3).at(-1), '!');
});

test('Canvas reads the latest host theme after the frame, coalesces edits and cancels work on disposal/DOM switch', (t) => {
  const p = { ...defaults, renderer: 'canvas' };
  const { view, frames, mounted, paint, core } = viewport(t, p);
  view.setPreferences({ ...p, latencyThreshold: 91, predictionStyle: 'dim' });
  assert.equal(mounted.length, 1); // Predictor is off.
  view.setPreferences({ ...p, themeRevision: 1 });
  view.setPreferences({
    ...p,
    themeRevision: 2,
    altIsMeta: false,
    fontSize: 18,
  });
  assert.equal(frames.size, 1);
  assert.equal(mounted.length, 1);
  paint();
  assert.equal(mounted.at(-1).p.themeRevision, 2);
  assert.equal(mounted.at(-1).p.fontSize, 18);
  view.setPreferences({ ...p, themeRevision: 3 });
  view.setPreferences({ ...p, renderer: 'dom', themeRevision: 4 });
  assert.equal(frames.size, 0);
  assert.equal(mounted.at(-1).p.renderer, 'dom');
  view.pixelRatioChanged();
  assert.equal(mounted.length, 3); // No DOM rebuild for a Canvas backing-store change.
  view.setPreferences({ ...p, themeRevision: 5 });
  core.snapshot(35, 3, 'new snapshot');
  view.rebind();
  assert.equal(mounted.at(-1).term, core.term);
  view.dispose();
  assert.equal(frames.size, 0);
  const count = mounted.length;
  view.fontsLoaded([]);
  view.setPreferences(p);
  view.pixelRatioChanged();
  paint();
  assert.equal(mounted.length, count);
});
