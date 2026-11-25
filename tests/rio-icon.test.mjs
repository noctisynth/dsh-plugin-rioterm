import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import React from 'react';
import TestRenderer from 'react-test-renderer';

const jiti = createJiti(import.meta.url, { jsx: true, fsCache: false });
const { RioIcon } = await jiti.import('../src/components/rio-icon.tsx');
const asset = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');

// The package SVG has tile margins; the inline SVG uses the title/guide's box.
// Their paths, gradient and colors must still describe exactly the same mark.
function tags(name) {
  return [...asset.matchAll(new RegExp(`<${name}\\s([^>]+)>`, 'g'))].map(
    ([, attrs]) =>
      Object.fromEntries(
        [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
      ),
  );
}

test('sidebar uses the exported classic Rio artwork, with decorative, instance-local SVGs', () => {
  const tree = TestRenderer.create(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(RioIcon),
      React.createElement(RioIcon, { size: 26 }),
    ),
  );
  try {
    const [first, second] = tree.root.findAllByType('svg');
    assert.equal(first.props.width, 16);
    assert.equal(second.props.width, 26);
    const [assetGradient] = tags('linearGradient');
    const ids = new Set();
    for (const icon of [first, second]) {
      assert.equal(icon.props.width, icon.props.height);
      assert.equal(icon.props['aria-hidden'], 'true');
      assert.equal(icon.props.focusable, 'false');
      const { children, id, ...coords } =
        icon.findByType('linearGradient').props;
      ids.add(id);
      assert.deepEqual({ ...coords, id: assetGradient.id }, assetGradient);
      assert.deepEqual(
        icon.findAllByType('stop').map(({ props: { stopColor, ...rest } }) => ({
          'stop-color': stopColor,
          ...rest,
        })),
        tags('stop'),
      );
      assert.deepEqual(
        icon.findAllByType('path').map(({ props: { d, fill } }) => ({
          d,
          fill: fill.replace(`url(#${id})`, `url(#${assetGradient.id})`),
        })),
        tags('path'),
      );
    }
    assert.equal(ids.size, 2);
  } finally {
    tree.unmount();
  }
});
