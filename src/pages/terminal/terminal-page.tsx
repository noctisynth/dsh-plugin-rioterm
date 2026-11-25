import * as React from 'react';
import type { TerminalSession } from '../../terminal/contracts.ts';
import type { TerminalTranslate } from './messages.ts';
import { TerminalNotice } from './terminal-notice.tsx';
import { useTerminalMount } from './use-terminal-mount.ts';

interface TerminalPageProps {
  session: TerminalSession;
  visible: boolean;
  launchTicket: string | undefined;
  issueLaunch: () => string;
  openNew: () => void;
  t: TerminalTranslate;
}

export function TerminalPage({
  session,
  visible,
  launchTicket,
  issueLaunch,
  openNew,
  t,
}: TerminalPageProps): React.ReactElement {
  const [requested, setRequested] = React.useState<string>();
  const [attempt, setAttempt] = React.useState(0);
  const { containerRef, state } = useTerminalMount({
    session,
    visible,
    ticket: requested ?? launchTicket,
    attempt,
    inputLabel: t('input'),
  });

  return (
    <section
      aria-label={t('title')}
      aria-busy={state.status === 'loading' || state.status === 'opening'}
      data-rio-terminal
      style={{
        position: 'relative',
        isolation: 'isolate',
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* Keep the observed screen full-size even when the status notice wraps. */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
        }}
      />
      <TerminalNotice
        state={state}
        t={t}
        onStart={() => setRequested(issueLaunch())}
        onRetry={() => setAttempt((n) => n + 1)}
        onOpenNew={openNew}
      />
    </section>
  );
}
