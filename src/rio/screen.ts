import {
  defaultEffectivePreferences,
  type EffectiveRioPreferences,
} from '../preferences/values.ts';
import type { TerminalFrameSink } from '../terminal/contracts.ts';
import { bindKeyboardInput } from './keyboard-input.ts';
import { bindPointerInput } from './pointer-input.ts';
import { makeRioRenderer } from './renderer.ts';
import { RioTerminal, type RioTerminalOptions } from './terminal.ts';
import { RioViewport } from './viewport.ts';

export interface RioScreen extends TerminalFrameSink {
  focus(): void;
  focusIfInteractive(): void;
  setVisible(visible: boolean): void;
  setPreferences(preferences: EffectiveRioPreferences): void;
  dispose(): void;
}
export interface RioScreenOptions extends RioTerminalOptions {
  label?: string;
  linkPrompt?: string;
}

export function createRioScreen(
  container: HTMLElement,
  options: RioScreenOptions,
): RioScreen {
  const preferences = options.preferences ?? defaultEffectivePreferences;
  const core = new RioTerminal(options);
  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  // Rio, not the invisible IME textarea's browser viewport, owns scrollback.
  root.className = 'rio:relative rio:size-full rio:overflow-clip';
  root.dataset.rioScreen = '';
  container.append(root); // Colors resolve in this mounted DSH view (including Canvas).
  let viewport: RioViewport;
  try {
    viewport = new RioViewport(core, preferences, {
      mount(term, p) {
        const renderer = makeRioRenderer(term, p, root);
        root.prepend(renderer.element); // Do not move/replace the focused IME textarea.
        return renderer;
      },
      box: () => ({ width: root.clientWidth, height: root.clientHeight }),
      metricsChanged: () => keyboard.positionComposition(),
      nextFrame(update) {
        const id = requestAnimationFrame(update);
        return () => cancelAnimationFrame(id);
      },
    });
  } catch (error) {
    root.remove();
    core.dispose();
    throw error;
  }
  const lifetime = new AbortController();
  const { signal } = lifetime;
  // Both input paths resolve the current renderer after a snapshot, font or view change.
  const currentRenderer = () => viewport.renderer;
  const keyboard = bindKeyboardInput(
    root,
    core,
    currentRenderer,
    options.label ?? 'Rio terminal',
    signal,
  );
  const pointer = bindPointerInput(
    root,
    core,
    currentRenderer,
    keyboard.focus,
    signal,
    options.linkPrompt,
  );

  // Sample the newest box once per interval while dragging; only a visible writer proposes size.
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelFit() {
    clearTimeout(fitTimer);
    fitTimer = undefined;
  }
  function fit() {
    cancelFit();
    viewport.fit();
  }
  const observer = new ResizeObserver(() => {
    if (core.canFit && fitTimer === undefined) fitTimer = setTimeout(fit, 75);
  });
  observer.observe(container);
  doc.fonts?.addEventListener(
    'loadingdone',
    (event) => viewport.fontsLoaded(event.fontfaces),
    { signal },
  );
  // A Canvas backing store also depends on the display's physical pixel ratio, even if the CSS box is unchanged.
  const win = doc.defaultView;
  function watchPixelRatio() {
    if (!win?.matchMedia || signal.aborted) return;
    win
      .matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`)
      .addEventListener(
        'change',
        () => {
          viewport.pixelRatioChanged();
          watchPixelRatio();
        },
        { once: true, signal },
      );
  }
  watchPixelRatio();
  let detectUrls = preferences.detectUrls;
  return {
    focus: keyboard.focus,
    focusIfInteractive: keyboard.focusIfInteractive,
    snapshot(cols, rows, data) {
      if (signal.aborted) return;
      keyboard.reset();
      pointer.reset();
      core.snapshot(cols, rows, data);
      viewport.rebind();
    },
    write: (data) => core.write(data),
    resize: (cols, rows) => core.resize(cols, rows),
    setPreferences(next) {
      if (signal.aborted) return;
      if (!next.fit) cancelFit();
      if (detectUrls !== next.detectUrls) pointer.clearLinks();
      detectUrls = next.detectUrls;
      viewport.setPreferences(next);
    },
    setWritable(writable) {
      if (signal.aborted || writable === core.writable) return;
      core.writable = writable;
      keyboard.setWritable(writable);
      if (writable) fit();
      else cancelFit();
    },
    setVisible(visible) {
      if (signal.aborted) return;
      core.visible = visible;
      root.hidden = !visible;
      if (visible) fit();
      else {
        cancelFit();
        pointer.reset();
        keyboard.blur();
      }
    },
    dispose() {
      if (signal.aborted) return;
      observer.disconnect();
      cancelFit();
      lifetime.abort();
      viewport.dispose();
      core.dispose();
      root.remove();
    },
  };
}
