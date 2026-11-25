import { createElement } from 'react';
import type { TerminalTranslate } from '../pages/terminal/messages.ts';
import { TerminalGuide } from '../pages/terminal/terminal-guide.tsx';
import { TerminalPage } from '../pages/terminal/terminal-page.tsx';
import { TerminalTabTitle } from '../pages/terminal/terminal-tab-title.tsx';
import type { Observable } from '../preferences/editor.ts';
import type { EffectiveRioPreferences } from '../preferences/values.ts';
import type { TerminalSession } from '../terminal/contracts.ts';
import { RIO_TAB_KIND } from '../terminal/identity.ts';
import type { SidebarTab } from './context.ts';

// Only these adapters know how DSH identifies a sidebar occurrence and navigates it.
interface TabSlotProps {
  useTabInfo(): { tab: SidebarTab };
  issueLaunch(): string;
}
interface GuideSlotProps extends TabSlotProps {
  title: string;
  description?: string;
}
interface PageSlotProps extends TabSlotProps {
  isActiveTab(id: string): boolean;
  appearance: Observable<EffectiveRioPreferences>;
  t: TerminalTranslate;
  session(contentId: string): TerminalSession;
}

function openNew(tab: SidebarTab, issueLaunch: () => string): void {
  tab.actions.openTab(RIO_TAB_KIND, {
    replaceTab: true,
    params: { rioLaunch: issueLaunch() },
  });
}

export function GuideSlot({
  useTabInfo,
  issueLaunch,
  title,
  description,
}: GuideSlotProps) {
  const { tab } = useTabInfo();
  return createElement(TerminalGuide, {
    title,
    description,
    onOpen: () => openNew(tab, issueLaunch),
  });
}

export function TitleSlot({ useTabInfo }: Pick<TabSlotProps, 'useTabInfo'>) {
  return createElement(TerminalTabTitle, { title: useTabInfo().tab.title });
}

export function PageSlot({
  useTabInfo,
  isActiveTab,
  issueLaunch,
  t,
  session,
  appearance,
}: PageSlotProps) {
  const { tab } = useTabInfo();
  return createElement(TerminalPage, {
    key: tab.contentId,
    session: session(tab.contentId),
    appearance,
    visible: tab.visible,
    // Split and floating panes can be visible together; only the selected one gets focus.
    active: tab.visible && isActiveTab(tab.id),
    launchTicket: tab.navigation.params?.rioLaunch,
    issueLaunch,
    openNew: () => openNew(tab, issueLaunch),
    t,
  });
}
