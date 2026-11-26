import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { initWasm } from 'rioterm';
import { mountTerminalView } from '../src/pages/terminal/terminal-mount.ts';
import { defaultEffectivePreferences as defaults } from '../src/preferences/values.ts';
import {
  beginAutoFocus,
  bindKeyboardInput,
} from '../src/rio/keyboard-input.ts';
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

function keyboardFixture(t) {
  const { core, writes } = coreFor(t, {
    ...defaults,
    renderer: 'canvas',
    predictiveEcho: true,
  });
  const predicted = [];
  const attributes = new Set();
  let resets = 0,
    focuses = 0;
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const input = {
    ...events(),
    style: {},
    setAttribute() {},
    matches: (selector) => selector === ':focus-visible',
    focus(options) {
      assert.deepEqual(options, { preventScroll: true });
      focuses++;
      if (doc.activeElement === input) return;
      doc.activeElement = input;
      input.fire('focus');
    },
    blur() {
      if (doc.activeElement !== input) return;
      doc.activeElement = doc.body;
      input.fire('blur');
    },
  };
  const doc = {
    ...events(),
    defaultView: events(),
    body: {},
    hasFocus: () => true,
    hidden: false,
    createElement: () => input,
  };
  doc.activeElement = { tagName: 'TEXTAREA' }; // The previous composer still owns focus.
  const root = {
    ownerDocument: doc,
    append() {},
    contains(element) {
      return element === this;
    },
    getClientRects: () => [{}],
    closest: () => null,
    removeAttribute: (name) => attributes.delete(name),
    toggleAttribute(name, present) {
      if (present) attributes.add(name);
      else attributes.delete(name);
    },
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
  );
  return {
    core,
    writes,
    input,
    doc,
    root,
    view,
    keyboard,
    predicted,
    focuses: () => focuses,
    indicated: () => attributes.has('data-rio-keyboard-focus'),
    resets: () => resets,
    lifetime,
  };
}

test('all programmatic terminal focus is ring-free, including activation, find restoration and takeover', (t) => {
  for (const method of ['focusIfInteractive', 'focus']) {
    const { core, writes, input, doc, keyboard, focuses, indicated } =
      keyboardFixture(t);
    core.writable = true;
    keyboard[method]();
    assert.equal(focuses(), 1, method);
    assert.equal(doc.activeElement, input, method);
    assert.equal(
      indicated(),
      false,
      `${method}: programmatic focus must not highlight the whole screen`,
    );
    input.blur();
    input.focus({ preventScroll: true }); // Model a new native keyboard-navigation focus.
    assert.equal(
      indicated(),
      true,
      'native keyboard focus remains distinguishable',
    );
    const before = focuses();
    keyboard[method]();
    assert.equal(focuses(), before + 1);
    assert.equal(doc.activeElement, input);
    assert.equal(
      indicated(),
      false,
      'also clear an existing ring when focus emits no event',
    );
    input.blur();
    input.focus({ preventScroll: true });
    assert.equal(
      indicated(),
      true,
      'programmatic suppression must not persist into native focus',
    );
    keyboard.blur();
    assert.equal(indicated(), false);
    assert.deepEqual(writes, []);
    keyboard[method]();
    input.fire('keydown', { key: 'x', code: 'KeyX' });
    assert.deepEqual(
      writes,
      [['x', true]],
      'ring-free focus still accepts terminal input',
    );
  }
});

test('keyboard navigation preserves focus indication until pointer input or blur, without PTY writes', (t) => {
  const {
    core,
    writes,
    input,
    doc,
    root,
    view,
    keyboard,
    lifetime,
    indicated: focused,
  } = keyboardFixture(t);
  core.writable = true;
  let focusVisible = true;
  input.matches = (selector) => selector === ':focus-visible' && focusVisible;
  input.focus({ preventScroll: true });
  assert.equal(focused(), true);
  input.blur(); // Focus moves to another control.
  assert.equal(focused(), false);
  input.focus({ preventScroll: true }); // Model native keyboard navigation, not our focus helper.
  assert.equal(doc.activeElement, input);
  assert.equal(
    focused(),
    true,
    'do not hide keyboard focus to mask a paint defect',
  );

  Object.assign(root, events(), { setPointerCapture() {} });
  const pointerView = {
    ...view,
    cellAt: () => ({ row: 0, col: 0, sideRight: false }),
  };
  bindPointerInput(
    root,
    core,
    () => pointerView,
    keyboard.focus,
    lifetime.signal,
  );
  root.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1 });
  assert.equal(doc.activeElement, input);
  assert.equal(
    focused(),
    false,
    'a click clears only the indication, not focus',
  );
  keyboard.focusIfInteractive();
  assert.equal(
    focused(),
    false,
    'focusing an already focused input emits no focus event',
  );
  input.blur();
  input.focus({ preventScroll: true });
  assert.equal(focused(), true);
  input.blur();
  focusVisible = false;
  input.focus({ preventScroll: true });
  assert.equal(
    focused(),
    false,
    'non-visible focus must not retain a stale ring',
  );
  input.blur();
  focusVisible = true;
  input.focus({ preventScroll: true });
  assert.equal(focused(), true);
  input.blur();
  assert.equal(focused(), false);
  assert.deepEqual(writes, []);
});

test('real mount-to-keyboard handoffs keep opening, repeated tab switches, find and takeover ring-free', async (t) => {
  const { core, writes, input, doc, keyboard, focuses, indicated } =
    keyboardFixture(t);
  core.writable = true;
  const tab = { active: true, visible: true };
  let panel;
  const view = mountTerminalView({
    ticket: 'existing-terminal',
    tabState: () => tab,
    beginAutoFocus: () => new AbortController(),
    loadEngine: async () => {},
    onState() {},
    session: {
      needsLaunch: () => false,
      environment: async () => ({}),
      mount(_ticket, _limits, target) {
        panel = target;
        return {
          reconnect() {
            target.status('reconnecting');
            return true;
          },
          setVisible() {},
          detach() {},
        };
      },
    },
    createScreen: () => ({
      focus: keyboard.focus,
      focusIfInteractive: keyboard.focusIfInteractive,
      setVisible(visible) {
        core.visible = visible;
        if (!visible) keyboard.blur();
      },
      dispose: keyboard.blur,
    }),
  });
  t.after(() => view.dispose());
  await setImmediate();
  panel.status('connected');
  await Promise.resolve();
  const assertInput = (message) => {
    assert.equal(doc.activeElement, input, message);
    assert.equal(indicated(), false, message);
  };
  assertInput('initial activation');
  assert.equal(focuses(), 1);
  for (const field of ['active', 'visible', 'active', 'visible']) {
    tab[field] = false;
    view.syncTabState();
    input.blur();
    tab[field] = true;
    view.syncTabState();
    await Promise.resolve();
    assertInput(`returning to a retained tab: ${field}`);
  }
  assert.equal(focuses(), 5);
  input.blur();
  view.focusTerminal();
  assertInput('closing find');
  core.writable = false;
  panel.status('readonly');
  input.blur();
  view.retry(true);
  assertInput('explicit takeover may focus before write ownership arrives');
  core.writable = true;
  panel.status('connected');
  await Promise.resolve();
  assertInput('ownership confirmation');
  input.blur();
  panel.status('reconnecting');
  panel.status('connected');
  await Promise.resolve();
  assert.notEqual(
    doc.activeElement,
    input,
    'background reconnect must not steal focus',
  );
  assert.equal(indicated(), false);
  assert.deepEqual(writes, []);
});

test('a keyboard activation may leave the composer focused; later interaction cancels even without changing activeElement', async (t) => {
  const { root, doc } = keyboardFixture(t);
  for (const event of [
    'focusin',
    'keydown',
    'input',
    'pointerdown',
    'window blur',
    'visibilitychange',
  ]) {
    const request = beginAutoFocus(root);
    doc.fire('focusin', {
      target: { contains: (element) => element === root },
    }); // Host handoff to our pane.
    assert.equal(request.signal.aborted, false);
    if (event === 'window blur') doc.defaultView.fire('blur');
    else doc.fire(event, { key: 'x', target: { contains: () => false } });
    assert.equal(request.signal.aborted, true, event);
  }
  const chip = {
    contains: () => false,
    matches: (selector) => selector === '[role="tab"][aria-selected="true"]',
  };
  const request = beginAutoFocus(root);
  doc.fire('focusin', { target: chip }); // DockKit selects and focuses the chip in one commit.
  assert.equal(request.signal.aborted, false);
  doc.fire('keydown', { target: chip, key: 'x' });
  doc.fire('pointerdown', { target: root });
  doc.fire('keydown', {
    target: { contains: (node) => node === root },
    key: 'a',
  });
  assert.equal(request.signal.aborted, false);
  await Promise.resolve();
  doc.fire('focusin', { target: chip });
  assert.equal(request.signal.aborted, true);
  const navigating = beginAutoFocus(root);
  doc.fire('keydown', { target: chip, key: 'Tab' });
  assert.equal(navigating.signal.aborted, true);
  doc.hidden = true;
  assert.equal(beginAutoFocus(root), undefined);
  doc.hidden = false;
  doc.hasFocus = () => false;
  assert.equal(beginAutoFocus(root), undefined);
});

test('a retained tab activation observes cancellation while its host is still inert and checks visibility only at handoff', async (t) => {
  for (const mode of [
    'released',
    'still inert',
    'pointerdown',
    'input',
    'focusin',
    'window blur',
    'hidden document',
    'readonly',
  ]) {
    const { root, core, doc, keyboard, focuses } = keyboardFixture(t);
    core.writable = true;
    let inert = true;
    root.closest = () => (inert ? {} : null);
    const request = beginAutoFocus(root);
    assert.ok(request, 'child layout must retain the new tab activation');
    assert.equal(focuses(), 0);
    queueMicrotask(() => {
      const allowed = !request.signal.aborted;
      request.abort();
      if (allowed) keyboard.focusIfInteractive();
    });
    if (mode !== 'still inert') inert = false;
    if (mode === 'pointerdown' || mode === 'input' || mode === 'focusin')
      doc.fire(mode, { target: { contains: () => false } });
    if (mode === 'window blur') doc.defaultView.fire('blur');
    if (mode === 'hidden document') doc.hidden = true;
    if (mode === 'readonly') core.writable = false;
    await Promise.resolve();
    assert.equal(focuses(), Number(mode === 'released'), mode);
    assert.equal(
      request.signal.aborted,
      true,
      'handoff releases its listeners',
    );
  }
});

test('automatic focus requires a visible foreground writer; explicit takeover keeps its own guards', (t) => {
  for (const blocked of [
    'readonly',
    'hidden tab',
    'background window',
    'hidden document',
    'no box',
    'inert ancestor',
    'disposed',
    'none',
  ]) {
    const { root, core, keyboard, focuses, doc, lifetime, indicated } =
      keyboardFixture(t);
    core.writable = blocked !== 'readonly';
    core.visible = blocked !== 'hidden tab';
    doc.hidden = blocked === 'hidden document';
    doc.hasFocus = () => blocked !== 'background window';
    root.getClientRects = () => (blocked === 'no box' ? [] : [{}]);
    root.closest = () => (blocked === 'inert ancestor' ? {} : null);
    if (blocked === 'disposed') lifetime.abort();
    root.toggleAttribute('data-rio-keyboard-focus', true);
    keyboard.focusIfInteractive();
    assert.equal(focuses(), Number(blocked === 'none'), blocked);
    assert.equal(
      indicated(),
      blocked !== 'none',
      'a rejected handoff must not mutate focus decoration',
    );
    if (
      blocked === 'readonly' ||
      blocked === 'hidden tab' ||
      blocked === 'disposed'
    ) {
      keyboard.focus();
      assert.equal(focuses(), Number(blocked === 'readonly'));
      assert.equal(indicated(), blocked !== 'readonly');
    }
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
