// Client-facing subset of @deepseek-ai/dsh-api-terminal-controller (0.2.2-rc.5).
// No import of Harness runtime packages: the composed gateway supplies the Remote.
export interface Info {
  id: string;
  origin: 'agent' | 'user';
  control: 'agent' | 'user';
  state: 'running' | 'exited' | 'failed';
  cols: number;
  rows: number;
  exitCode: number | null;
}
export interface Limits {
  maxCols: number;
  maxRows: number;
  maxInputBytes: number;
  maxBufferedBytes: number;
  scrollback: number;
}
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string; code?: string } };
export function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
interface Window {
  maxBytes: number;
  frameOverheadBytes: number;
}
export type Frame =
  | {
      type: 'snapshot';
      info: Info;
      writable: boolean;
      sequence: number;
      screen: string;
      inputWindow?: Window;
    }
  | { type: 'output'; sequence: number; data: string }
  | { type: 'state'; info: Info; writable: boolean }
  | { type: 'ack'; sequence: number; refusal?: string };
type Input =
  | { type: 'write'; data: string; typed?: boolean }
  | { type: 'resize'; cols: number; rows: number };
type Command = Input & { sequence: number };
export interface Attachment extends AsyncIterable<Frame> {
  send(command: Command): void;
}
export interface TerminalRemote {
  environment(session: string, signal: AbortSignal): Promise<Result<Limits>>;
  list(session: string): Promise<Result<Info[]>>;
  create(
    session: string,
    request: { id: string; cols: number; rows: number },
    signal: AbortSignal,
  ): Promise<Result<Info>>;
  retain(
    session: string,
    id: string,
    signal: AbortSignal,
  ): AsyncIterable<{ type: 'retained' }>;
  attach(session: string, id: string, signal: AbortSignal): Attachment;
  close(session: string, id: string): Promise<Result<void>>;
}

export interface FrameSink {
  snapshot(cols: number, rows: number, data: string): void;
  write(data: string): void;
  setWritable(value: boolean): void;
  fit(): void;
}
export type Status =
  | 'opening'
  | 'connected'
  | 'readonly'
  | 'exited'
  | 'failed'
  | 'disconnected'
  | 'missing';
export function owned(
  id: string,
  info: Info | undefined,
): asserts info is Info {
  if (
    !info ||
    info.id !== id ||
    info.origin !== 'user' ||
    info.control !== 'user'
  )
    throw new Error('Terminal identity or owner does not match this Rio tab.');
}

const encoder = new TextEncoder();
// A wire belongs to exactly one physical attachment. Input is never retried or
// transferred to another generation, including commands waiting for capacity.
export class TerminalWire {
  private output = -1;
  private next = 0;
  private acknowledged = 0;
  private queued: { command: Command; cost: number; raw: number }[] = [];
  private pending = new Map<number, { cost: number; raw: number }>();
  private inFlight = 0;
  private buffered = 0;
  private rawBytes = 0;
  private writable = false;
  private window?: Window;
  private size = '';
  private ended = false;
  private readonly id: string;
  private readonly handle: Attachment;
  private readonly limits: Limits;
  private readonly screen: FrameSink;
  private readonly notify: (s: Status) => void;
  constructor(
    id: string,
    handle: Attachment,
    limits: Limits,
    screen: FrameSink,
    notify: (s: Status) => void,
  ) {
    this.id = id;
    this.handle = handle;
    this.limits = limits;
    this.screen = screen;
    this.notify = notify;
  }
  async consume(signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of this.handle) {
        if (signal.aborted || this.ended) return;
        if (this.output < 0 && frame.type !== 'snapshot')
          throw new Error('Missing opening terminal snapshot.');
        switch (frame.type) {
          case 'snapshot':
            if (
              this.output >= 0 ||
              !Number.isSafeInteger(frame.sequence) ||
              frame.sequence < 0
            )
              throw new Error('Invalid terminal snapshot.');
            owned(this.id, frame.info);
            this.output = frame.sequence;
            if (frame.inputWindow) this.window = frame.inputWindow;
            this.screen.snapshot(
              frame.info.cols,
              frame.info.rows,
              frame.screen,
            );
            this.update(frame.info, frame.writable);
            break;
          case 'state':
            owned(this.id, frame.info);
            this.update(frame.info, frame.writable);
            break;
          case 'output':
            if (frame.sequence !== this.output + 1)
              throw new Error('Terminal output sequence gap.');
            this.output = frame.sequence;
            this.screen.write(frame.data);
            break;
          case 'ack': {
            const pay = this.pending.get(frame.sequence);
            if (frame.sequence !== this.acknowledged + 1 || !pay)
              throw new Error('Unexpected input acknowledgement.');
            this.acknowledged = frame.sequence;
            this.rawBytes -= pay.raw;
            this.inFlight -= pay.cost;
            this.buffered -= pay.cost;
            this.pending.delete(frame.sequence);
            if (frame.refusal) {
              this.revoke();
              this.notify(
                frame.refusal === 'not-running' ? 'exited' : 'readonly',
              );
            }
            this.flush();
            break;
          }
        }
      }
    } finally {
      this.stop();
    }
  }
  private update(info: Info, writable: boolean) {
    const canWrite = writable && info.state === 'running';
    if (!canWrite) this.revoke();
    this.writable = canWrite;
    const size = `${info.cols}:${info.rows}`;
    if (this.output >= 0 && size !== this.size && !canWrite)
      this.onRemoteSize?.(info.cols, info.rows);
    this.size = size;
    this.screen.setWritable(canWrite);
    this.notify(
      info.state === 'running'
        ? canWrite
          ? 'connected'
          : 'readonly'
        : info.state === 'exited'
          ? 'exited'
          : 'failed',
    );
  }
  onRemoteSize?: (cols: number, rows: number) => void;
  write(data: string, typed: boolean) {
    if (data && this.writable && !this.ended)
      this.queue(
        { type: 'write', data, ...(typed ? { typed: true } : {}) },
        encoder.encode(data).length,
      );
  }
  resize(cols: number, rows: number) {
    if (
      !this.writable ||
      this.ended ||
      !Number.isSafeInteger(cols) ||
      !Number.isSafeInteger(rows) ||
      cols <= 0 ||
      rows <= 0
    )
      return;
    cols = Math.min(this.limits.maxCols, cols);
    rows = Math.min(this.limits.maxRows, rows);
    if (this.size === `${cols}:${rows}`) return;
    this.size = `${cols}:${rows}`;
    this.queue({ type: 'resize', cols, rows }, 0);
  }
  private queue(input: Input, raw: number) {
    const command = { ...input, sequence: this.next + 1 };
    const cost =
      encoder.encode(JSON.stringify(command)).length +
      (this.window?.frameOverheadBytes ?? 0);
    if (
      raw + this.rawBytes > this.limits.maxInputBytes ||
      cost + this.buffered > this.limits.maxBufferedBytes ||
      (this.window && cost > this.window.maxBytes)
    )
      throw new Error('Terminal input exceeds its bounded input window.');
    this.next++;
    this.rawBytes += raw;
    this.buffered += cost;
    this.queued.push({ command, cost, raw });
    this.flush();
  }
  private flush() {
    while (this.writable && !this.ended && this.queued.length) {
      const next = this.queued[0];
      if (
        !next ||
        (this.window && this.inFlight + next.cost > this.window.maxBytes)
      )
        return;
      this.handle.send(next.command);
      this.queued.shift();
      this.pending.set(next.command.sequence, next);
      this.inFlight += next.cost;
    }
  }
  private revoke() {
    this.writable = false;
    // Unsent commands have no wire sequence yet from the Host's perspective.
    for (const item of this.queued) {
      this.rawBytes -= item.raw;
      this.buffered -= item.cost;
    }
    this.next -= this.queued.length;
    this.queued.length = 0;
    this.screen.setWritable(false);
  }
  stop() {
    if (this.ended) return;
    this.ended = true;
    this.revoke();
    this.pending.clear();
  }
}
