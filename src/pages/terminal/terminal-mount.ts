import type { EffectiveRioPreferences } from '../../preferences/values.ts';
import type { RioScreen } from '../../rio/screen.ts';
import { ResourceError } from '../../rio/wasm-loader.ts';
import type {
  TerminalAttachment,
  TerminalLimits,
  TerminalSession,
  TerminalStatus,
} from '../../terminal/contracts.ts';
import { errorMessage } from '../../terminal/error-message.ts';

export interface TerminalViewState {
  status: TerminalStatus | 'idle' | 'loading' | 'resourceFailed' | 'wasmFailed';
  detail?: string;
}

interface ViewOptions {
  session: TerminalSession;
  ticket: string | undefined;
  tabState: () => { visible: boolean; active: boolean };
  beginAutoFocus: () => AbortController | undefined;
  loadEngine: (reload: boolean) => Promise<void>;
  createScreen: (
    limits: TerminalLimits,
    input: Pick<TerminalAttachment, 'input' | 'resize'>,
  ) => RioScreen;
  onState: (state: TerminalViewState) => void;
}

export interface TerminalViewMount {
  retry(focusInput?: boolean): void;
  setPreferences(preferences: EffectiveRioPreferences): void;
  syncTabState(): void;
  dispose(): void;
}

export function mountTerminalView(options: ViewOptions): TerminalViewMount {
  let status: TerminalViewState['status'] | undefined;
  let pending: AbortController | undefined;
  let foreground = false;
  let { visible } = options.tabState();
  function cancelFocus() {
    pending?.abort();
    pending = undefined;
  }
  function offerFocus() {
    const request = pending;
    if (!request) return;
    // The sidebar may focus its pane after the activation commit. Finish after
    // that handoff, not in a later animation frame or on the next PTY output.
    queueMicrotask(() => {
      if (pending !== request) return;
      const { active, visible } = options.tabState();
      const allowed = active && visible && !request.signal.aborted;
      cancelFocus();
      if (allowed) attempt?.focusIfInteractive();
    });
  }
  const start = (reload: boolean) =>
    startAttempt(options, reload, (state) => {
      status = state.status;
      if (status === 'connected') offerFocus();
      else if (status !== 'opening' && status !== 'loading') cancelFocus();
      options.onState(state);
    });
  let attempt = start(false);
  function syncTabState() {
    const next = options.tabState();
    if (visible !== next.visible) attempt?.setVisible(next.visible);
    visible = next.visible;
    const selected = visible && next.active;
    if (foreground === selected) return;
    foreground = selected;
    cancelFocus();
    if (
      selected &&
      (status === 'loading' || status === 'opening' || status === 'connected')
    ) {
      pending = options.beginAutoFocus();
      if (status === 'connected') offerFocus();
    }
  }
  syncTabState();
  return {
    retry(focusInput = false) {
      // An old button event must not reopen an exited shell or take control from a hidden tab.
      if (!options.tabState().visible) return;
      if (
        status !== 'readonly' &&
        status !== 'disconnected' &&
        status !== 'resourceFailed'
      )
        return;
      if (attempt?.reconnect(focusInput)) return;
      // Only preflight/no-identity failures start over, with the ORIGINAL ticket (if any).
      attempt?.dispose();
      attempt = start(true);
    },
    setPreferences(preferences) {
      if (!preferences.autoFocus) cancelFocus();
      attempt?.setPreferences(preferences);
    },
    syncTabState,
    dispose() {
      cancelFocus();
      attempt?.dispose();
      attempt = undefined;
      status = undefined;
    },
  };
}

/** One preflight and screen. Dispose fences *all* callbacks before another attempt can start. */
function startAttempt(
  { session, ticket, tabState, loadEngine, createScreen }: ViewOptions,
  reload: boolean,
  onState: ViewOptions['onState'],
):
  | (Pick<TerminalViewMount, 'setPreferences' | 'dispose'> & {
      setVisible(visible: boolean): void;
      focusIfInteractive(): void;
      reconnect(focusInput: boolean): boolean;
    })
  | undefined {
  try {
    if (session.needsLaunch(ticket)) {
      onState({ status: 'idle' });
      return;
    }
  } catch (error) {
    onState({ status: 'disconnected', detail: errorMessage(error) });
    return;
  }

  const controller = new AbortController();
  let mounted = true;
  let screen: RioScreen | undefined;
  let attachment: TerminalAttachment | undefined;
  onState({ status: 'loading' });
  void loadEngine(reload)
    .then(async () => {
      if (!mounted) return;
      let limits: TerminalLimits;
      try {
        limits = await session.environment(controller.signal);
      } catch (error) {
        if (mounted)
          onState({ status: 'disconnected', detail: errorMessage(error) });
        return;
      }
      if (!mounted) return;
      // Input and resize from this screen must never reach a successor's attachment.
      screen = createScreen(limits, {
        input: (data, typed) => attachment?.input(data, typed),
        resize: (cols, rows) => attachment?.resize(cols, rows),
      });
      const { visible } = tabState();
      screen.setVisible(visible);
      attachment = session.mount(ticket, limits, {
        visible,
        screen,
        status(status, detail) {
          if (!mounted) return;
          onState(detail ? { status, detail } : { status });
        },
      });
    })
    .catch((error: unknown) => {
      if (mounted)
        onState({
          status:
            error instanceof ResourceError ? 'resourceFailed' : 'wasmFailed',
          detail: errorMessage(error),
        });
    });

  return {
    focusIfInteractive: () => screen?.focusIfInteractive(),
    reconnect(focusInput) {
      if (!attachment?.reconnect()) return false;
      // Transfer focus during the click, never when a late snapshot arrives.
      if (focusInput) screen?.focus();
      return true;
    },
    setPreferences(preferences) {
      screen?.setPreferences(preferences);
    },
    setVisible(visible) {
      screen?.setVisible(visible);
      attachment?.setVisible(visible);
    },
    dispose() {
      if (!mounted) return;
      mounted = false;
      attachment?.detach();
      screen?.setVisible(false);
      screen?.dispose();
      screen = undefined;
      attachment = undefined;
      controller.abort();
    },
  };
}
