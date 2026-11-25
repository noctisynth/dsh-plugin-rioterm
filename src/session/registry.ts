import type { TerminalSession } from '../terminal/contracts.ts';
import { RIO_TAB_KIND } from '../terminal/identity.ts';
import {
  type BindingStorage,
  bindingFor,
  bindingKey,
  closingBindings,
} from './bindings.ts';
import { RioSession } from './instance.ts';
import type { TerminalRemote } from './remote.ts';

// A registry belongs to a single client window; no shared DSH binding or tab inventory is mutated.
export class RioSessions {
  readonly #sessions = new Map<string, RioSession>();
  readonly #tickets = new Map<string, string>();
  readonly #remote: TerminalRemote;
  readonly #storage: () => BindingStorage;

  constructor(remote: TerminalRemote, storage: () => BindingStorage) {
    this.#remote = remote;
    this.#storage = storage;
  }

  issue(session: string): string {
    const ticket = crypto.randomUUID();
    this.#tickets.set(ticket, session);
    if (this.#tickets.size > 128) {
      const oldest = this.#tickets.keys().next().value;
      if (oldest) this.#tickets.delete(oldest);
    }
    return ticket;
  }

  get(session: string, content: string): TerminalSession {
    return this.#item(session, content).view;
  }

  #item(session: string, content: string): RioSession {
    if (!session || !content) throw new Error('Missing sidebar identity.');
    const key = bindingKey(session, content);
    let item = this.#sessions.get(key);
    if (!item) {
      const permits = (ticket: unknown): ticket is string =>
        typeof ticket === 'string' && this.#tickets.get(ticket) === session;
      item = new RioSession(
        this.#remote,
        session,
        bindingFor(this.#storage, session, content),
        {
          permits,
          consume: (ticket) => permits(ticket) && this.#tickets.delete(ticket),
        },
      );
      this.#sessions.set(key, item);
    }
    return item;
  }

  // Include collapsed and background tabs. A roster must never allocate a PTY or acquire input.
  sync(
    tabs: readonly { sessionId: string; contentId: string; kind: string }[],
  ) {
    const present = new Set<RioSession>();
    for (const tab of tabs)
      if (tab.kind === RIO_TAB_KIND)
        present.add(this.#item(tab.sessionId, tab.contentId));
    for (const item of this.#sessions.values()) item.retain(present.has(item));
  }

  async close(session: string, content: string) {
    const item = this.#item(session, content);
    await item.close();
    const key = bindingKey(session, content);
    if (this.#sessions.get(key) === item) this.#sessions.delete(key);
  }

  retryCleanup() {
    try {
      for (const { session, content } of closingBindings(this.#storage()))
        void this.close(session, content).catch(() => {});
    } catch {
      /* Blocked storage prevents new allocation; report this in the panel. */
    }
  }

  dispose() {
    this.#tickets.clear();
    for (const item of this.#sessions.values()) item.dispose();
    this.#sessions.clear();
  }
}
