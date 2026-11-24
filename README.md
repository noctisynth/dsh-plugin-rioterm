# dsh-plugin-rioterm

面向 DeepSeek Harness 的 Rio 终端插件。目前只有 TypeScript 工程骨架，尚不可作为 DSH 插件安装。

## 本地开发

使用 pnpm，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` 检查格式、lint 和类型。`pnpm build` 将 `src/` 编译为 `dist/` 下的 ES 模块。

## 变更集与发布

本地与 CI 使用 Semifold 0.3.4。需要发版的改动应随代码提交变更集，例如：

```sh
semifold commit --name fix-resize --package dsh-plugin-rioterm=patch --tag fix --summary '修复终端尺寸同步。'
semifold config sync --check
semifold status
```

提交到 `main` 的 PR 会运行质量检查并展示版本计划。推送到 `main` 后，相同的质量检查通过才运行 `semifold ci`：有变更集时，自动更新 `release` → `main` 的版本 PR；合并版本 PR 后，自动创建 GitHub Release。`release` 分支由 Semifold 管理，请勿手动开发。

当前工程骨架仅通过 GitHub 记录版本，**不发布到 npm**，也不需要 npm Token。启用远端自动化时，请在 GitHub 仓库设置中允许 GitHub Actions 创建 PR，并允许发布任务写入仓库内容。
