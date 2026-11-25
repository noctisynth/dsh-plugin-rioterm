import type {
  TerminalFrameSink,
  TerminalLimits,
  TerminalStatus,
} from '../terminal/contracts.ts';
import {
  type InputWindow,
  owned,
  type RemoteAttachment,
  type RemoteFrame,
  type TerminalInfo,
  type WireCommand,
  type WireInput,
} from './remote.ts';

const encoder = new TextEncoder();
// A wire belongs to exactly one physical attachment. Input is never retried or
// transferred to another generation, including commands waiting for capacity.
export class TerminalWire {
  private output = -1;
  private next = 0;
  private acknowledged = 0;
  private queued: { command: WireCommand; cost: number; raw: number }[] = [];
  private pending = new Map<number, { cost: number; raw: number }>();
  private inFlight = 0;
  private buffered = 0;
  private rawBytes = 0;
  private writable = false;
  private window?: InputWindow;
  private hostSize = '';
  // Latest intent for this writable attachment. A state for an earlier resize
  // can arrive while a later request is still queued or in flight.
  private requestedSize: string | undefined;
  private ended = false;
  private readonly id: string;
  private readonly handle: RemoteAttachment;
  private readonly limits: TerminalLimits;
  private readonly screen: TerminalFrameSink;
  private readonly notify: (s: TerminalStatus) => void;
  constructor(
    id: string,
    handle: RemoteAttachment,
    limits: TerminalLimits,
    screen: TerminalFrameSink,
    notify: (s: TerminalStatus) => void,
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
        this.receive(frame);
      }
    } finally {
      this.stop();
    }
  }
  receive(frame: RemoteFrame) {
    if (this.ended) return;
    if (!frame || (this.output < 0 && frame.type !== 'snapshot'))
      throw new Error('Missing opening terminal snapshot.');
    switch (frame.type) {
      case 'snapshot':
        if (
          this.output >= 0 ||
          !Number.isSafeInteger(frame.sequence) ||
          frame.sequence < 0 ||
          typeof frame.screen !== 'string' ||
          (frame.inputWindow !== undefined &&
            (!frame.inputWindow ||
              !Number.isSafeInteger(frame.inputWindow.maxBytes) ||
              frame.inputWindow.maxBytes <= 0 ||
              !Number.isSafeInteger(frame.inputWindow.frameOverheadBytes) ||
              frame.inputWindow.frameOverheadBytes < 0))
        )
          throw new Error('Invalid terminal snapshot.');
        this.validateState(frame.info, frame.writable);
        this.output = frame.sequence;
        if (frame.inputWindow) this.window = frame.inputWindow;
        this.hostSize = `${frame.info.cols}:${frame.info.rows}`;
        this.screen.snapshot(frame.info.cols, frame.info.rows, frame.screen);
        this.update(frame.info, frame.writable);
        break;
      case 'state':
        this.validateState(frame.info, frame.writable);
        this.update(frame.info, frame.writable);
        break;
      case 'output':
        if (
          !Number.isSafeInteger(frame.sequence) ||
          frame.sequence !== this.output + 1 ||
          typeof frame.data !== 'string'
        )
          throw new Error('Terminal output sequence gap.');
        this.output = frame.sequence;
        this.screen.write(frame.data);
        break;
      case 'ack': {
        const pay = this.pending.get(frame.sequence);
        if (
          frame.sequence !== this.acknowledged + 1 ||
          !pay ||
          (frame.refusal !== undefined &&
            frame.refusal !== 'not-running' &&
            frame.refusal !== 'read-only')
        )
          throw new Error('Unexpected input acknowledgement.');
        this.acknowledged = frame.sequence;
        this.rawBytes -= pay.raw;
        this.inFlight -= pay.cost;
        this.buffered -= pay.cost;
        this.pending.delete(frame.sequence);
        if (frame.refusal) {
          this.revoke();
          this.notify(frame.refusal === 'not-running' ? 'exited' : 'readonly');
        }
        this.flush();
        break;
      }
      default:
        throw new Error('Unknown terminal frame.');
    }
  }
  private validateState(info: TerminalInfo, writable: boolean) {
    owned(this.id, info);
    if (
      typeof writable !== 'boolean' ||
      !Number.isSafeInteger(info.cols) ||
      info.cols < 1 ||
      !Number.isSafeInteger(info.rows) ||
      info.rows < 1 ||
      !['running', 'exited', 'failed'].includes(info.state)
    )
      throw new Error('Invalid terminal state.');
  }
  private update(info: TerminalInfo, writable: boolean) {
    const size = `${info.cols}:${info.rows}`;
    if (size !== this.hostSize) {
      // The Host queues resize state alongside output. Reflow *here*, even for
      // the writer: output preceding this state still belongs to the old grid.
      this.hostSize = size;
      this.screen.resize(info.cols, info.rows);
    }
    const canWrite = writable && info.state === 'running';
    if (!canWrite) this.revoke();
    else if (!this.writable) {
      this.writable = true;
      this.screen.setWritable(true);
    }
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
    const target = `${cols}:${rows}`;
    if (target === (this.requestedSize ?? this.hostSize)) return;
    this.requestedSize = target;
    this.queue({ type: 'resize', cols, rows }, 0);
  }
  private queue(input: WireInput, raw: number) {
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
    this.requestedSize = undefined;
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
