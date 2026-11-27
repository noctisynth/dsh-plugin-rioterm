# Changelog

<!-- semifold:release version=0.1.0 -->
## v0.1.0

### Bug Fixes

- [`360be07`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/360be07a053d95958d0c4230533aa9a629eae1b4): Rio 侧栏入口与 DSH 内置卡片使用相同的圆角和文字布局，副标题改为「在会话工作目录打开终端」。入口、标签标题和插件列表统一使用 Rio 官方经典图标。
- [`c678b2b`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/c678b2b3af1442f29e8591efb7cf947d787f3d5d): 搜索输入框使用共享 Input 的小尺寸变体，减小输入高度和字号；收紧搜索条的默认宽度与上下内边距，保持导航图标、按钮点击区域和固定反馈槽不变。
- [`6b9efba`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/6b9efba360eaf05134fab8bcaf508941e18e72e6): 修复切回已挂载的 Rio 标签时，宿主尚未解除 inert 状态导致自动聚焦被提前取消的问题；保留只读、隐藏和用户转移焦点时的保护。
- [`6b9efba`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/6b9efba360eaf05134fab8bcaf508941e18e72e6): 为终端查找浮层增加跟随 DSH 主题的轻量外边框与阴影，保留输入框和按钮的无边框样式。
- [`a9d9fd1`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/a9d9fd11c6b763002322f427f50b0877efbf24c1): 统一终端的程序化聚焦：初次打开、切换已有标签、关闭查找和手动接管/重连时恢复输入焦点，不再额外显示整圈蓝色边框；保留原生键盘导航的焦点提示，并通过独立主题色覆盖层避免底部残边，不影响终端网格、输入法和鼠标选择。
- [`e0be970`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/e0be970649de845eccb183c54343109b51aa5cbc): 修复 Rio 终端短暂断线后无法自动接回原 shell 的问题；手动重新连接或接管输入时复用当前面板，不重复启动进程或发送未确认输入。
- [`5b791a5`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/5b791a5fcaedbd12a0d386ad57fccc1eee933f83): 新建或切回 Rio 终端标签时默认自动聚焦输入区，无需再次点击；仍可在设置中关闭。
- [`d7abbbc`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/d7abbbc077a9460ac6ee89c2cc3ba3f9a0f0aa9f): 修复 Rio 插件详情在宿主设置尚未就绪时不显示配置区的问题；页面会显示当前状态，并在配置可写后自动开放编辑。
- [`570faf0`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/570faf084216c64bc1f6c1fc08d6ecf4d923fcd0): 移除可写终端的常驻连接提示；按 PTY 确认的尺寸顺序重排屏幕，避免拖动面板时旧输出误换行或漏掉最终尺寸。

### Chores

- [`9850b8f`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/9850b8fcea6c8ec0edf93cab35409b406c53c27b): 初始化 DSH Rio 终端插件的 TypeScript 工程，配置质量检查与 Semifold 版本发布流程。
- [`4c9d741`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/4c9d7417dd790b2482034b06406855274d03d7f8): 整理面向用户的安装、使用与排错说明，将开发和验收约定迁入内部文档；补齐包的仓库与反馈元数据，限定发布资源，并在打包前自动构建。

### New Features

- [`950f839`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/950f839433ddb48f4faac3bb8e4d2a9f8cfbb599): Rio 设置改为自动保存：选择立即提交，文本停止输入或失焦后保存，无效输入不会覆盖已生效的设置。
- [`950f839`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/950f839433ddb48f4faac3bb8e4d2a9f8cfbb599): Rio 支持独立控制粗体基础 ANSI 前景是否使用亮色，默认跟随调色板；普通文字、背景与真彩色不受影响。
- [`d14d14f`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/d14d14f07c9ae53a92e52fe11a98606abcc56eb9): 在插件详情中配置 Rio 终端的字体、配色、渲染和输入行为；未覆盖的字体与字号分别跟随 DSH，修改显示设置无需重连。
- [`d57884d`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/d57884da9629f6d263ccd1ba556833895fe4ea5d): Rio 终端支持分别设置四边留白，默认与内置终端一致；保存后直接按可用空间调整，不重连 shell。
- [`eca5bc3`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/eca5bc306388c61de2c140230207226c2473947b): 在当前 Rio 标签内查找终端输出和滚动历史，使用快捷键或放大镜打开，支持高亮和上、下一处导航；只读终端也可使用。

    连续未匹配的查询也会正确结束加载；无边框搜索条在输入框右侧固定区域展示加载动效和结果，避免状态变化引起布局跳动。

- [`78cebe6`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/78cebe652442999d555f25ae6844a1a2a98fdf77): 新增可交互的 Rio 用户终端，支持键盘、粘贴、尺寸同步及同一 Host 内的屏幕恢复；保留内置终端。
- [`950f839`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/950f839433ddb48f4faac3bb8e4d2a9f8cfbb599): 参考 DSH 设置行重排 Rio 配置页，常用项与颜色来源直接可见；可在 Rio 默认与 DSH 内置终端的 ANSI 16 色间切换，单项颜色覆盖仍然优先。
- [`269ae1d`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/269ae1d0c77e15180e6790bb22cd917492f8bf8d): 新增独立加载 Rio WASM 的终端预览；使用 tsrs 执行本地和 CI 类型检查。

### Refactors

- [`b18f975`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/b18f9752cfd8df1130b5a3fbbe5a37c4b69990fe): 用 Tailwind CSS 和本地 shadcn/ui 组件重写 Rio 引导、状态通知与操作按钮，样式随插件加载和释放，不影响其他 DSH 页面。
- [`74721c7`](https://github.com/noctisynth/dsh-plugin-rioterm/commit/74721c7882aad8b0283f37ceee858950dea73a4a): 拆分 DSH 插件注册、终端页面、会话管理与 Rio 渲染，加入跨层导入检查和独立的生命周期回归测试。
<!-- semifold:release:end -->
