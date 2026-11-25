import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreferenceAutosave } from '../src/pages/preferences/preference-autosave.ts';

// Keep RPC completion independent of mirror delivery: the real form can deliver
// them in either order. Advancing time alone must never manufacture a revision.
function setup(t, user = {}, base = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let snapshot = {
    status: 'ready',
    writable: true,
    revision: 7,
    user,
    base,
    value: { ...base, ...user },
  };
  const listeners = new Set();
  const requests = [];
  function publish(delta) {
    snapshot = { ...snapshot, ...delta };
    for (const listener of listeners) listener();
  }
  const draft = new PreferenceAutosave({
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    save(next, revision) {
      assert.equal(snapshot.status, 'ready');
      assert.equal(snapshot.writable, true);
      assert.equal(revision, snapshot.revision);
      const { promise, resolve, reject } = Promise.withResolvers();
      requests.push({ next, revision, resolve, reject });
      return promise;
    },
  });
  const disconnect = draft.connect();
  t.after(() => {
    disconnect();
    assert.equal(listeners.size, 0);
  });
  function mirror(i, revision = requests[i].revision + 1) {
    publish({ revision, user: requests[i].next });
  }
  async function ack(i) {
    mirror(i);
    requests[i].resolve(true);
    await Promise.resolve();
  }
  return {
    draft,
    view: draft.getSnapshot,
    publish,
    requests,
    mirror,
    ack,
    disconnect,
    tick: (ms) => t.mock.timers.tick(ms),
  };
}
const palette = (cells) => Object.assign(Array(16).fill(''), cells);

test('600ms follows the last keystroke; blur commits only its valid local edit', async (t) => {
  const { draft, view, requests, tick, ack } = setup(
    t,
    { fontSize: 18 },
    { paddingTop: 33 },
  );
  draft.change('fontSize', '2'); // unfinished
  tick(500);
  draft.change('fontSize', '24');
  tick(400);
  draft.change('fontSize', '25');
  tick(200);
  draft.change('fontFamily', 'Fira Code');
  draft.flushField('scrollback'); // clean blur does nothing
  draft.flushField('fontFamily');
  assert.deepEqual(
    requests.map((r) => r.next),
    [{ fontSize: 18, fontFamily: '"Fira Code"' }],
  );
  assert.equal(view().fields.fontSize, '25');
  await ack(0);
  assert.equal(view().pending, true);
  assert.equal(view().fields.fontFamily, '"Fira Code"');
  tick(399);
  assert.equal(requests.length, 1);
  tick(1);
  assert.deepEqual(requests[1].next, {
    fontSize: 25,
    fontFamily: '"Fira Code"',
  });
  await ack(1);
  draft.change('fontSize', '025'); // canonical no-op; never migrate the profile on a clean edit
  tick(600);
  assert.equal(view().dirty, false);
  draft.change('fontSize', '19');
  draft.cancel();
  draft.flushField('fontSize'); // stale blur can't recreate the discarded text
  tick(5000);
  assert.equal(requests.length, 2);
});

test('invalid scalar and ANSI text stay local while selection, picker, removal and valid typing save', async (t) => {
  const saved = {
    fontSize: 20,
    foreground: '#abc',
    palette: palette({ 1: '#123', 2: '#234' }),
  };
  const { draft, requests, view, ack, tick } = setup(t, saved);
  draft.change('fontSize', '1e');
  draft.change('red', '#f');
  draft.change('paddingLeft', '0');
  draft.change('renderer', 'canvas', 'immediate');
  assert.deepEqual(requests[0].next, { ...saved, renderer: 'canvas' });
  await ack(0);
  draft.change('green', '#fff', 'immediate');
  draft.change('foreground', '', 'immediate');
  await ack(1);
  assert.deepEqual(requests[2].next, {
    fontSize: 20,
    renderer: 'canvas',
    palette: palette({ 1: '#123', 2: '#fff' }),
  });
  await ack(2);
  tick(600);
  assert.equal(requests[3].next.paddingLeft, 0);
  await ack(3);
  assert.deepEqual(view().invalid, ['fontSize', 'red']);
  assert.equal(view().fields.red, '#f');
  assert.notEqual(view().preview.palette[1], '#f');
  assert.equal(view().pending, false);
  draft.flushField('red');
  draft.undo('red');
  assert.equal(view().fields.red, '#123');
  tick(5000);
  assert.equal(requests.length, 4);
});

for (const order of ['rpc-first', 'mirror-first']) {
  test(`${order}: keep editing and never send the next CAS with an assumed revision`, async (t) => {
    const { draft, view, requests, mirror, ack, tick } = setup(t, {
      fontSize: 18,
    });
    draft.change('fontSize', '016', 'immediate');
    assert.deepEqual(requests[0].next, { fontSize: 16 });
    draft.change('fit', 'false', 'immediate');
    draft.change('fontSize', '17');
    draft.change('fontSize', '18'); // return to PRE-write value while 16 is in flight
    tick(600);
    if (order === 'rpc-first') {
      requests[0].resolve(true);
      await Promise.resolve();
    } else mirror(0, 42);
    assert.equal(view().saving, true);
    assert.equal(view().conflict, false);
    assert.equal(view().fields.fontSize, '18');
    tick(5000);
    assert.equal(requests.length, 1);
    if (order === 'rpc-first') mirror(0, 42);
    else {
      requests[0].resolve(true);
      await Promise.resolve();
    }
    assert.equal(requests[1].revision, 42);
    assert.deepEqual(requests[1].next, { fontSize: 18, fit: false });
    await ack(1);
    assert.equal(view().dirty, false);
    tick(5000);
    assert.equal(requests.length, 2);
  });
}

test('external change after own echo keeps only later edits, including individual palette cells', async (t) => {
  const { draft, view, requests, publish, mirror, ack, tick } = setup(t, {
    palette: palette({ 1: '#111', 2: '#222' }),
  });
  draft.change('renderer', 'canvas', 'immediate');
  draft.change('red', '', 'immediate');
  draft.change('fit', 'false');
  draft.change('fit', ''); // reverted unrelated edit must not undo an arriving remote override
  mirror(0);
  publish({
    revision: 9,
    user: {
      renderer: 'dom',
      fit: false,
      palette: palette({ 1: '#ccc', 2: '#ddd' }),
    },
  });
  requests[0].resolve(true);
  await Promise.resolve();
  assert.equal(view().conflict, true);
  assert.equal(view().fields.renderer, 'dom');
  assert.equal(view().fields.red, undefined);
  draft.flushField('red');
  tick(5000);
  assert.equal(requests.length, 1);
  draft.rebase();
  assert.equal(requests[1].revision, 9);
  assert.deepEqual(requests[1].next, {
    renderer: 'dom',
    fit: false,
    palette: palette({ 2: '#ddd' }),
  });
  await ack(1);
  assert.equal(view().dirty, false);
});

test('rejection and transport errors stop autosave until explicit retry or discard', async (t) => {
  const { draft, view, requests, tick } = setup(t);
  draft.change('fontSize', '24', 'immediate');
  draft.change('fontSize', '25');
  requests[0].resolve(false);
  await Promise.resolve();
  assert.deepEqual(view().failure, {});
  draft.flushField('fontSize');
  draft.change('scrollback', '0');
  tick(5000);
  assert.equal(requests.length, 1);
  draft.retry();
  assert.deepEqual(requests[1].next, { fontSize: 25, scrollback: 0 });
  requests[1].reject(new Error('Host offline'));
  await Promise.resolve();
  assert.equal(view().failure.detail, 'Host offline');
  draft.cancel();
  assert.equal(view().dirty, false);
  assert.equal(view().failure, undefined);
  tick(5000);
  assert.equal(requests.length, 2);
});

test('foreign revision requires keep or discard; losing write access pauses rather than overwrites', async (t) => {
  const { draft, view, requests, publish, tick, ack } = setup(t, {
    fontSize: 18,
  });
  draft.change('fontSize', '19');
  publish({
    status: 'unavailable',
    writable: false,
    revision: undefined,
    user: {},
  });
  draft.change('fontSize', '22', 'immediate');
  draft.flushField('fontSize');
  draft.retry();
  tick(1000);
  assert.equal(view().fields.fontSize, '19');
  publish({
    status: 'ready',
    revision: 9,
    user: { fontSize: 18, scrollback: 72 },
  });
  draft.rebase(); // still read-only
  publish({ writable: true });
  tick(1000);
  assert.equal(requests.length, 0);
  assert.equal(view().conflict, true);
  draft.rebase();
  assert.deepEqual(requests[0].next, { fontSize: 19, scrollback: 72 });
  await ack(0);
  draft.change('fontSize', '20');
  publish({ revision: 11, user: { fontSize: 28 } });
  draft.cancel();
  assert.equal(view().fields.fontSize, '28');
  tick(5000);
  assert.equal(requests.length, 1);
});

test('explicit reset queues removal of in-flight additions without pinning inherited values', async (t) => {
  const { draft, view, requests, publish, ack } = setup(
    t,
    {},
    { fontSize: 21, fit: true },
  );
  draft.restore();
  assert.equal(requests.length, 0);
  draft.change('fontSize', '22', 'immediate');
  draft.change('red', '#f');
  draft.restore();
  assert.equal(view().fields.fontSize, undefined);
  assert.equal(view().invalid.length, 0);
  publish({ revision: 8, user: { fontSize: 22, fit: true } }); // inherited sibling materialized after confirmation
  requests[0].resolve(true);
  await Promise.resolve();
  assert.equal(requests[1].revision, 8);
  assert.deepEqual(requests[1].next, {});
  await ack(1);
  draft.restore();
  assert.equal(requests.length, 2);
});

test('disconnect cancels timers and prevents later write completions from draining the queue', async (t) => {
  const first = setup(t);
  first.draft.change('fontSize', '24');
  first.disconnect();
  first.tick(600);
  assert.equal(first.requests.length, 0);
  const stop = first.draft.connect();
  assert.equal(first.requests.length, 1);
  first.draft.change('fit', 'true', 'immediate');
  stop();
  await first.ack(0);
  first.tick(2000);
  assert.equal(first.requests.length, 1);
});

test('an accepted set equal to inheritance can leave both the user layer AND revision unchanged', async (t) => {
  const { draft, view, requests, publish, ack, tick } = setup(
    t,
    {},
    { fontSize: 20, fit: true },
  );
  draft.change('fontSize', '020', 'immediate');
  draft.change('renderer', 'canvas', 'immediate');
  // The real SettingsForms editor may elide an override equal to inherited.
  requests[0].resolve(true);
  await Promise.resolve();
  assert.equal(view().fields.fontSize, undefined);
  assert.equal(view().conflict, false);
  assert.equal(requests[1].revision, 7);
  assert.deepEqual(requests[1].next, { renderer: 'canvas' });
  draft.change('fit', 'false', 'immediate');
  // Conversely, making a real override can materialize unrelated inherited rows.
  publish({
    revision: 9,
    user: { renderer: 'canvas', fit: true, fontSize: 20 },
  });
  requests[1].resolve(true);
  await Promise.resolve();
  assert.equal(view().conflict, false);
  assert.deepEqual(requests[2].next, {
    renderer: 'canvas',
    fit: false,
    fontSize: 20,
  });
  await ack(2);
  tick(60_000);
  assert.equal(view().dirty, false);
  assert.equal(requests.length, 3);
});

test('an accepted unset that the host did not reflect is recoverable, not silently saved or retried', async (t) => {
  const { draft, view, requests, tick } = setup(
    t,
    { fontSize: 20, fit: false },
    { fontSize: 20 },
  );
  draft.change('fontSize', '', 'immediate');
  requests[0].resolve(true); // unchanged user override: effective equivalence isn't enough for a clear
  await Promise.resolve();
  tick(60_000);
  assert.equal(view().saving, false);
  assert.ok(view().failure);
  assert.equal(view().dirty, true);
  assert.equal(view().fields.fontSize, undefined);
  draft.flushField('fontSize');
  assert.equal(requests.length, 1);
  draft.cancel();
  assert.equal(view().fields.fontSize, '20');
});

for (const matches of [true, false]) {
  test(`new host, reused revision, ${matches ? 'matching' : 'divergent'} snapshot retires old write without dropping the queue`, async (t) => {
    const { draft, view, requests, publish, ack, tick } = setup(t, {
      fontSize: 20,
    });
    draft.change('fontSize', '016', 'immediate');
    draft.change('fit', 'false', 'immediate');
    if (matches) {
      requests[0].resolve(true);
      await Promise.resolve();
    }
    publish({
      status: 'unavailable',
      writable: false,
      revision: undefined,
      user: {},
    });
    assert.equal(view().saving, false);
    publish({
      status: 'ready',
      writable: true,
      revision: 7,
      user: { fontSize: matches ? 16 : 23, scrollback: 100 },
    });
    tick(60_000);
    assert.equal(requests.length, 1);
    assert.equal(view().fields.fontSize, matches ? '16' : '016');
    assert.equal(view().fields.fit, 'false');
    if (matches) {
      assert.ok(view().failure);
      draft.retry();
    } else {
      assert.equal(view().conflict, true);
      draft.rebase();
    }
    assert.deepEqual(requests[1].next, {
      fontSize: 16,
      fit: false,
      scrollback: 100,
    });
    requests[0].reject(new Error('Late rejection from the old host'));
    await Promise.resolve();
    assert.equal(view().saving, true);
    assert.equal(view().failure, undefined);
    await ack(1);
    assert.equal(view().dirty, false);
    assert.equal(requests.length, 2);
  });
}

test('IME holds previously committed text without blocking other fields; release never commits a candidate', async (t) => {
  const { draft, view, requests, publish, tick, ack } = setup(t);
  draft.change('fontFamily', 'Mon');
  tick(200);
  draft.holdField('fontFamily');
  draft.flushField('fontFamily');
  draft.change('renderer', 'canvas', 'immediate');
  await ack(0);
  tick(2000);
  assert.deepEqual(
    requests.map((r) => r.next),
    [{ renderer: 'canvas' }],
  );
  draft.releaseField('fontFamily'); // an input was hidden mid-composition
  tick(599);
  assert.equal(requests.length, 1);
  tick(1);
  assert.deepEqual(requests[1].next, {
    renderer: 'canvas',
    fontFamily: '"Mon"',
  });
  await ack(1);
  draft.holdField('fontFamily');
  publish({
    revision: 100,
    user: { fontFamily: '"Other"', renderer: 'canvas' },
  });
  draft.change('fontFamily', '思源等宽'); // compositionend, not a candidate
  tick(2000);
  assert.equal(view().fields.fontFamily, '思源等宽');
  assert.equal(view().conflict, true);
  assert.equal(requests.length, 2);
  draft.rebase();
  assert.equal(requests[2].next.fontFamily, '"思源等宽"');
});
