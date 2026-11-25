import { RioIcon } from '../components/rio-icon.tsx';
import { terminalMessages } from '../pages/terminal/messages.ts';
import type { Observable } from '../preferences/editor.ts';
import type { EffectiveRioPreferences } from '../preferences/values.ts';
import type { RioSessions } from '../session/registry.ts';
import { errorMessage } from '../terminal/error-message.ts';
import { RIO_TAB_KIND } from '../terminal/identity.ts';
import type { ClientContext } from './context.ts';
import { GuideSlot, PageSlot, TitleSlot } from './sidebar-views.ts';

const id = 'dsh-plugin-rioterm';
const namespace = 'rioInteractiveTerminal';
const guideSlot = 'sidebar.right.tab.guide.entry';
const pageSlot = 'sidebar.right.pane.tab';
const titleSlot = 'sidebar.right.pane.tab.title';

export function registerTerminalSidebar(
  ctx: ClientContext,
  sessions: RioSessions,
  appearance: Observable<EffectiveRioPreferences>,
): void {
  ctx.effect(
    () => ctx.locale.register(namespace, terminalMessages),
    `${id}: locale`,
  );
  const t = ctx.locale.bind(namespace);
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id,
        kind: RIO_TAB_KIND,
        multiple: true,
        keepMounted: true,
        title: () => t('title'),
        guide: [
          {
            id: 'new',
            order: 50,
            title: () => t('title'),
            description: () => t('description'),
            icon: RioIcon,
          },
        ],
      }),
    `${id}: tab`,
  );
  ctx.effect(
    () =>
      ctx.sidebarRight.registerCloseHandler(RIO_TAB_KIND, (session, tab) => {
        void sessions
          .close(session, tab.contentId)
          .catch((error: unknown) =>
            console.warn('Rio terminal close pending:', errorMessage(error)),
          );
      }),
    `${id}: close`,
  );
  ctx.effect(() => {
    const sync = () => sessions.sync(ctx.sidebarRight.openTabs.getSnapshot());
    const unsubscribe = ctx.sidebarRight.openTabs.subscribe(sync);
    sync();
    sessions.retryCleanup();
    return unsubscribe;
  }, `${id}: independent window holds`);

  ctx.effect(
    () =>
      ctx.slots.inject(guideSlot, () =>
        ctx.slots.register(
          {
            name: guideSlot,
            key: id,
            locale: namespace,
            inject: (sessionId) => ({
              issueLaunch: () => sessions.issue(sessionId),
            }),
          },
          GuideSlot,
        ),
      ),
    `${id}: new terminal`,
  );
  ctx.effect(
    () =>
      ctx.slots.inject(titleSlot, () =>
        ctx.slots.register(
          { name: titleSlot, key: id, locale: namespace },
          TitleSlot,
        ),
      ),
    `${id}: tab title`,
  );
  ctx.effect(
    () =>
      ctx.slots.inject(pageSlot, () =>
        ctx.slots.register(
          {
            name: pageSlot,
            key: id,
            locale: namespace,
            inject: (sessionId) => ({
              issueLaunch: () => sessions.issue(sessionId),
              appearance,
              session: (contentId: string) =>
                sessions.get(sessionId, contentId),
            }),
          },
          PageSlot,
        ),
      ),
    `${id}: screen`,
  );
}
