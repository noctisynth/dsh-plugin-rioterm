import type { Terminal } from 'rioterm';
import {
  colorFields,
  type EffectiveRioPreferences,
} from '../preferences/values.ts';
import type { RioRenderer } from './renderer.ts';
import type { RioTerminal } from './terminal.ts';

/** This boundary mounts a measured Rio view; it never fits or replaces the parser. */
interface ViewportPorts {
  mount(term: Terminal, preferences: EffectiveRioPreferences): RioRenderer;
  box(): { width: number; height: number };
  metricsChanged(): void;
  nextFrame(update: () => void): () => void;
}

function sameAppearance(
  a: EffectiveRioPreferences,
  b: EffectiveRioPreferences,
): boolean {
  if (
    a.renderer !== b.renderer ||
    a.fontFamily !== b.fontFamily ||
    a.fontSize !== b.fontSize ||
    a.lineHeight !== b.lineHeight
  )
    return false;
  if (
    a.renderer === 'canvas' &&
    (a.themeRevision !== b.themeRevision ||
      a.cursorStyle !== b.cursorStyle ||
      a.predictiveEcho !== b.predictiveEcho ||
      (a.predictiveEcho &&
        (a.predictionStyle !== b.predictionStyle ||
          a.latencyThreshold !== b.latencyThreshold)))
  )
    return false;
  if (a.theme === b.theme) return true;
  const palette = a.theme.palette ?? [];
  const next = b.theme.palette ?? [];
  return (
    colorFields.every((key) => a.theme[key] === b.theme[key]) &&
    palette.length === next.length &&
    palette.every((value, i) => value === next[i])
  );
}

function familyName(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
}

/** Keep the screen root, focused textarea, and WASM state while replacing a renderer. */
export class RioViewport {
  renderer: RioRenderer;
  private preferences: EffectiveRioPreferences;
  private rendered: EffectiveRioPreferences;
  private readonly core: RioTerminal;
  private readonly ports: ViewportPorts;
  private cancelFrame: (() => void) | undefined;
  private stopped = false;
  private fitRequested = false;

  constructor(
    core: RioTerminal,
    preferences: EffectiveRioPreferences,
    ports: ViewportPorts,
  ) {
    this.core = core;
    this.preferences = preferences;
    this.rendered = preferences;
    this.ports = ports;
    this.renderer = ports.mount(core.term, preferences);
  }

  setPreferences(next: EffectiveRioPreferences): void {
    if (this.stopped) return;
    const previous = this.preferences;
    this.core.setPreferences(next);
    this.preferences = next;
    if (!next.fit) this.fitRequested = false;
    else if (!previous.fit) this.fitRequested = true;
    // The Host publishes its theme snapshot before the layout presenter has
    // necessarily applied its CSS tokens. Canvas needs resolved colors next frame;
    // DOM color variables already track that paint without a renderer rebuild.
    if (
      next.renderer === 'canvas' &&
      previous.themeRevision !== next.themeRevision
    ) {
      this.cancelFrame ??= this.ports.nextFrame(() => {
        this.cancelFrame = undefined;
        if (!this.stopped) this.replace(true);
      });
      return;
    }
    if (this.cancelFrame) {
      if (next.renderer === 'canvas') return; // The pending frame reads the newest preferences.
      this.cancelFrame();
      this.cancelFrame = undefined;
    }
    if (!sameAppearance(this.rendered, next)) this.replace(true);
    else if (this.fitRequested) this.fit();
  }

  fontsLoaded(faces: readonly Pick<FontFace, 'family'>[]): void {
    if (this.stopped || this.cancelFrame) return;
    const families = this.preferences.fontFamily.split(',').map(familyName);
    if (
      !faces.length ||
      faces.some((face) => families.includes(familyName(face.family)))
    )
      this.replace(true);
  }

  pixelRatioChanged(): void {
    if (
      !this.stopped &&
      !this.cancelFrame &&
      this.preferences.renderer === 'canvas'
    )
      this.replace(true);
  }

  /** The frame stream supplied a fresh snapshot/parser. It still owns cols/rows. */
  rebind(): void {
    if (!this.stopped) this.replace(false);
  }

  private replace(proposeSize: boolean): void {
    const previous = this.renderer;
    const next = this.ports.mount(this.core.term, this.preferences);
    this.rendered = this.preferences;
    this.renderer = next;
    previous.dispose();
    const changed =
      next.cellWidth !== previous.cellWidth ||
      next.cellHeight !== previous.cellHeight;
    if (changed) this.ports.metricsChanged();
    if (proposeSize && (this.fitRequested || changed)) this.fit();
  }

  fit(): void {
    this.fitRequested = false;
    if (this.stopped || !this.core.canFit) return;
    const { width, height } = this.ports.box();
    this.core.fit(
      width,
      height,
      this.renderer.cellWidth,
      this.renderer.cellHeight,
    );
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.renderer.dispose();
  }
}
