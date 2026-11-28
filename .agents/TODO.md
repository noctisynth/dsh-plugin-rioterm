# 发布待办

发布步骤与检查口径见[开发与发布](specs/development-release.md)。以下事项必须在对外宣称“可安装的正式发布”前明确。

## 建立 DSH 兼容范围与首发验收记录

- 当前已在 [package.json](../package.json) 声明 `engines.dsh` 为 `^0.2.0`（覆盖 `0.2.x` 至最新版本），但尚未建立最低兼容版本证据。本地安装的 DSH 版本本身不能证明最低版本，Node 的 CI 版本也不能证明 DSH 兼容性。
- 下一步：按[人工验收清单](specs/development-release.md#本地安装与人工验收)在拟支持的 DSH 版本和平台上实测，记录 GUI、PTY、桌面专测结果后，再按需调整兼容范围。
- 当前包版本由 Semifold 变更集与版本 PR 决定；不要在准备文档时把 `0.0.0` 手工改成未经确认的正式版本。
