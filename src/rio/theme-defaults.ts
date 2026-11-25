import { defaultTheme } from 'rioterm';
import type {
  AnsiPreset,
  ansiNames,
  BoldBright,
} from '../preferences/schema-values.ts';

type AnsiName = (typeof ansiNames)[number];

export function usesBoldBright({
  boldBright,
  ansiPreset,
}: {
  boldBright: BoldBright;
  ansiPreset: AnsiPreset;
}): boolean {
  return (
    boldBright === 'always' || (boldBright === 'auto' && ansiPreset === 'dsh')
  );
}

// Static xterm DEFAULT_ANSI_COLORS[0..15] from the installed Desktop app.asar:
// @deepseek-ai/dsh-client-ui-sidebar-terminal@0.2.2-rc.5/lib/client.terminal.js.
// Its terminal-theme.ts supplies no ANSI defaults. Do not sample another terminal's
// OSC overrides or follow the Host theme for these fixed sRGB slots.
const desktopAnsi = {
  black: '#2e3436',
  red: '#cc0000',
  green: '#4e9a06',
  yellow: '#c4a000',
  blue: '#3465a4',
  magenta: '#75507b',
  cyan: '#06989a',
  white: '#d3d7cf',
  brightBlack: '#555753',
  brightRed: '#ef2929',
  brightGreen: '#8ae234',
  brightYellow: '#fce94f',
  brightBlue: '#729fcf',
  brightMagenta: '#ad7fa8',
  brightCyan: '#34e2e2',
  brightWhite: '#eeeeec',
} satisfies Record<AnsiName, string>;

/** Fallback for rendering and previews only; never materialize these colors in preferences. */
export function defaultAnsiColor(
  name: AnsiName,
  preset: AnsiPreset = 'rio',
): string {
  return preset === 'dsh' ? desktopAnsi[name] : defaultTheme[name];
}
