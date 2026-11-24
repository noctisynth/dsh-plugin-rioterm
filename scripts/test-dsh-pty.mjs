// Optional POSIX integration test: use the installed DSH Electron as Node.
// No connection, credentials, profile changes or live user sessions are used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rmdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { initWasm } from 'rioterm';
import { TerminalWire } from '../src/dsh-protocol.ts';
import { RioTerminal } from '../src/rio-terminal.ts';

if (!process.env.DSH_INSTALL_DIR || process.platform === 'win32') {
  throw new Error('Run inside a POSIX DSH installation with its runtime.');
}
const requireDsh = createRequire(
  join(process.env.DSH_INSTALL_DIR, 'package.json'),
);
const load = (name) => import(pathToFileURL(requireDsh.resolve(name)));
const { Context } = await load('@deepseek-ai/cordis');
const { LocalSubprocessRuntime } = await load(
  '@deepseek-ai/dsh-subprocess-local',
);
const { TerminalController } = await load(
  '@deepseek-ai/dsh-api-terminal-controller',
);
await initWasm(
  await readFile(new URL('../lib/rioterm-0.1.8.wasm', import.meta.url)),
);
const ctx = new Context();
let input;
ctx.accessor('invocation', { get: () => ({ uplink: () => input }) });
const provider = new LocalSubprocessRuntime(ctx);
const cwd = await mkdtemp(join(tmpdir(), 'dsh-rio-pty-'));
const controller = new TerminalController(
  ctx,
  TerminalController.Config({
    shell: {
      name: 'sh',
      path: '/bin/sh',
      args: [
        '-c',
        'unset ENV BASH_ENV; export HISTFILE=/dev/null; exec /bin/sh -i',
      ],
    },
    unattendedTimeoutMs: 0,
  }),
);
const env = {
  subprocess: provider,
  workingDirectory: { ensure: () => cwd, get: () => cwd },
  sandboxPolicy: {},
};
const agent = {
  id: randomUUID(),
  ctx: { get: (key) => env[key], effect: () => {} },
};
const id = `rio-test-${randomUUID()}`;
const deadline = AbortSignal.timeout(20000);
const changes = new EventEmitter();
let terminal;
let wire;
let abort;
let done;
let status;
let fault;
let exitCode;
// Bound even a provider cleanup regression. DSH's process-exit hook terminates owned PTYs.
const watchdog = setTimeout(() => {
  console.error(
    'Smoke test exceeded its cleanup deadline. Last state:',
    status,
    fault,
    terminal?.term.dump().slice(-500),
  );
  process.exit(1);
}, 25000);
deadline.addEventListener('abort', () => input?.end(), { once: true });
function attach() {
  status = undefined;
  fault = undefined;
  input = new PassThrough({ objectMode: true });
  abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, deadline]);
  const stream = controller.attach(agent, id, signal);
  const rpc = {
    send(command) {
      input.write(command);
    },
    async *[Symbol.asyncIterator]() {
      for await (const f of stream) {
        if (f.type === 'state') exitCode = f.info.exitCode;
        yield f;
        changes.emit('frame');
      }
    },
  };
  terminal?.dispose();
  terminal = new RioTerminal({
    onInput: (d, t) => wire.write(d, t),
    onResize: (c, r) => wire.resize(c, r),
  });
  const sink = {
    snapshot: (...args) => terminal.snapshot(...args),
    write: (d) => terminal.write(d),
    setWritable: (w) => {
      terminal.writable = w;
    },
    fit() {},
  };
  wire = new TerminalWire(
    id,
    rpc,
    controller.environment(agent, signal),
    sink,
    (s) => {
      status = s;
    },
  );
  done = wire
    .consume(signal)
    .catch((e) => {
      fault = e;
    })
    .finally(() => changes.emit('frame'));
}
async function detach() {
  if (!done) return;
  input.end();
  abort.abort();
  await done;
  done = undefined;
}
const write = (data) => terminal.text(data);
const lines = () => terminal.term.dump();
async function until(matches) {
  while (!matches()) {
    if (fault) throw fault;
    await once(changes, 'frame', { signal: deadline }).catch((e) => {
      throw new Error(
        `No expected frame; state=${status}, screen=${JSON.stringify(lines().slice(-1200))}`,
        { cause: e },
      );
    });
  }
}
try {
  const info = await controller.create(
    agent,
    { id, cols: 80, rows: 24 },
    deadline,
  );
  assert.equal(info.origin, 'user');
  assert.equal(info.cwd, cwd);
  attach();
  await until(() => status === 'connected');
  console.log('DSH user PTY created; received writable initial screen.');
  write(
    'stty -echo; export RIO_PROBE=$$; printf \'\\nRIO-PID:%s\\n\' "$RIO_PROBE"\r',
  );
  await until(() => /RIO-PID:\d+/.test(lines()));
  const pid = Number(lines().match(/RIO-PID:(\d+)/)[1]);
  console.log('Received real shell command output.');
  terminal.fit(91 * 8, 31 * 16, 8, 16);
  // Emit UTF-8 independent of the testing machine's readline locale.
  write(
    "printf '\\nRIO-SIZE:'; stty size; printf 'RIO-UTF:\\344\\270\\255\\346\\226\\207\\n'\r",
  );
  await until(
    () => lines().includes('RIO-SIZE:31 91') && /RIO-UTF:中\s*文/.test(lines()),
  );
  console.log('Real shell input, CJK output and 91x31 PTY resize passed.');
  await detach();
  attach();
  await until(() => status === 'connected');
  assert.match(lines(), /RIO-SIZE:31 91/);
  write('printf \'\\nRECONNECTED:%s:%s\\n\' "$$" "$RIO_PROBE"\r');
  await until(() => lines().includes(`RECONNECTED:${pid}:${pid}`));
  console.log(
    'DSH serialized snapshot restored into a fresh Rio engine; shell PID and environment survived.',
  );
  write('vim -Nu NONE -i NONE -n\r');
  await until(() => terminal.term.modes().altScreen);
  write('\x1b:qa!\r');
  await until(() => !terminal.term.modes().altScreen);
  write('exit 7\r');
  await until(() => status === 'exited');
  assert.equal(exitCode, 7);
  console.log(
    'Real Vim alternate-screen entry/exit and shell exit status passed.',
  );
} finally {
  try {
    await detach();
  } finally {
    terminal?.dispose();
    await controller.close(agent, id);
    assert.equal(controller.list(agent.id).length, 0);
    await rmdir(cwd);
    clearTimeout(watchdog);
  }
}
