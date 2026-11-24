import { DOMRenderer, defaultTheme, modsOf } from 'rioterm';
import {
  type RioScreenOptions,
  RioTerminal,
  RioTextInput,
} from './rio-terminal.js';

export type { RioScreenOptions } from './rio-terminal.js';

export interface RioScreen {
  snapshot(cols: number, rows: number, data: string): void;
  write(data: string): void;
  /** Apply Host size locally, without requesting a PTY resize. */
  resize(cols: number, rows: number): void;
  setWritable(writable: boolean): void;
  setVisible(visible: boolean): void;
  fit(): void;
  focus(): void;
  dispose(): void;
}

export function createRioScreen(
  container: HTMLElement,
  options: RioScreenOptions,
): RioScreen {
  const core = new RioTerminal(options);
  const editing = new RioTextInput();
  const lifetime = new AbortController();
  const events = { signal: lifetime.signal };
  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  Object.assign(root.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  });
  const input = doc.createElement('textarea');
  input.setAttribute('aria-label', options.label ?? 'Rio terminal');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.readOnly = true;
  Object.assign(input.style, {
    position: 'absolute',
    opacity: '0',
    width: '1px',
    height: '1em',
    padding: '0',
    border: '0',
    resize: 'none',
    pointerEvents: 'none',
  });
  // DOMRenderer accepts CSS colors. Keep theme changes live and give inverse
  // video an actual foreground/background pair instead of 'transparent'.
  const theme = {
    ...defaultTheme,
    foreground: 'var(--dsw-alias-label-primary, CanvasText)',
    background: 'var(--dsw-alias-bg-base, Canvas)',
    cursor: 'currentColor',
    selectionForeground: 'HighlightText',
    selectionBackground: 'Highlight',
  };
  const makeRenderer = () => new DOMRenderer(core.term, { theme });
  let renderer: DOMRenderer;
  try {
    renderer = makeRenderer();
  } catch (error) {
    core.dispose();
    throw error;
  }
  root.append(renderer.element, input);
  container.append(root);
  let stopped = false;
  let selecting: number | undefined;
  let wheelRemainder = 0;

  const focus = () => {
    if (!stopped && core.visible) input.focus({ preventScroll: true });
  };
  const cancelInput = () => {
    editing.reset();
    input.value = '';
  };
  function positionInput() {
    const pos = core.term.cursorPosition();
    input.style.left = `${Math.max(0, pos.col) * renderer.cellWidth}px`;
    input.style.top = `${Math.max(0, pos.line) * renderer.cellHeight}px`;
  }
  function fit() {
    if (stopped) return;
    core.fit(
      root.clientWidth,
      root.clientHeight,
      renderer.cellWidth,
      renderer.cellHeight,
    );
  }
  const observer = new ResizeObserver(fit);
  observer.observe(container);

  input.addEventListener(
    'compositionstart',
    () => {
      if (core.interactive) {
        editing.start();
        positionInput();
      }
    },
    events,
  );
  input.addEventListener(
    'compositionend',
    (event) => {
      core.text(editing.end(event.data));
      input.value = '';
    },
    events,
  );
  input.addEventListener(
    'input',
    (event) => {
      if (
        !(event instanceof InputEvent) ||
        event.isComposing ||
        editing.composing
      )
        return;
      core.text(
        editing.input(
          event.data ?? input.value,
          event.inputType,
          event.isComposing,
        ),
      );
      input.value = '';
    },
    events,
  );
  input.addEventListener('blur', cancelInput, events);
  input.addEventListener(
    'paste',
    (event) => {
      event.preventDefault();
      cancelInput();
      core.text(event.clipboardData?.getData('text/plain') ?? '', true);
    },
    events,
  );
  input.addEventListener(
    'copy',
    (event) => {
      const text = core.term.getSelection();
      if (text && event.clipboardData) {
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
      }
    },
    events,
  );
  const key = (event: KeyboardEvent) => {
    if (editing.composing || event.isComposing || event.keyCode === 229) return;
    if (event.type === 'keydown') editing.key();
    const letter = event.key.toLowerCase();
    // Leave Cmd+C/V and Ctrl+Shift+V to the browser's native clipboard events.
    if (
      (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
      (letter === 'v' || letter === 'c')
    ) {
      if (
        event.type === 'keydown' &&
        letter === 'c' &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.metaKey
      ) {
        const selection = core.term.getSelection();
        if (selection && navigator.clipboard) {
          event.preventDefault();
          void navigator.clipboard.writeText(selection).catch(() => {});
        }
      }
      return;
    }
    if (
      event.shiftKey &&
      (event.key === 'PageUp' || event.key === 'PageDown')
    ) {
      if (event.type === 'keydown')
        core.term.scrollLines(
          (event.key === 'PageUp' ? 1 : -1) * core.term.options.rows,
        );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (core.key(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  input.addEventListener('keydown', key, events);
  input.addEventListener('keyup', key, events);

  // 0.1.8 exposes program wheel reports, but NOT mouse button/motion reports
  // or the active encoding mode. Pointer actions are local selection only.
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !core.visible) return;
      focus();
      if (event.pointerType === 'touch') return;
      const { row, col, sideRight } = renderer.cellAt(
        event.clientX,
        event.clientY,
      );
      core.term.selectionBegin(
        row,
        col,
        event.detail >= 3
          ? 'line'
          : event.detail === 2
            ? 'word'
            : event.altKey
              ? 'block'
              : 'simple',
        sideRight,
      );
      selecting = event.pointerId;
      root.setPointerCapture(selecting);
      event.preventDefault();
    },
    events,
  );
  root.addEventListener(
    'pointermove',
    (event) => {
      if (selecting !== event.pointerId) return;
      const { row, col, sideRight } = renderer.cellAt(
        event.clientX,
        event.clientY,
      );
      core.term.selectionUpdate(row, col, sideRight);
    },
    events,
  );
  root.addEventListener(
    'lostpointercapture',
    () => {
      selecting = undefined;
    },
    events,
  );
  root.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || !core.visible) return; // never steal browser pinch zoom
      const inLines =
        event.deltaMode === 1
          ? event.deltaY
          : event.deltaMode === 2
            ? event.deltaY * core.term.options.rows
            : event.deltaY / renderer.cellHeight;
      wheelRemainder -= inLines;
      const lines = Math.trunc(wheelRemainder);
      wheelRemainder -= lines;
      const { row, col } = renderer.cellAt(event.clientX, event.clientY);
      if (
        core.wheel(
          Math.max(-200, Math.min(200, lines)),
          col,
          row,
          modsOf(event as unknown as KeyboardEvent),
        )
      )
        event.preventDefault();
    },
    { ...events, passive: false },
  );

  return {
    snapshot(cols, rows, data) {
      if (stopped) return;
      cancelInput();
      selecting = undefined;
      wheelRemainder = 0;
      core.snapshot(cols, rows, data);
      renderer.dispose();
      renderer = makeRenderer();
      root.insertBefore(renderer.element, input);
    },
    write(data) {
      core.write(data);
    },
    resize(cols, rows) {
      if (
        !stopped &&
        (cols !== core.term.options.cols || rows !== core.term.options.rows)
      )
        core.term.resize(cols, rows);
    },
    setWritable(writable) {
      core.writable = writable;
      input.readOnly = !writable;
      if (!writable) cancelInput();
      else fit();
    },
    setVisible(visible) {
      core.visible = visible;
      root.hidden = !visible;
      if (!visible) {
        input.blur();
        cancelInput();
      } else fit();
    },
    fit,
    focus,
    dispose() {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      lifetime.abort();
      renderer.dispose();
      core.dispose();
      root.remove();
    },
  };
}
