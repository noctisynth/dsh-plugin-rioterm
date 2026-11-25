import type { TabBinding } from './bindings.ts';
import { owned, type TerminalRemote, value } from './remote.ts';

// A roster hold belongs to the window, not to a mounted screen. Restoring
// one may list and retain an existing owned shell, never create or attach.
export class SessionHold {
  private readonly remote: TerminalRemote;
  private readonly session: string;
  private readonly binding: TabBinding;
  private stream?: { ac: AbortController; ready: Promise<void> } | undefined;
  private retryTimer?: ReturnType<typeof setTimeout> | undefined;
  private backoff = 1000;
  private wanted = false;

  constructor(remote: TerminalRemote, session: string, binding: TabBinding) {
    this.remote = remote;
    this.session = session;
    this.binding = binding;
  }

  get isWanted(): boolean {
    return this.wanted;
  }

  retain(wanted: boolean, opening: boolean) {
    if (!wanted) {
      this.release();
      return;
    }
    const changed = !this.wanted;
    this.wanted = true;
    if (changed && !opening) void this.restore();
  }

  release() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const stream = this.stream;
    this.stream = undefined;
    stream?.ac.abort();
  }

  private async restore() {
    try {
      const record = this.binding.read();
      if (!record || record.closing || !this.wanted) return;
      const { id } = await this.binding.identity(record.nonce);
      const found = value(await this.remote.list(this.session)).find(
        (info) => info.id === id,
      );
      if (!found || !this.wanted) return;
      owned(id, found);
      await this.ensure(id);
    } catch {
      this.retry();
    }
  }

  private retry() {
    if (this.wanted && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        void this.restore();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    }
  }

  isCurrent(ready: Promise<void>) {
    return this.stream?.ready === ready;
  }

  // Only an acknowledged hold permits a physical attachment. All callers of
  // ensure share the same readiness promise and the same retain stream.
  ensure(id: string) {
    if (this.stream) return this.stream.ready;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const ac = new AbortController();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.stream = { ac, ready };
    ac.signal.addEventListener(
      'abort',
      () => reject(new Error('Rio hold released.')),
      { once: true },
    );
    void (async () => {
      try {
        for await (const frame of this.remote.retain(
          this.session,
          id,
          ac.signal,
        )) {
          if (ac.signal.aborted) break;
          if (frame.type !== 'retained')
            throw new Error('Unexpected retain response.');
          this.backoff = 1000;
          resolve();
        }
        throw new Error('Terminal retention ended.');
      } catch (error) {
        reject(error);
      } finally {
        if (this.stream?.ac === ac) {
          this.stream = undefined;
          this.retry();
        }
      }
    })();
    return ready;
  }
}
