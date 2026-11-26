import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createJiti } from 'jiti';
import { JSDOM } from 'jsdom';

// These are DOM interaction unit tests, not browser/layout or visual acceptance.
// Install DOM globals before importing ReactDOM/Radix: their layout-effect choice
// is made at module evaluation time. Each fixture is unmounted after its test.
let dom;
let React;
let act;
let createRoot;
let Select;
let SelectValue;
let SelectTrigger;
let SelectContent;
let SelectItem;
let ChoiceField;
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

  // jsdom has no layout, ResizeObserver, pointer capture or scrollIntoView.
  // Only missing platform APIs are supplied; selection/focus/dismissal stay Radix's.
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
  window.ResizeObserver = ResizeObserver;
  window.PointerEvent = PointerEvent;
  installGlobal('ResizeObserver', ResizeObserver);
  installGlobal('PointerEvent', PointerEvent);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};

  React = await import('react');
  ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
  ({ Select, SelectValue, SelectTrigger, SelectContent, SelectItem } =
    await jiti.import('../src/components/ui/select.tsx'));
  ({ ChoiceField } = await jiti.import('../src/pages/preferences/fields.tsx'));
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

const choices = [
  ['balanced', 'Balanced'],
  ['quality', 'Quality'],
  ['speed', 'Speed'],
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function mount(
  tc,
  {
    id = 'quality-setting',
    rootProps = {},
    contentProps = {},
    items = choices,
    triggerRef,
  } = {},
) {
  const container = document.createElement('section');
  container.dataset.rioUi = 'test';
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  tc.after(async () => {
    await act(async () => root.unmount());
    await act(settle);
    container.remove();
  });
  await act(async () => {
    root.render(
      React.createElement(
        Select,
        {
          defaultValue: 'balanced',
          onValueChange: (value) => changes.push(value),
          ...rootProps,
        },
        React.createElement(
          SelectTrigger,
          { id, name: id, 'aria-label': id, ref: triggerRef },
          React.createElement(SelectValue, { placeholder: 'Choose a setting' }),
        ),
        React.createElement(
          SelectContent,
          contentProps,
          items.map(([value, label, disabled]) =>
            React.createElement(
              SelectItem,
              { value, key: value, disabled },
              label,
            ),
          ),
        ),
      ),
    );
    await settle();
  });
  return {
    container,
    trigger: container.querySelector('[role="combobox"]'),
    changes,
  };
}

async function key(target, value) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  });
  await act(settle);
}

async function pointer(target, type = 'pointerdown') {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );
    await settle();
  });
}

const listbox = () => document.querySelector('[role="listbox"]');
const options = () => Array.from(listbox().querySelectorAll('[role="option"]'));

async function open(trigger, openingKey = 'ArrowDown') {
  await act(async () => trigger.focus());
  await key(trigger, openingKey);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(listbox());
}

function PreferenceFixture({ changes, controls }) {
  const [fields, setFields] = React.useState({});
  const [writable, changeWritable] = React.useState(true);
  const [base, changeBase] = React.useState({ boldBright: 'never' });
  React.useImperativeHandle(
    controls,
    () => ({ setWritable: changeWritable, setBase: changeBase }),
    [],
  );
  return React.createElement(
    'fieldset',
    { disabled: !writable },
    React.createElement(ChoiceField, {
      name: 'boldBright',
      options: ['auto', 'always', 'never'],
      form: {
        fields,
        base,
        writable,
        sourcesReady: true,
        invalid: [],
        t: (key) => copy[key],
        change: (name, value, mode) => {
          changes.push([name, value, mode]);
          setFields((current) => {
            const next = { ...current };
            if (value === '') delete next[name];
            else next[name] = value;
            return next;
          });
        },
      },
    }),
  );
}

test('preference Select shows actual values, resets without pinning defaults and closes on read-only', async (tc) => {
  const container = document.createElement('section');
  container.dataset.rioUi = 'preferences';
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  const controls = React.createRef();
  tc.after(async () => {
    await act(async () => root.unmount());
    await act(settle);
    container.remove();
  });
  await act(async () => {
    root.render(React.createElement(PreferenceFixture, { changes, controls }));
    await settle();
  });
  const trigger = container.querySelector('[role="combobox"]');
  assert.equal(trigger.textContent, copy.never);
  assert.deepEqual(changes, []);
  await open(trigger);
  assert.deepEqual(
    options().map((item) => item.textContent),
    [copy.auto, copy.always, copy.never],
  );
  await key(document.activeElement, 'Home');
  await key(document.activeElement, 'Enter');
  assert.deepEqual(changes, [['boldBright', 'auto', 'immediate']]);
  assert.equal(trigger.textContent, copy.auto);
  await act(async () => controls.current.setBase({ boldBright: 'always' }));
  assert.equal(trigger.textContent, copy.auto);
  const reset = Array.from(container.querySelectorAll('button')).find(
    (button) =>
      button.getAttribute('aria-label') ===
      `${copy.useInherited}: ${copy.boldBright}`,
  );
  assert.ok(reset);
  await act(async () => reset.click());
  assert.equal(trigger.textContent, copy.always);
  assert.ok(document.activeElement === trigger);
  assert.deepEqual(changes.at(-1), ['boldBright', '', 'immediate']);
  await open(trigger);
  await act(async () => {
    controls.current.setWritable(false);
    await settle();
  });
  assert.equal(listbox(), null);
  assert.equal(trigger.disabled, true);
  await act(async () => {
    controls.current.setWritable(true);
    controls.current.setBase({ boldBright: 'never' });
    await settle();
  });
  assert.equal(trigger.textContent, copy.never);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(changes.length, 2);
});

test('keyboard opens real options, focuses selection, selects and returns focus', async (tc) => {
  const ref = React.createRef();
  const view = await mount(tc, { triggerRef: ref });
  assert.equal(ref.current, view.trigger);
  assert.equal(view.trigger.tagName, 'BUTTON');
  assert.equal(view.trigger.dataset.slot, 'select-trigger');
  assert.equal(view.trigger.id, 'quality-setting');
  assert.equal(view.trigger.name, 'quality-setting');
  assert.equal(view.trigger.textContent, 'Balanced');
  await open(view.trigger);
  assert.deepEqual(
    options().map((item) => item.textContent),
    ['Balanced', 'Quality', 'Speed'],
  );
  assert.equal(document.activeElement, options()[0]);
  await key(document.activeElement, 'ArrowDown');
  assert.equal(document.activeElement, options()[1]);
  await key(document.activeElement, 'Enter');
  assert.deepEqual(view.changes, ['quality']);
  assert.equal(listbox(), null);
  assert.equal(view.trigger.textContent, 'Quality');
  assert.ok(
    document.activeElement === view.trigger,
    'focus returns to trigger',
  );
});

test('Escape preserves the selected value and returns focus through onCloseAutoFocus', async (tc) => {
  let closes = 0;
  const view = await mount(tc, {
    contentProps: { onCloseAutoFocus: () => closes++ },
  });
  await open(view.trigger, 'Enter');
  await key(document.activeElement, 'ArrowDown');
  await key(document.activeElement, 'Escape');
  assert.equal(listbox(), null);
  assert.deepEqual(view.changes, []);
  assert.equal(view.trigger.textContent, 'Balanced');
  assert.ok(
    document.activeElement === view.trigger,
    'focus returns to trigger',
  );
  assert.equal(closes, 1);
});

test('Radix prevents host modal Escape and Tab handlers while forwarding consumer handlers', async (tc) => {
  const hostActions = [];
  const observed = [];
  const hostKeyDown = (event) => {
    if (!['Escape', 'Tab'].includes(event.key)) return;
    observed.push([event.key, event.defaultPrevented]);
    if (!event.defaultPrevented) hostActions.push(event.key);
  };
  // DSH's modal listener runs on document in the bubbling phase and respects
  // defaultPrevented. Keep the real Radix listbox semantics, not role="menu".
  document.addEventListener('keydown', hostKeyDown);
  tc.after(() => document.removeEventListener('keydown', hostKeyDown));
  let escapes = 0;
  const view = await mount(tc, {
    contentProps: {
      onEscapeKeyDown: (event) => {
        assert.equal(event.key, 'Escape');
        escapes++;
      },
    },
  });
  await open(view.trigger);
  const selected = document.activeElement;
  await key(selected, 'Tab');
  assert.ok(listbox());
  assert.ok(document.activeElement === selected);
  await key(document.activeElement, 'Escape');
  assert.equal(listbox(), null);
  assert.equal(escapes, 1);
  assert.deepEqual(hostActions, []);
  assert.deepEqual(observed, [
    ['Tab', true],
    ['Escape', true],
  ]);
  assert.ok(document.activeElement === view.trigger);
});

test('consumer can cancel close autofocus without reopening the menu', async (tc) => {
  const outside = document.createElement('button');
  outside.textContent = 'Outside';
  document.body.append(outside);
  tc.after(() => outside.remove());
  const view = await mount(tc, {
    contentProps: {
      onCloseAutoFocus: (event) => {
        event.preventDefault();
        outside.focus();
      },
    },
  });
  await open(view.trigger);
  await key(document.activeElement, 'Escape');
  assert.equal(listbox(), null);
  assert.equal(document.activeElement, outside);
});

test('outside pointer dismisses the portal without changing value', async (tc) => {
  const view = await mount(tc);
  await open(view.trigger);
  await pointer(document.body);
  assert.equal(listbox(), null);
  assert.equal(view.trigger.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(view.changes, []);
});

test('disabled Root prevents keyboard, pointer and click opening', async (tc) => {
  const view = await mount(tc, { rootProps: { disabled: true } });
  assert.equal(view.trigger.disabled, true);
  await key(view.trigger, 'ArrowDown');
  await pointer(view.trigger);
  await act(async () => {
    view.trigger.click();
    await settle();
  });
  assert.equal(view.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(listbox(), null);
  assert.deepEqual(view.changes, []);
});

test('typeahead skips disabled items and keeps selection indicators accurate', async (tc) => {
  const view = await mount(tc, {
    items: [...choices, ['silent', 'Silent', true]],
  });
  await open(view.trigger);
  assert.equal(options()[0].dataset.state, 'checked');
  assert.equal(
    options()[0].querySelectorAll('[data-slot="select-item-indicator"] svg')
      .length,
    1,
  );
  assert.equal(
    options()[1].querySelector('[data-slot="select-item-indicator"]'),
    null,
  );
  assert.equal(options()[3].getAttribute('aria-disabled'), 'true');
  await key(document.activeElement, 's');
  assert.equal(document.activeElement.textContent, 'Speed');
  await key(document.activeElement, 'Enter');
  assert.deepEqual(view.changes, ['speed']);
  await open(view.trigger);
  assert.equal(document.activeElement, options()[2]);
  assert.equal(options()[2].dataset.state, 'checked');
  assert.equal(
    options()[0].querySelector('[data-slot="select-item-indicator"]'),
    null,
  );
});

test('body portal has its own scope and bounded scroll viewport, not trigger height', async (tc) => {
  const view = await mount(tc);
  await open(view.trigger);
  const content = listbox();
  assert.equal(content.dataset.rioUi, 'select');
  assert.equal(content.dataset.slot, 'select-content');
  assert.equal(document.body.contains(content), true);
  assert.equal(view.container.contains(content), false);
  assert.ok(content.closest('[data-radix-popper-content-wrapper]'));
  assert.ok(
    content.classList.contains(
      'rio:max-h-[min(20rem,var(--radix-select-content-available-height))]',
    ),
  );
  assert.ok(content.classList.contains('rio:overflow-hidden'));
  assert.ok(content.classList.contains('rio:z-[1100]'));
  const viewport = content.querySelector('[data-slot="select-viewport"]');
  assert.ok(viewport.hasAttribute('data-radix-select-viewport'));
  assert.ok(viewport.classList.contains('rio:min-h-0'));
  assert.ok(viewport.classList.contains('rio:box-border'));
  assert.ok(viewport.classList.contains('rio:overflow-y-auto'));
  assert.doesNotMatch(viewport.className, /trigger-height/);
});

test('independent React roots keep values and portal ownership isolated', async (tc) => {
  const first = await mount(tc, { id: 'first' });
  const second = await mount(tc, {
    id: 'second',
    rootProps: { defaultValue: 'quality' },
  });
  await open(first.trigger);
  const firstControls = first.trigger.getAttribute('aria-controls');
  assert.equal(listbox().id, firstControls);
  assert.equal(second.trigger.getAttribute('aria-expanded'), 'false');
  await key(document.activeElement, 'End');
  await key(document.activeElement, 'Enter');
  assert.deepEqual(first.changes, ['speed']);
  assert.deepEqual(second.changes, []);
  assert.equal(second.trigger.textContent, 'Quality');
  await open(second.trigger);
  assert.notEqual(second.trigger.getAttribute('aria-controls'), firstControls);
  assert.equal(document.querySelectorAll('[role="listbox"]').length, 1);
  assert.equal(document.activeElement.textContent, 'Quality');
  await key(document.activeElement, 'Escape');
  assert.equal(document.activeElement, second.trigger);
  assert.equal(first.trigger.textContent, 'Speed');
});
