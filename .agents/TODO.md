# 发布待办

发布步骤与检查口径见[开发与发布](specs/development-release.md)。以下事项必须在对外宣称“可安装的正式发布”前明确。

## 确认插件自身的许可证

- 当前只有 [第三方许可声明](../THIRD-PARTY-NOTICES.txt) 及其中引用的许可全文，尚无本插件自身的 `license` 字段或根目录许可证。
- 下一步：由维护者决定授权方式，再同步包元数据、许可证文件、README 和发布包。不得把第三方 MIT / Apache / 0BSD 声明当成本插件的授权，也不在文档整理中擅自选 MIT 或 `UNLICENSED`。

## 落实 npm 发布配置

- 已确定通过 npm 发布，README 随包交付，以当前版本已经发布为前提，说明在 DSH 中通过包名安装；不向用户展示上线前的临时状态。
- [Semifold 配置](../.changes/config.toml)仍为 `publish = false`、`github-release = true`，包仍为 `private: true`，与目标发布方式尚未对齐。
- 下一步：调整 private 与 Semifold 发布动作，配置 npm 发布权限或可信发布，并验证实际安装包。不能只去掉 private 就视为完成发布链路。GitHub Release 是否附带安装包不作为 npm 安装的前提。

## 建立 DSH 兼容范围与首发验收记录

- 尚未声明 `engines.dsh`，也未建立最低兼容版本证据。本地安装的 DSH 版本本身不能证明最低版本，Node 的 CI 版本也不能证明 DSH 兼容性。
- 下一步：按[人工验收清单](specs/development-release.md#本地安装与人工验收)在拟支持的 DSH 版本和平台上实测，记录 GUI、PTY、桌面专测结果后，再声明兼容范围。
- 当前包版本由 Semifold 变更集与版本 PR 决定；不要在准备文档时把 `0.0.0` 手工改成未经确认的正式版本。
