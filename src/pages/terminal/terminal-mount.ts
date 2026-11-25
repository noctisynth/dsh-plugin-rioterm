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
  isVisible: () => boolean;
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
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function mountTerminalView(options: ViewOptions): TerminalViewMount {
  let status: TerminalViewState['status'] | undefined;
  const start = (reload: boolean) =>
    startAttempt(options, reload, (state) => {
      status = state.status;
      options.onState(state);
    });
  let attempt = start(false);
  return {
    retry(focusInput = false) {
      // An old button event must not reopen an exited shell or take control from a hidden tab.
      if (!options.isVisible()) return;
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
    setPreferences: (preferences) => attempt?.setPreferences(preferences),
    setVisible: (visible) => attempt?.setVisible(visible),
    dispose() {
      attempt?.dispose();
      attempt = undefined;
      status = undefined;
    },
  };
}

/** One preflight and screen. Dispose fences *all* callbacks before another attempt can start. */
function startAttempt(
  { session, ticket, isVisible, loadEngine, createScreen }: ViewOptions,
  reload: boolean,
  onState: ViewOptions['onState'],
):
  | (Omit<TerminalViewMount, 'retry'> & {
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
      screen.setVisible(isVisible());
      attachment = session.mount(ticket, limits, {
        visible: isVisible(),
        screen,
        status(status, detail) {
          if (!mounted) return;
          if (status === 'reconnecting') screen?.cancelAutoFocus();
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
