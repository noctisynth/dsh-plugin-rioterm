import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const routePath = '/dsh-plugin-rioterm/wasm/0.1.8.wasm';
const owner = {
  principal: { kind: 'owner' },
  signal: new AbortController().signal,
};
const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);

// Isolate each build layout: never alter the real bundled asset, and never
// require a DSH profile, network, or a server listening on a developer port.
async function host(t, admit, withAsset = true) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-rioterm-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'index.mjs');
  await copyFile(new URL('../lib/index.js', import.meta.url), entry);
  if (withAsset) await writeFile(join(dir, 'rioterm-0.1.8.wasm'), wasmBytes);
  const plugin = await import(pathToFileURL(entry).href);
  assert.deepEqual(plugin.inject, ['webServer', 'connection']);
  let route;
  let dispose;
  let removed = false;
  plugin.apply({
    connection: { admit },
    webServer: {
      register(value) {
        route = value;
        return () => {
          removed = true;
        };
      },
    },
    effect(register) {
      dispose = register();
    },
  });
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, routePath);
  t.after(() => {
    dispose();
    assert.ok(removed);
  });
  return route.resource;
}

function request(method = 'GET', query = '') {
  return new Request(`https://dsh.test${routePath}${query}`, { method });
}

test('GET and HEAD serve the same fixed artifact; query parameters do not select files', async (t) => {
  const get = request('GET', '?file=ignored');
  const head = request('HEAD');
  const seen = [];
  const resource = await host(t, (req) => {
    seen.push(req);
    return { peer: owner };
  });
  const result = await resource(get);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'application/wasm');
  assert.equal(result.headers.get('content-length'), String(wasmBytes.length));
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    result.headers.get('cross-origin-resource-policy'),
    'same-origin',
  );
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  const bytes = new Uint8Array(await result.arrayBuffer());
  assert.deepEqual(bytes, wasmBytes);
  assert.ok(WebAssembly.validate(bytes));
  const metadata = await resource(head);
  assert.equal(metadata.status, 200);
  assert.deepEqual([...metadata.headers], [...result.headers]);
  assert.equal(metadata.body, null);
  assert.deepEqual(seen, [get, head]);
});

test('HTTP trust/credential rejection takes precedence over a missing file', async (t) => {
  for (const rejection of [401, 403]) {
    const resource = await host(t, () => ({ rejection }), false);
    for (const method of ['GET', 'HEAD']) {
      const result = await resource(request(method));
      assert.equal(result.status, rejection);
      assert.equal(result.body, null);
      assert.equal(result.headers.get('content-length'), null);
    }
  }
});

test('in-process resource reads require a live admitted owner peer', async (t) => {
  const resource = await host(t, () =>
    assert.fail('an in-process peer does not authenticate via cookies'),
  );
  assert.equal((await resource(request(), owner)).status, 200);
  assert.equal(
    (await resource(request(), { ...owner, principal: { kind: 'remote' } }))
      .status,
    403,
  );
  assert.equal(
    (await resource(request(), { ...owner, signal: AbortSignal.abort() }))
      .status,
    403,
  );
});

test('missing assets have no body or path leak, unsupported methods return 405', async (t) => {
  const resource = await host(t, () => ({ peer: owner }), false);
  for (const method of ['GET', 'HEAD']) {
    const result = await resource(request(method));
    assert.equal(result.status, 404);
    assert.equal(result.body, null);
  }
  const result = await resource(request('POST'));
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('allow'), 'GET, HEAD');
});
