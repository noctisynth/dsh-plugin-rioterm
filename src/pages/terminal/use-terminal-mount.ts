import { useEffect, useRef, useState } from 'react';
import type { Observable } from '../../preferences/editor.ts';
import type { EffectiveRioPreferences } from '../../preferences/values.ts';
import { createRioScreen } from '../../rio/screen.ts';
import { loadWasm } from '../../rio/wasm-loader.ts';
import type { TerminalSession } from '../../terminal/contracts.ts';
import {
  mountTerminalView,
  type TerminalViewMount,
  type TerminalViewState,
} from './terminal-mount.ts';

interface MountOptions {
  appearance: Observable<EffectiveRioPreferences>;
  session: TerminalSession;
  visible: boolean;
  ticket: string | undefined;
  inputLabel: string;
  linkPrompt: string;
}

export function useTerminalMount({
  appearance,
  session,
  visible,
  ticket,
  inputLabel,
  linkPrompt,
}: MountOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TerminalViewState>({ status: 'loading' });
  const active = useRef<TerminalViewMount>();
  const visibleRef = useRef(visible);
  const labelRef = useRef({ inputLabel, linkPrompt });
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  // Subscribe separately from mount: a preference change isn't a new attachment.
  useEffect(() => {
    const sync = () => active.current?.setPreferences(appearance.getSnapshot());
    const off = appearance.subscribe(sync);
    sync();
    return off;
  }, [appearance]);
  visibleRef.current = visible;
  labelRef.current = { inputLabel, linkPrompt };

  // Restored tabs wait for the first reveal. Later hides don't detach or reacquire input.
  const [started, setStarted] = useState(visible);
  useEffect(() => {
    if (visible) setStarted(true);
    active.current?.setVisible(visible);
  }, [visible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!started || !container) return;
    const mount = mountTerminalView({
      session,
      ticket,
      isVisible: () => visibleRef.current,
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
        }),
      onState: setState,
    });
    active.current = mount;
    return () => {
      mount.dispose();
      if (active.current === mount) active.current = undefined;
    };
  }, [started, session, ticket]);

  return {
    containerRef,
    state,
    retry: (focusInput: boolean) => active.current?.retry(focusInput),
  };
}
