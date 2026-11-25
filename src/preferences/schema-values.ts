// The persisted layer contains only choices made in Rio, never a copy of DSH's fonts.
export const ansiNames = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;
export const colorFields = [
  'foreground',
  'background',
  'cursor',
  'selectionForeground',
  'selectionBackground',
] as const;
export const fontSizeRange = [8, 48] as const;
export const lineHeightRange = [1, 3] as const;
export const scrollbackRange = [0, 100000] as const;
export const latencyRange = [0, 2000] as const;
export interface RioPreferenceValues
  extends Record<(typeof colorFields)[number], string> {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  altIsMeta: boolean;
  autoFocus: boolean;
  fit: boolean;
  detectUrls: boolean;
  palette: string[];
  renderer: 'dom' | 'canvas';
  cursorStyle: 'block' | 'bar' | 'underline';
  predictiveEcho: boolean;
  latencyThreshold: number;
  predictionStyle: 'underline' | 'dim';
}
export type RioOverrides = Partial<RioPreferenceValues>;
export const preferenceDefaults: RioPreferenceValues = {
  fontFamily: '',
  fontSize: 0,
  lineHeight: 1.3,
  scrollback: -1,
  altIsMeta: true,
  autoFocus: false,
  fit: true,
  detectUrls: true,
  foreground: '',
  background: '',
  cursor: '',
  selectionForeground: '',
  selectionBackground: '',
  palette: [],
  renderer: 'dom',
  cursorStyle: 'block',
  predictiveEcho: false,
  latencyThreshold: 30,
  predictionStyle: 'underline',
};
