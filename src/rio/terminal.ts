import { handleKeyboardEvent, Terminal } from 'rioterm';
import {
  defaultEffectivePreferences,
  type EffectiveRioPreferences,
} from '../preferences/values.ts';
import {
  EMPTY_SEARCH_RESULT,
  type TerminalSearch,
  type TerminalSearchDirection,
} from '../terminal/search.ts';
import { RioOutputSearch } from './output-search.ts';

export interface RioTerminalOptions {
  /** Edge-triggered; the view may coalesce refreshes or wait for navigation. */
  onSearchInvalidated?(): void;
  onInput(data: string, typed: boolean): void;
  onResize(cols: number, rows: number): void;
  cols?: number;
  rows?: number;
  maxCols?: number;
  maxRows?: number;
  /** Host limit, not a request to change the running ring buffer. */
  scrollback?: number;
  preferences?: EffectiveRioPreferences;
}

// Rio 0.1.8 emits both user input and protocol responses synchronously through
// one onData subscription. Attribute bytes to the operation, NOT to a recent
// keypress: a DSR in the next output frame is never a human taking control.
type Source = 'silent' | 'protocol' | 'gesture' | 'wheel';

export class RioTerminal implements TerminalSearch {
  term: Terminal;
  private readonly outputSearch = new RioOutputSearch();
  writable = false;
  visible = true;
  private source: Source = 'silent';
  private keyBytes: Uint8Array[] | undefined;
  private stopped = false;
  private readonly options: RioTerminalOptions;
  private preferences: EffectiveRioPreferences;
  private readonly decode = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  });

  constructor(options: RioTerminalOptions) {
    this.options = options;
    this.preferences = options.preferences ?? defaultEffectivePreferences;
    this.term = this.create(options.cols ?? 80, options.rows ?? 24);
  }

  private create(cols: number, rows: number): Terminal {
    const limit = this.options.scrollback ?? 1000;
    const term = new Terminal({
      cols,
      rows,
      convertEol: false, // DSH supplies real PTY output, including its own CR/LF discipline.
      detectUrls: this.preferences.detectUrls,
      scrollback: Math.max(
        0,
        Math.min(this.preferences.scrollback ?? limit, limit),
      ),
    });
    term.setAltIsMeta(this.preferences.altIsMeta);
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
      if (!data) return;
      this.keyBytes?.push(bytes.slice());
      this.options.onInput(data, this.source === 'gesture');
    });
    return term;
  }

  private during<T>(
    source: Source,
    action: () => T,
    keyBytes?: Uint8Array[],
  ): T {
    const previous = this.source;
    const previousBytes = this.keyBytes;
    this.source = source;
    this.keyBytes = keyBytes;
    try {
      return action();
    } finally {
      this.source = previous;
      this.keyBytes = previousBytes;
    }
  }

  setPreferences(next: EffectiveRioPreferences): void {
    if (this.stopped) return;
    if (next.altIsMeta !== this.preferences.altIsMeta)
      this.term.setAltIsMeta(next.altIsMeta);
    // linkAt() consults this public option on every plain-text hit test in 0.1.8.
    this.term.options.detectUrls = next.detectUrls;
    this.preferences = next; // scrollback is consumed only by the next fresh parser.
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
    this.invalidateSearch(true);
  }

  private invalidateSearch(replaced = false): void {
    if (this.outputSearch.invalidate(replaced))
      this.options.onSearchInvalidated?.();
  }

  search(query: string, direction: TerminalSearchDirection) {
    return this.stopped
      ? EMPTY_SEARCH_RESULT
      : this.outputSearch.search(this.term, query, direction);
  }

  clearSearch(): void {
    if (!this.stopped) this.outputSearch.clear(this.term);
  }

  beginPointerSelection(...args: Parameters<Terminal['selectionBegin']>): void {
    this.outputSearch.pointerSelecting();
    this.term.selectionBegin(...args);
  }

  write(data: string): void {
    if (this.stopped || !data) return;
    this.during('protocol', () => this.term.write(data));
    this.invalidateSearch();
  }

  get interactive(): boolean {
    return !this.stopped && this.visible && this.writable;
  }

  get canFit(): boolean {
    return this.interactive && this.preferences.fit;
  }

  key(event: KeyboardEvent, userInput?: (bytes: Uint8Array) => void): boolean {
    if (!this.interactive || event.isComposing || event.keyCode === 229)
      return false;
    // onData fires *inside* the WASM key encoder. A prediction querying the cursor
    // there would re-enter a borrowed RioTerm. Deliver only this key's accepted
    // bytes, synchronously after the encoder returns and before the next VT frame.
    const keyBytes: Uint8Array[] | undefined =
      userInput &&
      this.preferences.renderer === 'canvas' &&
      this.preferences.predictiveEcho
        ? []
        : undefined;
    const handled = this.during(
      'gesture',
      () => handleKeyboardEvent(this.term, event),
      keyBytes,
    );
    if (keyBytes && userInput && this.interactive)
      for (const bytes of keyBytes) userInput(bytes);
    return handled;
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
      !this.canFit ||
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
    ) {
      this.term.resize(cols, rows);
      this.invalidateSearch();
    }
  }

  dispose(): void {
    if (!this.stopped) {
      this.clearSearch();
      this.stopped = true;
      this.term.dispose();
    }
  }
}
