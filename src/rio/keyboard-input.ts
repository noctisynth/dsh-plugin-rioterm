import type { RioRenderer } from './renderer.ts';
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

const hiddenAncestor = '[inert], [hidden], [aria-hidden="true"]';

// Watch only while an activation is waiting for the engine/shell. The old focus
// owner (even a composer) is not itself a veto; a subsequent gesture is.
export function beginAutoFocus(
  container: HTMLElement,
): AbortController | undefined {
  const doc = container.ownerDocument;
  if (doc.hidden || !doc.hasFocus() || container.closest(hiddenAncestor))
    return;
  const request = new AbortController();
  const cancel = () => request.abort();
  const events = { capture: true, signal: request.signal };
  doc.addEventListener('input', cancel, events);
  doc.addEventListener('visibilitychange', cancel, events);
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (!container.contains(event.target as Node)) cancel();
    },
    events,
  );
  const selectedTab = '[role="tab"][aria-selected="true"]';
  doc.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as Element | null;
      // Typing into the not-yet-ready tab does not revoke it (or buffer keys).
      // Typing in the old composer, or navigating elsewhere, does.
      const atTerminal =
        target === doc.body ||
        target?.contains(container) ||
        target?.matches?.(selectedTab) ||
        container.contains(target);
      if (!atTerminal || event.key === 'Tab' || event.key === 'Escape')
        cancel();
    },
    events,
  );
  let activating = true;
  queueMicrotask(() => {
    activating = false;
  });
  doc.addEventListener(
    'focusin',
    (event) => {
      // DockKit hands focus to a selected tab chip during the activation commit,
      // or to the surrounding pane after it. Neither is a new editing gesture.
      const target = event.target as Element | null;
      if (target?.contains(container)) return;
      if (activating && target?.matches?.(selectedTab)) return;
      cancel();
    },
    events,
  );
  doc.defaultView?.addEventListener('blur', cancel, { signal: request.signal });
  return request;
}

export function bindKeyboardInput(
  root: HTMLElement,
  core: RioTerminal,
  renderer: () => Pick<
    RioRenderer,
    'cellWidth' | 'cellHeight' | 'userInput' | 'resetPredictions'
  >,
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
  // Keep the IME target focusable. Its pixel position follows Rio's measured grid.
  input.className =
    'rio:absolute rio:top-0 rio:left-0 rio:h-[1em] rio:w-px rio:resize-none rio:border-0 rio:p-0 rio:opacity-0 rio:pointer-events-none';
  root.append(input);
  const events = { signal };
  const doc = root.ownerDocument;
  const reset = () => {
    editing.reset();
    input.value = '';
    renderer().resetPredictions();
  };
  const positionComposition = () => {
    if (!editing.composing) return;
    const pos = core.term.cursorPosition();
    const { cellWidth, cellHeight } = renderer();
    input.style.left = `${Math.max(0, pos.col) * cellWidth}px`;
    input.style.top = `${Math.max(0, pos.line) * cellHeight}px`;
  };
  input.addEventListener(
    'compositionstart',
    () => {
      if (!core.interactive) return;
      renderer().resetPredictions();
      editing.start();
      positionComposition();
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
      const text = editing.input(
        event.data ?? input.value,
        event.inputType,
        event.isComposing,
      );
      if (text) {
        renderer().resetPredictions();
        core.text(text);
      }
      input.value = '';
    },
    events,
  );
  input.addEventListener(
    'focus',
    () => {
      root.toggleAttribute(
        'data-rio-keyboard-focus',
        input.matches(':focus-visible'),
      );
    },
    events,
  );
  input.addEventListener(
    'blur',
    () => {
      root.removeAttribute('data-rio-keyboard-focus');
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
    if (core.key(event, (bytes) => renderer().userInput(bytes))) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  input.addEventListener('keydown', key, events);
  input.addEventListener('keyup', key, events);
  return {
    reset,
    positionComposition,
    focusIfInteractive() {
      if (
        core.interactive &&
        !signal.aborted &&
        doc.hasFocus() &&
        !doc.hidden &&
        root.getClientRects().length &&
        !root.closest(hiddenAncestor)
      ) {
        input.focus({ preventScroll: true });
      }
    },
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
