import { type DOMRenderer, modsOf } from 'rioterm';
import type { RioTerminal } from './terminal.ts';

/** Rio supports program wheel reports but not button/motion reports. Drags only select locally. */
export function bindPointerInput(
  root: HTMLElement,
  core: RioTerminal,
  renderer: () => Pick<DOMRenderer, 'cellHeight' | 'cellAt'>,
  focus: () => void,
  signal: AbortSignal,
) {
  let selecting: number | undefined;
  let wheelRemainder = 0;
  const events = { signal };
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !core.visible) return;
      focus();
      root.style.outline = '';
      if (event.pointerType === 'touch') return;
      const { row, col, sideRight } = renderer().cellAt(
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
      const { row, col, sideRight } = renderer().cellAt(
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
      if (event.ctrlKey || !core.visible) return; // Preserve browser pinch zoom.
      const view = renderer();
      const inLines =
        event.deltaMode === 1
          ? event.deltaY
          : event.deltaMode === 2
            ? event.deltaY * core.term.options.rows
            : event.deltaY / view.cellHeight;
      wheelRemainder -= inLines;
      const lines = Math.trunc(wheelRemainder);
      wheelRemainder -= lines;
      const { row, col } = view.cellAt(event.clientX, event.clientY);
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
    reset() {
      selecting = undefined;
      wheelRemainder = 0;
    },
  };
}
