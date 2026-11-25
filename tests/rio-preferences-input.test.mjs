import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { initWasm } from 'rioterm';
import { defaultEffectivePreferences as defaults } from '../src/preferences/values.ts';
import { bindKeyboardInput } from '../src/rio/keyboard-input.ts';
import { bindPointerInput } from '../src/rio/pointer-input.ts';
import { RioTerminal } from '../src/rio/terminal.ts';

before(async () =>
  initWasm(
    await readFile(
      new URL('../wasm/librio_wasm_bg.wasm', import.meta.resolve('rioterm')),
    ),
  ),
);

// Handler ports only: never a synthetic trusted browser action, network open, clipboard or DOM paint.
function events() {
  const handlers = new Map();
  return {
    addEventListener(type, listener, options = {}) {
      handlers.set(type, { listener, options });
    },
    fire(type, values = {}) {
      const handler = handlers.get(type);
      if (!handler || handler.options.signal?.aborted) return;
      if (handler.options.once) handlers.delete(type);
      handler.listener({
        type,
        preventDefault() {},
        stopPropagation() {},
        ...values,
      });
    },
  };
}
function coreFor(t, preferences = defaults) {
  const writes = [];
  const core = new RioTerminal({
    cols: 48,
    rows: 6,
    preferences,
    onInput: (...args) => writes.push(args),
    onResize: assert.fail,
  });
  t.after(() => core.dispose());
  return { core, writes };
}
function pointerFixture(t) {
  const { core, writes } = coreFor(t);
  const prompts = [],
    opened = [],
    hover = [];
  let permitted = true;
  const win = {
    confirm(message) {
      prompts.push(message);
      return permitted;
    },
    open: (...args) => opened.push(args),
  };
  const root = {
    ...events(),
    ownerDocument: { defaultView: win },
    removeAttribute() {},
    setPointerCapture() {},
  };
  const view = {
    cellWidth: 10,
    cellHeight: 10,
    element: {
      style: {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 600,
        height: 120,
      }),
    },
    cellAt: (x, y) => ({
      row: Math.max(0, Math.min(5, Math.floor(y / 10))),
      col: Math.max(0, Math.min(47, Math.floor(x / 10))),
      sideRight: false,
    }),
    setHoverLink: (run) => hover.push(run),
    resetPredictions() {},
  };
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const pointer = bindPointerInput(
    root,
    core,
    () => view,
    () => {},
    lifetime.signal,
    'Open destination?',
  );
  const event = (type, row, extra = {}) =>
    root.fire(type, {
      pointerId: 1,
      isTrusted: true,
      button: 0,
      pointerType: 'mouse',
      ctrlKey: true,
      clientX: 3,
      clientY: row * 10 + 2,
      ...extra,
    });
  const click = (row, extra = {}) => {
    event('pointerdown', row, extra);
    event('pointerup', row, extra);
    root.fire('lostpointercapture');
  };
  const osc = (url, label) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
  core.write(
    [
      'https://visible.invalid/path',
      'mailto:a@example.invalid',
      'http://example.invalid/path',
      osc('javascript:alert(1)', 'program label'),
      osc('file:///example', 'other label'),
      osc('https://actual.invalid/dst', 'https://pretend.invalid/'),
    ].join('\r\n'),
  );
  return {
    core,
    writes,
    event,
    click,
    opened,
    prompts,
    hover,
    lifetime,
    pointer,
    permit(value) {
      permitted = value;
    },
  };
}

test('safe links require a trusted Ctrl/Cmd click and explicit confirmation of the actual URI; detection controls only plain URLs', (t) => {
  const { core, writes, event, click, opened, prompts, hover, permit } =
    pointerFixture(t);
  assert.deepEqual(opened, []);
  event('pointermove', 0);
  assert.deepEqual(hover.at(-1), { line: 0, startCol: 0, endCol: 27 });
  assert.deepEqual(prompts, []);
  click(0, { ctrlKey: false });
  click(0, { isTrusted: false });
  click(0, { pointerType: 'touch' });
  click(0, { button: 1 });
  assert.deepEqual(prompts, []);
  permit(false);
  click(0);
  assert.deepEqual(prompts, [
    'Open destination?\n\nhttps://visible.invalid/path',
  ]);
  assert.deepEqual(opened, []);
  permit(true);
  click(0, { ctrlKey: false, metaKey: true });
  click(1);
  click(2);
  assert.deepEqual(
    opened.map(([url]) => url),
    [
      'https://visible.invalid/path',
      'mailto:a@example.invalid',
      'http://example.invalid/path',
    ],
  );
  const count = prompts.length;
  assert.equal(core.term.linkAt(3, 0).uri, 'javascript:alert(1)'); // The raw OSC link exists and was rejected by this plugin.
  click(3);
  click(4);
  assert.equal(prompts.length, count);
  core.setPreferences({ ...defaults, detectUrls: false });
  click(0);
  click(1);
  click(2);
  assert.equal(prompts.length, count);
  click(5);
  assert.equal(
    prompts.at(-1),
    'Open destination?\n\nhttps://actual.invalid/dst',
  );
  assert.deepEqual(opened.at(-1), [
    'https://actual.invalid/dst',
    '_blank',
    'noopener,noreferrer',
  ]);
  assert.ok(
    opened.every(
      (args) => args[1] === '_blank' && args[2] === 'noopener,noreferrer',
    ),
  );
  assert.deepEqual(writes, []); // Works on a readonly view without any PTY or attachment input.
});

test('drags, cancelled modifiers, stale/changed targets and points outside the viewport never open a destination', (t) => {
  const { core, event, click, opened, prompts, lifetime, pointer } =
    pointerFixture(t);
  event('pointerdown', 0);
  event('pointermove', 0, { clientX: 10 });
  event('pointerup', 0);
  event('pointerdown', 0);
  event('pointerup', 0, { ctrlKey: false });
  event('pointerdown', 0);
  event('pointerup', 0, { pointerId: 2 });
  event('pointerdown', 0);
  event('pointercancel', 0);
  event('pointerup', 0);
  event('pointerdown', 0);
  pointer.clearLinks();
  event('pointerup', 0);
  event('pointerdown', 0);
  core.write('\x1b[Hhttps://changed.invalid/path');
  event('pointerup', 0);
  click(7);
  core.visible = false;
  click(5);
  core.visible = true;
  lifetime.abort();
  click(5);
  assert.deepEqual(prompts, []);
  assert.deepEqual(opened, []);
});

function keyboardFixture(t, { autoFocus = true, occupied = false } = {}) {
  const { core, writes } = coreFor(t, {
    ...defaults,
    renderer: 'canvas',
    predictiveEcho: true,
  });
  const predicted = [];
  let resets = 0,
    focuses = 0;
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const input = {
    ...events(),
    style: {},
    setAttribute() {},
    focus(options) {
      assert.deepEqual(options, { preventScroll: true });
      focuses++;
    },
    blur() {},
  };
  const doc = {
    ...events(),
    defaultView: events(),
    body: {},
    hasFocus: () => true,
    hidden: false,
    createElement: () => input,
  };
  doc.activeElement = occupied ? {} : doc.body;
  const root = {
    ownerDocument: doc,
    append() {},
    getClientRects: () => [{}],
    closest: () => null,
    removeAttribute() {},
    toggleAttribute() {},
  };
  const view = {
    cellWidth: 9,
    cellHeight: 18,
    userInput: (bytes) => predicted.push([...bytes]),
    resetPredictions() {
      resets++;
    },
  };
  const keyboard = bindKeyboardInput(
    root,
    core,
    () => view,
    'input',
    lifetime.signal,
    autoFocus,
  );
  return {
    core,
    writes,
    input,
    doc,
    view,
    keyboard,
    predicted,
    focuses: () => focuses,
    resets: () => resets,
    lifetime,
  };
}

test('initial focus is offered only once to a visible writer with vacant focus; later settings/ownership cannot steal it', (t) => {
  const { core, keyboard, focuses, doc } = keyboardFixture(t);
  keyboard.offerAutoFocus();
  assert.equal(focuses(), 0);
  core.writable = true;
  core.visible = false;
  keyboard.offerAutoFocus();
  assert.equal(focuses(), 0);
  core.visible = true;
  keyboard.offerAutoFocus();
  assert.equal(focuses(), 1);
  doc.activeElement = doc.body;
  keyboard.offerAutoFocus();
  assert.equal(focuses(), 1);
  for (const mode of [
    'disabled',
    'cancelled',
    'other input',
    'focus moved away and back',
    'window blur',
  ]) {
    const f = keyboardFixture(t, {
      autoFocus: mode !== 'disabled',
      occupied: mode === 'other input',
    });
    if (mode === 'cancelled') f.keyboard.cancelAutoFocus();
    if (mode === 'focus moved away and back') f.doc.fire('focusin');
    if (mode === 'window blur') f.doc.defaultView.fire('blur');
    f.doc.activeElement = f.doc.body;
    f.core.writable = true;
    f.keyboard.offerAutoFocus();
    assert.equal(f.focuses(), 0, mode);
  }
});

test('prediction resets on paste, composition, blur and lost ownership; a font change reanchors rather than cancelling IME', (t) => {
  const { core, input, view, keyboard, predicted, writes, resets } =
    keyboardFixture(t);
  core.writable = true;
  keyboard.setWritable(true);
  core.write('abcd');
  input.fire('keydown', { key: 'x', code: 'KeyX' });
  assert.deepEqual(predicted, [[120]]);
  input.fire('compositionstart');
  assert.deepEqual(input.style, { left: '36px', top: '0px' });
  const r = resets();
  view.cellWidth = 14;
  keyboard.positionComposition();
  assert.equal(input.style.left, '56px');
  input.fire('keydown', { key: 'h', code: 'KeyH' });
  input.fire('compositionend', { data: '好' });
  input.fire('paste', { clipboardData: { getData: () => 'clipboard' } });
  keyboard.blur();
  core.writable = false;
  keyboard.setWritable(false);
  input.fire('keydown', { key: 'z', code: 'KeyZ' });
  assert.deepEqual(predicted, [[120]]);
  assert.ok(resets() >= r + 3);
  assert.deepEqual(writes, [
    ['x', true],
    ['好', true],
    ['clipboard', true],
  ]);
});
