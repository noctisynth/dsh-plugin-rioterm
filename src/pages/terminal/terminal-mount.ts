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
  loadEngine: () => Promise<void>;
  createScreen: (
    limits: TerminalLimits,
    input: Pick<TerminalAttachment, 'input' | 'resize'>,
  ) => RioScreen;
  onState: (state: TerminalViewState) => void;
}

export interface TerminalViewMount {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Own one attempt, from engine preflight through detaching its screen. */
export function mountTerminalView({
  session,
  ticket,
  isVisible,
  loadEngine,
  createScreen,
  onState,
}: ViewOptions): TerminalViewMount | undefined {
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
  void loadEngine()
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
          if (mounted) onState(detail ? { status, detail } : { status });
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
