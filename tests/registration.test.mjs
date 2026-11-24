import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// DSH loads this as a classic script. Evaluating it must only register a
// factory, without touching React, initializing WASM, or making requests.
test('the client registers lazily under the published package name', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const script = await readFile(
    new URL(`../${manifest.exports['./client']}`, import.meta.url),
    'utf8',
  );
  const registrations = [];
  runInNewContext(script, {
    TextEncoder,
    TextDecoder,
    window: {
      __ModuleLoader__: { load: (entry) => registrations.push(entry) },
    },
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, manifest.name);
  const requested = new Set();
  const client = registrations[0].factory((name) => {
    assert.equal(name, 'react');
    requested.add(name);
    return {};
  });
  assert.deepEqual([...requested], ['react']);
  assert.equal(typeof client.apply, 'function');
});
