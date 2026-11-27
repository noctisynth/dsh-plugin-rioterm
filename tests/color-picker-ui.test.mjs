import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createJiti } from 'jiti';
import { JSDOM } from 'jsdom';

// Interaction regressions, not browser/layout or visual acceptance. DOM globals
// precede ReactDOM/Radix imports so their real layout effects and focus logic run.
let dom;
let React;
let act;
let createRoot;
let ColorPicker;
let copy;
const globals = new Map();

function installGlobal(name, value) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLFormElement',
    'Element',
    'Node',
    'NodeFilter',
    'DocumentFragment',
    'MutationObserver',
    'CustomEvent',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
  ])
    installGlobal(name, name === 'window' ? window : window[name]);
  installGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  installGlobal(
    'requestAnimationFrame',
    window.requestAnimationFrame.bind(window),
  );
  installGlobal(
    'cancelAnimationFrame',
    window.cancelAnimationFrame.bind(window),
  );
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  // Supply only platform APIs absent in jsdom; do not replace Radix focus traps.
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class PointerEvent extends window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  const captures = new WeakMap();
  window.HTMLElement.prototype.setPointerCapture = function (id) {
    captures.set(this, id);
  };
  window.HTMLElement.prototype.hasPointerCapture = function (id) {
    return captures.get(this) === id;
  };
  window.HTMLElement.prototype.releasePointerCapture = function (id) {
    if (captures.get(this) === id) captures.delete(this);
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.ResizeObserver = ResizeObserver;
  window.PointerEvent = PointerEvent;
  installGlobal('ResizeObserver', ResizeObserver);
  installGlobal('PointerEvent', PointerEvent);
  React = await import('react');
  ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
  ({ ColorPicker } = await jiti.import(
    '../src/pages/preferences/color-picker.tsx',
  ));
  copy = (await jiti.import('../src/pages/preferences/messages.ts'))
    .preferenceMessages.en;
});

after(() => {
  dom?.window.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

// Module-level hook component: controlled echoes are essential to these tests.
function PickerFixture({ initialValue, initialDisabled, controls, writes }) {
  const [value, setValue] = React.useState(initialValue);
  const [disabled, setDisabled] = React.useState(initialDisabled);
  React.useImperativeHandle(controls, () => ({ setValue, setDisabled }), []);
  return React.createElement(ColorPicker, {
    value,
    disabled,
    label: 'Terminal foreground',
    describedBy: 'color-setting-description',
    t: (key) => copy[key],
    onValueChange: (next) => {
      writes.push(next);
      setValue(next);
    },
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const content = () => document.querySelector('[data-slot="popover-content"]');
const sv = () => content().querySelector('[data-rio-color-sv]');
const slider = (channel) =>
  content().querySelector(`[data-rio-color-slider="${channel}"]`);
const closeButton = () =>
  content().querySelector('[data-slot="color-picker-close"]');
const eyeButton = () =>
  content()?.querySelector('[data-slot="color-picker-eyedropper"]');
function input(label) {
  const node = Array.from(content().querySelectorAll('label')).find(
    (item) => item.querySelector('span')?.textContent === label,
  );
  assert.ok(node, `label ${label} exists`);
  return document.getElementById(node.htmlFor);
}
async function mount(tc, { value, disabled = false } = {}) {
  const container = document.createElement('section');
  container.dataset.rioUi = 'preferences';
  document.body.append(container);
  const root = createRoot(container);
  const controls = React.createRef();
  const writes = [];
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
    await act(settle);
    container.remove();
  };
  tc.after(unmount);
  await act(async () => {
    root.render(
      React.createElement(PickerFixture, {
        initialValue: value,
        initialDisabled: disabled,
        controls,
        writes,
      }),
    );
    await settle();
  });
  return {
    container,
    controls,
    writes,
    unmount,
    trigger: container.querySelector('[data-slot="color-picker-trigger"]'),
  };
}
async function click(target) {
  assert.ok(target);
  await act(async () => {
    target.click();
    await settle();
  });
  await act(settle);
}
async function open(view) {
  await act(async () => view.trigger.focus());
  await click(view.trigger);
  assert.ok(content());
  assert.equal(view.trigger.getAttribute('aria-expanded'), 'true');
}
async function focus(target) {
  await act(async () => target.focus());
}
async function key(target, value, init = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
    await settle();
  });
  await act(settle);
  return event;
}
async function pointer(target, type, init = {}) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      }),
    );
    await settle();
  });
  await act(settle);
}
async function change(target, value) {
  // Bypass React's value tracker exactly as a native user edit would.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  await act(async () => {
    setter.call(target, String(value));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  });
}
function rect(panel) {
  panel.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 120,
    width: 200,
    height: 100,
    toJSON() {},
  });
}
function installEyeDropper(tc) {
  const previous = Object.getOwnPropertyDescriptor(window, 'EyeDropper');
  const requests = [];
  window.EyeDropper = class {
    open({ signal }) {
      return new Promise((resolve, reject) =>
        requests.push({ signal, resolve, reject }),
      );
    }
  };
  tc.after(() => {
    if (previous) Object.defineProperty(window, 'EyeDropper', previous);
    else delete window.EyeDropper;
  });
  return requests;
}
async function complete(request, method, value) {
  await act(async () => {
    request[method](value);
    await settle();
  });
}

test('unknown/invalid values open without writes or fake swatches; portal owns bounded settings scope', async (tc) => {
  const view = await mount(tc);
  assert.equal(view.trigger.tagName, 'BUTTON');
  assert.equal(
    view.trigger.getAttribute('aria-describedby'),
    'color-setting-description',
  );
  assert.equal(view.trigger.hasAttribute('data-color'), false);
  assert.equal(
    view.trigger.querySelector('[data-rio-color-checkerboard]'),
    null,
  );
  assert.equal(view.trigger.querySelector('[style]'), null);
  await open(view);
  assert.equal(document.activeElement, sv());
  assert.equal(input('HEX').value, '');
  assert.equal(content().dataset.rioUi, 'popover');
  assert.equal(document.body.contains(content()), true);
  assert.equal(view.container.contains(content()), false);
  assert.equal(document.body.hasAttribute('data-rio-ui'), false);
  assert.equal(document.documentElement.hasAttribute('data-rio-ui'), false);
  assert.equal(
    document.getElementById(content().getAttribute('aria-describedby'))
      .textContent,
    copy.pickerUnknown,
  );
  assert.equal(document.querySelector('input[type="color"]'), null);
  assert.equal(eyeButton(), null);
  for (const target of [
    view.trigger,
    content(),
    sv(),
    closeButton(),
    ...content().querySelectorAll('input'),
  ]) {
    assert.ok(target.classList.contains('rio:rounded-settings'));
  }
  assert.ok(content().classList.contains('rio:z-[1100]'));
  assert.ok(
    content().classList.contains('rio:w-[min(20rem,calc(100vw-2rem))]'),
  );
  assert.ok(content().classList.contains('rio:max-w-[calc(100vw-2rem)]'));
  assert.equal(closeButton().getAttribute('aria-label'), copy.pickerClose);
  await click(closeButton());
  assert.ok(content() === null, 'picker is closed');
  await act(async () =>
    view.controls.current.setValue('var(--not-a-resolved-color)'),
  );
  await open(view);
  assert.equal(view.trigger.hasAttribute('data-color'), false);
  assert.equal(view.trigger.querySelector('[style]'), null);
  assert.equal(input('HEX').value, '');
  assert.ok(content().textContent.includes(copy.pickerUnknown));
  await key(sv(), 'Escape');
  assert.deepEqual(view.writes, []);
});

test('Escape closes only the picker, returns trigger focus and preserves the last selected color', async (tc) => {
  const hostActions = [];
  const host = (event) => {
    if (['Tab', 'Escape'].includes(event.key) && !event.defaultPrevented)
      hostActions.push(event.key);
  };
  document.addEventListener('keydown', host);
  tc.after(() => document.removeEventListener('keydown', host));
  const view = await mount(tc, { value: '#ff0000' });
  await open(view);
  await change(input('G'), 64);
  assert.deepEqual(view.writes, ['#ff4000']);
  await key(input('G'), 'Escape');
  assert.ok(content() === null, 'picker is closed');
  assert.equal(document.activeElement, view.trigger);
  assert.equal(view.trigger.dataset.color, '#ff4000');
  assert.deepEqual(hostActions, []);
  await open(view);
  assert.equal(input('HEX').value, '#ff4000');
  assert.deepEqual(view.writes, ['#ff4000']);
});

test('Tab stays out of host handlers without cancelling ordinary Tab; real FocusScope loops boundaries', async (tc) => {
  const hostActions = [];
  const host = (event) => {
    if (['Tab', 'Escape'].includes(event.key) && !event.defaultPrevented)
      hostActions.push(event.key);
  };
  document.addEventListener('keydown', host);
  tc.after(() => document.removeEventListener('keydown', host));
  const view = await mount(tc, { value: '#123456' });
  await open(view);
  // jsdom does not implement ordinary Tab traversal. Assert it is not prevented,
  // then focus the real first/last tabbable elements to test Radix's boundary loop.
  const ordinary = await key(sv(), 'Tab');
  assert.equal(ordinary.defaultPrevented, false);
  const first = closeButton();
  const last = input('HEX');
  await focus(last);
  assert.equal((await key(last, 'Tab')).defaultPrevented, true);
  assert.equal(document.activeElement, first);
  await focus(first);
  assert.equal(
    (await key(first, 'Tab', { shiftKey: true })).defaultPrevented,
    true,
  );
  assert.equal(document.activeElement, last);
  assert.deepEqual(hostActions, []);
  assert.deepEqual(view.writes, []);
});

test('SV pointer capture clamps a 200x100 drag and ignores moves after cancel/lost capture/up', async (tc) => {
  const view = await mount(tc, { value: '#ff0000' });
  await open(view);
  const panel = sv();
  rect(panel);
  await pointer(panel, 'pointerdown', { clientX: 110, clientY: 70 });
  assert.equal(panel.hasPointerCapture(1), true);
  assert.equal(view.writes.at(-1), '#804040');
  await pointer(panel, 'pointermove', { clientX: 400, clientY: -100 });
  assert.equal(view.writes.at(-1), '#ff0000');
  await pointer(panel, 'pointermove', { clientX: -100, clientY: 400 });
  assert.equal(view.writes.at(-1), '#000000');
  await pointer(panel, 'pointercancel');
  let count = view.writes.length;
  await pointer(panel, 'pointermove', { clientX: 210, clientY: 20 });
  assert.equal(view.writes.length, count);
  await pointer(panel, 'pointerdown', {
    pointerId: 2,
    clientX: 210,
    clientY: 20,
  });
  await pointer(panel, 'lostpointercapture', { pointerId: 2 });
  count = view.writes.length;
  await pointer(panel, 'pointermove', {
    pointerId: 2,
    clientX: 10,
    clientY: 20,
  });
  assert.equal(view.writes.length, count);
  await pointer(panel, 'pointerdown', {
    pointerId: 3,
    clientX: 210,
    clientY: 20,
  });
  await pointer(panel, 'pointerup', { pointerId: 3, clientX: 10, clientY: 20 });
  assert.equal(panel.hasPointerCapture(3), false);
  assert.equal(view.writes.at(-1), '#ffffff');
  count = view.writes.length;
  await pointer(panel, 'pointermove', {
    pointerId: 3,
    clientX: 210,
    clientY: 20,
  });
  await pointer(panel, 'pointerdown', { button: 2, clientX: 210, clientY: 20 });
  await pointer(panel, 'pointerdown', {
    isPrimary: false,
    clientX: 210,
    clientY: 20,
  });
  assert.equal(view.writes.length, count);
});

test('SV Arrow/Shift steps and RGB/hue edits retain exact alpha bytes; opaque edits stay six-digit', async (tc) => {
  const view = await mount(tc, { value: '#ff000080' });
  await open(view);
  assert.equal(slider('alpha').value, '50.2');
  assert.equal(slider('alpha').getAttribute('aria-valuetext'), '50.2%');
  await key(sv(), 'ArrowLeft');
  assert.equal(sv().getAttribute('aria-valuenow'), '99');
  await key(sv(), 'ArrowLeft', { shiftKey: true });
  assert.equal(sv().getAttribute('aria-valuenow'), '89');
  await key(sv(), 'ArrowDown', { shiftKey: true });
  assert.match(sv().getAttribute('aria-valuetext'), /Brightness: 90%/);
  await change(input('R'), 100);
  await change(slider('hue'), 240);
  assert.ok(view.writes.every((value) => /^#[\da-f]{6}80$/.test(value)));
  assert.equal(slider('alpha').value, '50.2');
  await act(async () => view.controls.current.setValue('#ff0000'));
  await change(input('B'), 10);
  await change(slider('hue'), 120);
  assert.match(view.writes.at(-1), /^#[\da-f]{6}$/);
  await change(slider('alpha'), 50.2);
  assert.match(view.writes.at(-1), /^#[\da-f]{6}80$/);
});

test('RGB number inputs reject empty, fractional and out-of-range drafts with linked visible errors', async (tc) => {
  const view = await mount(tc, { value: '#12345680' });
  await open(view);
  const red = input('R');
  assert.equal(red.type, 'number');
  assert.equal(red.min, '0');
  assert.equal(red.max, '255');
  for (const draft of ['', '-1', '256', '12.5']) {
    await focus(red);
    await change(red, draft);
    assert.equal(red.getAttribute('aria-invalid'), 'true');
    const error = document.getElementById(red.getAttribute('aria-describedby'));
    assert.equal(error.textContent, copy.pickerRgbInvalid);
    assert.equal(error.hidden, false);
    assert.equal(error.classList.contains('rio:sr-only'), false);
    assert.deepEqual(view.writes, []);
    await focus(sv());
    assert.equal(red.value, '18');
    assert.equal(red.hasAttribute('aria-invalid'), false);
    assert.equal(red.hasAttribute('aria-describedby'), false);
    assert.equal(error.isConnected, false);
  }
  await change(red, '0');
  await change(input('G'), '255');
  assert.deepEqual(view.writes, ['#00345680', '#00ff5680']);
});

test('controlled black echoes preserve hue 240 and full saturation until Shift+ArrowUp makes blue', async (tc) => {
  const view = await mount(tc, { value: '#000000' });
  await open(view);
  await change(slider('hue'), 240);
  assert.equal(view.writes.at(-1), '#000000');
  rect(sv());
  await pointer(sv(), 'pointerdown', { clientX: 210, clientY: 120 });
  await pointer(sv(), 'pointerup', { clientX: 210, clientY: 120 });
  assert.equal(slider('hue').value, '240');
  await key(sv(), 'ArrowUp', { shiftKey: true });
  assert.equal(view.writes.at(-1), '#00001a');
  assert.equal(input('B').value, '26');
  assert.equal(slider('hue').value, '240');
});

test('HEX commits complete dirty drafts only on Enter, blur, outside dismissal or explicit close', async (tc) => {
  const view = await mount(tc, { value: '#123456' });
  await open(view);
  await focus(input('HEX'));
  await focus(sv());
  assert.deepEqual(view.writes, []);
  await focus(input('HEX'));
  await change(input('HEX'), '#abc');
  assert.deepEqual(view.writes, []);
  await key(input('HEX'), 'Enter');
  assert.deepEqual(view.writes, ['#aabbcc']);
  await focus(sv());
  assert.equal(view.writes.length, 1);
  await focus(input('HEX'));
  await change(input('HEX'), '#123');
  await focus(sv());
  assert.deepEqual(view.writes, ['#aabbcc', '#112233']);
  await focus(input('HEX'));
  await change(input('HEX'), '#456');
  // Modal Popover defers outside dismissal until the completed click sequence.
  await pointer(document.body, 'pointerdown');
  await pointer(document.body, 'pointerup');
  await click(document.body);
  assert.ok(content() === null, 'picker is closed');
  assert.equal(view.writes.at(-1), '#445566');
  await open(view);
  await focus(input('HEX'));
  await change(input('HEX'), '#789');
  await click(closeButton());
  assert.ok(content() === null, 'picker is closed');
  assert.deepEqual(view.writes, ['#aabbcc', '#112233', '#445566', '#778899']);
});

test('invalid/incomplete HEX exposes error without writes and Escape discards even a complete pending draft', async (tc) => {
  const view = await mount(tc, { value: '#12345680' });
  await open(view);
  for (const draft of ['#12', '#zzzzzz', '']) {
    await focus(input('HEX'));
    await change(input('HEX'), draft);
    assert.equal(input('HEX').getAttribute('aria-invalid'), 'true');
    const error = document.getElementById(
      input('HEX').getAttribute('aria-describedby'),
    );
    assert.equal(error.textContent, copy.invalidColor);
    assert.equal(error.hidden, false);
    assert.equal(error.classList.contains('rio:sr-only'), false);
    await key(input('HEX'), 'Enter');
    await focus(sv());
    assert.deepEqual(view.writes, []);
  }
  await focus(input('HEX'));
  await change(input('HEX'), '#abcdef');
  assert.equal(input('HEX').hasAttribute('aria-invalid'), false);
  await key(input('HEX'), 'Escape');
  assert.ok(content() === null, 'picker is closed');
  assert.deepEqual(view.writes, []);
  assert.equal(document.activeElement, view.trigger);
  await open(view);
  assert.equal(input('HEX').value, '#12345680');
});

test('HEX is a full color: three/six digits replace old alpha with opaque; four/eight specify alpha', async (tc) => {
  const view = await mount(tc, { value: '#12345680' });
  await open(view);
  for (const [draft, expected, opacity] of [
    ['#abc', '#aabbcc', '100'],
    ['#def8', '#ddeeff88', '53.3'],
    ['#a1b2c3', '#a1b2c3', '100'],
    ['#a1b2c380', '#a1b2c380', '50.2'],
  ]) {
    await change(input('HEX'), draft);
    await key(input('HEX'), 'Enter');
    assert.equal(view.writes.at(-1), expected);
    assert.equal(view.trigger.dataset.color, expected);
    assert.equal(slider('alpha').value, opacity);
  }
});

test('external values synchronize controls; read-only and unmount reject stale events and disabled never opens', async (tc) => {
  const view = await mount(tc, { value: '#ff0000', disabled: true });
  assert.equal(view.trigger.disabled, true);
  await click(view.trigger);
  await key(view.trigger, 'Enter');
  await pointer(view.trigger, 'pointerdown');
  assert.ok(content() === null, 'picker is closed');
  await act(async () => view.controls.current.setDisabled(false));
  await open(view);
  await act(async () => view.controls.current.setValue('#0000ff80'));
  assert.equal(input('HEX').value, '#0000ff80');
  assert.deepEqual(
    ['R', 'G', 'B'].map((label) => input(label).value),
    ['0', '0', '255'],
  );
  assert.equal(slider('hue').value, '240');
  assert.equal(slider('alpha').value, '50.2');
  assert.equal(sv().getAttribute('aria-valuenow'), '100');
  const oldPanel = sv();
  const oldHex = input('HEX');
  rect(oldPanel);
  await change(oldHex, '#abcdef');
  await act(async () => {
    view.controls.current.setDisabled(true);
    await settle();
  });
  assert.ok(content() === null, 'picker is closed');
  assert.equal(view.trigger.disabled, true);
  await key(oldHex, 'Enter');
  await pointer(oldPanel, 'pointerdown', { clientX: 210, clientY: 20 });
  await change(oldHex, '#fff');
  assert.deepEqual(view.writes, []);
  await act(async () => view.controls.current.setDisabled(false));
  await open(view);
  assert.equal(input('HEX').value, '#0000ff80');
  const detachedPanel = sv();
  const detachedHex = input('HEX');
  rect(detachedPanel);
  await view.unmount();
  await key(detachedHex, 'Enter');
  await change(detachedHex, '#123');
  await pointer(detachedPanel, 'pointerdown', { clientX: 210, clientY: 20 });
  assert.deepEqual(view.writes, []);
});

test('EyeDropper starts only on click, keeps layer during outside focus and resolves against latest alpha', async (tc) => {
  const requests = installEyeDropper(tc);
  const view = await mount(tc, { value: '#ff000080' });
  assert.equal(requests.length, 0);
  await open(view);
  assert.ok(eyeButton());
  assert.equal(requests.length, 0);
  await click(eyeButton());
  assert.equal(requests.length, 1);
  assert.equal(typeof requests[0].signal.addEventListener, 'function');
  assert.equal(requests[0].signal.aborted, false);
  assert.equal(eyeButton().disabled, true);
  const outside = document.createElement('button');
  document.body.append(outside);
  tc.after(() => outside.remove());
  await focus(outside);
  assert.ok(content(), 'focus outside while picking must not dismiss');
  await act(async () => view.controls.current.setValue('#ff000040'));
  await complete(requests[0], 'resolve', { sRGBHex: '#123456' });
  assert.deepEqual(view.writes, ['#12345640']);
  assert.equal(eyeButton().disabled, false);
  assert.equal(content().querySelector('[role="status"]'), null);
});

test('EyeDropper AbortError cancels silently; real failure explains fallback without changing settings', async (tc) => {
  const requests = installEyeDropper(tc);
  const view = await mount(tc, { value: '#123456' });
  await open(view);
  await click(eyeButton());
  await complete(
    requests[0],
    'reject',
    Object.assign(new Error('User cancelled'), { name: 'AbortError' }),
  );
  assert.deepEqual(view.writes, []);
  assert.equal(content().querySelector('[role="status"]'), null);
  assert.equal(eyeButton().disabled, false);
  await click(eyeButton());
  await complete(requests[1], 'reject', new Error('Screen unavailable'));
  assert.deepEqual(view.writes, []);
  assert.equal(
    content().querySelector('[role="status"]').textContent,
    copy.pickerEyeDropperError,
  );
  await click(eyeButton());
  assert.equal(content().querySelector('[role="status"]'), null);
  await complete(requests[2], 'resolve', { sRGBHex: '#abcdef' });
  assert.deepEqual(view.writes, ['#abcdef']);
});

test('EyeDropper close, read-only and unmount abort requests and ignore late successful results', async (tc) => {
  const requests = installEyeDropper(tc);
  const view = await mount(tc, { value: '#12345680' });
  await open(view);
  await click(eyeButton());
  await click(closeButton());
  assert.equal(requests[0].signal.aborted, true);
  await open(view);
  await click(eyeButton());
  // The previous request cannot affect this newly mounted helper or its request.
  await complete(requests[0], 'resolve', { sRGBHex: '#ffffff' });
  assert.deepEqual(view.writes, []);
  assert.equal(eyeButton().disabled, true);
  await act(async () => {
    view.controls.current.setDisabled(true);
    await settle();
  });
  assert.ok(content() === null, 'picker is closed');
  assert.equal(requests[1].signal.aborted, true);
  await complete(requests[1], 'resolve', { sRGBHex: '#ffffff' });
  assert.deepEqual(view.writes, []);
  await act(async () => view.controls.current.setDisabled(false));
  await open(view);
  await click(eyeButton());
  await view.unmount();
  assert.equal(requests[2].signal.aborted, true);
  await complete(requests[2], 'resolve', { sRGBHex: '#ffffff' });
  assert.deepEqual(view.writes, []);
});
