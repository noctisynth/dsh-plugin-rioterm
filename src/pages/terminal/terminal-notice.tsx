import * as React from 'react';
import type { TerminalTranslate } from './messages.ts';
import type { TerminalViewState } from './terminal-mount.ts';

interface TerminalNoticeProps {
  state: TerminalViewState;
  t: TerminalTranslate;
  onStart: () => void;
  onRetry: () => void;
  onOpenNew: () => void;
}

export function TerminalNotice({
  state: { status, detail },
  t,
  onStart,
  onRetry,
  onOpenNew,
}: TerminalNoticeProps): React.ReactElement | null {
  if (status === 'connected') return null;

  return (
    <div
      style={{
        position: 'absolute',
        insetBlockStart: 4,
        insetInlineEnd: 4,
        maxWidth: 'calc(100% - 8px)',
        maxHeight: 'calc(100% - 8px)',
        boxSizing: 'border-box',
        overflow: 'auto',
        overflowWrap: 'anywhere',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        flexWrap: 'wrap',
        background: 'var(--dsw-alias-bg-base, Canvas)',
        color: 'var(--dsw-alias-label-primary, CanvasText)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
      }}
    >
      <span role="status">{t(status)}</span>
      {detail && (
        <details key={status}>
          <summary style={{ cursor: 'pointer' }}>{t('details')}</summary>
          <small>{detail}</small>
        </details>
      )}
      {status === 'idle' && (
        <button type="button" onClick={onStart}>
          {t('start')}
        </button>
      )}
      {status === 'readonly' && (
        <button type="button" onClick={onRetry}>
          {t('control')}
        </button>
      )}
      {(status === 'resourceFailed' || status === 'disconnected') && (
        <button type="button" onClick={onRetry}>
          {t(status === 'resourceFailed' ? 'retry' : 'reconnect')}
        </button>
      )}
      {(status === 'exited' || status === 'missing' || status === 'failed') && (
        <button type="button" onClick={onOpenNew}>
          {t('new')}
        </button>
      )}
    </div>
  );
}
