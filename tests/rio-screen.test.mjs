import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { initWasm } from 'rioterm';
import { RioTerminal, RioTextInput } from '../src/rio-terminal.ts';

// Real published parser, keyboard and mouse encoders. These are not DOM, IME
// driver or pixel-level tests: the matching live GUI checks still matter.
before(async () => {
  await initWasm(
    await readFile(
      new URL('../wasm/librio_wasm_bg.wasm', import.meta.resolve('rioterm')),
    ),
  );
});
function viewport(t) {
  const writes = [],
    sizes = [];
  const view = new RioTerminal({
    cols: 12,
    rows: 3,
    scrollback: 8,
    onInput: (...frame) => writes.push(frame),
    onResize: (...size) => sizes.push(size),
  });
  t.after(() => view.dispose());
  return { view, writes, sizes };
}
function key(key, extra = {}) {
  return {
    key,
    code: key,
    type: 'keydown',
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    ...extra,
  };
}

test('snapshot sets an exact fresh grid; parser auto-replies never escape replay or readonly', (t) => {
  const { view, writes } = viewport(t);
  view.writable = true;
  view.write('\x1b[?1049h\x1b[?25l\x1b['); // previous attachment ends mid-control
  view.snapshot(18, 5, '你好\x1b[6n\x1b[c');
  assert.equal(view.term.modes().altScreen, false);
  assert.deepEqual(view.term.cursorPosition(), {
    col: 4,
    line: 0,
    visible: true,
  });
  assert.deepEqual(writes, []);
  view.write('\x1b[6n');
  assert.deepEqual(writes.splice(0), [['\x1b[1;5R', false]]);
  view.writable = false;
  view.write('\x1b[6n\x1b[c');
  view.text('no');
  view.text('no', true);
  view.key(key('Enter'));
  assert.deepEqual(writes, []);
});

test('keyboard uses Rio modes, genuine input remains distinct from synchronous VT responses', (t) => {
  const { view, writes } = viewport(t);
  view.writable = true;
  assert.equal(view.key(key('c', { ctrlKey: true })), true);
  view.write('\x1b[6n\x1b[?1h');
  assert.equal(view.key(key('ArrowUp')), true);
  assert.equal(view.key(key('Enter')), true);
  view.text('中文');
  view.write('\x1b[?2004h');
  view.text('a\n中文', true);
  view.write('\x1b[?2004l');
  view.text('a\nb', true);
  assert.deepEqual(writes, [
    ['\x03', true],
    ['\x1b[1;1R', false],
    ['\x1bOA', true],
    ['\r', true],
    ['中文', true],
    ['\x1b[200~a\r中文\x1b[201~', true],
    ['a\rb', true],
  ]);
  assert.equal(view.key(key('Enter', { isComposing: true })), false);
  assert.equal(view.key(key('Enter', { keyCode: 229 })), false);
  view.visible = false;
  view.text('hidden');
  assert.equal(view.key(key('Enter')), false);
  assert.equal(writes.length, 7);
});

test('IME state commits once across both browser event orders; cancelling does not type', () => {
  const ime = new RioTextInput();
  ime.start();
  assert.equal(ime.input('ni', 'insertCompositionText', true), '');
  assert.equal(ime.input('你', 'insertFromComposition', false), '');
  assert.equal(ime.end('你'), '你');
  assert.equal(ime.input('你', 'insertText', false), '');
  ime.key();
  assert.equal(ime.input('你', 'insertText', false), '你');
  ime.start();
  ime.reset();
  assert.equal(ime.end('no'), '');
});

test('wheel scrolls history or produces Rio SGR mouse bytes, never an Agent takeover', (t) => {
  const { view, writes } = viewport(t);
  view.snapshot(12, 3, '1\r\n2\r\n3\r\n4\r\n5\r\n6');
  assert.equal(view.term.historySize(), 3);
  assert.equal(view.wheel(1, 2, 1, 0), true);
  assert.equal(view.term.displayOffset(), 1);
  assert.deepEqual(writes, []);
  view.writable = true;
  view.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h');
  assert.equal(view.wheel(1, 2, 1, 0), true);
  assert.deepEqual(writes.splice(0), [['\x1b[<64;3;2M', false]]);
  view.writable = false;
  view.wheel(1, 2, 1, 0);
  assert.deepEqual(writes, []);
});

test('layout measures bounded sizes without changing the grid; only a visible writer makes requests', (t) => {
  const { view, sizes, writes } = viewport(t);
  view.fit(640, 300, 8, 15);
  assert.deepEqual(sizes, []);
  view.visible = false;
  view.writable = true;
  view.fit(640, 300, 8, 15);
  assert.deepEqual(sizes, []);
  view.visible = true;
  view.fit(0, 0, 8, 15);
  view.fit(640, 300, 8, 15);
  assert.deepEqual(sizes, [[80, 20]]);
  assert.deepEqual([view.term.options.cols, view.term.options.rows], [12, 3]);
  view.fit(8000, 8000, 8, 15);
  assert.deepEqual(sizes.at(-1), [500, 200]);
  view.resize(80, 20); // Host state, independent of the newest proposal
  view.write('\x1b[8;4H\x1b[?25l');
  assert.deepEqual(view.term.cursorPosition(), {
    col: 3,
    line: 7,
    visible: false,
  });
  view.write('\x1b[?25h');
  assert.equal(view.term.cursorPosition().visible, true);
  assert.deepEqual(writes, []);
  view.dispose();
  view.write('\x1b[6n');
  view.fit(640, 300, 8, 15);
  assert.deepEqual(writes, []);
  assert.equal(sizes.length, 2);
});
