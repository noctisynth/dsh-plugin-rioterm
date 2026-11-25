import { createElement } from 'react';
import type { TerminalTranslate } from '../pages/terminal/messages.ts';
import { TerminalGuide } from '../pages/terminal/terminal-guide.tsx';
import { TerminalPage } from '../pages/terminal/terminal-page.tsx';
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

export function PageSlot({
  useTabInfo,
  issueLaunch,
  t,
  session,
}: PageSlotProps) {
  const { tab } = useTabInfo();
  return createElement(TerminalPage, {
    key: tab.contentId,
    session: session(tab.contentId),
    visible: tab.visible,
    launchTicket: tab.navigation.params?.rioLaunch,
    issueLaunch,
    openNew: () => openNew(tab, issueLaunch),
    t,
  });
}
