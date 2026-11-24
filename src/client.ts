import {
  createElement as h,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Limits, Status, TerminalRemote } from './dsh-protocol.js';
import { detail, type RioSession, RioSessions } from './dsh-session.js';
import { createRioScreen, type RioScreen } from './rio-screen.js';
import { loadWasm, ResourceError } from './wasm-loader.js';

const id = 'dsh-plugin-rioterm';
const kind = 'rio-terminal';
const namespace = 'rioInteractiveTerminal';
const bodySlot = 'sidebar.right.pane.tab';
const entrySlot = 'sidebar.right.tab.guide.entry';
const copy = {
  en: {
    title: 'Rio terminal',
    description:
      'Open a new interactive user shell in this session’s working directory.',
    loading: 'Loading Rio…',
    opening: 'Connecting to your terminal…',
    connected: 'Connected. Click the terminal to type.',
    idle: 'No shell has been started in this tab.',
    start: 'Start shell',
    control: 'Take input control',
    readonly: 'Read-only: another window controls this terminal.',
    exited: 'The shell exited.',
    failed: 'The shell failed.',
    disconnected: 'The terminal was disconnected.',
    missing:
      'This tab has no recoverable Rio process. No replacement shell was started.',
    wasmFailed:
      'The Rio engine could not start. Fix the error and refresh this page.',
    resourceFailed: 'Could not load the Rio engine.',
    retry: 'Retry',
    reconnect: 'Reconnect',
    new: 'Open a new Rio terminal',
    input: 'Rio terminal input',
  },
  zh: {
    title: 'Rio 终端',
    description: '在当前会话的工作目录中新建一个可交互的用户 shell。',
    loading: '正在加载 Rio…',
    opening: '正在连接终端…',
    connected: '已连接，点击终端即可输入。',
    idle: '此标签尚未启动 shell。',
    start: '启动 shell',
    control: '取得输入控制权',
    readonly: '只读：另一个窗口拥有此终端的输入权。',
    exited: 'Shell 已退出。',
    failed: 'Shell 出错。',
    disconnected: '终端连接已中断。',
    missing: '此标签没有可恢复的 Rio 进程，未新建替代 shell。',
    wasmFailed: 'Rio 引擎初始化失败。请解决错误后刷新页面。',
    resourceFailed: '无法加载 Rio 引擎。',
    retry: '重试',
    reconnect: '重新连接',
    new: '打开新的 Rio 终端',
    input: 'Rio 终端输入',
  },
};
type Key = keyof typeof copy.en;
type Translate = (k: Key) => string;
type Dispose = () => void;
interface Tab {
  id: string;
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
interface CommonProps {
  t: Translate;
  useTabInfo(): { tab: Tab };
  issue(): string;
}
interface BodyProps extends CommonProps {
  session(content: string): RioSession;
}
interface GuideProps extends CommonProps {
  title: string;
  description?: string;
}
interface Ctx {
  effect(register: () => Dispose, label: string): void;
  remote: { terminal: TerminalRemote };
  locale: {
    register(n: string, d: typeof copy): Dispose;
    bind(n: string): Translate;
  };
  slots: {
    inject(slot: string, install: () => Dispose): Dispose;
    register<P>(
      entry: {
        name: string;
        key: string;
        locale: string;
        inject(sessionId: string): object;
      },
      component: (p: P) => ReactElement,
    ): Dispose;
  };
  sidebarRightTabs: {
    register(v: {
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
      subscribe(cb: () => void): Dispose;
    };
    registerCloseHandler(
      kind: string,
      cb: (session: string, tab: { contentId: string }) => void,
    ): Dispose;
  };
}
function launch(tab: Tab, issue: () => string) {
  tab.actions.openTab(kind, {
    replaceTab: true,
    params: { rioLaunch: issue() },
  });
}
function Guide({
  title,
  description,
  useTabInfo,
  issue,
}: GuideProps): ReactElement {
  const { tab } = useTabInfo();
  return h(
    'button',
    {
      type: 'button',
      'data-sidebar-right-guide-entry': kind,
      onClick: () => launch(tab, issue),
      title: description,
      style: {
        width: '100%',
        textAlign: 'start',
        cursor: 'pointer',
        padding: '0.6em 0.9em',
        font: 'inherit',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid currentColor',
        borderRadius: 8,
      },
    },
    title,
    description && h('small', { style: { display: 'block' } }, description),
  );
}
function Panel({ useTabInfo, t, session, issue }: BodyProps): ReactElement {
  const { tab } = useTabInfo();
  const model = session(tab.contentId);
  return h(Occurrence, { key: tab.contentId, tab, model, t, issue });
}
function Occurrence({
  tab,
  model,
  t,
  issue,
}: {
  tab: Tab;
  model: RioSession;
  t: Translate;
  issue: () => string;
}): ReactElement {
  const [requested, setRequested] = useState<string>();
  const ticket = requested ?? tab.navigation.params?.rioLaunch;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: Status | 'idle' | 'loading' | 'wasmFailed' | 'resourceFailed';
    msg?: string;
  }>({ key: 'loading' });
  const element = useRef<HTMLDivElement>(null);
  // Never attach invisible restored tabs. After first showing a tab, keep its
  // attachment while hidden; merely switching tabs must not acquire another window’s input.
  const [started, setStarted] = useState(tab.visible);
  const visible = useRef(tab.visible);
  visible.current = tab.visible;
  const screen = useRef<RioScreen | null>(null);
  useEffect(() => {
    if (tab.visible) setStarted(true);
    screen.current?.setVisible(tab.visible);
  }, [tab.visible]);
  const label = useRef(t('input'));
  label.current = t('input');
  useEffect(() => {
    if (!started || !element.current) return;
    try {
      if (model.needsLaunch(ticket)) {
        setState({ key: 'idle' });
        return;
      }
    } catch (error) {
      setState({ key: 'disconnected', msg: detail(error) });
      return;
    }
    const el = element.current;
    let mounted = true;
    const ac = new AbortController();
    let adapter: RioScreen | undefined;
    let channel: ReturnType<RioSession['mount']> | undefined;
    setState({ key: 'loading' });
    void loadWasm(attempt > 0)
      .then(async () => {
        if (!mounted) return;
        let limits: Limits;
        try {
          limits = await model.environment(ac.signal);
        } catch (error) {
          if (mounted) setState({ key: 'disconnected', msg: detail(error) });
          return;
        }
        if (!mounted) return;
        adapter = createRioScreen(el, {
          maxCols: limits.maxCols,
          maxRows: limits.maxRows,
          scrollback: limits.scrollback,
          onInput: (data, typed) => channel?.input(data, typed),
          onResize: (c, r) => channel?.resize(c, r),
          label: label.current,
        });
        screen.current = adapter;
        adapter.setVisible(visible.current);
        channel = model.mount(ticket, limits, {
          screen: adapter,
          status(key, msg) {
            if (mounted) setState(msg ? { key, msg } : { key });
          },
        });
        // Focus is always an explicit click/keyboard action, never an async side effect.
      })
      .catch((e: unknown) => {
        if (mounted)
          setState({
            key: e instanceof ResourceError ? 'resourceFailed' : 'wasmFailed',
            msg: detail(e),
          });
      });
    return () => {
      mounted = false;
      channel?.detach();
      adapter?.setVisible(false);
      adapter?.dispose();
      if (screen.current === adapter) screen.current = null;
      ac.abort();
    };
  }, [started, attempt, model, ticket]);
  const retry = state.key === 'resourceFailed' || state.key === 'disconnected';
  return h(
    'section',
    {
      'aria-label': t('title'),
      'data-rio-terminal': true,
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          flexWrap: 'wrap',
        },
      },
      h('span', { role: 'status' }, t(state.key)),
      state.msg && h('small', { role: 'alert' }, state.msg),
      state.key === 'idle' &&
        h(
          'button',
          { type: 'button', onClick: () => setRequested(issue()) },
          t('start'),
        ),
      state.key === 'readonly' &&
        h(
          'button',
          { type: 'button', onClick: () => setAttempt((n) => n + 1) },
          t('control'),
        ),
      retry &&
        h(
          'button',
          { type: 'button', onClick: () => setAttempt((n) => n + 1) },
          t(state.key === 'resourceFailed' ? 'retry' : 'reconnect'),
        ),
      (state.key === 'exited' ||
        state.key === 'missing' ||
        state.key === 'failed') &&
        h(
          'button',
          { type: 'button', onClick: () => launch(tab, issue) },
          t('new'),
        ),
    ),
    h('div', {
      ref: element,
      style: { flex: '1 1 0', minHeight: 0, minWidth: 0, overflow: 'hidden' },
    }),
  );
}
export const inject = [
  'slots',
  'locale',
  'sidebarRightTabs',
  'sidebarRight',
  'remote',
  'remote.terminal',
];
export function apply(ctx: Ctx): void {
  const sessions = new RioSessions(ctx.remote.terminal, () => localStorage);
  ctx.effect(() => () => sessions.dispose(), `${id}: release attachments`);
  ctx.effect(() => ctx.locale.register(namespace, copy), `${id}: locale`);
  const t = ctx.locale.bind(namespace);
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id,
        kind,
        multiple: true,
        keepMounted: true,
        title: () => t('title'),
        guide: [
          {
            id: 'new',
            order: 50,
            title: () => t('title'),
            description: () => t('description'),
          },
        ],
      }),
    `${id}: tab`,
  );
  ctx.effect(
    () =>
      ctx.sidebarRight.registerCloseHandler(kind, (session, tab) => {
        void sessions
          .close(session, tab.contentId)
          .catch((e: unknown) =>
            console.warn('Rio terminal close pending:', detail(e)),
          );
      }),
    `${id}: close`,
  );
  ctx.effect(() => {
    const sync = () => sessions.sync(ctx.sidebarRight.openTabs.getSnapshot());
    const unsub = ctx.sidebarRight.openTabs.subscribe(sync);
    sync();
    sessions.retryCleanup();
    return unsub;
  }, `${id}: independent window holds`);
  const inject = (sessionId: string) => ({
    issue: () => sessions.issue(sessionId),
    session: (content: string) => sessions.get(sessionId, content),
  });
  ctx.effect(
    () =>
      ctx.slots.inject(entrySlot, () =>
        ctx.slots.register(
          { name: entrySlot, key: id, locale: namespace, inject },
          Guide,
        ),
      ),
    `${id}: new terminal`,
  );
  ctx.effect(
    () =>
      ctx.slots.inject(bodySlot, () =>
        ctx.slots.register(
          { name: bodySlot, key: id, locale: namespace, inject },
          Panel,
        ),
      ),
    `${id}: screen`,
  );
}
