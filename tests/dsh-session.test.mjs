import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TerminalWire } from '../src/dsh-protocol.ts';
import { RioSessions } from '../src/dsh-session.ts';

const limits = {
  maxCols: 120,
  maxRows: 60,
  maxInputBytes: 160,
  maxBufferedBytes: 2048,
  scrollback: 40,
};
const ok = (value) => ({ ok: true, value });
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function stream(signal) {
  const queue = [];
  let wake = deferred();
  const commands = [];
  signal.addEventListener('abort', () => wake.resolve(), { once: true });
  return {
    commands,
    signal,
    push(value) {
      queue.push(value);
      wake.resolve();
    },
    send(c) {
      assert.ok(!signal.aborted);
      commands.push(c);
    },
    async *[Symbol.asyncIterator]() {
      while (!signal.aborted) {
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        wake = deferred();
        await wake.promise;
      }
    },
  };
}
function host() {
  const infos = new Map();
  const creates = [],
    closes = [],
    holds = [],
    views = [];
  const remote = {
    environment: async () => ok(limits),
    list: async () => ok([...infos.values()]),
    async create(_sid, request) {
      creates.push(request.id);
      const info = {
        ...request,
        origin: 'user',
        control: 'user',
        state: 'running',
        exitCode: null,
      };
      infos.set(info.id, info);
      return ok(info);
    },
    retain(_sid, id, signal) {
      assert.ok(infos.has(id));
      const s = stream(signal);
      holds.push(s);
      s.push({ type: 'retained' });
      return s;
    },
    attach(_sid, id, signal) {
      const s = stream(signal);
      views.push(s);
      const info = infos.get(id);
      assert.ok(info);
      s.push({
        type: 'snapshot',
        info,
        writable: true,
        sequence: 10,
        screen: 'shell $ ',
        inputWindow: { maxBytes: 100, frameOverheadBytes: 1 },
      });
      return s;
    },
    async close(_sid, id) {
      closes.push(id);
      infos.delete(id);
      return ok();
    },
  };
  return { remote, infos, creates, closes, holds, views };
}
function store() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
function panel() {
  const seen = [],
    events = [],
    waiters = [];
  const notify = (k, msg) => {
    seen.push([k, msg]);
    for (const waiter of waiters) if (waiter.key === k) waiter.defer.resolve();
  };
  return {
    seen,
    events,
    status: notify,
    screen: {
      snapshot: (...v) => events.push(['snapshot', ...v]),
      write: (v) => events.push(['write', v]),
      resize: (...v) => events.push(['size', ...v]),
      setWritable: (v) => events.push(['writable', v]),
      fit() {},
    },
    async wait(key) {
      if (seen.some(([k]) => k === key)) return;
      const defer = deferred();
      waiters.push({ key, defer });
      await defer.promise;
    },
  };
}
const sid = 'session';
const content = 'sidebar://rio-terminal/one';
const tab = { sessionId: sid, contentId: content, kind: 'rio-terminal' };
function fresh(t, h = host(), storage = store()) {
  const mgr = new RioSessions(h.remote, () => storage);
  t.after(() => mgr.dispose());
  mgr.sync([tab]);
  return { mgr, h, storage, item: mgr.get(sid, content) };
}

test('explicit new ticket allocates once; collapse retains without input; reload recovers, and only close terminates', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h, storage } = fresh(t);
  const p = panel();
  const first = item.mount(mgr.issue(sid), limits, p);
  await p.wait('connected');
  assert.deepEqual(
    p.events.filter((e) => e[0] === 'snapshot'),
    [['snapshot', 80, 24, 'shell $ ']],
  );
  assert.equal(h.creates.length, 1);
  first.input('ls\r', true);
  first.input('\x1b[0n', false);
  assert.deepEqual(h.views[0].commands[0], {
    type: 'write',
    data: 'ls\r',
    typed: true,
    sequence: 1,
  });
  h.views[0].push({ type: 'ack', sequence: 1 });
  first.detach();
  await first.done;
  first.input('stale', true);
  assert.equal(h.holds[0].signal.aborted, false);
  assert.equal(h.closes.length, 0);
  mgr.dispose();
  assert.equal(h.holds[0].signal.aborted, true);
  const later = fresh(t, h, storage);
  const restored = panel();
  const second = later.item.mount(undefined, limits, restored);
  await restored.wait('connected');
  assert.equal(h.creates.length, 1);
  assert.equal(h.views.length, 2);
  assert.deepEqual(h.views[1].commands, []);
  first.input('stale', true);
  first.resize(30, 12);
  second.resize(90, 25);
  assert.deepEqual(h.views[1].commands, [
    { type: 'resize', cols: 90, rows: 25, sequence: 1 },
  ]);
  await later.mgr.close(sid, content);
  await second.done;
  assert.deepEqual(h.closes, h.creates);
  assert.equal(storage.length, 0);
});
test('no ticket/unknown established terminal never allocates a substitute or targets a supplied ID', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h } = fresh(t);
  const unknown = panel();
  await item.mount('some-foreign-terminal', limits, unknown).done;
  assert.equal(unknown.seen.at(-1)[0], 'missing');
  assert.deepEqual(h.creates, []);
  const created = panel();
  const bind = item.mount(mgr.issue(sid), limits, created);
  await created.wait('connected');
  bind.detach();
  await bind.done;
  h.infos.clear();
  const missing = panel();
  await item.mount(mgr.issue(sid), limits, missing).done;
  assert.equal(missing.seen.at(-1)[0], 'missing');
  assert.equal(h.creates.length, 1);
  assert.equal(h.views.length, 1);
});
test('recovery and close refuse agent-owned or foreign identities, even after human takeover', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h, storage } = fresh(t);
  const p = panel();
  const binding = item.mount(mgr.issue(sid), limits, p);
  await p.wait('connected');
  binding.detach();
  await binding.done;
  mgr.dispose();
  const info = h.infos.get(h.creates[0]);
  info.origin = 'agent';
  info.control = 'user';
  const other = fresh(t, h, storage);
  const bad = panel();
  await other.item.mount(undefined, limits, bad).done;
  assert.match(bad.seen.at(-1)[1], /owner/);
  assert.equal(h.views.length, 1);
  await assert.rejects(other.item.close(), /owner/);
  assert.equal(h.closes.length, 0);
});
test('bounded uplink, control revocation and protocol responses remain scoped to their attachment', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h } = fresh(t);
  const p = panel();
  const bind = item.mount(mgr.issue(sid), limits, p);
  await p.wait('connected');
  const view = h.views[0];
  const info = h.infos.get(h.creates[0]);
  bind.input('a'.repeat(20), true);
  bind.input('b'.repeat(20), true);
  assert.equal(view.commands.length, 1);
  view.push({ type: 'ack', sequence: 1 });
  view.push({ type: 'state', info, writable: false });
  await p.wait('readonly');
  assert.equal(view.commands.length, 2);
  bind.input('never written', true);
  bind.resize(90, 24);
  assert.equal(view.commands.length, 2);
  view.push({ type: 'output', sequence: 21, data: 'invalid' });
  await bind.done;
  assert.equal(p.seen.at(-1)[0], 'disconnected');
  assert.ok(!p.events.some((e) => e[1] === 'invalid'));
  assert.ok(view.signal.aborted);
});
test('closing a tab while create is in flight cannot leak or attach a new terminal', {
  timeout: 5000,
}, async (t) => {
  const h = host();
  const entered = deferred();
  const resume = deferred();
  const create = h.remote.create;
  h.remote.create = async (...args) => {
    entered.resolve();
    await resume.promise;
    return create(...args);
  };
  const { item, mgr, storage } = fresh(t, h);
  const bind = item.mount(mgr.issue(sid), limits, panel());
  await entered.promise;
  const closing = mgr.close(sid, content);
  resume.resolve();
  await closing;
  await bind.done;
  assert.deepEqual(h.closes, h.creates);
  assert.equal(h.views.length, 0);
  assert.equal(storage.length, 0);
});
test('a persisted close request is retryable without creating or attaching anything', {
  timeout: 5000,
}, async (t) => {
  const { item, mgr, h, storage } = fresh(t);
  const p = panel();
  const b = item.mount(mgr.issue(sid), limits, p);
  await p.wait('connected');
  b.detach();
  await b.done;
  const close = h.remote.close;
  h.remote.close = async () => ({
    ok: false,
    error: { message: 'transport lost' },
  });
  await assert.rejects(mgr.close(sid, content), /transport lost/);
  assert.equal(storage.length, 1);
  mgr.dispose();
  const finished = deferred();
  h.remote.close = async (...a) => {
    const result = await close(...a);
    finished.resolve();
    return result;
  };
  const next = fresh(t, h, storage);
  next.mgr.retryCleanup();
  await finished.promise;
  assert.deepEqual(h.closes, h.creates);
  assert.equal(h.views.length, 1);
});

test('an untrusted opening snapshot never renders or enables protocol/user input', async () => {
  const p = panel();
  const ac = new AbortController();
  for (const [id, origin] of [
    ['foreign', 'user'],
    ['own', 'agent'],
  ]) {
    const handle = stream(ac.signal);
    const wire = new TerminalWire('own', handle, limits, p.screen, p.status);
    const opened = wire.consume(ac.signal);
    handle.push({
      type: 'snapshot',
      info: { id, origin, control: 'user', state: 'running' },
      writable: true,
      sequence: 0,
      screen: 'secret',
    });
    await assert.rejects(opened, /identity|owner/);
    wire.write('must not send', true);
    assert.deepEqual(handle.commands, []);
    assert.ok(!p.events.some((e) => e[0] === 'snapshot' || e[1] === true));
  }
});

test('missing persistent storage disables allocation without falling back to another terminal', async (t) => {
  const h = host();
  h.infos.set('foreign', {
    id: 'foreign',
    origin: 'user',
    control: 'user',
    state: 'running',
  });
  const mgr = new RioSessions(h.remote, () => {
    throw Error('storage disabled');
  });
  t.after(() => mgr.dispose());
  const p = panel();
  const view = mgr.get('s', 'c').mount(mgr.issue('s'), limits, p);
  await view.done;
  assert.deepEqual(h.creates, []);
  assert.deepEqual(h.views, []);
  assert.deepEqual(h.closes, []);
  assert.match(p.seen.at(-1)[1], /storage disabled/);
});

test('a refused command switches to read-only and discards buffered input, without replay', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h } = fresh(t);
  const p = panel();
  const bind = item.mount(mgr.issue(sid), limits, p);
  await p.wait('connected');
  const view = h.views[0];
  bind.input('a'.repeat(20), true);
  bind.input('b'.repeat(20), true);
  assert.equal(view.commands.length, 1);
  view.push({ type: 'ack', sequence: 1, refusal: 'read-only' });
  await p.wait('readonly');
  bind.input('no', true);
  assert.equal(view.commands.length, 1);
  bind.detach();
  await bind.done;
});

test('initial discovery can retry the same user ticket after transport failure', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h } = fresh(t);
  const ticket = mgr.issue(sid);
  const list = h.remote.list;
  h.remote.list = async () => ({
    ok: false,
    error: { message: 'unavailable' },
  });
  assert.equal(item.needsLaunch(ticket), false);
  assert.equal(item.needsLaunch(undefined), true);
  const first = panel();
  await item.mount(ticket, limits, first).done;
  assert.equal(first.seen.at(-1)[0], 'disconnected');
  assert.equal(h.creates.length, 0);
  h.remote.list = list;
  const p = panel();
  const reopen = item.mount(ticket, limits, p);
  await p.wait('connected');
  assert.equal(h.creates.length, 1);
  assert.equal(item.needsLaunch(undefined), false);
  reopen.detach();
  await reopen.done;
});

test('closing a recorded but unlisted id tombstones a pending shell and preserves the binding on failure', {
  timeout: 5000,
}, async (t) => {
  const { mgr, item, h, storage } = fresh(t);
  const p = panel();
  const handle = item.mount(mgr.issue(sid), limits, p);
  await p.wait('connected');
  handle.detach();
  await handle.done;
  h.infos.clear();
  const close = h.remote.close;
  h.remote.close = async () => ({
    ok: false,
    error: { message: 'retry later' },
  });
  await assert.rejects(item.close(), /retry later/);
  assert.equal(storage.length, 1);
  h.remote.close = close;
  await item.close();
  assert.deepEqual(h.closes, h.creates);
  assert.equal(storage.length, 0);
});
