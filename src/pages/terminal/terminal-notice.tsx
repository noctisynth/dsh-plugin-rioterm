import * as React from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import type { TerminalTranslate } from './messages.ts';
import type { TerminalViewState } from './terminal-mount.ts';

interface TerminalNoticeProps {
  state: TerminalViewState;
  t: TerminalTranslate;
  onStart: () => void;
  onRetry: (focusInput: boolean) => void;
  onOpenNew: () => void;
}

function noticeAction({
  state: { status, detail },
  t,
  onStart,
  onRetry,
  onOpenNew,
}: TerminalNoticeProps) {
  const reconnect = ({
    currentTarget: button,
  }: React.MouseEvent<HTMLButtonElement>) => {
    const doc = button.ownerDocument;
    onRetry(doc.activeElement === button && !doc.hidden && doc.hasFocus());
  };
  switch (status) {
    case 'idle':
      return { label: t('start'), onClick: onStart };
    case 'readonly':
      return {
        label: t(detail ? 'reconnectControl' : 'control'),
        onClick: reconnect,
      };
    case 'resourceFailed':
      return { label: t('retry'), onClick: () => onRetry(false) };
    case 'disconnected':
      return { label: t('reconnect'), onClick: reconnect };
    case 'exited':
    case 'missing':
    case 'failed':
      return { label: t('new'), onClick: onOpenNew };
    default:
      return undefined;
  }
}

export function TerminalNotice(
  props: TerminalNoticeProps,
): React.ReactElement | null {
  const {
    state: { status, detail },
    t,
  } = props;
  if (status === 'connected') return null;

  const failed =
    status === 'failed' ||
    status === 'resourceFailed' ||
    status === 'wasmFailed';
  const action = noticeAction(props);
  return (
    <Alert
      role="group"
      variant={failed ? 'destructive' : 'default'}
      className="rio:absolute rio:top-2 rio:end-2 rio:z-10 rio:max-h-[min(calc(100%_-_1rem),max(6rem,50%))] rio:max-w-[min(24rem,calc(100%_-_1rem))] rio:overflow-auto rio:overscroll-contain"
    >
      <div className="rio:flex rio:flex-wrap rio:items-center rio:gap-x-3 rio:gap-y-1.5">
        {/* Announce the status, not the controls or the diagnostic disclosure. */}
        <AlertTitle role={failed ? 'alert' : 'status'}>
          {t(status === 'readonly' && detail ? 'readonlyDisconnected' : status)}
        </AlertTitle>
        {action && (
          <Button
            variant={status === 'idle' ? 'default' : 'outline'}
            size="sm"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </div>
      {detail && (
        <details key={status} className="rio:mt-1.5">
          <summary className="rio:box-border rio:min-h-7 rio:w-fit rio:max-w-full rio:cursor-pointer rio:rounded-sm rio:py-1.5 rio:text-xs rio:text-muted-foreground rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2">
            {t('details')}
          </summary>
          <AlertDescription className="rio:mt-1 rio:whitespace-pre-wrap">
            {detail}
          </AlertDescription>
        </details>
      )}
    </Alert>
  );
}
