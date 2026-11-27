# 开发、验收与发布

本文面向维护者。用户安装和使用说明在 [README](../../README.md)；源码职责与测试入口见[终端模块边界](terminal-modules.md)。README 只保留安装前提、操作方法、设置、限制和排错，不写构建实现、回归步骤或 CI 约定。

## 本地开发

使用 [package.json](../../package.json) 的 `packageManager` 指定版本；Node 基线与 [Quality 工作流](../../.github/workflows/quality.yaml) 一致。首次安装与完整验证顺序：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
```

- `typecheck` 用锁定版本的 tsrs，以 `--noEmit` 检查源码和构建配置；`check` 先运行 Biome，再做类型检查。
- `build` 用 tsdown 打包客户端，用 `tsc --noCheck`（Host 配置）转译宿主入口，再把与 JS 版本匹配的独立 WASM 复制到 `lib/`。WASM 路由和认证约定见[宿主资源](host-resource.md)。
- `test` 读取构建产物，必须在构建后运行。修改源码后不能用旧 `lib/` 的通过结果交付。
- React 页面使用 Tailwind CSS v4 和仓库内的 shadcn/ui 组件，只编译插件作用域内的样式，不使用 CDN 或全局 Preflight。见[UI 约定](terminal-modules.md#ui-样式与组件)。
- 粗体亮色是渲染设置，不改写 PTY 输出或 WASM 网格。[rioterm 补丁](../../patches/rioterm@0.1.8.patch)为 DOM 和 Canvas 使用同一条颜色解析规则；升级 Rio 时检查上游支持并运行渲染测试。

## 本地安装与人工验收

构建后通过 DSH 插件管理添加仓库的绝对目录；本地目录安装引用工作树，不受 `files` 白名单过滤。交付插件行为改动时，在检查、测试、构建通过后安装到当前 profile，并核对安装工具的 `application`、`warnings` 和 `nextStep`。需要重启时明确告知；构建成功不等于已安装，安装成功也不等于已完成 GUI 验收。单纯文档审阅不为验证文本而更改运行中的 profile。

在实际 DSH 页面中验证：

1. **启动与权限：** 右侧栏 **＋ → Rio 终端**，输入 `pwd`，确认使用当前会话工作目录；连接就绪后只显示终端，不留状态栏。这是用户 shell，命令使用 DSH 的系统用户权限，不走 Agent 审批。
2. **会话与聚焦：** macOS/Linux 执行 `echo $$`，切换标签、刷新页面后 PID 不变。分别在两个 Rio 标签和其他类型标签之间切换：默认自动聚焦可写终端；关闭自动聚焦后不抢焦点。关闭标签结束 shell，收起侧栏不结束；后台重启或进程丢失后不得静默新建。
3. **尺寸与全屏程序：** 执行 `stty size`，调整面板宽高后确认行列数变化。拉高时允许历史（含空行）重新出现，不删除历史来固定提示符。运行 `vim -Nu NONE -i NONE -n`，用 `:q!` 退出；检查键盘、粘贴、选择和滚轮，不要求转发终端应用鼠标事件。
4. **查找：** 验证 `⌘F` / `Ctrl+Shift+F`、Enter / Shift+Enter、Esc，以及字面匹配、大小写、计数上限、只读查找；普通 Ctrl+F 仍交给 shell。搜索图标默认完全隐藏，开启设置后常驻；改开关不收起现有查找框。
5. **断线与控制权：** 断线保留画面且不可输入；恢复时可见、原本可写的标签回到原 shell，隐藏标签等再次显示。只读窗口不得自动接管。手动重连不新建 shell、不重发未确认输入；丢失进程需手动新建。
6. **设置与继承：** 选择、开关、取色立即保存；文本约 600 毫秒防抖或失焦保存。无效字段不阻止其他有效字段保存。确认单项、内边距整组和整页恢复默认的范围，以及整页恢复的二次确认。修改设置不重连终端。
7. **字体与颜色：** 已有标签仅覆盖字号，再更改 DSH 终端字体；字体继续继承，字号保持覆盖。分别切换主题、DOM/Canvas、ANSI 调色板和粗体亮色，检查独立预览、光标和选区。DSH 内置终端的最低对比度调整不是 Rio 的粗体亮色功能，不要求像素级相同。
8. **取色器与可访问性：** 验证 HEX 提交和 Escape 丢弃未提交文本、alpha 保留、屏幕取色取消、键盘焦点循环、减少动态效果下的静态保存图标。保存异常显示文字说明。

比较 ANSI 蓝与粗体蓝可使用：

```sh
printf '\033[34m普通蓝\033[0m  \033[1;34m粗体蓝\033[0m  \033[94m亮蓝\033[0m\n'
```

## 桌面专测与 PTY 冒烟

在仓库根目录执行，使用已安装 DSH 提供的 `DSH_NODE_EXECUTABLE`。POSIX 真机冒烟还需要 Vim 和系统允许分配 PTY：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" scripts/test-dsh-pty.mjs
```

测试使用独立 DSH 控制器与测试 shell，不连接用户正在使用的终端。若系统不允许分配 PTY，可运行不启动子进程的桌面专测：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" --test tests/dsh-desktop-loopback.test.mjs tests/desktop-reconnect.test.mjs tests/host-preferences-desktop.test.mjs
```

回环测试使用真实控制器、屏幕序列化器、输入协议和 Rio WASM，检查中文、尺寸、全屏重连与主屏恢复；重连测试使用桌面 Gateway 检查断线、恢复与手动接管不重建 shell、不重发输入；设置测试使用真实 Cordis Loader 和配置服务，配置仅写入内存，不触及个人配置。常规 `pnpm test` 在普通 Node 中会跳过这三项，不能据此声称通过桌面专测，也不能用它们替代人工 GUI 验收。

## 发布包边界

[package.json](../../package.json) 的 `files` 只包含运行产物、Cordis patch、图标、语言资源、用户 README 与第三方许可。源码、测试、补丁、`.agents` 和维护入口不随包交付；技术资源约定留在本目录。新增运行模块或资源时，同时更新白名单并检查实际 tarball。

`prepack` 自动构建以避免从未构建的工作树打出缺少入口或 WASM 的包，但不替代完整质量检查，也不自动发布：

```sh
pnpm check
pnpm build
pnpm test
pnpm pack --out dist/dsh-plugin-rioterm.tgz
```

解包核对 `exports` 指向的宿主/客户端入口、全部转译模块、`dsh.bundle.patch`、语言文件、图标、匹配版本的 WASM、README 和第三方许可均在包中。确认无 `.agents`、维护文档、源码、测试、环境变量文件或过期构建产物。打包成功不等于 GitHub Release 已上传附件或 npm 已发布；发布渠道的未决事项见[发布待办](../TODO.md)。

## 变更集与发布流程

Semifold 版本以 [CI 工作流](../../.github/workflows/semifold-ci.yaml) 为准。需要随版本交付的改动提交变更集，例如：

```sh
semifold commit --name fix-resize --package dsh-plugin-rioterm=patch --tag fix --summary '修复终端尺寸同步。'
semifold config sync --check
semifold status
```

向 `main` 提交 PR 时运行质量检查并展示版本计划；推送到 `main` 后质量检查通过才运行 `semifold ci`。有变更集时更新 `release` → `main` 的版本 PR，合并版本 PR 后创建 GitHub Release。`release` 分支由 Semifold 管理，不用于手动开发。

目标发布渠道为 npm。README 随 npm 包交付，必须以该版本已经发布为前提，直接说明通过包名安装；上线前状态、配置差距与发布操作只记录在 `.agents`，不写入用户 README。

当前包采用 MIT 许可证，[发布配置](../../.changes/config.toml) 已启用公开 npm 发布（`publish = true`、`--provenance --access public`）与 GitHub Release，并在 [CI 工作流](../../.github/workflows/semifold-ci.yaml) 中配置了 Node 24 与 pnpm 发布环境。GitHub 源码归档不含被忽略的 `lib/`，不能代替经过检查的 npm 包。GitHub 自动化需要允许 Actions 创建 PR，并允许发布任务写入仓库内容；发布待办见[发布待办](../TODO.md)。文档按发布后的用户视角编写，不代表已实际执行发布。
