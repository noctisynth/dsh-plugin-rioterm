import * as React from 'react';
import type { Observable } from '../../preferences/editor.ts';
import type { EffectiveRioPreferences } from '../../preferences/values.ts';
import type { TerminalSession } from '../../terminal/contracts.ts';
import type { TerminalTranslate } from './messages.ts';
import { TerminalNotice } from './terminal-notice.tsx';
import { useTerminalMount } from './use-terminal-mount.ts';

interface TerminalPageProps {
  appearance: Observable<EffectiveRioPreferences>;
  session: TerminalSession;
  visible: boolean;
  launchTicket: string | undefined;
  issueLaunch: () => string;
  openNew: () => void;
  t: TerminalTranslate;
}

export function TerminalPage({
  appearance,
  session,
  visible,
  launchTicket,
  issueLaunch,
  openNew,
  t,
}: TerminalPageProps): React.ReactElement {
  const [requested, setRequested] = React.useState<string>();
  const { containerRef, state, retry } = useTerminalMount({
    appearance,
    session,
    visible,
    ticket: requested ?? launchTicket,
    inputLabel: t('input'),
    linkPrompt: t('openLink'),
  });

  return (
    <section
      aria-label={t('title')}
      data-rio-ui="terminal"
      data-rio-terminal
      className="rio:relative rio:isolate rio:h-full rio:w-full rio:min-h-0 rio:min-w-0 rio:overflow-hidden rio:bg-background rio:text-foreground"
    >
      {/* ResizeObserver measures only this stable box, never the notice. */}
      <div
        ref={containerRef}
        aria-busy={
          state.status === 'loading' ||
          state.status === 'opening' ||
          state.status === 'reconnecting'
        }
        data-rio-viewport
        className="rio:absolute rio:inset-0 rio:z-0 rio:overflow-hidden"
      />
      {/* A persistent, non-focusable live region announces readiness without covering the grid. */}
      <span role="status" className="rio:sr-only">
        {visible && state.status === 'connected' ? t('ready') : null}
      </span>
      <TerminalNotice
        state={state}
        t={t}
        onStart={() => setRequested(issueLaunch())}
        onRetry={retry}
        onOpenNew={openNew}
      />
    </section>
  );
}
