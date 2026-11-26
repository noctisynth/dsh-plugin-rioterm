import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createJiti } from 'jiti';
import postcss from 'postcss';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { compileUiStyles } from '../build/ui-styles.ts';
import { cn } from '../src/lib/cn.ts';
import { defaultEffectivePreferences } from '../src/preferences/values.ts';

// Exercise real React components and Tailwind output; no browser, live PTY or pixels involved.
const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { TerminalNotice } = await jiti.import(
  '../src/pages/terminal/terminal-notice.tsx',
);
const { TerminalGuide } = await jiti.import(
  '../src/pages/terminal/terminal-guide.tsx',
);
const { TerminalPage } = await jiti.import(
  '../src/pages/terminal/terminal-page.tsx',
);
const { TerminalSearch } = await jiti.import(
  '../src/pages/terminal/terminal-search.tsx',
);
const cssSelectors = new Set();
let css;
before(async () => {
  css = await compileUiStyles();
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors) cssSelectors.add(selector);
  });
});
function assertCompiled(className, prefix = '') {
  for (const token of className.split(/\s+/).filter(Boolean)) {
    assert.ok(token.startsWith('rio:'), `unprefixed: ${token}`);
    const selector = `${prefix}.${token.replace(/[^\w-]/g, (ch) => `\\${ch}`)}`;
    assert.ok(
      [...cssSelectors].some(
        (entry) => entry === selector || entry.startsWith(`${selector}:`),
      ),
      `no generated utility for ${token}`,
    );
  }
}
const key = (value) => value;

test('the emitted stylesheet has no document selectors, unowned properties, imports or global reset', () => {
  const sheet = postcss.parse(css);
  const scopes = sheet.nodes.filter(
    (node) => node.type === 'atrule' && node.name === 'scope',
  );
  assert.equal(scopes.length, 1);
  const [scope] = scopes;
  assert.equal(scope.params, '([data-rio-ui])');
  sheet.walkRules((rule) => {
    let p = rule.parent;
    while (p && p !== scope) p = p.parent;
    assert.equal(p, scope, `unscoped rule ${rule.selector}`);
    assert.doesNotMatch(rule.selector, /:root|:host|\bhtml\b|\bbody\b/);
  });
  for (const node of sheet.nodes) {
    if (node.type === 'comment' || node === scope) continue;
    assert.equal(node.name, 'property');
    assert.match(node.params, /^--dsh-rio-tw-/);
  }
  assert.doesNotMatch(css, /--tw-|@import|@font-face|url\s*\(/);
  assert.match(css, /--dsw-alias-bg-base/);
  assert.match(css, /--dsw-alias-label-primary-foreground/);
  assertCompiled(
    'rio:absolute rio:inset-0 rio:overflow-clip rio:pointer-events-none rio:h-[1em]',
  );
});

test('terminal keyboard focus paints above the renderer without changing grid geometry or intercepting pointers', () => {
  const sheet = postcss.parse(css);
  const rules = new Map();
  sheet.walkRules((rule) => {
    if (!rule.selector.includes('[data-rio-screen]')) return;
    const values = new Map();
    rule.walkDecls((decl) => values.set(decl.prop, decl.value));
    rules.set(rule.selector.replace('::after', ':after'), values);
  });
  const screen = rules.get('[data-rio-screen]');
  assert.equal(screen?.get('isolation'), 'isolate');
  const ring = rules.get('[data-rio-screen][data-rio-keyboard-focus]:after');
  assert.ok(
    ring,
    'focus indication must be a separate overlay, not a root outline',
  );
  for (const [property, value] of [
    ['position', 'absolute'],
    ['inset', '0'],
    ['z-index', '1'],
    ['box-sizing', 'border-box'],
    ['pointer-events', 'none'],
  ])
    assert.equal(ring.get(property), value, property);
  assert.match(ring.get('content'), /^(?:""|'')$/);
  assert.match(ring.get('border'), /1px solid var\(--dsw-focus-ring-color/);
  for (const [selector, values] of rules) {
    assert.equal(values.has('outline'), false, selector);
    assert.equal(values.has('outline-offset'), false, selector);
    if (!selector.endsWith(':after')) {
      assert.equal(
        values.has('border'),
        false,
        'the grid root must not lose a border width',
      );
      assert.equal(values.has('padding'), false);
    }
  }
});

test('search feedback animation and borderless inset utilities compile inside the Rio scope', () => {
  assertCompiled(
    'rio:animate-search-spin rio:motion-reduce:animate-none rio:pe-[min(7rem,50%)] rio:max-w-[calc(50%_-_0.5rem)] rio:border-0 rio:bg-transparent',
  );
  const sheet = postcss.parse(css);
  const animations = [];
  sheet.walkAtRules('keyframes', (rule) => animations.push(rule));
  const spin = animations.find((rule) => rule.params === 'rio-search-spin');
  assert.ok(spin, 'the loading indicator must have an emitted animation');
  assert.equal(spin.parent.name, 'scope');
  assert.equal(spin.parent.params, '([data-rio-ui])');
  const reductions = [];
  sheet.walkAtRules('media', (rule) => {
    if (rule.params.includes('prefers-reduced-motion:reduce'))
      rule.walkDecls('animation', (decl) => reductions.push(decl.value));
  });
  assert.ok(reductions.includes('none'));
});

test('search uses one themed outer boundary while its input and actions stay borderless', () => {
  let tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(TerminalSearch, {
        t: key,
        status: 'connected',
        searchRevision: 0,
        search: assert.fail,
        clearSearch() {},
        focusTerminal() {},
      }),
    );
  });
  try {
    TestRenderer.act(() => tree.root.findByType('button').props.onClick());
    const frame = tree.root.findByType('search');
    for (const token of [
      'rio:border',
      'rio:border-solid',
      'rio:border-border',
      'rio:bg-background',
      'rio:shadow-md',
      'rio:w-96',
      'rio:max-w-full',
      'rio:px-2',
      'rio:py-1',
    ]) {
      assert.ok(frame.props.className.split(' ').includes(token), token);
      assertCompiled(token);
    }
    for (const node of [
      tree.root.findByType('input'),
      ...frame.findAllByType('button'),
    ]) {
      const classes = node.props.className.split(' ');
      assert.ok(classes.includes('rio:border-0'));
      assert.ok(!classes.includes('rio:border-border'));
    }
    const input = tree.root.findByType('input');
    assert.equal(input.props['data-slot'], 'input');
    assert.equal(
      input.props.size,
      undefined,
      'component size is not a native character width',
    );
    const inputClasses = input.props.className.split(' ');
    for (const token of ['rio:h-7', 'rio:text-xs']) {
      assert.ok(inputClasses.includes(token), token);
      assertCompiled(token);
    }
    assert.ok(!inputClasses.includes('rio:h-8'));
    assert.ok(!inputClasses.includes('rio:text-sm'));
    for (const button of frame.findAllByType('button'))
      assert.ok(button.props.className.split(' ').includes('rio:size-8'));
    assert.match(css, /--dsw-alias-border-l2/);
  } finally {
    TestRenderer.act(() => tree.unmount());
  }
});

test('component class overrides merge by variant without changing unprefixed host classes', () => {
  assert.equal(
    cn('host-button rio:px-3 rio:hover:bg-primary', false, [
      'rio:px-5',
      'rio:hover:bg-accent',
    ]),
    'host-button rio:px-5 rio:hover:bg-accent',
  );
});

test('guide keeps one native launch button and the same text inset in both densities', () => {
  let opens = 0;
  const render = (description) =>
    React.createElement(TerminalGuide, {
      title: 'Rio',
      description,
      onOpen: () => {
        opens++;
      },
    });
  const tree = TestRenderer.create(render('Start a shell'));
  try {
    const button = tree.root.findByType('button');
    assert.equal(button.props['data-rio-ui'], 'guide');
    assert.equal(
      button.props['data-sidebar-right-guide-entry'],
      'rio-terminal',
    );
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-label'], 'Rio');
    assert.equal(button.props.autoFocus, undefined);
    assertCompiled(button.props.className, ':where(:scope)');
    const classes = button.props.className.split(' ');
    for (const token of [
      'rio:min-h-[56px]',
      'rio:gap-[14px]',
      'rio:border-[0.5px]',
      'rio:border-guide-border',
      'rio:rounded-guide',
      'rio:hover:bg-accent',
      'rio:focus-visible:outline-ring',
      'rio:focus-visible:-outline-offset-2',
    ]) {
      assert.ok(classes.includes(token), token);
    }
    // Just emitting rounded-guide isn't enough: rounded-md is later in the CSS.
    assert.deepEqual(
      classes.filter((token) => token.startsWith('rio:rounded-')),
      ['rio:rounded-guide'],
    );
    assert.match(
      css,
      /\.rio\\:rounded-guide[^{}]*\{border-radius:var\(--dsl-guide-entry-radius,/,
    );
    const checkLayout = (glyphSize) => {
      const [icon, text] = button.children;
      assert.equal(icon.props['aria-hidden'], 'true');
      assert.ok(icon.props.className.includes('rio:size-[26px]'));
      const svg = icon.findByType('svg');
      assert.equal(svg.props.width, glyphSize);
      assert.equal(svg.props.height, glyphSize);
      assertCompiled(svg.props.className, ':where(:scope)');
      assert.ok(text.props.className.includes('rio:min-w-0'));
      const [title] = text.children;
      assert.deepEqual(title.children, ['Rio']);
      assert.ok(title.props.className.includes('rio:truncate'));
      for (const span of button.findAllByType('span')) {
        assertCompiled(span.props.className);
      }
    };
    const description = button.props['aria-describedby'];
    assert.ok(description);
    const hint = button.findByProps({ id: description });
    assert.deepEqual(hint.children, ['Start a shell']);
    assert.ok(hint.props.className.includes('rio:truncate'));
    checkLayout(26);
    tree.update(render(undefined)); // The host hides descriptions in longer lists.
    assert.equal(tree.root.findByType('button'), button);
    assert.equal(button.props['aria-describedby'], undefined);
    assert.equal(button.findAllByProps({ id: description }).length, 0);
    checkLayout(22);
    assert.equal(opens, 0);
    button.props.onClick();
    assert.equal(opens, 1);
  } finally {
    tree.unmount();
  }
});

test('the viewport keeps its own content box and applies four live insets without remounting', () => {
  let preferences = defaultEffectivePreferences;
  const listeners = new Set();
  const appearance = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => preferences,
  };
  let tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(TerminalPage, {
        t: key,
        visible: false,
        launchTicket: undefined,
        session: {},
        appearance,
        issueLaunch: assert.fail,
        openNew: assert.fail,
      }),
    );
  });
  try {
    const root = tree.root.findByType('section');
    assert.equal(root.props['data-rio-ui'], 'terminal');
    const [viewport] = root.findAll(
      (n) => n.type === 'div' && n.props['data-rio-viewport'],
    );
    assert.equal(viewport.parent, root);
    assert.equal(viewport.props['aria-busy'], true);
    assert.equal(root.props['aria-busy'], undefined);
    const ready = root.findByType('span');
    assert.equal(ready.props.role, 'status');
    assert.deepEqual(ready.children, []);
    assertCompiled(ready.props.className);
    assert.deepEqual(viewport.children, []);
    assert.match(viewport.props.className, /rio:absolute/);
    assert.match(viewport.props.className, /rio:inset-0/);
    assertCompiled(root.props.className, ':where(:scope)');
    assertCompiled(viewport.props.className);
    assert.match(viewport.props.className, /rio:box-border/);
    assert.match(viewport.props.className, /rio:border-solid/);
    assert.deepEqual(viewport.props.style, {
      borderTopWidth: 16,
      borderRightWidth: 8,
      borderBottomWidth: 8,
      borderLeftWidth: 8,
      borderColor: 'transparent',
    });
    TestRenderer.act(() => {
      preferences = {
        ...preferences,
        paddingTop: 0,
        paddingRight: 3,
        paddingBottom: 17,
        paddingLeft: 64,
        theme: { background: '#102030' },
      };
      for (const notify of listeners) notify();
    });
    assert.equal(
      tree.root.find((n) => n.type === 'div' && n.props['data-rio-viewport']),
      viewport,
    );
    assert.deepEqual(viewport.props.style, {
      borderTopWidth: 0,
      borderRightWidth: 3,
      borderBottomWidth: 17,
      borderLeftWidth: 64,
      borderColor: '#102030',
    });
  } finally {
    TestRenderer.act(() => tree.unmount());
  }
  assert.equal(listeners.size, 0);
});

test('takeover transfers focus only from the active button in a foreground document', () => {
  const focus = [];
  const tree = TestRenderer.create(
    React.createElement(TerminalNotice, {
      state: { status: 'readonly' },
      t: key,
      onRetry: (value) => focus.push(value),
    }),
  );
  try {
    const button = tree.root.findByType('button');
    assert.deepEqual(button.children, ['control']); // A connected reader needn't reconnect.
    const doc = { hidden: false, hasFocus: () => true };
    const event = { currentTarget: { ownerDocument: doc } };
    button.props.onClick(event); // Focus elsewhere
    doc.activeElement = event.currentTarget;
    button.props.onClick(event);
    doc.hidden = true;
    button.props.onClick(event);
    doc.hidden = false;
    doc.hasFocus = () => false;
    button.props.onClick(event);
    assert.deepEqual(focus, [false, true, false, false]);
  } finally {
    tree.unmount();
  }
});

test('all notice states expose just their intended action, native disclosure and one live message', () => {
  const cases = [
    ['connected'],
    ['loading'],
    ['opening'],
    ['reconnecting'],
    ['idle', 'start', 'start'],
    ['readonly', 'reconnectControl', 'retry'],
    ['resourceFailed', 'retry', 'retry'],
    ['disconnected', 'reconnect', 'retry'],
    ['exited', 'new', 'new'],
    ['missing', 'new', 'new'],
    ['failed', 'new', 'new'],
    ['wasmFailed'],
  ];
  for (const [status, label, operation] of cases) {
    const actions = [];
    const tree = TestRenderer.create(
      React.createElement(TerminalNotice, {
        state: { status, detail: 'a long diagnostic' },
        t: key,
        onStart: () => actions.push('start'),
        onRetry: () => actions.push('retry'),
        onOpenNew: () => actions.push('new'),
      }),
    );
    try {
      if (status === 'connected') {
        assert.equal(tree.toJSON(), null);
        continue;
      }
      const elements = tree.root.findAll((n) => typeof n.type === 'string');
      for (const el of elements) {
        if (el.props.className) assertCompiled(el.props.className);
        assert.equal(el.props.style, undefined);
        assert.equal(el.props.autoFocus, undefined);
      }
      const live = elements.filter(
        (n) => n.props.role === 'alert' || n.props.role === 'status',
      );
      assert.equal(live.length, 1);
      assert.deepEqual(live[0].children, [
        status === 'readonly' ? 'readonlyDisconnected' : status,
      ]);
      assert.equal(live[0].findAllByType('button').length, 0);
      const details = tree.root.findByType('details');
      assert.equal(details.props.open, undefined);
      assert.deepEqual(details.findByType('summary').children, ['details']);
      const buttons = tree.root.findAllByType('button');
      assert.equal(buttons.length, label ? 1 : 0);
      assert.deepEqual(actions, []);
      if (label) {
        assert.deepEqual(buttons[0].children, [label]);
        buttons[0].props.onClick({
          currentTarget: { ownerDocument: { activeElement: null } },
        });
        assert.deepEqual(actions, [operation]);
      }
    } finally {
      tree.unmount();
    }
  }
});
