import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Observable } from '../../preferences/editor.ts';
import type { EffectiveRioPreferences } from '../../preferences/values.ts';
import { beginAutoFocus } from '../../rio/keyboard-input.ts';
import { createRioScreen } from '../../rio/screen.ts';
import { loadWasm } from '../../rio/wasm-loader.ts';
import type { TerminalSession } from '../../terminal/contracts.ts';
import {
  EMPTY_SEARCH_RESULT,
  type TerminalSearchDirection,
} from '../../terminal/search.ts';
import {
  mountTerminalView,
  type TerminalViewMount,
  type TerminalViewState,
} from './terminal-mount.ts';

interface MountOptions {
  appearance: Observable<EffectiveRioPreferences>;
  session: TerminalSession;
  visible: boolean;
  active: boolean;
  ticket: string | undefined;
  inputLabel: string;
  linkPrompt: string;
}

export function useTerminalMount({
  appearance,
  session,
  visible,
  active,
  ticket,
  inputLabel,
  linkPrompt,
}: MountOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TerminalViewState>({ status: 'loading' });
  const mountRef = useRef<TerminalViewMount>();
  const [searchRevision, setSearchRevision] = useState(0);
  const search = useCallback(
    (query: string, direction: TerminalSearchDirection) =>
      mountRef.current?.search(query, direction) ?? EMPTY_SEARCH_RESULT,
    [],
  );
  const clearSearch = useCallback(() => mountRef.current?.clearSearch(), []);
  const focusTerminal = useCallback(
    () => mountRef.current?.focusTerminal(),
    [],
  );
  const tabRef = useRef({ visible, active });
  const labelRef = useRef({ inputLabel, linkPrompt });
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const preferences = useSyncExternalStore(
    appearance.subscribe,
    appearance.getSnapshot,
  );
  // Apply renderer changes after the viewport's new insets reach the DOM.
  // Neither geometry nor theme updates belong in the attachment dependencies.
  useLayoutEffect(() => {
    mountRef.current?.setPreferences(preferences);
  }, [preferences]);
  labelRef.current = { inputLabel, linkPrompt };

  // Restored tabs wait for the first reveal. Later hides don't detach or reacquire input.
  const [started, setStarted] = useState(visible);
  useLayoutEffect(() => {
    tabRef.current = { visible, active };
    if (visible) setStarted(true);
    mountRef.current?.syncTabState();
  }, [visible, active]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!started || !container) return;
    // Output can arrive many times per frame. Only an active, invalidated search
    // requests a refresh, and streaming output must not keep postponing it.
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const invalidateSearch = () => {
      refresh ??= setTimeout(() => {
        refresh = undefined;
        setSearchRevision((revision) => revision + 1);
      }, 250);
    };
    const mount = mountTerminalView({
      session,
      ticket,
      tabState: () => tabRef.current,
      beginAutoFocus: () =>
        appearanceRef.current.getSnapshot().autoFocus
          ? beginAutoFocus(container)
          : undefined,
      loadEngine: loadWasm,
      createScreen: (limits, input) =>
        createRioScreen(container, {
          preferences: appearanceRef.current.getSnapshot(),
          maxCols: limits.maxCols,
          maxRows: limits.maxRows,
          scrollback: limits.scrollback,
          onInput: input.input,
          onResize: input.resize,
          label: labelRef.current.inputLabel,
          linkPrompt: labelRef.current.linkPrompt,
          onSearchInvalidated: invalidateSearch,
        }),
      onState: setState,
    });
    mountRef.current = mount;
    return () => {
      mount.dispose();
      clearTimeout(refresh);
      if (mountRef.current === mount) mountRef.current = undefined;
    };
  }, [started, session, ticket]);

  return {
    containerRef,
    search,
    clearSearch,
    focusTerminal,
    searchRevision,
    preferences,
    state,
    retry: (focusInput: boolean) => mountRef.current?.retry(focusInput),
  };
}
