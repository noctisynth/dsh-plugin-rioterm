import assert from 'node:assert/strict';
import test from 'node:test';
import { initWasm, Terminal } from 'rioterm';
import { apply } from '../lib/index.js';

test('the production host resource initializes Rio and parses wide characters', async () => {
  let route;
  apply({
    effect: (register) => register(),
    webServer: {
      register(value) {
        route = value;
        return () => {};
      },
    },
    connection: {
      admit: () => ({
        peer: {
          principal: { kind: 'owner' },
          signal: new AbortController().signal,
        },
      }),
    },
  });
  assert.equal(route.path, '/dsh-plugin-rioterm/wasm/0.1.8.wasm');
  const response = await route.resource(
    new Request(`https://example.invalid${route.path}`),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/wasm');
  await initWasm(response);
  const terminal = new Terminal({ cols: 24, rows: 4 });
  try {
    terminal.write('Rio 就绪');
    assert.match(terminal.textRow(0), /^Rio 就\s*绪/);
    assert.equal(terminal.cursorPosition().col, 8);
  } finally {
    terminal.dispose();
  }
});
