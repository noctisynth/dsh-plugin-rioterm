import { DOMRenderer, defaultTheme } from 'rioterm';
import type { TerminalFrameSink } from '../terminal/contracts.ts';
import { bindKeyboardInput } from './keyboard-input.ts';
import { bindPointerInput } from './pointer-input.ts';
import { RioTerminal, type RioTerminalOptions } from './terminal.ts';

export interface RioScreen extends TerminalFrameSink {
  setVisible(visible: boolean): void;
  dispose(): void;
}
export interface RioScreenOptions extends RioTerminalOptions {
  label?: string;
}

// Resolve colors through CSS so existing screens also follow theme changes.
const theme = {
  ...defaultTheme,
  foreground: 'var(--dsw-alias-label-primary, CanvasText)',
  background: 'var(--dsw-alias-bg-base, Canvas)',
  cursor: 'currentColor',
  selectionForeground: 'HighlightText',
  selectionBackground: 'Highlight',
};

export function createRioScreen(
  container: HTMLElement,
  options: RioScreenOptions,
): RioScreen {
  const core = new RioTerminal(options);
  const root = container.ownerDocument.createElement('div');
  // Rio, not the invisible IME textarea's browser viewport, owns scrollback.
  root.className = 'rio:relative rio:size-full rio:overflow-clip';
  root.dataset.rioScreen = '';
  const makeRenderer = () => new DOMRenderer(core.term, { theme });
  let renderer: DOMRenderer;
  try {
    renderer = makeRenderer();
  } catch (error) {
    core.dispose();
    throw error;
  }
  root.append(renderer.element);
  const lifetime = new AbortController();
  // Always resolve the active renderer: a reconnect replaces the grid and its metrics.
  const currentRenderer = () => renderer;
  const keyboard = bindKeyboardInput(
    root,
    core,
    currentRenderer,
    options.label ?? 'Rio terminal',
    lifetime.signal,
  );
  const pointer = bindPointerInput(
    root,
    core,
    currentRenderer,
    keyboard.focus,
    lifetime.signal,
  );
  container.append(root);

  // Sample the newest box once per interval while dragging; only a visible writer proposes size.
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelFit() {
    clearTimeout(fitTimer);
    fitTimer = undefined;
  }
  function fit() {
    cancelFit();
    if (core.interactive)
      core.fit(
        root.clientWidth,
        root.clientHeight,
        renderer.cellWidth,
        renderer.cellHeight,
      );
  }
  const observer = new ResizeObserver(() => {
    if (core.interactive && fitTimer === undefined)
      fitTimer = setTimeout(fit, 75);
  });
  observer.observe(container);

  return {
    snapshot(cols, rows, data) {
      if (lifetime.signal.aborted) return;
      keyboard.reset();
      pointer.reset();
      core.snapshot(cols, rows, data);
      renderer.dispose();
      renderer = makeRenderer();
      root.prepend(renderer.element);
    },
    write: (data) => core.write(data),
    resize: (cols, rows) => core.resize(cols, rows),
    setWritable(writable) {
      if (writable === core.writable) return;
      core.writable = writable;
      keyboard.setWritable(writable);
      if (writable) fit();
      else cancelFit();
    },
    setVisible(visible) {
      core.visible = visible;
      root.hidden = !visible;
      if (visible) fit();
      else {
        cancelFit();
        keyboard.blur();
      }
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      observer.disconnect();
      cancelFit();
      lifetime.abort();
      renderer.dispose();
      core.dispose();
      root.remove();
    },
  };
}
