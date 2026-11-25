import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingFor, closingBindings } from '../src/session/bindings.ts';

function store(entries = []) {
  const records = new Map(entries);
  return {
    get length() {
      return records.size;
    },
    key: (i) => [...records.keys()][i] ?? null,
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
}

const nonce = '01234567-89ab-4cde-8012-3456789abcde';
const prefix = 'rio-terminal.binding.v1.';

test('a v1 tab binding keeps its persisted key, nonce and host ID across recovery', async () => {
  const storage = store();
  const binding = bindingFor(() => storage, 'session/海', 'tab:"one"');
  const key = String.raw`rio-terminal.binding.v1.["session/海","tab:\"one\""]`;
  const id =
    'rio-v1-8e18b10c72c89675d4ec7646196f94210183ece4e915cc47ccf896b65e1d20f1';
  assert.deepEqual(await binding.identity(nonce), { id, nonce });
  assert.equal(binding.read(), undefined);
  binding.remember(nonce);
  assert.equal(storage.getItem(key), JSON.stringify({ nonce, closing: false }));

  const recovered = bindingFor(() => storage, 'session/海', 'tab:"one"');
  assert.deepEqual(await recovered.identity(recovered.read().nonce), {
    id,
    nonce,
  });
  recovered.beginClose();
  assert.equal(storage.getItem(key), JSON.stringify({ nonce, closing: true }));
  recovered.forget();
  assert.equal(storage.length, 0);
});

test('only canonical, validated closing records can authorize startup cleanup', () => {
  const closing = JSON.stringify({ nonce, closing: true });
  const entries = [
    [`${prefix}["s","accepted"]`, closing],
    [`${prefix}["s", "whitespace"]`, closing],
    [`${prefix}["s","extra",false]`, closing],
    ['rio-terminal.binding.v2.["s","wrong-version"]', closing],
    [`${prefix}not-json`, closing],
    [`${prefix}["s","bad-json"]`, '{'],
    [
      `${prefix}["s","bad-nonce"]`,
      JSON.stringify({ nonce: 'other', closing: true }),
    ],
    [`${prefix}["s","bad-flag"]`, JSON.stringify({ nonce, closing: 'true' })],
    [`${prefix}["s","open"]`, JSON.stringify({ nonce, closing: false })],
    [`${prefix}["another","accepted"]`, closing],
  ];
  const storage = store(entries);
  assert.deepEqual(closingBindings(storage), [
    { session: 's', content: 'accepted' },
    { session: 'another', content: 'accepted' },
  ]);
  assert.equal(storage.length, entries.length);
  for (const [key, value] of entries) assert.equal(storage.getItem(key), value);
});
