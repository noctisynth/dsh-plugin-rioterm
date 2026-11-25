import type {
  TerminalAttachment,
  TerminalLimits,
  TerminalPanel,
  TerminalStatus,
} from '../terminal/contracts.ts';
import { errorMessage } from '../terminal/error-message.ts';
import type { SessionHold } from './hold.ts';
import type {
  RemoteAttachment,
  RemoteFrame,
  RemoteStreamFactory,
} from './remote.ts';
import { TerminalWire } from './wire.ts';

export class MissingBinding extends Error {}

export interface ResolvedTerminal {
  id: string;
  initialHold: Promise<void> | undefined;
}

interface AttachmentOptions {
  panel: TerminalPanel;
  limits: TerminalLimits;
  hold: SessionHold;
  lifetime: AbortController;
  stream: RemoteStreamFactory;
  open(): Promise<ResolvedTerminal>;
  attach(id: string, signal: AbortSignal): RemoteAttachment;
}

// An opening/allocation or roster hold can also belong to another occurrence.
// Cancelling our wait must neither release it nor block this view's teardown.
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function missing(error: unknown) {
  return (
    error instanceof MissingBinding ||
    (error instanceof Error &&
      'code' in error &&
      (error.code === 'terminal/unavailable' ||
        error.code === 'session/not-found'))
  );
}

/** One mounted screen. Manual retries replace the logical stream; Gateway owns its physical generations. */
export class SessionAttachment implements TerminalAttachment {
  readonly #options: AttachmentOptions;
  #visible: boolean;
  #wake: (() => void) | undefined;
  #id: string | undefined;
  #attempt: AbortController | undefined;
  #wire: TerminalWire | undefined;
  #stopped = false;
  #done: Promise<void>;

  constructor(options: AttachmentOptions) {
    this.#options = options;
    this.#visible = options.panel.visible ?? true;
    options.lifetime.signal.addEventListener('abort', () => this.#cancel(), {
      once: true,
    });
    options.panel.screen.setWritable(false);
    options.panel.status('opening');
    this.#done = this.#start();
  }

  get done() {
    return this.#done;
  }

  async #start() {
    const { lifetime, open } = this.#options;
    if (lifetime.signal.aborted) return;
    try {
      const { id, initialHold } = await waitFor(open(), lifetime.signal);
      if (lifetime.signal.aborted) return;
      this.#id = id;
      await this.#run(id, initialHold);
    } catch (error) {
      if (!lifetime.signal.aborted) this.#report(error);
    }
  }

  #report(error: unknown, readonly = false) {
    if (this.#stopped) return; // Final output or EOF cannot replace the shell's exit status.
    this.#stopped = missing(error);
    this.#options.panel.status(
      this.#stopped ? 'missing' : readonly ? 'readonly' : 'disconnected',
      errorMessage(error),
    );
  }

  async #run(id: string, initialHold?: Promise<void>) {
    const { panel, stream } = this.#options;
    const attempt = new AbortController();
    this.#attempt = attempt;
    let readonly = false;
    const notify = (status: TerminalStatus) => {
      if (attempt.signal.aborted) return;
      readonly = status === 'readonly';
      this.#stopped ||= status === 'exited' || status === 'failed';
      panel.status(status);
    };
    try {
      const managed = stream<RemoteFrame>({
        name: 'Rio terminal attachment',
        open: (signal) => {
          const ready = initialHold;
          initialHold = undefined;
          return this.#physical(id, signal, notify, ready);
        },
        // The Host drains final state before normal completion. Physical loss
        // throws a branded carrier failure, never a successful EOF.
        ended: (accepted) =>
          new Error(
            accepted
              ? 'Terminal attachment ended.'
              : 'Missing opening terminal snapshot.',
          ),
        carrierFailed: (error) => {
          // A revoked reader must not steal back control. The mux also brands
          // a malformed transport envelope as a carrier error; fail it closed.
          if (
            readonly ||
            this.#stopped ||
            error.message === 'api gateway: invalid Remote stream frame'
          )
            throw error;
          if (!attempt.signal.aborted) panel.status('reconnecting');
        },
      });
      const dispose = () => {
        void managed.dispose();
      };
      attempt.signal.addEventListener('abort', dispose, { once: true });
      try {
        for await (const item of managed) {
          if (attempt.signal.aborted || item.signal.aborted) continue;
          this.#wire?.receive(item.value);
          if (item.value.type === 'snapshot') item.accept();
        }
      } finally {
        attempt.signal.removeEventListener('abort', dispose);
        await managed.dispose();
      }
    } catch (error) {
      if (!attempt.signal.aborted) this.#report(error, readonly);
    } finally {
      if (this.#attempt === attempt) this.#attempt = undefined;
    }
  }

  async *#physical(
    id: string,
    signal: AbortSignal,
    notify: (status: TerminalStatus) => void,
    initialHold: Promise<void> | undefined,
  ) {
    const { hold, limits, panel, attach } = this.#options;
    for (;;) {
      signal.throwIfAborted();
      const ready = initialHold ?? hold.ensure(id);
      initialHold = undefined;
      await waitFor(ready, signal);
      while (!this.#visible && !signal.aborted) {
        await waitFor(
          new Promise<void>((resolve) => {
            this.#wake = resolve;
          }),
          signal,
        );
      }
      signal.throwIfAborted();
      // Visibility and hold lifetime can both change while suspended.
      if (hold.isCurrent(ready)) break;
    }
    const raw = attach(id, signal);
    const wire = new TerminalWire(id, raw, limits, panel.screen, notify);
    this.#wire = wire;
    try {
      yield* raw;
    } finally {
      wire.stop();
      if (this.#wire === wire) this.#wire = undefined;
    }
  }

  #cancel() {
    // Disarm old writes before asynchronous iterator teardown or a new snapshot.
    this.#wire?.stop();
    this.#wire = undefined;
    this.#attempt?.abort();
    this.#wake?.();
    this.#wake = undefined;
  }

  reconnect() {
    if (this.#options.lifetime.signal.aborted || this.#stopped) return true;
    if (this.#id === undefined) return false;
    this.#cancel();
    this.#options.panel.status('reconnecting');
    this.#done = this.#run(this.#id);
    return true;
  }

  setVisible(visible: boolean) {
    this.#visible = visible;
    if (visible) {
      this.#wake?.();
      this.#wake = undefined;
    }
  }

  #send(op: (wire: TerminalWire) => void) {
    if (!this.#wire) return;
    try {
      op(this.#wire);
    } catch (error) {
      this.#cancel();
      this.#report(error);
    }
  }
  input(data: string, typed: boolean) {
    this.#send((wire) => wire.write(data, typed));
  }
  resize(cols: number, rows: number) {
    this.#send((wire) => wire.resize(cols, rows));
  }
  detach() {
    this.#options.lifetime.abort();
  }
}
