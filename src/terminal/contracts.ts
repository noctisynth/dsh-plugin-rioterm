// The screen and session meet here. Neither side needs a DSH frame or a Rio parser.
export interface TerminalFrameSink {
  snapshot(cols: number, rows: number, data: string): void;
  write(data: string): void;
  /** Apply host geometry in output order; never send a resize proposal back. */
  resize(cols: number, rows: number): void;
  setWritable(writable: boolean): void;
}

export interface TerminalLimits {
  maxCols: number;
  maxRows: number;
  maxInputBytes: number;
  maxBufferedBytes: number;
  scrollback: number;
}

export type TerminalStatus =
  | 'opening'
  | 'connected'
  | 'readonly'
  | 'exited'
  | 'failed'
  | 'disconnected'
  | 'missing';

export interface TerminalPanel {
  visible?: boolean;
  screen: TerminalFrameSink;
  status(state: TerminalStatus, reason?: string): void;
}

export interface TerminalAttachment {
  input(data: string, typed: boolean): void;
  resize(cols: number, rows: number): void;
  setVisible(visible: boolean): void;
  /** Stop this view, not the shell it displays. */
  detach(): void;
  readonly done: Promise<void>;
}

/** The page can attach to a private session, not allocate or close a host process directly. */
export interface TerminalSession {
  needsLaunch(ticket: unknown): boolean;
  environment(signal: AbortSignal): Promise<TerminalLimits>;
  mount(
    ticket: unknown,
    limits: TerminalLimits,
    panel: TerminalPanel,
  ): TerminalAttachment;
}
