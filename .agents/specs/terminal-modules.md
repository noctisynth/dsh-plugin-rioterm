# 终端模块边界

**页面显示一个终端；插件决定它对应哪个 DSH 标签；会话决定它能控制哪个进程。** 拆的是源码职责，不是安装包：宿主仍提供一个受认证的 WASM 资源，浏览器仍通过一个惰性工厂从 DSH 获取 React。

| 要改什么                                              | 从哪里开始                                                                                                                                                                                           | 不要放进来                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 注册、卸载、侧栏导航、把标签映射到会话                | [客户端入口](../../src/client.ts)、[侧栏适配](../../src/plugin/sidebar.ts)                                                                                                                           | JSX 页面布局、初始化 WASM、在渲染时创建进程                           |
| 引导、终端页面、状态按钮、可见性与挂载                | [终端页面](../../src/pages/terminal/terminal-page.tsx)、[一次挂载的生命周期](../../src/pages/terminal/terminal-mount.ts)                                                                             | DSH 上下文、宿主 RPC 帧、绑定记录；页面只收会话接口、可见性和操作回调 |
| 私有终端归属、恢复、关闭、保活、输入与输出帧          | [窗口会话注册表](../../src/session/registry.ts)、[绑定存储](../../src/session/bindings.ts)、[有序帧流](../../src/session/wire.ts)                                                                    | React、Rio、DOM 渲染；持久化格式改变需要迁移，不是文件改名            |
| 字体与配色如何渲染、字符网格、键盘/输入法、选择与滚轮 | [Rio 屏幕](../../src/rio/screen.ts)、[无 DOM 的终端核心](../../src/rio/terminal.ts)                                                                                                                  | 侧栏、会话存储、控制宿主 PTY 的逻辑                                   |
| 设置的校验、继承、持久化与编辑                        | [偏好模型](../../src/preferences/values.ts)、[宿主 schema](../../src/host/preferences.ts)、[编辑器适配](../../src/plugin/preferences.ts)、[设置页](../../src/pages/preferences/preferences-page.tsx) | 不能把宿主字体缓存成 Rio 覆盖，也不通过重连应用设置                   |
| WASM 文件的认证与交付                                 | [宿主资源入口](../../src/index.ts)、[资源约定](../../docs/host-resource.md)                                                                                                                          | 浏览器组件、外部 CDN 或从用户输入拼接文件路径                         |

[共享契约](../../src/terminal/contracts.ts)是接口，不是另一个实现。页面可以挂载、取消自己的视图，不能直接关闭进程。一个窗口的注册表负责标签清单和关闭操作。Rio 只提议新尺寸；确认后的尺寸由会话和输出按顺序交给屏幕，不能为了让窗口“合身”先改网格。重连不签发新的启动许可，隐藏已挂载的页面也不等于结束 shell。[屏幕连接](../../src/session/attachment.ts)负责在原面板接回已知的终端 ID：传输重试交给 DSH Gateway，每次新连接都要重新确认保活与可见性，旧连接的按键和待确认输入不跨连接重发。已知只读的窗口不得自动接管。

## UI 样式与组件

- 共享 Button、Input 和 Alert 采用 shadcn/ui 源码组件模式，放在 [components/ui](../../src/components/ui/)；页面只组合控件、选择变体，文案仍从页面词典取。组件使用 `cn` 合并含 `rio:` 前缀的 Tailwind 类；不要在页面复制按钮样式或用内联样式写静态布局。主题色和圆角在[局部样式源](../../src/styles/terminal.css)映射到宿主变量；字号用 Tailwind 的刻度，终端的字体、字号分别从 [DSH 主题适配](../../src/plugin/appearance.ts)继承，再叠加 [Rio 偏好](../../src/preferences/values.ts)。用户配置页位于插件详情，不在终端内容上叠加控件。
- 一页只需要自己的 `data-rio-ui` 根。在[构建步骤](../../build/ui-styles.ts)将工具类和 Tailwind 的回退声明限制在这个范围；不发布全局 Preflight、`.dark` 或 `:root` 规则。[样式安装](../../src/plugin/ui-styles.ts)随插件 effect 创建和清理，同一文档的标签共享一份，客户端不请求单独的 CSS 文件。不要把其他插件的 DOM 放进这个范围。
- Rio 的屏幕和隐藏输入框可以使用这里的工具类；只有输入法候选窗的光标坐标、字体样张等依赖实时数据的值直接设置样式；样张只读经过校验的字体与字号，不接受 CSS 文本。修改原生组件、通知或配色后运行 [UI 契约测试](../../tests/terminal-ui.test.mjs)；React 单元测试不代替在 DSH 中切换主题和使用键盘的人工验收。

## 如何守住这些边界

- [Biome 跨层导入限制](../../biome.json)随 `pnpm check` 执行，页面不能依赖具体会话/插件实现；会话与 Rio 不互相导入，都不依赖 React。只服务于终端页的组件、hook 和文案就近维护，不建立通用 `utils` 或转发层。
- 改挂载或恢复行为，先看[页面挂载测试](../../tests/terminal-mount.test.mjs)和[会话测试](../../tests/dsh-session.test.mjs)。前者用可控端口，不要求 React、浏览器或 PTY；后者覆盖启动许可、失去控制权和延迟关闭。
- 改字体度量或尺寸同步，运行[有序缩放测试](../../tests/resize-order.test.mjs)。改入口或加载方式，运行[产物注册测试](../../tests/registration.test.mjs)和[宿主资源测试](../../tests/host-route.test.mjs)。类型检查不能代替这些运行时测试。
- 改设置时，分别运行[设置页交互测试](../../tests/preferences-ui.test.mjs)、[字体继承测试](../../tests/appearance.test.mjs)、[渲染热更新测试](../../tests/rio-preferences.test.mjs)和[真实 DSH 宿主配置测试](../../tests/host-preferences-desktop.test.mjs)。[自动保存时序测试](../../tests/preferences-autosave.test.mjs)单独覆盖宿主确认先后顺序、冲突和输入法组合。特别核对选择立即保存、文本按字段防抖、无效输入不落盘；上一笔写入返回时不能覆盖更新的草稿或其他窗口的修改。自动保存不重启终端，清空字体后继续跟随宿主。
