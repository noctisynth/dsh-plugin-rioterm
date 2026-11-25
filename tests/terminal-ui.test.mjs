import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createJiti } from 'jiti';
import postcss from 'postcss';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { compileUiStyles } from '../build/ui-styles.ts';
import { cn } from '../src/lib/cn.ts';

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

test('component class overrides merge by variant without changing unprefixed host classes', () => {
  assert.equal(
    cn('host-button rio:px-3 rio:hover:bg-primary', false, [
      'rio:px-5',
      'rio:hover:bg-accent',
    ]),
    'host-button rio:px-5 rio:hover:bg-accent',
  );
});

test('guide is one named native button, sizes override the primitive, and opening is explicit', () => {
  let opens = 0;
  const tree = TestRenderer.create(
    React.createElement(TerminalGuide, {
      title: 'Rio',
      description: 'Start a shell',
      onOpen: () => {
        opens++;
      },
    }),
  );
  try {
    const button = tree.root.findByType('button');
    assert.equal(button.props['data-rio-ui'], 'guide');
    assert.equal(
      button.props['data-sidebar-right-guide-entry'],
      'rio-terminal',
    );
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-label'], 'Rio');
    const description = button.props['aria-describedby'];
    assert.ok(description);
    assert.deepEqual(button.findByProps({ id: description }).children, [
      'Start a shell',
    ]);
    assert.equal(button.props.autoFocus, undefined);
    assert.ok(!button.props.className.split(' ').includes('rio:min-h-9'));
    assertCompiled(button.props.className, ':where(:scope)');
    assert.equal(opens, 0);
    button.props.onClick();
    assert.equal(opens, 1);
  } finally {
    tree.unmount();
  }
});

test('page keeps an independent full-size viewport even when status is visible', () => {
  const tree = TestRenderer.create(
    React.createElement(TerminalPage, {
      t: key,
      visible: false,
      launchTicket: undefined,
      session: {},
      issueLaunch: assert.fail,
      openNew: assert.fail,
    }),
  );
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
  } finally {
    tree.unmount();
  }
});

test('all notice states expose just their intended action, native disclosure and one live message', () => {
  const cases = [
    ['connected'],
    ['loading'],
    ['opening'],
    ['idle', 'start', 'start'],
    ['readonly', 'control', 'retry'],
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
      assert.deepEqual(live[0].children, [status]);
      assert.equal(live[0].findAllByType('button').length, 0);
      const details = tree.root.findByType('details');
      assert.equal(details.props.open, undefined);
      assert.deepEqual(details.findByType('summary').children, ['details']);
      const buttons = tree.root.findAllByType('button');
      assert.equal(buttons.length, label ? 1 : 0);
      assert.deepEqual(actions, []);
      if (label) {
        assert.deepEqual(buttons[0].children, [label]);
        buttons[0].props.onClick();
        assert.deepEqual(actions, [operation]);
      }
    } finally {
      tree.unmount();
    }
  }
});
