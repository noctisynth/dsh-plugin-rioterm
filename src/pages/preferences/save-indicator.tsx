import * as React from 'react';
import { cn } from '../../lib/cn.ts';

export type SaveIndicatorKind =
  | 'busy'
  | 'pending'
  | 'saved'
  | 'attention'
  | 'readonly';

/** Keep a stable, focusable live region when recovery actions disappear. */
export function SaveIndicator({
  kind,
  text,
  statusRef,
  messageId,
}: {
  kind: SaveIndicatorKind;
  text: string;
  statusRef: React.Ref<HTMLParagraphElement>;
  messageId: string | undefined;
}) {
  return (
    <p
      ref={statusRef}
      role="status"
      aria-label={text}
      aria-atomic="true"
      aria-describedby={messageId}
      title={text}
      tabIndex={-1}
      data-rio-save-state={kind}
      className={cn(
        'rio:m-0 rio:inline-flex rio:size-6 rio:shrink-0 rio:items-center rio:justify-center rio:rounded-sm rio:text-muted-foreground rio:focus-visible:outline-2 rio:focus-visible:outline-solid rio:focus-visible:outline-ring rio:focus-visible:outline-offset-2',
        kind === 'attention' && 'rio:text-destructive',
      )}
    >
      <svg
        key={kind}
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          'rio:block rio:size-4',
          kind === 'busy' && 'rio:motion-safe:animate-settings-spin',
          kind === 'saved' && 'rio:motion-safe:animate-settings-saved',
        )}
      >
        {kind === 'busy' ? (
          <path d="M20 12a8 8 0 1 1-8-8" />
        ) : kind === 'pending' ? (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 7v5l3 2" />
          </>
        ) : kind === 'saved' ? (
          <path d="m5 12 4 4L19 6" />
        ) : kind === 'readonly' ? (
          <>
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 7v6m0 3h.01" />
          </>
        )}
      </svg>
      <span className="rio:sr-only">{text}</span>
    </p>
  );
}
