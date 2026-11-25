import type { ReactElement } from 'react';
import type { TerminalTranslate } from '../pages/terminal/messages.ts';
import type { RemoteStreamFactory, TerminalRemote } from '../session/remote.ts';
import type { PreferenceConfigForms } from './preferences.ts';

// Structural types for the DSH client services this bundle consumes. Never
// bundle a second DSH client or pass the application context to a page.
type Dispose = () => void;
export interface SidebarTab {
  contentId: string;
  visible: boolean;
  navigation: { params?: { rioLaunch?: string } };
  actions: {
    openTab(
      kind: string,
      options: { replaceTab: boolean; params: { rioLaunch: string } },
    ): void;
  };
}
export interface ClientContext {
  effect(register: () => Dispose, label: string): void;
  remote: { terminal: TerminalRemote; $stream: RemoteStreamFactory };
  theme: {
    getTheme(): {
      revision: number;
      fontFamilies: { terminal: string };
      fontSizes: { terminal: number };
    };
  };
  on(event: 'theme/change', listener: () => void): Dispose;
  configForms: PreferenceConfigForms;
  locale: {
    register(
      namespace: string,
      messages: { en: Record<string, string>; zh: Record<string, string> },
    ): Dispose;
    bind(namespace: string): TerminalTranslate;
  };
  slots: {
    inject(slot: string, install: () => Dispose): Dispose;
    register<Injected extends object, Props extends Injected>(
      entry: {
        name: string;
        key: string;
        locale: string;
        inject(sessionId: string): Injected;
      },
      component: (props: Props) => ReactElement,
    ): Dispose;
  };
  sidebarRightTabs: {
    register(tabType: {
      id: string;
      kind: string;
      multiple: true;
      keepMounted: true;
      title: () => string;
      guide: {
        id: string;
        order: number;
        title: () => string;
        description: () => string;
      }[];
    }): Dispose;
  };
  sidebarRight: {
    openTabs: {
      getSnapshot(): readonly {
        sessionId: string;
        kind: string;
        contentId: string;
      }[];
      subscribe(callback: () => void): Dispose;
    };
    registerCloseHandler(
      kind: string,
      callback: (sessionId: string, tab: { contentId: string }) => void,
    ): Dispose;
  };
}
