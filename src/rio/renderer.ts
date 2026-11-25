import {
  CanvasRenderer,
  DOMRenderer,
  defaultTheme,
  type Overlay,
  PredictionEngine,
  type Snapshot,
  type Terminal,
  type Theme,
} from 'rioterm';
import {
  ansiNames,
  colorFields,
  type EffectiveRioPreferences,
} from '../preferences/values.ts';

export interface RioRenderer
  extends Pick<
    DOMRenderer,
    | 'element'
    | 'cellWidth'
    | 'cellHeight'
    | 'cellAt'
    | 'setHoverLink'
    | 'dispose'
  > {
  /** Only a committed key, after returning from WASM; never a raw onData subscription. */
  userInput(bytes: Uint8Array): void;
  resetPredictions(): void;
}

const dshTheme: Theme = {
  ...defaultTheme,
  foreground: 'var(--dsw-alias-label-primary, CanvasText)',
  background: 'var(--dsw-alias-bg-base, Canvas)',
  cursor: 'currentColor',
  selectionForeground: 'HighlightText',
  selectionBackground: 'Highlight',
};

// CSS accepts shorthand, but Rio 0.1.8's named dim colors read pairs of hex digits.
function fullHex(color: string): string {
  return /^#[\da-f]{3,4}$/i.test(color)
    ? color.replace(/[\da-f]/gi, '$&$&')
    : color;
}

function composeTheme(overrides: EffectiveRioPreferences['theme']): Theme {
  const theme = { ...dshTheme };
  for (const key of colorFields) {
    const color = overrides[key];
    if (color) theme[key] = fullHex(color);
  }
  for (const [index, key] of ansiNames.entries()) {
    const color = overrides.palette?.[index];
    if (color) theme[key] = fullHex(color);
  }
  return theme;
}

const themeKeys = [...colorFields, ...ansiNames];

/** Resolve CSS in this terminal's actual color-scheme/inheritance context, not document.body. */
function canvasTheme(root: HTMLElement, theme: Theme): Theme {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!root.isConnected || !view)
    throw new Error('Canvas colors require a mounted Rio screen');

  // 0.1.8 paints to an opaque surface and its named dim colors require #rrggbb.
  // Let the browser convert even wide-gamut/system colors to that surface's sRGB.
  const swatch = doc.createElement('canvas');
  swatch.width = themeKeys.length;
  swatch.height = 1;
  const ctx = swatch.getContext('2d');
  if (!ctx) throw new Error('Rio requires a 2D canvas context');
  const probe = doc.createElement('span');
  probe.hidden = true;
  probe.style.color = theme.foreground;
  root.append(probe);
  try {
    const resolve = (color: string): string => {
      probe.style.backgroundColor = color;
      return view.getComputedStyle(probe).backgroundColor;
    };
    // Composite alpha once, not over last frame's glyphs on each repaint. No
    // dark/light guess: system Canvas and DSH's own backdrop come from the probe.
    const fillBase = (color: string) => {
      ctx.fillStyle = resolve(color);
      ctx.fillRect(0, 0, swatch.width, 1);
    };
    fillBase('Canvas');
    fillBase(dshTheme.background);
    if (theme.background !== dshTheme.background) fillBase(theme.background);
    for (const [index, key] of themeKeys.entries()) {
      if (key === 'background') continue;
      ctx.fillStyle =
        key === 'foreground'
          ? view.getComputedStyle(probe).color
          : resolve(theme[key]); // currentColor now follows the effective foreground.
      ctx.fillRect(index, 0, 1, 1);
    }
    const { data } = ctx.getImageData(0, 0, swatch.width, 1);
    const resolved = { ...theme };
    for (const [index, key] of themeKeys.entries()) {
      const rgb = data.subarray(index * 4, index * 4 + 3);
      resolved[key] =
        `#${Array.from(rgb, (v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
    return resolved;
  } finally {
    probe.remove();
  }
}

// Rio has no access to PTY ECHO. Its first prediction can be visible even at
// a no-echo prompt. Keep actual input inside Rio's reconciliation logic; only
// the program's authoritative grid is ever allowed to paint those glyphs.
class MaskedPredictions extends PredictionEngine {
  override overlay(snapshot: Snapshot): Overlay {
    const overlay = super.overlay(snapshot);
    for (const cell of overlay.cells) {
      if (!cell.erase) cell.codepoint = 0x2022;
    }
    return overlay;
  }
}

class CanvasView extends CanvasRenderer implements RioRenderer {
  private expiry: ReturnType<typeof setTimeout> | undefined;

  userInput(bytes: Uint8Array): void {
    if (!this.predictions) return;
    // Do not let a submission, control report, multi-character edit or
    // bracketed-paste marker anchor a prediction on a different prompt.
    if (bytes.length === 0 || bytes.length > 4 || (bytes[0] ?? 0) < 0x20) {
      this.resetPredictions();
      return;
    }
    this.predictions.onInput(bytes);
    this.schedule();
    // With ECHO off there may never be another frame to retire the overlay.
    clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => this.resetPredictions(),
      Math.max(1500, 3 * (this.predictions.stats.latency.max || 0)),
    );
  }

  resetPredictions(): void {
    clearTimeout(this.expiry);
    this.expiry = undefined;
    if (this.predictions) {
      this.predictions.flush();
      this.schedule();
    }
  }

  override dispose(): void {
    clearTimeout(this.expiry);
    this.predictions?.flush();
    this.predictions = null;
    super.dispose();
  }
}

class DomView extends DOMRenderer implements RioRenderer {
  userInput(): void {}
  resetPredictions(): void {}
}

/** Own painting only: screen still owns mounting, font remeasurement and ordered fitting. */
export function makeRioRenderer(
  term: Terminal,
  preferences: EffectiveRioPreferences,
  root: HTMLElement,
): RioRenderer {
  const { fontFamily, fontSize, lineHeight } = preferences;
  const font = { fontFamily, fontSize, lineHeight };
  const theme = composeTheme(preferences.theme);
  if (preferences.renderer === 'canvas') {
    try {
      const canvas = new CanvasView(term, {
        ...font,
        theme: canvasTheme(root, theme),
        cursorStyle: preferences.cursorStyle,
      });
      if (preferences.predictiveEcho === true) {
        canvas.predictions = new MaskedPredictions(term, {
          latencyThreshold: preferences.latencyThreshold,
          style: preferences.predictionStyle,
        });
      }
      return canvas;
    } catch (error) {
      // Some webviews disable canvas/readback. Keep the SAME terminal and grid.
      console.warn('Rio Canvas unavailable; using the DOM renderer.', error);
    }
  }
  return new DomView(term, { ...font, theme });
}
