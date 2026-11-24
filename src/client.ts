import {
  createElement as h,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DOMRenderer, defaultTheme, initWasm, Terminal } from 'rioterm';

const id = 'dsh-plugin-rioterm';
const slot = 'sidebar.right.pane.tab';
const namespace = 'rioWasmDemo';
const wasmPath = 'dsh-plugin-rioterm/wasm/0.1.8.wasm';
const copy = {
  en: {
    title: 'Rio read-only preview',
    description: 'WASM terminal demonstration. No shell is started.',
    loading: 'Loading the Rio terminal…',
    ready: 'The terminal preview is ready.',
    failed: 'Could not load the Rio WASM resource:',
    refresh:
      'Rio could not initialize. Refresh the page after resolving this error:',
    retry: 'Retry',
    screen: 'Rio terminal output',
  },
  zh: {
    title: 'Rio 只读预览',
    description: 'WASM 终端演示，不启动 shell。',
    loading: '正在加载 Rio 终端…',
    ready: '终端预览已就绪。',
    failed: '无法加载 Rio WASM 资源：',
    refresh: 'Rio 初始化失败。请排查以下错误后刷新页面：',
    retry: '重试',
    screen: 'Rio 终端输出',
  },
};

type Translate = (key: keyof typeof copy.en) => string;
type Disposer = () => void;
interface ClientContext {
  effect(register: () => Disposer, label: string): void;
  locale: {
    register(namespace: string, dictionaries: typeof copy): Disposer;
    bind(namespace: string): Translate;
  };
  slots: {
    inject(name: string, register: () => Disposer): Disposer;
    register(
      seat: { name: string; key: string; locale: string },
      component: (props: { t: Translate }) => ReactElement,
    ): Disposer;
  };
  sidebarRightTabs: {
    register(tab: {
      id: string;
      kind: string;
      title: () => string;
      guide: {
        id: string;
        order: number;
        title: () => string;
        description: () => string;
      }[];
    }): Disposer;
  };
}

class ResourceError extends Error {}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function requestWasm(reload: boolean): Promise<Response> {
  const response = await fetch(new URL(wasmPath, document.baseURI), {
    mode: 'same-origin',
    credentials: 'same-origin',
    cache: reload ? 'reload' : 'default',
  });
  if (!response.ok) throw new Error(`WASM: HTTP ${response.status}`);
  if (
    response.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/wasm'
  ) {
    throw new Error('WASM: expected Content-Type application/wasm');
  }
  return response;
}

// Rio 0.1.8 caches initWasm's promise (even rejection), so only failures before
// handing it a Response are retryable without a fresh page. Coalesce parallel mounts.
let wasmReady: Promise<void> | undefined;
function loadWasm(reload: boolean): Promise<void> {
  wasmReady ??= requestWasm(reload)
    .catch((error: unknown) => {
      throw new ResourceError(messageOf(error));
    })
    .then((response) => initWasm(response))
    .catch((error: unknown) => {
      wasmReady = undefined;
      throw error;
    });
  return wasmReady;
}

function RioPanel({ t }: { t: Translate }): ReactElement {
  const mount = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    'loading' | 'ready' | { error: string; retryable: boolean }
  >('loading');
  useEffect(() => {
    const node = mount.current;
    if (!node) return;
    let active = true;
    let terminal: Terminal | undefined;
    let renderer: DOMRenderer | undefined;
    function dispose() {
      renderer?.element.remove();
      renderer?.dispose();
      renderer = undefined;
      terminal?.dispose();
      terminal = undefined;
    }
    void loadWasm(attempt > 0)
      .then(() => {
        if (!active) return;
        terminal = new Terminal({ cols: 16, rows: 2, scrollback: 0 });
        renderer = new DOMRenderer(terminal, {
          theme: {
            ...defaultTheme,
            foreground: 'inherit',
            background: 'transparent',
          },
        });
        node.append(renderer.element);
        terminal.write('\x1b[?25lRio 就绪');
        renderer.render();
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        dispose();
        setState({
          error: messageOf(error),
          retryable: error instanceof ResourceError,
        });
      });
    return () => {
      active = false;
      dispose();
    };
  }, [attempt]);
  return h(
    'section',
    {
      'aria-label': t('title'),
      'data-rio-wasm-demo': true,
      style: { padding: 16 },
    },
    h('h2', null, t('title')),
    h('p', null, t('description')),
    h('p', { role: 'status' }, typeof state === 'string' ? t(state) : null),
    typeof state === 'object' &&
      h(
        'p',
        { role: 'alert' },
        t(state.retryable ? 'failed' : 'refresh'),
        ' ',
        state.error,
      ),
    typeof state === 'object' &&
      state.retryable &&
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setState('loading');
            setAttempt((previous) => previous + 1);
          },
        },
        t('retry'),
      ),
    h('div', {
      ref: mount,
      role: 'region',
      'aria-label': t('screen'),
      style: { overflowX: 'auto' },
    }),
  );
}

export const inject = ['slots', 'locale', 'sidebarRightTabs'];
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(namespace, copy), `${id}: locale`);
  const t = ctx.locale.bind(namespace);
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id,
        kind: 'rio-wasm-demo',
        title: () => t('title'),
        guide: [
          {
            id: 'demo',
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
      ctx.slots.inject(slot, () =>
        ctx.slots.register(
          { name: slot, key: id, locale: namespace },
          RioPanel,
        ),
      ),
    `${id}: panel`,
  );
}
