import type {
  TerminalAttachment,
  TerminalLimits,
  TerminalPanel,
  TerminalSession,
  TerminalStatus,
} from '../terminal/contracts.ts';
import { errorMessage } from '../terminal/error-message.ts';
import type { TabBinding } from './bindings.ts';
import { SessionHold } from './hold.ts';
import { owned, type TerminalRemote, value } from './remote.ts';
import { TerminalWire } from './wire.ts';

class MissingBinding extends Error {}

interface LaunchTickets {
  permits(ticket: unknown): boolean;
  consume(ticket: unknown): boolean;
}

// One logical sidebar tab, surviving physical panel detach/remount. Its page
// contract does not expose the Remote, binding, or window's ticket inventory.
export class RioSession {
  readonly #remote: TerminalRemote;
  readonly #session: string;
  readonly #binding: TabBinding;
  readonly #tickets: LaunchTickets;
  readonly #hold: SessionHold;
  readonly #lifetime = new AbortController();
  #active: AbortController | undefined;
  #opening: Promise<string> | undefined;
  #closing: Promise<void> | undefined;
  #closed = false;

  constructor(
    remote: TerminalRemote,
    session: string,
    binding: TabBinding,
    tickets: LaunchTickets,
  ) {
    this.#remote = remote;
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
    if (this.#hold.isWanted) await this.#hold.ensure(id);
    return id;
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
    const ac = new AbortController();
    let visible = panel.visible ?? true;
    let wake: (() => void) | undefined;
    let wire: TerminalWire | undefined;
    const current = () =>
      this.#active === ac && !ac.signal.aborted && !this.#closed;
    const send = (op: () => void) => {
      if (!current()) return;
      try {
        op();
      } catch (error) {
        panel.status('disconnected', errorMessage(error));
        ac.abort();
      }
    };
    this.#active = ac;
    panel.screen.setWritable(false);
    panel.status('opening');
    ac.signal.addEventListener(
      'abort',
      () => {
        wake?.();
        wire?.stop();
        wire = undefined;
      },
      { once: true },
    );
    const done = (async () => {
      try {
        const id = await this.#open(ticket, limits);
        if (!current()) return;
        await this.#hold.ensure(id);
        // A pane can collapse while opening. Hold the shell, but don't take
        // input/resize control away from a visible window in the meantime.
        while (current() && !visible) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
        if (!current()) return;
        const stream = this.#remote.attach(this.#session, id, ac.signal);
        let ended = false;
        const notify = (status: TerminalStatus) => {
          ended = status === 'exited' || status === 'failed';
          if (current()) panel.status(status);
        };
        wire = new TerminalWire(id, stream, limits, panel.screen, notify);
        await wire.consume(ac.signal);
        if (current() && !ended) panel.status('disconnected');
      } catch (error) {
        if (current())
          panel.status(
            error instanceof MissingBinding ? 'missing' : 'disconnected',
            errorMessage(error),
          );
      } finally {
        ac.abort();
        if (this.#active === ac) this.#active = undefined;
      }
    })();
    return {
      input: (data, typed) => send(() => wire?.write(data, typed)),
      resize: (cols, rows) => send(() => wire?.resize(cols, rows)),
      setVisible(next: boolean) {
        visible = next;
        if (visible) wake?.();
      },
      detach: () => {
        ac.abort();
        if (this.#active === ac) this.#active = undefined;
      },
      done,
    };
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
