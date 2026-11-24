import {
  type FrameSink,
  type Limits,
  owned,
  type Status,
  type TerminalRemote,
  TerminalWire,
  value,
} from './dsh-protocol.ts';

const prefix = 'rio-terminal.binding.v1.';
interface RecordValue {
  nonce: string;
  closing: boolean;
}
interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}
const noncePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function decode(raw: string): RecordValue {
  const record = JSON.parse(raw) as Partial<RecordValue> | null;
  if (
    !record ||
    typeof record.nonce !== 'string' ||
    !noncePattern.test(record.nonce) ||
    typeof record.closing !== 'boolean'
  )
    throw new Error('Invalid Rio terminal binding.');
  return { nonce: record.nonce, closing: record.closing };
}
const keyOf = (session: string, content: string) =>
  prefix + JSON.stringify([session, content]);
async function hostId(session: string, content: string, nonce: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(['rio-terminal:1', session, content, nonce]),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `rio-v1-${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
export class MissingBinding extends Error {}
export const detail = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
export interface Screen extends FrameSink {
  resize(cols: number, rows: number): void;
}
export interface SessionPanel {
  screen: Screen;
  status(s: Status, reason?: string): void;
}
interface ActivePanel {
  abort: AbortController;
  input(data: string, typed: boolean): void;
  resize(cols: number, rows: number): void;
  done: Promise<void>;
}

// A manager belongs to a single client window; no shared DSH binding or tab inventory is mutated.
export class RioSessions {
  private sessions = new Map<string, RioSession>();
  private tickets = new Map<string, string>();
  readonly remote: TerminalRemote;
  readonly storage: () => StoragePort;
  constructor(remote: TerminalRemote, storage: () => StoragePort) {
    this.remote = remote;
    this.storage = storage;
  }
  issue(session: string): string {
    const ticket = crypto.randomUUID();
    this.tickets.set(ticket, session);
    if (this.tickets.size > 128) {
      const oldest = this.tickets.keys().next().value;
      if (oldest) this.tickets.delete(oldest);
    }
    return ticket;
  }
  permits(session: string, ticket: unknown): ticket is string {
    return typeof ticket === 'string' && this.tickets.get(ticket) === session;
  }
  consume(session: string, ticket: unknown): boolean {
    if (!this.permits(session, ticket)) return false;
    this.tickets.delete(ticket);
    return true;
  }
  get(session: string, content: string): RioSession {
    if (!session || !content) throw new Error('Missing sidebar identity.');
    const key = keyOf(session, content);
    let item = this.sessions.get(key);
    if (!item) {
      item = new RioSession(this, session, content, key);
      this.sessions.set(key, item);
    }
    return item;
  }
  // Include collapsed and background tabs. A roster must never allocate a PTY or acquire input.
  sync(
    tabs: readonly { sessionId: string; contentId: string; kind: string }[],
  ) {
    const present = new Set<RioSession>();
    for (const tab of tabs)
      if (tab.kind === 'rio-terminal')
        present.add(this.get(tab.sessionId, tab.contentId));
    for (const item of this.sessions.values()) item.retain(present.has(item));
  }
  async close(session: string, content: string) {
    const item = this.get(session, content);
    await item.close();
    if (this.sessions.get(item.key) === item) this.sessions.delete(item.key);
  }
  retryCleanup() {
    try {
      const storage = this.storage();
      const jobs: { session: string; content: string }[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k?.startsWith(prefix)) continue;
        try {
          const [session, content] = JSON.parse(k.slice(prefix.length));
          if (
            typeof session === 'string' &&
            typeof content === 'string' &&
            k === keyOf(session, content) &&
            decode(storage.getItem(k) ?? '').closing
          )
            jobs.push({ session, content });
        } catch {
          /* Bad records grant no authority. */
        }
      }
      for (const { session, content } of jobs)
        void this.close(session, content).catch(() => {});
    } catch {
      /* Blocked storage prevents new allocation; report this in the panel. */
    }
  }
  dispose() {
    this.tickets.clear();
    for (const item of this.sessions.values()) item.dispose();
    this.sessions.clear();
  }
}

export class RioSession {
  private hold?: { ac: AbortController; ready: Promise<void> } | undefined;
  private wanted = false;
  private active?: ActivePanel | undefined;
  private opening?: Promise<{ id: string; limits: Limits }> | undefined;
  private closing?: Promise<void> | undefined;
  private closed = false;
  private lifetime = new AbortController();
  private holdRetry?: ReturnType<typeof setTimeout> | undefined;
  private backoff = 1000;
  private readonly manager: RioSessions;
  readonly session: string;
  readonly content: string;
  readonly key: string;
  constructor(
    manager: RioSessions,
    session: string,
    content: string,
    key: string,
  ) {
    this.manager = manager;
    this.session = session;
    this.content = content;
    this.key = key;
  }
  private record() {
    const s = this.manager.storage().getItem(this.key);
    return s === null ? undefined : decode(s);
  }
  needsLaunch(ticket: unknown): boolean {
    return !this.record() && !this.manager.permits(this.session, ticket);
  }
  private store(r: RecordValue) {
    this.manager.storage().setItem(this.key, JSON.stringify(r));
  }
  private assertOpen() {
    if (this.closed || this.lifetime.signal.aborted)
      throw new Error('Rio tab is closed.');
  }
  async environment(signal: AbortSignal): Promise<Limits> {
    return value(await this.manager.remote.environment(this.session, signal));
  }
  private async open(ticket: unknown, limits: Limits) {
    if (this.opening) return this.opening;
    this.opening = this.resolve(ticket, limits).finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }
  private async resolve(ticket: unknown, limits: Limits) {
    this.assertOpen();
    const saved = this.record();
    if (
      saved?.closing ||
      (!saved && !this.manager.permits(this.session, ticket))
    )
      throw new MissingBinding('No recoverable Rio terminal.');
    const nonce = saved?.nonce ?? crypto.randomUUID();
    const id = await hostId(this.session, this.content, nonce);
    const remote = this.manager.remote;
    const signal = this.lifetime.signal;
    const list = await remote.list(this.session);
    this.assertOpen();
    const existing = value(list).find((x) => x.id === id);
    if (saved) {
      if (!existing)
        throw new MissingBinding('Host no longer has this terminal.');
      owned(id, existing);
    } else {
      // idempotent create can return an existing terminal. Reject any collision, even a user terminal.
      if (existing || this.record())
        throw new Error('Rio terminal identity already exists.');
      if (!this.manager.consume(this.session, ticket))
        throw new MissingBinding(
          'The launch authorization is no longer active.',
        );
      this.store({ nonce, closing: false });
      owned(
        id,
        value(
          await remote.create(
            this.session,
            {
              id,
              cols: Math.min(80, limits.maxCols),
              rows: Math.min(24, limits.maxRows),
            },
            signal,
          ),
        ),
      );
    }
    this.assertOpen();
    // A tab may have collapsed while create was in flight. Keep its process
    // even when the original screen occurrence is no longer mounted.
    if (this.wanted) await this.ensureHold(id);
    return { id, limits };
  }
  // Hold stream is independent of mounting the screen. No attach until a held ID is verified.
  retain(wanted: boolean) {
    const changed = this.wanted !== wanted;
    this.wanted = wanted;
    if (!wanted) {
      this.dropHold();
      return;
    }
    if (this.closed || !changed || this.opening) return;
    void this.restoreHold();
  }
  private async restoreHold() {
    try {
      const r = this.record();
      if (!r || r.closing || !this.wanted || this.closed) return;
      const id = await hostId(this.session, this.content, r.nonce);
      // This hold does not attach, start or write to a process; filter explicitly nonetheless.
      const found = value(await this.manager.remote.list(this.session)).find(
        (x) => x.id === id,
      );
      if (!found || !this.wanted || this.closed) return;
      owned(id, found);
      await this.ensureHold(id);
    } catch {
      this.retryHold();
    }
  }
  private retryHold() {
    if (!this.closed && this.wanted && !this.holdRetry) {
      this.holdRetry = setTimeout(() => {
        this.holdRetry = undefined;
        void this.restoreHold();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    }
  }
  private dropHold() {
    clearTimeout(this.holdRetry);
    this.holdRetry = undefined;
    const h = this.hold;
    this.hold = undefined;
    h?.ac.abort();
  }
  private ensureHold(id: string) {
    if (this.hold) return this.hold.ready;
    const ac = new AbortController();
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.hold = { ac, ready };
    ac.signal.addEventListener(
      'abort',
      () => reject(new Error('Rio hold released.')),
      { once: true },
    );
    void (async () => {
      try {
        for await (const f of this.manager.remote.retain(
          this.session,
          id,
          ac.signal,
        )) {
          if (ac.signal.aborted) break;
          if (f.type !== 'retained')
            throw new Error('Unexpected retain response.');
          this.backoff = 1000;
          resolve();
        }
        throw new Error('Terminal retention ended.');
      } catch (e) {
        reject(e);
      } finally {
        if (this.hold?.ac === ac) {
          this.hold = undefined;
          this.retryHold();
        }
      }
    })();
    return ready;
  }
  mount(ticket: unknown, limits: Limits, panel: SessionPanel) {
    // No operation on a superseded physical attachment may use its successor's handle or sink.
    this.active?.abort.abort();
    const ac = new AbortController();
    let wire: TerminalWire | undefined;
    const active: ActivePanel = {
      abort: ac,
      done: Promise.resolve(),
      input: (d, t) => send(() => wire?.write(d, t)),
      resize: (c, r) => send(() => wire?.resize(c, r)),
    };
    const current = () =>
      this.active === active && !ac.signal.aborted && !this.closed;
    const send = (op: () => void) => {
      if (!current()) return;
      try {
        op();
      } catch (e) {
        panel.status('disconnected', detail(e));
        ac.abort();
      }
    };
    this.active = active;
    panel.screen.setWritable(false);
    panel.status('opening');
    ac.signal.addEventListener(
      'abort',
      () => {
        wire?.stop();
        wire = undefined;
      },
      { once: true },
    );
    active.done = (async () => {
      let status: Status = 'opening';
      try {
        const { id } = await this.open(ticket, limits);
        if (!current()) return;
        await this.ensureHold(id);
        if (!current()) return;
        const stream = this.manager.remote.attach(this.session, id, ac.signal);
        const notify = (s: Status) => {
          status = s;
          if (current()) panel.status(s);
        };
        wire = new TerminalWire(id, stream, limits, panel.screen, notify);
        wire.onRemoteSize = (cols, rows) => panel.screen.resize(cols, rows);
        await wire.consume(ac.signal);
        if (
          current() &&
          (status as Status) !== 'exited' &&
          (status as Status) !== 'failed'
        )
          panel.status('disconnected');
      } catch (e) {
        if (current())
          panel.status(
            e instanceof MissingBinding ? 'missing' : 'disconnected',
            detail(e),
          );
      } finally {
        ac.abort();
        if (this.active === active) this.active = undefined;
      }
    })();
    return {
      input: active.input,
      resize: active.resize,
      detach: () => {
        ac.abort();
        if (this.active === active) this.active = undefined;
      },
      done: active.done,
    };
  }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.active?.abort.abort();
    this.dropHold();
    this.closing = (async () => {
      const r = this.record();
      if (r) this.store({ ...r, closing: true });
      // Never race an outstanding successful allocation with close, even if the DOM disappeared.
      await this.opening?.catch(() => {});
      if (!r) return;
      const id = await hostId(this.session, this.content, r.nonce);
      const remote = this.manager.remote;
      const found = value(await remote.list(this.session)).find(
        (x) => x.id === id,
      );
      if (found) owned(id, found);
      // A lost create reply may leave a pending allocation outside the list.
      // DSH close is idempotent and tombstones even an as-yet unseen identity.
      value(await remote.close(this.session, id));
      this.manager.storage().removeItem(this.key);
    })().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
  dispose() {
    this.closed = true;
    this.lifetime.abort();
    this.active?.abort.abort();
    this.dropHold();
  }
}
