// Exercise Rio against the installed Gateway's real carrier classification and retry budget.
// Only the connection's online/offline signal and the physical PTY stream are controlled.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { RioSessions } from '../src/session/registry.ts';

const desktop = process.versions.electron && process.env.DSH_INSTALL_DIR;

test('the installed Gateway resumes a Rio screen on the original shell without repeating unacknowledged input', {
  skip: !desktop,
  timeout: 5000,
}, async (t) => {
  const requireDsh = createRequire(join(desktop, 'package.json'));
  const { RemoteStream, RemoteStreamCarrierError } = await import(
    pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-api-gateway/client'))
  );
  const limits = {
    maxInputBytes: 65536,
    maxBufferedBytes: 2097152,
    maxCols: 500,
    maxRows: 200,
    scrollback: 1000,
  };
  let generation = 1;
  const listeners = new Set();
  const waitingForConnection = Promise.withResolvers();
  const connection = {
    generation: {
      getSnapshot: () => generation,
      subscribe: (notify) => {
        listeners.add(notify);
        waitingForConnection.resolve();
        return () => listeners.delete(notify);
      },
    },
  };
  const setGeneration = (next) => {
    generation = next;
    for (const notify of [...listeners]) notify();
  };
  const storage = new Map();
  const local = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const ok = (value) => ({ ok: true, value });
  let info;
  let creates = 0,
    lists = 0,
    holds = 0;
  const inputs = [],
    attachments = [],
    screens = [];
  const loss = Promise.withResolvers();
  const transferWriter = Promise.withResolvers();
  const loseMuxOnly = Promise.withResolvers();
  const stopped = (signal) =>
    new Promise((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
  const remote = {
    list: async () => {
      lists++;
      return ok(info ? [info] : []);
    },
    create: async (_s, request) => {
      creates++;
      info = {
        ...request,
        origin: 'user',
        control: 'user',
        state: 'running',
        exitCode: null,
      };
      return ok(info);
    },
    async *retain(_s, _id, signal) {
      const first = ++holds === 1;
      yield { type: 'retained' };
      if (first) {
        await Promise.race([loss.promise, stopped(signal)]);
        if (!signal.aborted)
          throw new RemoteStreamCarrierError('test hold lost');
      } else await stopped(signal);
    },
    attach(_s, id, signal) {
      assert.equal(id, info.id);
      const index = attachments.length;
      attachments.push(id);
      return {
        send: (command) => inputs.push([index, command.sequence, command.data]),
        async *[Symbol.asyncIterator]() {
          if (index === 3)
            throw new RemoteStreamCarrierError('test mux still down');
          yield {
            type: 'snapshot',
            info,
            sequence: 10 * (index + 1),
            writable: true,
            screen: index === 0 ? 'before' : 'including offline output',
          };
          if (index === 0) {
            await Promise.race([loss.promise, stopped(signal)]);
            if (!signal.aborted)
              throw new RemoteStreamCarrierError('test carrier lost');
          } else {
            if (index === 1) {
              await Promise.race([transferWriter.promise, stopped(signal)]);
              if (!signal.aborted)
                yield { type: 'state', info, writable: false };
            } else if (index === 2) {
              await Promise.race([loseMuxOnly.promise, stopped(signal)]);
              if (!signal.aborted)
                throw new RemoteStreamCarrierError('test mux interrupted');
            }
            await stopped(signal);
          }
        },
      };
    },
  };
  const sessions = new RioSessions(
    remote,
    () => local,
    (options) => new RemoteStream(connection, options),
  );
  t.after(() => sessions.dispose());
  const tab = {
    sessionId: 'test-session',
    contentId: 'test-content',
    kind: 'rio-terminal',
  };
  sessions.sync([tab]);
  let notify = Promise.withResolvers();
  const states = [];
  const changed = () => {
    notify.resolve();
    notify = Promise.withResolvers();
  };
  const view = sessions
    .get(tab.sessionId, tab.contentId)
    .mount(sessions.issue(tab.sessionId), limits, {
      screen: {
        snapshot: (_cols, _rows, data) => {
          screens.push(data);
          changed();
        },
        write: assert.fail,
        resize: assert.fail,
        setWritable: () => {},
      },
      status: (status) => {
        states.push(status);
        changed();
      },
    });
  t.after(() => view.detach());
  const until = async (condition) => {
    while (!condition()) await notify.promise;
  };
  await until(() => states.includes('connected'));
  const baselineLists = lists;
  view.input('run once\r', true);
  setGeneration(undefined);
  loss.resolve();
  // No new physical attach until the real supervisor observes the next generation.
  await waitingForConnection.promise;
  assert.deepEqual(screens, ['before']);
  assert.equal(attachments.length, 1);
  view.input('offline keystroke', true);
  setGeneration(2);
  await until(
    () => states.filter((state) => state === 'connected').length === 2,
  );
  assert.deepEqual(screens, ['before', 'including offline output']);
  assert.deepEqual(inputs, [[0, 1, 'run once\r']]);
  view.input('next\r', true);
  assert.deepEqual(inputs, [
    [0, 1, 'run once\r'],
    [1, 1, 'next\r'],
  ]);
  transferWriter.resolve();
  await until(() => states.at(-1) === 'readonly');
  assert.equal(view.reconnect(), true);
  await until(
    () => states.filter((state) => state === 'connected').length === 3,
  );
  // With Connection still online, one immediate replacement is allowed. If it
  // fails before a snapshot there is no busy retry loop; manual retry still works.
  loseMuxOnly.resolve();
  await until(() => states.at(-1) === 'disconnected');
  await view.done;
  assert.equal(attachments.length, 4);
  assert.equal(view.reconnect(), true);
  await until(() => states.at(-1) === 'connected');
  assert.deepEqual(attachments, Array(5).fill(info.id));
  assert.equal(creates, 1);
  assert.equal(holds, 2);
  assert.equal(lists, baselineLists);
  view.detach();
  await view.done;
  assert.equal(listeners.size, 0);
});
