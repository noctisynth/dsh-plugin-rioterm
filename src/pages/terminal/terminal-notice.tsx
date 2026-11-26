import * as React from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/cn.ts';
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

function TerminalGlyph({ compact }: { compact: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'rio:flex rio:shrink-0 rio:items-center rio:justify-center rio:text-muted-foreground',
        compact
          ? 'rio:size-5'
          : 'rio:mb-5 rio:size-12 rio:rounded-lg rio:bg-muted',
      )}
    >
      <svg
        aria-hidden="true"
        width={compact ? 18 : 24}
        height={compact ? 18 : 24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="m7 9 3 3-3 3m6 0h4" />
      </svg>
    </span>
  );
}

export function TerminalNotice(
  props: TerminalNoticeProps,
): React.ReactElement | null {
  const {
    state: { status, detail, hasScreenContent = false },
    t,
  } = props;
  const titleId = React.useId();
  const descriptionId = React.useId();
  if (status === 'connected') return null;

  const failed =
    status === 'failed' ||
    status === 'resourceFailed' ||
    status === 'wasmFailed';
  const message =
    status === 'readonly' && detail ? 'readonlyDisconnected' : status;
  const title =
    hasScreenContent &&
    (message === 'readonly' ||
      message === 'readonlyDisconnected' ||
      message === 'reconnecting' ||
      message === 'disconnected')
      ? t(`${message}Compact`)
      : t(message);
  const action = noticeAction(props);
  const opensNew =
    status === 'missing' || status === 'exited' || status === 'failed';
  const diagnostic =
    status === 'missing'
      ? [t('missingTechnical'), detail].filter(Boolean).join('\n\n')
      : detail;
  return (
    <div
      data-rio-notice={hasScreenContent ? 'compact' : 'empty'}
      className={cn(
        'rio:absolute rio:z-10 rio:box-border rio:overflow-auto rio:overscroll-contain',
        hasScreenContent
          ? 'rio:inset-x-2 rio:bottom-2 rio:max-h-[min(calc(100%_-_1rem),max(6rem,50%))]'
          : 'rio:inset-0 rio:flex rio:flex-col rio:bg-background rio:px-6 rio:pt-8 rio:pb-16',
      )}
    >
      <Alert
        role="group"
        aria-labelledby={titleId}
        aria-describedby={hasScreenContent ? undefined : descriptionId}
        className={cn(
          hasScreenContent
            ? 'rio:w-full'
            : 'rio:my-auto rio:flex rio:w-full rio:max-w-sm rio:shrink-0 rio:flex-col rio:items-center rio:self-center rio:border-0 rio:bg-transparent rio:p-0 rio:text-center',
        )}
      >
        <div
          className={cn(
            'rio:flex rio:items-center',
            hasScreenContent
              ? 'rio:flex-wrap rio:gap-x-3 rio:gap-y-2'
              : 'rio:w-full rio:flex-col',
          )}
        >
          <TerminalGlyph compact={hasScreenContent} />
          {/* Announce only the status, not the controls or technical details. */}
          <AlertTitle
            id={titleId}
            role={failed ? 'alert' : 'status'}
            className={
              hasScreenContent
                ? 'rio:flex-1 rio:basis-40 rio:text-xs rio:leading-relaxed'
                : 'rio:text-base rio:leading-normal'
            }
          >
            {title}
          </AlertTitle>
          {!hasScreenContent && (
            <AlertDescription
              id={descriptionId}
              className="rio:mt-2 rio:max-w-full rio:text-sm rio:leading-relaxed"
            >
              {t(`${message}Description`)}
            </AlertDescription>
          )}
          {action && (
            <Button
              variant={hasScreenContent ? 'outline' : 'default'}
              size={hasScreenContent ? 'sm' : 'default'}
              className={cn('rio:gap-2', !hasScreenContent && 'rio:mt-5')}
              onClick={action.onClick}
            >
              {opensNew && (
                <svg
                  aria-hidden="true"
                  focusable="false"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  className="rio:shrink-0"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
              )}
              {action.label}
            </Button>
          )}
        </div>
        {diagnostic && (
          <details
            key={status}
            data-rio-notice-details
            className={cn(
              'rio:w-full rio:min-w-0',
              hasScreenContent ? 'rio:mt-1' : 'rio:mt-4',
            )}
          >
            <summary
              className={cn(
                'rio:flex rio:min-h-7 rio:w-fit rio:max-w-full rio:cursor-pointer rio:list-none rio:items-center rio:gap-1.5 rio:rounded-sm rio:px-1 rio:py-1 rio:text-xs rio:text-muted-foreground rio:hover:text-foreground rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2 rio:[&::-webkit-details-marker]:hidden',
                !hasScreenContent && 'rio:mx-auto',
              )}
            >
              {t('details')}
              <svg
                aria-hidden="true"
                focusable="false"
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="rio:shrink-0"
              >
                <path d="m6 4 4 4-4 4" />
              </svg>
            </summary>
            <AlertDescription className="rio:mt-2 rio:max-h-40 rio:overflow-auto rio:overscroll-contain rio:rounded-md rio:bg-muted rio:p-3 rio:text-start rio:font-mono rio:text-xs rio:leading-relaxed rio:whitespace-pre-wrap rio:wrap-anywhere">
              {diagnostic}
            </AlertDescription>
          </details>
        )}
      </Alert>
    </div>
  );
}
