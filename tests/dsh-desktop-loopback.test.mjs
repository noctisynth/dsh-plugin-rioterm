// Optional desktop contract test. No OS terminal, shell, profile or network.
// Only the subprocess handle and Gateway carrier are in memory. The Host
// controller/serializer and the plugin's Rio WASM + wire are the real ones.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { initWasm } from 'rioterm';
import { TerminalWire } from '../src/dsh-protocol.ts';
import { RioTerminal } from '../src/rio-terminal.ts';

const desktop = process.versions.electron && process.env.DSH_INSTALL_DIR;
test('desktop controller and Rio exchange input, resize, screen snapshots and exit over an in-memory carrier', {
  skip: !desktop,
  timeout: 6000,
}, async (t) => {
  const requireDsh = createRequire(join(desktop, 'package.json'));
  const load = (name) => import(pathToFileURL(requireDsh.resolve(name)));
  const { Context } = await load('@deepseek-ai/cordis');
  const { TerminalController } = await load(
    '@deepseek-ai/dsh-api-terminal-controller',
  );
  await initWasm(
    await readFile(new URL('../lib/rioterm-0.1.8.wasm', import.meta.url)),
  );
  const ctx = new Context();
  const output = new PassThrough();
  const exit = Promise.withResolvers();
  const input = [];
  const sizes = [];
  const handle = {
    output,
    done: exit.promise,
    write: async (d) => {
      input.push(d);
    },
    resize: async (c, r) => {
      sizes.push([c, r]);
    },
    terminate: async () => {
      output.end();
      exit.resolve({ exitCode: 0 });
    },
    inspectActivity: async () => ({ state: 'idle', revision: 0 }),
  };
  const services = {
    subprocess: {
      resolveExecutable: async (name) => name,
      spawnTerminal: async () => handle,
    },
    workingDirectory: { get: () => '/fixture', ensure: () => '/fixture' },
    sandboxPolicy: {},
  };
  const agent = {
    id: 'fixture-session',
    ctx: { get: (k) => services[k], effect: () => {} },
  };
  let uplink;
  ctx.accessor('invocation', { get: () => ({ uplink: () => uplink }) });
  const controller = new TerminalController(
    ctx,
    TerminalController.Config({
      shell: { name: 'fixture', path: '/fixture/nonexistent', args: [] },
      unattendedTimeoutMs: 0,
    }),
  );
  const id = 'rio-test-offline';
  const deadline = AbortSignal.timeout(4000);
  await controller.create(agent, { id, cols: 80, rows: 24 }, deadline);
  t.after(() => controller.close(agent, id));
  const info = controller.environment(agent, deadline);
  async function view(run) {
    const ac = new AbortController();
    const signal = AbortSignal.any([deadline, ac.signal]);
    let wire;
    const channel = new PassThrough({ objectMode: true });
    uplink = channel;
    const stream = controller.attach(agent, id, signal);
    const core = new RioTerminal({
      onInput: (d, typed) => wire.write(d, typed),
      onResize: (c, r) => wire.resize(c, r),
    });
    const frames = [];
    let changed = Promise.withResolvers();
    const notify = () => {
      changed.resolve();
      changed = Promise.withResolvers();
    };
    let error;
    const carrier = {
      send: (f) => channel.write(f),
      async *[Symbol.asyncIterator]() {
        for await (const f of stream) {
          yield f;
          frames.push(f);
          notify();
        }
      },
    };
    wire = new TerminalWire(
      id,
      carrier,
      info,
      {
        snapshot: (...args) => core.snapshot(...args),
        write: (d) => core.write(d),
        setWritable: (w) => {
          core.writable = w;
        },
        fit() {},
      },
      () => {},
    );
    const work = wire
      .consume(signal)
      .catch((e) => {
        error = e;
      })
      .finally(notify);
    const until = async (predicate) => {
      while (!predicate()) {
        if (error) throw error;
        signal.throwIfAborted();
        await changed.promise;
      }
    };
    const interrupt = () => {
      channel.end();
      notify();
    };
    signal.addEventListener('abort', interrupt, { once: true });
    try {
      await until(() => frames[0]?.type === 'snapshot');
      await run(core, until, frames);
    } finally {
      ac.abort();
      await work;
      core.dispose();
    }
  }
  await view(async (core, until, frames) => {
    assert.equal(core.writable, true);
    core.text('你好');
    core.key({ key: 'Enter', code: 'Enter', type: 'keydown' });
    core.fit(91 * 8, 31 * 16, 8, 16);
    await until(() => frames.filter((f) => f.type === 'ack').length === 3);
    assert.deepEqual(input, ['你好', '\r']);
    assert.deepEqual(sizes, [[91, 31]]);
    output.write(Buffer.from('held:你好\r\n\x1b[?1049h\x1b[Hfull-screen'));
    await until(() => core.term.dump().includes('full-screen'));
    assert.equal(core.term.modes().altScreen, true);
  });
  await view(async (core, until, frames) => {
    assert.equal(core.term.options.cols, 91);
    assert.equal(core.term.options.rows, 31);
    assert.equal(core.term.modes().altScreen, true);
    assert.match(core.term.dump(), /full-screen/);
    output.write(Buffer.from('\x1b[?1049l'));
    await until(() => !core.term.modes().altScreen);
    assert.match(core.term.dump(), /held:你好/);
    output.end();
    exit.resolve({ exitCode: 7 });
    await until(() =>
      frames.some((f) => f.type === 'state' && f.info.exitCode === 7),
    );
    assert.equal(core.writable, false);
  });
});
