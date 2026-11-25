import { handleKeyboardEvent, Terminal } from 'rioterm';

export interface RioTerminalOptions {
  onInput(data: string, typed: boolean): void;
  onResize(cols: number, rows: number): void;
  cols?: number;
  rows?: number;
  maxCols?: number;
  maxRows?: number;
  scrollback?: number;
}

// Rio 0.1.8 emits both user input and protocol responses synchronously through
// one onData subscription. Attribute bytes to the operation, NOT to a recent
// keypress: a DSR in the next output frame is never a human taking control.
type Source = 'silent' | 'protocol' | 'gesture' | 'wheel';

export class RioTerminal {
  term: Terminal;
  writable = false;
  visible = true;
  private source: Source = 'silent';
  private stopped = false;
  private readonly options: RioTerminalOptions;
  private readonly decode = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  });

  constructor(options: RioTerminalOptions) {
    this.options = options;
    this.term = this.create(options.cols ?? 80, options.rows ?? 24);
  }

  private create(cols: number, rows: number): Terminal {
    const term = new Terminal({
      cols,
      rows,
      scrollback: this.options.scrollback ?? 1000,
    });
    term.onData((bytes) => {
      if (this.stopped || !this.writable || this.source === 'silent') return;
      // DSH transports UTF-8 strings, not a raw 8-bit channel. Do not send
      // replacement characters for legacy mouse reports that aren't UTF-8.
      let data: string;
      try {
        data = this.decode.decode(bytes);
      } catch {
        return;
      }
      if (data) this.options.onInput(data, this.source === 'gesture');
    });
    return term;
  }

  private during<T>(source: Source, action: () => T): T {
    const previous = this.source;
    this.source = source;
    try {
      return action();
    } finally {
      this.source = previous;
    }
  }

  snapshot(cols: number, rows: number, data: string): void {
    if (this.stopped) return;
    // Fresh parser/grid: an interrupted escape or alternate screen from the
    // old attachment must not leak across a reconnect. Don't replay DA/DSR.
    this.during('silent', () => {
      const next = this.create(cols, rows);
      try {
        next.write(data);
      } catch (error) {
        next.dispose();
        throw error;
      }
      this.term.dispose();
      this.term = next;
    });
  }

  write(data: string): void {
    if (!this.stopped) this.during('protocol', () => this.term.write(data));
  }

  get interactive(): boolean {
    return !this.stopped && this.visible && this.writable;
  }

  key(event: KeyboardEvent): boolean {
    if (!this.interactive || event.isComposing || event.keyCode === 229)
      return false;
    return this.during('gesture', () => handleKeyboardEvent(this.term, event));
  }

  text(text: string, paste = false): void {
    if (!this.interactive || !text) return;
    this.during('gesture', () =>
      paste ? this.term.paste(text) : this.term.input(text),
    );
  }

  wheel(lines: number, col: number, row: number, mods: number): boolean {
    if (this.stopped || !this.visible || !lines) return false;
    const before = this.term.displayOffset();
    if (!this.writable) this.term.scrollLines(lines);
    else if (
      this.during('wheel', () => this.term.scrollWheel(lines, col, row, mods))
    )
      return true;
    return this.term.displayOffset() !== before;
  }

  fit(
    width: number,
    height: number,
    cellWidth: number,
    cellHeight: number,
  ): void {
    if (
      !this.interactive ||
      width < cellWidth ||
      height < cellHeight ||
      cellWidth <= 0 ||
      cellHeight <= 0
    )
      return;
    const cols = Math.max(
      2,
      Math.min(this.options.maxCols ?? 500, Math.floor(width / cellWidth)),
    );
    const rows = Math.max(
      2,
      Math.min(this.options.maxRows ?? 200, Math.floor(height / cellHeight)),
    );
    // This is a request, not a grid update. Even a return to the current
    // grid might have to undo a request that the Host has not applied yet.
    this.options.onResize(cols, rows);
  }

  /** Consume a geometry change from the same ordered stream as write(). */
  resize(cols: number, rows: number): void {
    if (
      !this.stopped &&
      (cols !== this.term.options.cols || rows !== this.term.options.rows)
    )
      this.term.resize(cols, rows);
  }

  dispose(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.term.dispose();
    }
  }
}
