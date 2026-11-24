# dsh-plugin-rioterm

在 DeepSeek Harness 右侧栏打开 **Rio 终端**，使用当前会话工作目录中的交互式 shell。DSH 管理伪终端（PTY）、进程和屏幕快照；Rio WASM 负责显示内容和编码输入。它与内置终端并存，不接管 Agent 终端。

## 使用和验收

1. 在右侧栏选择 **＋ → Rio 终端**，看到「已连接」后输入 `pwd`。这是用户终端：命令按 DSH 所在执行环境的系统用户权限运行，不经过 Agent 的审批流程。
2. 在 macOS/Linux 输入 `echo $$`，记下 shell PID。切换标签再切回，或刷新 DSH 页面，再执行一次；同一 Host 进程中应回到原来的 shell。关闭终端标签会请求结束 shell，不等同于收起侧栏。Host 重启或进程已丢失时不会静默新建。
3. 输入 `stty size`，调整面板宽度后重试，列数应随之改变。可用 `vim -Nu NONE -i NONE -n`（输入 `:q!` 退出）验证全屏程序。支持键盘、粘贴、文本选择和滚轮；当前不向 Vim 等应用转发鼠标点击或拖动。

## 本地开发

使用 pnpm，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
```

`pnpm typecheck` 使用锁定版本的 tsrs，以 `--noEmit` 检查源码与构建配置。`pnpm check` 先运行 Biome，再运行相同的类型检查。`pnpm build` 用 tsdown 打包客户端，用 `tsc --noCheck`（通过 Host 配置）仅转译宿主入口，并把与 JS 版本匹配的独立 WASM 复制到 `lib/`。`pnpm test` 在构建后运行。

本地试用时先构建，再到 DSH 的插件管理中添加当前仓库目录。如果之前开过只读预览，请关闭旧标签、刷新，然后新建「Rio 终端」。插件不依赖 CDN；如果页面策略阻止 WASM 编译，请检查错误提示，不要关闭安全策略。

另有仅用于开发的 POSIX 真机冒烟测试（需要已安装的 DSH、Vim 和系统授权分配 PTY，在工作区根目录运行）：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" scripts/test-dsh-pty.mjs
```

该测试使用独立的 DSH 控制器与测试 shell，不连接正在运行的用户终端。若系统不允许分配 PTY，可单独验证桌面控制器与 Rio 是否兼容：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" --test tests/dsh-desktop-loopback.test.mjs
```

回环测试不启动子进程：使用真实的 DSH 控制器和屏幕序列化器、插件的输入协议和 Rio WASM，检查中文输入、尺寸、全屏模式重连以及还原主屏幕。常规 `pnpm test` 在普通 Node 中会跳过这个桌面专测。这两类测试均不能替代在 GUI 里实际输入命令。

## 变更集与发布

本地与 CI 使用 Semifold 0.3.4。需要发版的改动应随代码提交变更集，例如：

```sh
semifold commit --name fix-resize --package dsh-plugin-rioterm=patch --tag fix --summary '修复终端尺寸同步。'
semifold config sync --check
semifold status
```

提交到 `main` 的 PR 会运行质量检查并展示版本计划。推送到 `main` 后，相同的质量检查通过才运行 `semifold ci`：有变更集时，自动更新 `release` → `main` 的版本 PR；合并版本 PR 后，自动创建 GitHub Release。`release` 分支由 Semifold 管理，请勿手动开发。

当前工程骨架仅通过 GitHub 记录版本，**不发布到 npm**，也不需要 npm Token。启用远端自动化时，请在 GitHub 仓库设置中允许 GitHub Actions 创建 PR，并允许发布任务写入仓库内容。
