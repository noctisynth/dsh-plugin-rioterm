import { defaultEffectivePreferences } from '../../src/preferences/values.ts';

// Only the page's search ownership/layout test substitutes the view hook.
// Actual snapshot, reconnect and disposal behavior is covered by terminal-mount.test.mjs.
export const terminalView = {
  containerRef: { current: null },
  preferences: defaultEffectivePreferences,
  state: { status: 'connected', hasScreenContent: true },
  searchRevision: 0,
  search: () => ({ index: 0, count: 0, truncated: false }),
  clearSearch() {},
  focusTerminal() {},
  retry() {},
};

export function useTerminalMount() {
  return terminalView;
}
