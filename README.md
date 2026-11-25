# dsh-plugin-rioterm

在 DeepSeek Harness 右侧栏打开 **Rio 终端**，使用当前会话工作目录中的交互式 shell。DSH 管理伪终端（PTY）、进程和屏幕快照；Rio WASM 负责显示内容和编码输入。它与内置终端并存，不接管 Agent 终端。

## 使用和验收

1. 在右侧栏选择 **＋ → Rio 终端**。出现 shell 提示符后，面板只显示终端，不留状态栏。点击终端，输入 `pwd` 并回车。这是用户终端：命令按 DSH 所在执行环境的系统用户权限运行，不经过 Agent 的审批流程。
2. 在 macOS/Linux 输入 `echo $$`，记下 shell PID。切换标签再切回，或刷新 DSH 页面，再执行一次；同一 Host 进程中应回到原来的 shell。关闭终端标签会请求结束 shell，不等同于收起侧栏。Host 重启或进程已丢失时不会静默新建。
3. 输入 `stty size`，调整面板宽度后重试，列数应随之改变。拉高面板时，原有的滚动历史（包括空行）可能重新出现在顶部；插件不会为固定提示符的位置而删除历史。可用 `vim -Nu NONE -i NONE -n`（输入 `:q!` 退出）验证全屏程序。支持键盘、粘贴、文本选择和滚轮；当前不向 Vim 等应用转发鼠标点击或拖动。

**使用中断线：**原画面会保留，但不能输入。DSH 的传输连接恢复后，原本可写且当前可见的 Rio 标签会尝试连接原来的 shell，用宿主快照恢复画面。隐藏标签等到再次显示才接屏幕；已经只读的窗口必须手动取得输入控制权。也可以点「重新连接」：已知终端身份时直接在原面板重连，不重新启动 shell，也不重发断线前未确认的输入。如果原进程已不存在，需要手动新建。

## Rio 设置

在 DSH 侧栏打开 **插件 → 已安装插件 → Rio 终端**，在插件详情的配置区修改并保存。它只影响 Rio 标签，不改变 DSH 的内置终端。取消编辑不会写入配置；恢复默认后也需要保存。

| 设置                                        | 行为                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字体、字号                                  | 两项分别继承 **DSH 设置 → 通用 → 更多字体设置** 中的终端配置。只改字号不锁定字体；清空一个覆盖并保存，就重新跟随对应的宿主设置。字体只使用本机字体列表。                   |
| 行高、文字与背景、光标、选区、16 个 ANSI 色 | 影响已有画面；未指定的颜色使用宿主或 Rio 默认色。自定义固定色不会随明暗主题变化。                                                                                          |
| 渲染器                                      | 默认使用 DOM。可切换 Canvas，在 Canvas 下选择光标形状，或开启预测反馈并设置延迟阈值和标记样式。预测默认关闭；开启时，未确认的字符只画占位符，字符本身仍以 shell 回显为准。 |
| 面板行为                                    | 可关闭自动适配尺寸，保留宿主网格；可以选择首次可写时自动聚焦（默认关闭）。修改偏好本身不夺取正在使用的输入框。                                                             |
| 键盘和链接                                  | 可切换 Alt 作为 Meta，以及纯文本 URL 识别。普通单击不打开链接；Ctrl / ⌘ 加点击会先显示目的地址，确认后才打开网页或邮件链接。                                               |
| 本地滚动历史                                | 留空使用 DSH 告知的上限，`0` 表示不保留。新上限在下一次创建或从宿主快照恢复屏幕时生效，不为了应用设置丢弃现有历史。                                                        |

改变显示设置不会新建 shell，也不会重新连接当前终端。行列数和单元格像素尺寸由宿主与渲染器协商，不当作可手填的显示参数；真实 PTY 的换行处理也不修改。验收字体继承时，可以打开已有 Rio 标签，仅覆盖字号，然后在 DSH 中换终端字体；字体应随宿主更新，字号应保持 Rio 的值。

## 本地开发

插件注册、React 页面、会话管理与 Rio 渲染分开维护。修改前可从[终端模块边界与测试索引](.agents/specs/terminal-modules.md)找到对应入口。

使用 pnpm，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
```

React 界面使用 Tailwind CSS v4 和仓库内的 shadcn/ui 组件。只为 Rio 面板、引导和插件设置区编译样式，不加载 CDN，不给 DSH 页面引入 Preflight；主题色直接引用 DSH 的语义色。修改样式与控件时见[UI 约定](.agents/specs/terminal-modules.md#ui-样式与组件)。

`pnpm typecheck` 使用锁定版本的 tsrs，以 `--noEmit` 检查源码与构建配置。`pnpm check` 先运行 Biome，再运行相同的类型检查。`pnpm build` 用 tsdown 打包客户端，用 `tsc --noCheck`（通过 Host 配置）仅转译宿主入口，并把与 JS 版本匹配的独立 WASM 复制到 `lib/`。`pnpm test` 在构建后运行。

本地试用时先构建，再到 DSH 的插件管理中添加当前仓库目录。插件不依赖 CDN；如果页面策略阻止 WASM 编译，请检查错误提示，不要关闭安全策略。

另有仅用于开发的 POSIX 真机冒烟测试（需要已安装的 DSH、Vim 和系统授权分配 PTY，在工作区根目录运行）：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" scripts/test-dsh-pty.mjs
```

该测试使用独立的 DSH 控制器与测试 shell，不连接正在运行的用户终端。若系统不允许分配 PTY，可单独验证桌面控制器与 Rio 是否兼容：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" --test tests/dsh-desktop-loopback.test.mjs tests/desktop-reconnect.test.mjs tests/host-preferences-desktop.test.mjs
```

回环测试不启动子进程：使用真实的 DSH 控制器和屏幕序列化器、插件的输入协议和 Rio WASM，检查中文输入、尺寸、全屏模式重连以及还原主屏幕。重连测试使用桌面自带的 Gateway，模拟传输断开、恢复与手动接管，检查没有重建 shell 或重复发送输入。桌面设置测试使用真实的 Cordis Loader 与 DSH 配置服务，验证保存和清除覆盖不会重新挂载插件；配置写入在内存中，不触及个人配置。常规 `pnpm test` 在普通 Node 中会跳过这三项桌面专测。它们不替代 GUI 里的人工验收。

## 变更集与发布

本地与 CI 使用 Semifold 0.3.4。需要发版的改动应随代码提交变更集，例如：

```sh
semifold commit --name fix-resize --package dsh-plugin-rioterm=patch --tag fix --summary '修复终端尺寸同步。'
semifold config sync --check
semifold status
```

提交到 `main` 的 PR 会运行质量检查并展示版本计划。推送到 `main` 后，相同的质量检查通过才运行 `semifold ci`：有变更集时，自动更新 `release` → `main` 的版本 PR；合并版本 PR 后，自动创建 GitHub Release。`release` 分支由 Semifold 管理，请勿手动开发。

当前工程骨架仅通过 GitHub 记录版本，**不发布到 npm**，也不需要 npm Token。启用远端自动化时，请在 GitHub 仓库设置中允许 GitHub Actions 创建 PR，并允许发布任务写入仓库内容。
