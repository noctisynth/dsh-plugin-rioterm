import type {
  TerminalAttachment,
  TerminalLimits,
  TerminalPanel,
  TerminalSession,
} from '../terminal/contracts.ts';
import {
  MissingBinding,
  type ResolvedTerminal,
  SessionAttachment,
} from './attachment.ts';
import type { TabBinding } from './bindings.ts';
import { SessionHold } from './hold.ts';
import {
  owned,
  type RemoteStreamFactory,
  type TerminalRemote,
  value,
} from './remote.ts';

interface LaunchTickets {
  permits(ticket: unknown): boolean;
  consume(ticket: unknown): boolean;
}

// One logical sidebar tab, surviving physical panel detach/remount. Its page
// contract does not expose the Remote, binding, or window's ticket inventory.
export class RioSession {
  readonly #remote: TerminalRemote;
  readonly #stream: RemoteStreamFactory;
  readonly #session: string;
  readonly #binding: TabBinding;
  readonly #tickets: LaunchTickets;
  readonly #hold: SessionHold;
  readonly #lifetime = new AbortController();
  #active: AbortController | undefined;
  #opening: Promise<ResolvedTerminal> | undefined;
  #closing: Promise<void> | undefined;
  #closed = false;

  constructor(
    remote: TerminalRemote,
    stream: RemoteStreamFactory,
    session: string,
    binding: TabBinding,
    tickets: LaunchTickets,
  ) {
    this.#remote = remote;
    this.#stream = stream;
    this.#session = session;
    this.#binding = binding;
    this.#tickets = tickets;
    this.#hold = new SessionHold(remote, session, binding);
  }

  // This stable object, not the owner of the process, is injected into React.
  readonly view: TerminalSession = {
    needsLaunch: (ticket) =>
      !this.#binding.read() && !this.#tickets.permits(ticket),
    environment: async (signal) =>
      value(await this.#remote.environment(this.#session, signal)),
    mount: (ticket, limits, panel) => this.#mount(ticket, limits, panel),
  };

  #assertOpen() {
    if (this.#closed || this.#lifetime.signal.aborted)
      throw new Error('Rio tab is closed.');
  }

  async #open(ticket: unknown, limits: TerminalLimits) {
    if (this.#opening) return this.#opening;
    this.#opening = this.#resolve(ticket, limits).finally(() => {
      this.#opening = undefined;
    });
    return this.#opening;
  }

  async #resolve(ticket: unknown, limits: TerminalLimits) {
    this.#assertOpen();
    const saved = this.#binding.read();
    if (saved?.closing || (!saved && !this.#tickets.permits(ticket)))
      throw new MissingBinding('No recoverable Rio terminal.');
    const { id, nonce } = await this.#binding.identity(saved?.nonce);
    const signal = this.#lifetime.signal;
    const list = await this.#remote.list(this.#session);
    this.#assertOpen();
    const existing = value(list).find((info) => info.id === id);
    if (saved) {
      if (!existing)
        throw new MissingBinding('Host no longer has this terminal.');
      owned(id, existing);
    } else {
      // Idempotent create can return an existing terminal. Reject any collision, even a user terminal.
      if (existing || this.#binding.read())
        throw new Error('Rio terminal identity already exists.');
      if (!this.#tickets.consume(ticket))
        throw new MissingBinding(
          'The launch authorization is no longer active.',
        );
      this.#binding.remember(nonce);
      owned(
        id,
        value(
          await this.#remote.create(
            this.#session,
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
    this.#assertOpen();
    // A tab may have collapsed while create was in flight. Keep its process
    // even when the original screen occurrence is no longer mounted.
    const initialHold = this.#hold.isWanted ? this.#hold.ensure(id) : undefined;
    // Detached occurrences may never await this. A mounted generation observes
    // the original promise (including its carrier/business failure) before attach.
    void initialHold?.catch(() => {});
    return { id, initialHold };
  }

  retain(wanted: boolean) {
    if (!this.#closed) this.#hold.retain(wanted, !!this.#opening);
  }

  #mount(
    ticket: unknown,
    limits: TerminalLimits,
    panel: TerminalPanel,
  ): TerminalAttachment {
    // No operation on a superseded physical attachment may use its successor's handle or sink.
    this.#active?.abort();
    const lifetime = new AbortController();
    this.#active = lifetime;
    return new SessionAttachment({
      lifetime,
      limits,
      panel,
      hold: this.#hold,
      stream: this.#stream,
      open: () => this.#open(ticket, limits),
      attach: (id, signal) => this.#remote.attach(this.#session, id, signal),
    });
  }

  async close() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#active?.abort();
    this.#hold.release();
    this.#closing = (async () => {
      const record = this.#binding.beginClose();
      // Never race an outstanding successful allocation with close, even if the DOM disappeared.
      await this.#opening?.catch(() => {});
      if (!record) return;
      const { id } = await this.#binding.identity(record.nonce);
      const found = value(await this.#remote.list(this.#session)).find(
        (info) => info.id === id,
      );
      if (found) owned(id, found);
      // A lost create reply may leave a pending allocation outside the list.
      // DSH close is idempotent and tombstones even an as-yet unseen identity.
      value(await this.#remote.close(this.#session, id));
      this.#binding.forget();
    })().finally(() => {
      this.#closing = undefined;
    });
    return this.#closing;
  }

  dispose() {
    this.#closed = true;
    this.#lifetime.abort();
    this.#active?.abort();
    this.#hold.release();
  }
}
