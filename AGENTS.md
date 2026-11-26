# 维护入口

修改插件注册、终端页面、PTY 会话或 Rio 渲染前，先看[终端模块边界](.agents/specs/terminal-modules.md)。构建步骤、实机验收与发布流程见 [README](README.md)。

插件改动交付前，默认在检查、测试和构建通过后安装到当前 DSH profile，并核对安装工具返回的应用状态；安装受阻时明确说明，不把“已构建”当作“已安装”。
