import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { initWasm } from 'rioterm';
import { RioTerminal } from '../src/rio/terminal.ts';
import { EMPTY_SEARCH_RESULT } from '../src/terminal/search.ts';

before(async () => {
  await initWasm(
    await readFile(
      new URL('../wasm/librio_wasm_bg.wasm', import.meta.resolve('rioterm')),
    ),
  );
});

function fixture(t, cols = 12, rows = 3, scrollback = 1300) {
  let invalidations = 0;
  const view = new RioTerminal({
    cols,
    rows,
    scrollback,
    onSearchInvalidated: () => invalidations++,
    onInput: () => assert.fail('search must never send PTY input/control'),
    onResize: () => assert.fail('search must never fit/resize the PTY'),
  });
  t.after(() => view.dispose());
  // Only the published WASM coordinate search is allowed. Do not build a shadow buffer.
  for (const method of ['dump', 'serialize', 'textRow'])
    t.mock.method(view.term, method, () => assert.fail(method));
  return { view, invalidations: () => invalidations };
}
const result = (index, count, truncated = false) => ({
  index,
  count,
  truncated,
});

test('offscreen oldest retained line and bottom-right cell are reachable; directions wrap without PTY input', (t) => {
  const { view } = fixture(t, 5, 2, 1200);
  view.writable = true;
  view.write(`gone\r\nXold\r\n${'none\r\n'.repeat(1200)}xxxxX`);
  assert.equal(view.term.historySize(), 1200);
  assert.deepEqual(view.search('gone', 'first'), EMPTY_SEARCH_RESULT);
  assert.deepEqual(view.search('X', 'first'), result(1, 2));
  assert.equal(view.term.displayOffset(), 1200);
  assert.equal(view.term.getSelection(), 'X');
  const selection = () => view.term.snapshot().selection;
  assert.deepEqual(selection(), {
    startLine: 0,
    startCol: 0,
    endLine: 0,
    endCol: 0,
    isBlock: false,
  });
  assert.deepEqual(view.search('X', 'previous'), result(2, 2));
  assert.equal(view.term.displayOffset(), 0);
  assert.deepEqual(selection(), {
    startLine: 1,
    startCol: 4,
    endLine: 1,
    endCol: 4,
    isBlock: false,
  });
  assert.deepEqual(view.search('X', 'next'), result(1, 2));
  view.clearSearch();
  assert.equal(selection(), null);
  assert.deepEqual(view.search('X', 'previous'), result(2, 2));
});

test('search is literal, case-sensitive and cell-aware across soft wraps (not hard newlines)', (t) => {
  const { view } = fixture(t, 7, 3);
  const punctuation = '.*+?^{}$()|[]\\';
  const cluster = '界e\u0301👩‍💻';
  view.write(`${punctuation}\r\n---${cluster}\r\nFoo foo\r\n界\r\nFoo`);
  for (const [query, n] of [
    [punctuation, 1],
    ['[]', 1],
    [cluster, 1],
    ['Foo', 2],
    ['foo', 1],
  ]) {
    assert.deepEqual(view.search(query, 'first'), result(1, n));
    assert.equal(view.term.getSelection(), query);
    const selected = view.term.snapshot().selection;
    assert.ok(selected && selected.startLine >= 0 && selected.endLine < 3);
  }
  for (const query of ['界Foo', '界\nFoo', 'FOO', '.*?', 'é', '']) {
    assert.deepEqual(view.search(query, 'first'), EMPTY_SEARCH_RESULT);
    assert.equal(view.term.snapshot().selection, null);
  }
  view.write(`\r\n${'1234567'.repeat(5)}`);
  const long = '1234567'.repeat(5);
  assert.deepEqual(view.search(long, 'first'), result(1, 1));
  assert.equal(
    view.term.getSelection(),
    long,
    'endpoints may extend below viewport',
  );
  assert.equal(view.term.snapshot().selection.startLine, 0);
});

test('cap detects one extra real match; navigation reuses the bounded coordinate cache', (t) => {
  const { view } = fixture(t, 10, 2);
  const scan = t.mock.method(view.term, 'search');
  view.write('x\r\n'.repeat(1000));
  assert.deepEqual(view.search('x', 'first'), result(1, 1000));
  assert.deepEqual(view.search('x', 'previous'), result(1000, 1000));
  assert.deepEqual(view.search('x', 'next'), result(1, 1000));
  assert.equal(scan.mock.callCount(), 1);
  view.write('x');
  assert.equal(scan.mock.callCount(), 1);
  assert.deepEqual(view.search('x', 'refresh'), result(1, 1000, true));
  assert.deepEqual(view.search('x', 'previous'), result(1000, 1000, true));
  assert.equal(scan.mock.callCount(), 2);
});

test('output bursts invalidate once; refresh preserves the hit and never pulls a manually scrolled viewport', (t) => {
  const { view, invalidations } = fixture(t, 8, 3);
  const scan = t.mock.method(view.term, 'search');
  view.write(`hit1\r\nhit2\r\n${'other\r\n'.repeat(20)}`);
  assert.deepEqual(view.search('hit', 'first'), result(1, 2));
  assert.deepEqual(view.search('hit', 'next'), result(2, 2));
  view.term.scrollLines(-100);
  view.resize(8, 3);
  view.write('');
  assert.equal(invalidations(), 0);
  view.write('hit3\r\n');
  for (let i = 0; i < 32; i++) view.write('b');
  assert.equal(
    view.term.getSelection(),
    'hit',
    'no blinking away on each append',
  );
  assert.equal(invalidations(), 1);
  assert.equal(scan.mock.callCount(), 1);
  assert.deepEqual(view.search('hit', 'refresh'), result(2, 3));
  assert.equal(view.term.displayOffset(), 0);
  assert.equal(view.term.snapshot().selection, null);
  assert.deepEqual(view.search('hit', 'next'), result(3, 3));
  assert.ok(view.term.snapshot().selection);
  view.resize(20, 5);
  assert.equal(invalidations(), 2);
  assert.deepEqual(view.search('no match', 'first'), EMPTY_SEARCH_RESULT);
  view.write('\r\nno match');
  assert.equal(invalidations(), 3, 'a cached miss can become a live match');
  assert.deepEqual(view.search('no match', 'refresh'), result(1, 1));
  view.clearSearch();
  view.write('x');
  assert.equal(invalidations(), 3);
});

test('refresh removes a retained highlight if in-place output overwrote the last hit', (t) => {
  const { view } = fixture(t);
  view.write('hit');
  view.search('hit', 'first');
  view.write('\rnew');
  assert.deepEqual(view.search('hit', 'refresh'), EMPTY_SEARCH_RESULT);
  assert.equal(view.term.snapshot().selection, null);
});

test('old coordinates cannot cross parser replacement, alternate screen, views or disposal', (t) => {
  const { view } = fixture(t);
  const { view: other } = fixture(t);
  view.write('hit hit');
  assert.deepEqual(view.search('hit', 'previous'), result(2, 2));
  assert.deepEqual(other.search('hit', 'first'), EMPTY_SEARCH_RESULT);
  view.snapshot(10, 2, 'hit\r\nhit');
  assert.equal(view.term.snapshot().selection, null);
  assert.deepEqual(view.search('hit', 'refresh'), result(1, 2));
  assert.equal(view.term.snapshot().selection.startCol, 0);
  view.write('\x1b[?1049h\x1b[2Jalt');
  assert.equal(view.term.snapshot().selection, null);
  assert.deepEqual(view.search('hit', 'first'), EMPTY_SEARCH_RESULT);
  assert.deepEqual(view.search('alt', 'first'), result(1, 1));
  view.write('\x1b[?1049l');
  assert.equal(view.term.snapshot().selection, null);
  assert.deepEqual(view.search('hit', 'first'), result(1, 2));
  view.dispose();
  view.clearSearch();
  assert.deepEqual(view.search('hit', 'next'), EMPTY_SEARCH_RESULT);
});

test('automatic invalidation, refresh and closing find leave a newer pointer selection alone', (t) => {
  const { view } = fixture(t);
  view.write('hit copy');
  view.search('hit', 'first');
  view.beginPointerSelection(0, 4);
  view.term.selectionUpdate(0, 7, true);
  view.write('\r\nnext');
  view.search('hit', 'refresh');
  assert.equal(view.term.getSelection(), 'copy');
  view.clearSearch();
  assert.equal(view.term.getSelection(), 'copy');
});
