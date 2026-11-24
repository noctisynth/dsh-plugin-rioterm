# dsh-plugin-rioterm

面向 DeepSeek Harness 的 Rio WASM 预览插件。在右侧栏的新建页打开 Rio 预览，查看由本地 WASM 解析的就绪文字。此阶段不连接 shell，不读取会话内容，也不替换 DSH 的默认终端。

## 本地开发

使用 pnpm，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
```

`pnpm typecheck` 使用锁定版本的 tsrs，以 `--noEmit` 检查源码与构建配置。`pnpm check` 先运行 Biome，再运行相同的类型检查。`pnpm build` 用 tsdown 打包客户端，用 `tsc --noCheck`（通过 Host 配置）仅转译宿主入口，并把与 JS 版本匹配的独立 WASM 复制到 `lib/`。`pnpm test` 在构建后运行。

本地预览时先构建，再到 DSH 的插件管理中添加当前仓库目录。在右侧栏的新建页选择「Rio 只读预览」。插件不依赖 CDN，也不需要放宽页面 CSP。若页面策略阻止 WASM 编译，应检查错误提示，而不是关闭安全策略。

## 变更集与发布

本地与 CI 使用 Semifold 0.3.4。需要发版的改动应随代码提交变更集，例如：

```sh
semifold commit --name fix-resize --package dsh-plugin-rioterm=patch --tag fix --summary '修复终端尺寸同步。'
semifold config sync --check
semifold status
```

提交到 `main` 的 PR 会运行质量检查并展示版本计划。推送到 `main` 后，相同的质量检查通过才运行 `semifold ci`：有变更集时，自动更新 `release` → `main` 的版本 PR；合并版本 PR 后，自动创建 GitHub Release。`release` 分支由 Semifold 管理，请勿手动开发。

当前工程骨架仅通过 GitHub 记录版本，**不发布到 npm**，也不需要 npm Token。启用远端自动化时，请在 GitHub 仓库设置中允许 GitHub Actions 创建 PR，并允许发布任务写入仓库内容。
