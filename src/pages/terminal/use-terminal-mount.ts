import { useEffect, useRef, useState } from 'react';
import { createRioScreen } from '../../rio/screen.ts';
import { loadWasm } from '../../rio/wasm-loader.ts';
import type { TerminalSession } from '../../terminal/contracts.ts';
import {
  mountTerminalView,
  type TerminalViewMount,
  type TerminalViewState,
} from './terminal-mount.ts';

interface MountOptions {
  session: TerminalSession;
  visible: boolean;
  ticket: string | undefined;
  attempt: number;
  inputLabel: string;
}

export function useTerminalMount({
  session,
  visible,
  ticket,
  attempt,
  inputLabel,
}: MountOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TerminalViewState>({ status: 'loading' });
  const active = useRef<TerminalViewMount>();
  const visibleRef = useRef(visible);
  const labelRef = useRef(inputLabel);
  visibleRef.current = visible;
  labelRef.current = inputLabel;

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
      loadEngine: () => loadWasm(attempt > 0),
      createScreen: (limits, input) =>
        createRioScreen(container, {
          maxCols: limits.maxCols,
          maxRows: limits.maxRows,
          scrollback: limits.scrollback,
          onInput: input.input,
          onResize: input.resize,
          label: labelRef.current,
        }),
      onState: setState,
    });
    if (!mount) return;
    active.current = mount;
    return () => {
      mount.dispose();
      if (active.current === mount) active.current = undefined;
    };
  }, [started, attempt, session, ticket]);

  return { containerRef, state };
}
