const en = {
  title: 'Rio terminal',
  description: 'Open a terminal in the session’s working directory',
  loading: 'Loading Rio…',
  opening: 'Connecting to your terminal…',
  reconnecting: 'Reconnecting to the same terminal. Input is unavailable.',
  ready: 'Terminal connected. Ready for input.',
  idle: 'No shell has been started in this tab.',
  start: 'Start shell',
  control: 'Take input control',
  reconnectControl: 'Reconnect and take input control',
  readonlyDisconnected:
    'This read-only window was disconnected from the terminal.',
  readonly: 'Read-only: another window controls this terminal.',
  exited: 'The shell exited.',
  failed: 'The shell failed.',
  disconnected: 'Terminal disconnected. Input is unavailable.',
  missing:
    'This tab has no recoverable Rio process. No replacement shell was started.',
  wasmFailed:
    'The Rio engine could not start. After fixing the error, reload the entire DSH window, not just the terminal tab.',
  resourceFailed: 'Could not load the Rio engine.',
  details: 'Error details',
  retry: 'Retry',
  reconnect: 'Reconnect',
  new: 'Open a new Rio terminal',
  input: 'Rio terminal input',
  openLink: 'Open the following address outside the terminal?',
};

type MessageKey = keyof typeof en;
export type TerminalTranslate = (key: MessageKey) => string;

const zh = {
  title: 'Rio 终端',
  description: '在会话工作目录打开终端',
  loading: '正在加载 Rio…',
  opening: '正在连接终端…',
  reconnecting: '正在重新连接到原终端，暂时无法输入。',
  ready: '终端已连接，可以输入。',
  idle: '此标签尚未启动 shell。',
  start: '启动 shell',
  control: '取得输入控制权',
  reconnectControl: '重新连接并取得输入控制权',
  readonlyDisconnected: '此只读窗口已与原终端断开连接。',
  readonly: '只读：另一个窗口拥有此终端的输入权。',
  exited: 'Shell 已退出。',
  failed: 'Shell 出错。',
  disconnected: '终端连接已中断，暂时无法输入。',
  missing: '此标签没有可恢复的 Rio 进程，未新建替代 shell。',
  wasmFailed:
    'Rio 引擎初始化失败。解决错误后，请重新加载整个 DSH 窗口，而不只是终端标签页。',
  resourceFailed: '无法加载 Rio 引擎。',
  details: '错误详情',
  retry: '重试',
  reconnect: '重新连接',
  new: '打开新的 Rio 终端',
  input: 'Rio 终端输入',
  openLink: '要在终端外打开以下地址吗？',
} satisfies Record<MessageKey, string>;

export const terminalMessages = { en, zh };
