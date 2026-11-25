import { modsOf } from 'rioterm';
import type { RioRenderer } from './renderer.ts';
import type { RioTerminal } from './terminal.ts';

type PointerView = Pick<
  RioRenderer,
  | 'cellWidth'
  | 'cellHeight'
  | 'cellAt'
  | 'element'
  | 'setHoverLink'
  | 'resetPredictions'
>;

/** All terminal output, including an OSC 8 destination, is untrusted text. */
function safeHref(uri: string): string | undefined {
  if (!/^(?:https?:\/\/|mailto:)/i.test(uri) || /[\s\\]/u.test(uri)) return;
  try {
    const url = new URL(uri); // No base URL: never navigate relative to the authenticated DSH origin.
    if (
      url.protocol === 'https:' ||
      url.protocol === 'http:' ||
      url.protocol === 'mailto:'
    )
      return url.href;
  } catch {
    /* An invalid destination is ordinary selectable terminal output. */
  }
}

function linkChord(event: PointerEvent): boolean {
  return (
    event.isTrusted &&
    event.pointerType !== 'touch' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

/** Rio supports program wheel reports but not button/motion reports. Drags only select locally. */
export function bindPointerInput(
  root: HTMLElement,
  core: RioTerminal,
  renderer: () => PointerView,
  focus: () => void,
  signal: AbortSignal,
  linkPrompt = '',
) {
  let selecting: number | undefined;
  let candidate: { id: number; x: number; y: number; href: string } | undefined;
  let hovering = false;
  let wheelRemainder = 0;
  const events = { signal };
  const hit = (event: PointerEvent) => {
    if (!core.visible || !linkChord(event)) return;
    const view = renderer();
    const rect = view.element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // cellAt clamps selection drags. Empty space OUTSIDE the grid must not link to its last cell.
    if (
      x < 0 ||
      y < 0 ||
      x >= Math.min(rect.width, view.cellWidth * core.term.options.cols) ||
      y >= Math.min(rect.height, view.cellHeight * core.term.options.rows)
    )
      return;
    const { row, col } = view.cellAt(event.clientX, event.clientY);
    const link = core.term.linkAt(row, col);
    const href = link && safeHref(link.uri);
    if (link && href)
      return {
        href,
        run: { line: row, startCol: link.startCol, endCol: link.endCol },
      };
  };
  const clearHover = () => {
    if (!hovering) return;
    renderer().setHoverLink(null);
    renderer().element.style.cursor = 'text';
    hovering = false;
  };
  const clearLinks = () => {
    candidate = undefined;
    clearHover();
  };
  const moved = (event: PointerEvent, start: { x: number; y: number }) =>
    Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5;
  root.addEventListener(
    'pointerdown',
    (event) => {
      candidate = undefined;
      if (event.button !== 0 || !core.visible) return;
      focus();
      root.removeAttribute('data-rio-keyboard-focus');
      if (event.pointerType === 'touch') return;
      const link = hit(event);
      if (link) {
        candidate = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          href: link.href,
        };
        event.preventDefault();
        return;
      }
      const { row, col, sideRight } = renderer().cellAt(
        event.clientX,
        event.clientY,
      );
      core.beginPointerSelection(
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
      if (
        candidate &&
        (candidate.id !== event.pointerId ||
          moved(event, candidate) ||
          !linkChord(event))
      )
        candidate = undefined;
      const view = renderer();
      if (selecting === event.pointerId) {
        const { row, col, sideRight } = view.cellAt(
          event.clientX,
          event.clientY,
        );
        core.term.selectionUpdate(row, col, sideRight);
        clearHover();
        return;
      }
      const link = hit(event);
      if (link) {
        view.setHoverLink(link.run);
        view.element.style.cursor = 'pointer';
        hovering = true;
      } else clearHover();
    },
    events,
  );
  root.addEventListener(
    'pointerup',
    (event) => {
      const down = candidate;
      candidate = undefined;
      if (
        !down ||
        down.id !== event.pointerId ||
        event.button !== 0 ||
        moved(event, down)
      )
        return;
      const href = hit(event)?.href; // Output/scroll/geometry may have changed since pointerdown.
      if (!href || href !== down.href) return;
      event.preventDefault();
      clearHover();
      const win = root.ownerDocument.defaultView;
      if (win?.confirm(linkPrompt ? `${linkPrompt}\n\n${href}` : href))
        win.open(href, '_blank', 'noopener,noreferrer');
    },
    events,
  );
  root.addEventListener('pointerleave', clearLinks, events);
  root.addEventListener('pointercancel', clearLinks, events);
  root.addEventListener(
    'keyup',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) clearLinks();
    },
    { ...events, capture: true },
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
      if (lines) {
        clearLinks();
        view.resetPredictions();
      }
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
    clearLinks,
    reset() {
      clearLinks();
      selecting = undefined;
      wheelRemainder = 0;
    },
  };
}
