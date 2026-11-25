import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { initWasm } from 'rioterm';
import { RioTerminal } from '../src/rio/terminal.ts';
import { TerminalWire } from '../src/session/wire.ts';

// Replay deterministic output/state interleavings through the plugin and the
// shipping Rio parser. No native shell, mock grid, or DOM timing assumptions.
before(async () => {
  await initWasm(
    await readFile(
      new URL('../wasm/librio_wasm_bg.wasm', import.meta.resolve('rioterm')),
    ),
  );
});
const id = 'resize-fixture';
const limits = {
  maxCols: 200,
  maxRows: 100,
  maxInputBytes: 65536,
  maxBufferedBytes: 65536,
  scrollback: 100,
};
const info = (cols, rows) => ({
  id,
  origin: 'user',
  control: 'user',
  state: 'running',
  exitCode: null,
  cols,
  rows,
});
const state = (cols, rows, writable = true) => ({
  type: 'state',
  info: info(cols, rows),
  writable,
});
const ack = (sequence) => ({ type: 'ack', sequence });
async function replay(frames) {
  let wire;
  const sent = [];
  const core = new RioTerminal({
    onResize: (c, r) => wire.resize(c, r),
    onInput: (data, typed) => wire.write(data, typed),
  });
  const handle = {
    send(cmd) {
      sent.push(cmd);
    },
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'snapshot',
        info: info(80, 18),
        sequence: 0,
        writable: true,
        screen: 'result\r\n\r\n❯ ',
      };
      yield* frames(core, (c, r) => core.fit(c * 8, r * 16, 8, 16), sent);
    },
  };
  wire = new TerminalWire(
    id,
    handle,
    limits,
    {
      snapshot: (...args) => core.snapshot(...args),
      write: (d) => core.write(d),
      setWritable: (w) => {
        core.writable = w;
      },
      resize: (c, r) => core.resize(c, r),
    },
    () => {},
  );
  try {
    await wire.consume(new AbortController().signal);
  } finally {
    core.dispose();
  }
  return sent;
}

test('dragging narrower and wider does not accumulate blank lines when a redraw precedes the Host size change', async () => {
  const cycles = 30;
  const commands = await replay(function* (core, fit) {
    let output = 0,
      input = 0;
    for (let i = 0; i < cycles; i++) {
      fit(32, 12);
      // PTY already emitted this 80-column prompt cleanup before processing
      // the request. At 32 columns the spaces wrap and the erase hits a different row.
      yield {
        type: 'output',
        sequence: ++output,
        data: `\r${' '.repeat(79)}\r\x1b[2K❯ `,
      };
      yield state(32, 12);
      yield ack(++input);
      yield { type: 'output', sequence: ++output, data: '\r\x1b[2K❯ ' };
      fit(80, 18);
      yield state(80, 18);
      yield ack(++input);
      assert.equal(core.term.dump(), 'result\n\n❯'); // keep the intentional blank line
      assert.deepEqual(core.term.cursorPosition(), {
        line: 2,
        col: 2,
        visible: true,
      });
      assert.equal(core.term.historySize(), 0);
    }
  });
  assert.equal(commands.length, cycles * 2);
  assert.ok(commands.every((c) => c.type === 'resize'));
});

test('height changes do not manufacture or erase history when growing the viewport reveals old rows', async () => {
  await replay(function* (core, fit) {
    // A program left empty lines in history, then located the prompt at the
    // top of the live grid. Its physical row need not stay fixed on growth.
    yield {
      type: 'output',
      sequence: 1,
      data: `${'\r\n'.repeat(40)}\x1b[Hmarker> `,
    };
    const dump = core.term.dump();
    const row = () => core.term.search('marker>')[0].startLine;
    const original = row();
    let seq = 0;
    for (let i = 0; i < 30; i++) {
      for (const rows of [12, 18]) {
        fit(80, rows);
        yield state(80, rows);
        yield ack(++seq);
        assert.equal(core.term.dump(), dump);
        assert.equal(row(), original);
        assert.equal(
          core.term.historySize() + core.term.cursorPosition().line,
          original,
        );
      }
    }
  });
});

test('a late size report cannot suppress the final drag target, and readonly views follow Host sizes without echo', async () => {
  await replay(function* (core, fit, sent) {
    const widths = () => sent.map((c) => c.cols);
    fit(48, 18);
    fit(90, 18);
    yield state(48, 18);
    yield ack(1);
    fit(48, 18);
    fit(48, 18);
    assert.deepEqual(widths(), [48, 90, 48]); // still need to undo the 90-column request
    yield state(90, 18);
    yield ack(2);
    assert.equal(core.term.options.cols, 90);
    yield state(48, 18);
    yield ack(3);
    yield state(36, 10, false);
    fit(42, 12);
    assert.deepEqual(
      [core.term.options.cols, core.term.options.rows],
      [36, 10],
    );
    assert.deepEqual(widths(), [48, 90, 48]);
  });
});
