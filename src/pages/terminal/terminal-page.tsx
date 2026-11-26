import * as React from 'react';
import type { Observable } from '../../preferences/editor.ts';
import type { EffectiveRioPreferences } from '../../preferences/values.ts';
import type { TerminalSession } from '../../terminal/contracts.ts';
import type { TerminalTranslate } from './messages.ts';
import { TerminalNotice } from './terminal-notice.tsx';
import { TerminalSearch } from './terminal-search.tsx';
import { useTerminalMount } from './use-terminal-mount.ts';

interface TerminalPageProps {
  appearance: Observable<EffectiveRioPreferences>;
  session: TerminalSession;
  visible: boolean;
  active: boolean;
  launchTicket: string | undefined;
  issueLaunch: () => string;
  openNew: () => void;
  t: TerminalTranslate;
}

export function TerminalPage({
  appearance,
  session,
  visible,
  active,
  launchTicket,
  issueLaunch,
  openNew,
  t,
}: TerminalPageProps): React.ReactElement {
  const [requested, setRequested] = React.useState<string>();
  const mount = useTerminalMount({
    appearance,
    session,
    visible,
    active,
    ticket: requested ?? launchTicket,
    inputLabel: t('input'),
    linkPrompt: t('openLink'),
  });
  const { containerRef, preferences, state, retry } = mount;

  return (
    <section
      aria-label={t('title')}
      tabIndex={-1}
      data-rio-ui="terminal"
      data-rio-terminal
      className="rio:relative rio:isolate rio:h-full rio:w-full rio:min-h-0 rio:min-w-0 rio:overflow-hidden rio:bg-background rio:text-foreground"
    >
      {/* A colored border leaves the screen's 100% child exactly the usable content box.
          ResizeObserver sees this content box; neither the gutter nor the notice adds cells. */}
      <div
        ref={containerRef}
        aria-busy={
          state.status === 'loading' ||
          state.status === 'opening' ||
          state.status === 'reconnecting'
        }
        data-rio-viewport
        className="rio:absolute rio:inset-0 rio:z-0 rio:box-border rio:overflow-hidden rio:border-solid"
        style={{
          borderTopWidth: preferences.paddingTop,
          borderRightWidth: preferences.paddingRight,
          borderBottomWidth: preferences.paddingBottom,
          borderLeftWidth: preferences.paddingLeft,
          borderColor: preferences.theme.background || 'transparent',
        }}
      />
      {/* A persistent, non-focusable live region announces readiness without covering the grid. */}
      <span role="status" className="rio:sr-only">
        {visible && state.status === 'connected' ? t('ready') : null}
      </span>
      {visible && active && state.hasScreenContent && (
        <TerminalSearch
          search={mount.search}
          clearSearch={mount.clearSearch}
          focusTerminal={mount.focusTerminal}
          searchRevision={mount.searchRevision}
          alwaysVisible={preferences.searchIconAlwaysVisible}
          status={state.status}
          t={t}
        />
      )}
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
