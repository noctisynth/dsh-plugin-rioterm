import type { DOMRenderer } from 'rioterm';
import type { RioTerminal } from './terminal.ts';

// Chromium and WebKit disagree on whether final input precedes compositionend.
// Commit once; a new editing gesture ends suppression of a matching echo.
export class RioTextInput {
  composing = false;
  private echo: string | undefined;
  start(): void {
    this.composing = true;
    this.echo = undefined;
  }
  key(): void {
    this.echo = undefined;
  }
  reset(): void {
    this.composing = false;
    this.echo = undefined;
  }
  end(text: string): string {
    if (!this.composing) return '';
    this.composing = false;
    this.echo = text;
    return text;
  }
  input(text: string, type: string, composing: boolean): string {
    if (composing || this.composing) return '';
    const duplicate = this.echo === text;
    this.echo = undefined;
    if (
      duplicate ||
      type === 'insertCompositionText' ||
      type === 'insertFromComposition' ||
      type === 'insertFromPaste'
    )
      return '';
    return type.startsWith('insert') ? text : '';
  }
}

export function bindKeyboardInput(
  root: HTMLElement,
  core: RioTerminal,
  cells: () => Pick<DOMRenderer, 'cellWidth' | 'cellHeight'>,
  label: string,
  signal: AbortSignal,
) {
  const editing = new RioTextInput();
  const input = root.ownerDocument.createElement('textarea');
  input.setAttribute('aria-label', label);
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.readOnly = true;
  Object.assign(input.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    opacity: '0',
    width: '1px',
    height: '1em',
    padding: '0',
    border: '0',
    resize: 'none',
    pointerEvents: 'none',
  });
  root.append(input);
  const events = { signal };
  const reset = () => {
    editing.reset();
    input.value = '';
  };
  input.addEventListener(
    'compositionstart',
    () => {
      if (!core.interactive) return;
      editing.start();
      const pos = core.term.cursorPosition();
      const { cellWidth, cellHeight } = cells();
      input.style.left = `${Math.max(0, pos.col) * cellWidth}px`;
      input.style.top = `${Math.max(0, pos.line) * cellHeight}px`;
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
  input.addEventListener(
    'focus',
    () => {
      if (input.matches(':focus-visible'))
        root.style.outline =
          '1px solid var(--dsw-alias-label-primary, Highlight)';
    },
    events,
  );
  input.addEventListener(
    'blur',
    () => {
      root.style.outline = '';
      reset();
    },
    events,
  );
  input.addEventListener(
    'paste',
    (event) => {
      event.preventDefault();
      reset();
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
    // Leave Cmd+C/V and Ctrl+Shift+V to native clipboard events.
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
  return {
    reset,
    setWritable(writable: boolean) {
      input.readOnly = !writable;
      if (!writable) reset();
    },
    focus() {
      if (!signal.aborted && core.visible) input.focus({ preventScroll: true });
    },
    blur() {
      input.blur();
      reset();
    },
  };
}
