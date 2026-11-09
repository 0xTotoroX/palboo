# ui/codex/runtime/ — 运行协调与状态

> L2 | 父级：[AGENTS.md](../AGENTS.md)

lifecycle 在宿主安装侧聊控制器及回答行入口，输入框不挂侧聊按钮；不受提示词优化开关影响，不在桌面投影安装。销毁回收观察器、事件及在途后续写入，已关闭来源的失败草稿由同页内存接续。

settings-sync 的 tools 通知按独立开关安装/销毁提示词优化和术语实例；关闭时取消其监听、轮询及未完成结果，重新开启按当前上下文恢复。presentation 相同偏好与 detached 状态不发重绘/外观通知；恢复心跳仍保留。lifecycle 公开按需 samplePerformance/stopPerformance，计时实现在 shared/performance，销毁时清理采样租约。

shared/constants 与 state 为下层基础；Codex 适配和功能模块各自工作；settings-sync 协调开关，presentation 生成投影，lifecycle 订阅通知并组合运行。状态分为 runtime、context、stepwise、outline、shell 五组；旧调试 state 只提供兼容投影。

presentation 投影历史回复模式并核对目录命令的内容 token；lifecycle 每轮扫描共用 context 已读取的最新轮次身份同步回复按钮，避免为按钮重复采集正文，再同步所选回复，聊天切换恢复跟随最新。生成期间先只更新轮次身份并维护历史入口，不解析全部正文；仅当前生成轮次等待完成，来源失联仍清理全部入口。

presentation 的 panelReadingState 由 lifecycle 导出，记录标签、预览条目及滚动位置；工作台额外记录 outline/next 各自的内容 token 与滚动位置，通过 surfaces/workspace/reading 保存隐藏标签的滚动意图，并以任务/内容 token 校验；只在初次呈现或收回时恢复。panelWindowAnchor 提供临时屏幕矩形，隐藏内嵌或宿主页面不可见时由 shellLayout 计算，按出发形态返回胶囊或展开矩形；blinkHandoff 在交接结束眨眼一次。setDetached 是可等待、可反向中断的淡化交接，shell 保存临时动画与完成 promise，lifecycle 停用时回收。后台不可见页面或减少动态效果时立即交接，避免等待被浏览器暂停的帧；常规投影不重置阅读位置。

工作台的屏幕交接使用宿主适配提供的 `dockRect.anchor`：展开时匹配实际栏宽，收起时使用共用胶囊的84×36区域，侧栏占位归零；弹出期间仍按可恢复的布局计算，不能由保存的 `dockOpen` 单独推断。

成员清单：

- [state.js](state.js)：createOutlineState 也为普通 Chat 创建独立目录状态；五组状态及独立停靠/浮窗布局及分功能字号的初始化（弹出始终展开）、能力判断、受限 bridgeCall 和完整生成输入采集（预算仅在后台应用）及自选方向位置数量；大纲保留临时来源上下文供点击核验，不导入上层。
- [signals.js](signals.js)：固定的同步通知类型及订阅，包括 windowToggle 窗口手势与 workbenchToggle 停靠开合请求；不承载状态或业务实现。
- [diagnostics.js](diagnostics.js)：可见几何和本地限量诊断，不保存聊天正文。
- [settings-sync.js](settings-sync.js)：openSettings 打开统一配置页，支持 layout-presets 目的地参数；设置请求、保存、推送同步和 15 秒恢复检查；两个功能独立重置。
- [presentation.js](presentation.js)：包含宿主明暗、语义色及应用偏好后的大纲/下一步内容字号的只读窗口投影（缺失时恢复默认色）、Web 三材质及 liquidVariant 偏好同步（忽略弹出收起偏好），通过工作台纯模型迁移旧比例并接收两端独立布局；首次连接恢复后台已保存的开合和尺寸，随后只随 Web 设置修订回读，避免覆盖本地交互；按钮与表情双击共用 togglePanelWindow 弹出/收回与动作校验，未收到后台 popoutSupported=true 时禁用弹出；执行业务动作前重新核对宿主；quick-fill 按快捷词配置与 promptToken 校验，遵循 submit 意图并保护已有草稿，追加草稿不发送；不接收远端 theme 命令，按投影设置浮窗主题和原生外观通知，不改变系统设置；内嵌弹出/收回发出 appearance 通知以同步 SVG 液态；弹出与收回使用方向相反的图标，提示对应动作；窗口切换由公共表情手势触发，旧图标隐藏；桌面头部保留置顶按钮，默认开启且可保存取消选择，写入期间禁用按钮，使用请求时的目标值避免投影回读后二次翻转；Web 设置保留同一偏好，不插入弹出专用来源行。
- [lifecycle.js](lifecycle.js)：组合入口、DOM 观察、正文扫描、启停/销毁、接口和通知订阅；大纲与下一步均停用时跳过正文读取，仅维护其他功能容器；重新注入时清理旧根和侧栏占位，重复占位视为不健康实例；切换聊天只重置当前建议与在途请求，按当前聊天/回答恢复缓存（含手动模式）；停用时清理表情连击记录；公开运行实例是否为开发版，提供 panelAppearance 只读颜色接口，不暴露主题写入接口；停用/销毁时发送内嵌 SVG 液态清理通知。

state 从独立宿主存储恢复聊天关联元数据；presentation 投影来源状态并接收关联命令，viewToken 使用逻辑上下文而非物理栏位。lifecycle 接收 bindingUnavailable 使在途请求失效并保留已完成结果，恢复时重验来源。

双面板阅读投影依据当前实际 workbench DOM，不再由旧 layoutMode 决定；胶囊偏好弹出后同样接续两面板阅读，返回仍恢复出发形态。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

state 的 feature 仅决定活动视图，runtimeEnabled 依据真实功能开关；taskView 保存任务搜索/自定义阶段/页签/快速新建草稿/横向位置，与聊天 token 无关。presentation 独立接续 taskView，大纲仍检查原阅读 token。windowToggle 的可选 expand 只用于显式选择返回承载形式，旧手势保持原行为。

lifecycle 同时安装/销毁独立功能嵌入适配器；扫描忽略自有功能节点，settings 的 modelControlEnabled 允许只开模型时保留入口。独立呈现不复制生成、识别或写入逻辑。

独立功能保留同一 windowToggle/workbenchToggle 通知：lifecycle 按当前模式路由功能 owner 交接或旧工作台，避免绕过原表情手势。

lifecycle 为 embedded/launcher 接入共用表情手势与设置操作，停用时回收导航入口；presentation 统一使用左栏图标作为窗口往返锚点（无图标栏时沿用旧锚点）。不再读取旧 launcher 选择字段。

Dev 官方插件页签联动仅在 launcher 成功确认选中后通过 lifecycle 收起旧注入侧栏，不关闭已有桌面/贴边窗口或迁移业务 owner。

通过 canUseOfficial 将 chatRoot 的有效性供 launcher 校验，生成中仍可收放；非聊天页保留官方按钮默认导航。

openSettings 信号来自内嵌工作台头部，lifecycle 请求后台按 settingsTarget 选择内置浏览器网页或插件侧边页签；不将该点击传递给表情收放。

openSettings 信号可显式携带 web，用于 Option+右键；此时请求 inHostBrowser=true，不读取或修改保存的默认打开方式。

产品设置统一由 settings-sync.openSettings 调用后台 inHostBrowser 路径，并在内置侧边浏览器打开；单飞防止连续点击创建多个标签，runtime generation 变化后不继续导航。头部、眼睛右键和 Option+右键共用该入口，lifecycle 不再调用插件设置工具或按 settingsTarget 分流。

lifecycle 统一执行 launcherAction：内在宿主显示/收放，外使用现有整组桌面交接或唤起，设置复用内置浏览器。presentation 接收 cdp 传来的默认动作并刷新入口，不重置业务数据；主功能 owner 与旧窗口分别走现有协议。强调点由已确认的主功能 placement 或旧 detached 状态生成，pending 目标不提前改变强调点；旧侧栏与页面浮层的 detached 变化均刷新入口，默认手势保持原配置。

lifecycle 每次渲染使用原 resolveFabExpression/fabExpressionLabel 和 activePaneCue 更新独立入口；来源沿用原关联身份与几何判断，单聊天或来源无效时不显示小点，不为图标另行读取聊天。

lifecycle在宿主安装/销毁prompt-enhancement，独立于工作台业务启停，不在桌面投影安装。其验证接口仅回答指定在途优化请求是否仍对应原草稿；不对外返回草稿。

独立主界面的入口收放按当前承载分流：sidebar更新dockOpen，overlay更新open，desktop仍走整组返回；避免浮层误用停靠状态而无法收起。

入口在整组功能视图已关闭时先恢复仍启用的主内容，再按 sidebar/overlay 打开；桌面返回及外部唤起复用同一恢复流程。普通收放保持原逻辑，业务停用和贴边功能不被入口重新开启。

lifecycle 同时安装并销毁 terminology/host，复用活动聊天根、标题、一问一答及忙碌状态；不参与 Stepwise 建议缓存。

提示词优化安装透传settingsLoaded与promptEnhancementEnabled；settings-sync将工具开关按即时补丁更新，独立于工作台功能启停。

术语旁路通过 context.terminologyExchange 读取最近三轮已完成问答；宿主生成新回答时仍允许核对已完成内容，换聊天继续取消旧请求。

lifecycle 暴露 syncTypography 与 typography 供原 CDP 状态轮询传入统一偏好并读回不含正文的字体快照。presentation 将解析后的快照传给旧浮窗；shell.sharedTypography 仅内存保存。

lifecycle 随下一步开关安装/回收 next-drop；销毁清除拖放监听与落点反馈。填入不再走草稿确认协议，保留历史字段兼容读取。

设置打开共享同一在途Promise；bridgeCall与底层/settings/open均10秒超时并支持取消，超时回收而不影响模型长请求。后台错误保留并返回，失败和处理中状态投影到眼睛入口旁可关闭反馈；成功清除反馈。停用/销毁立即取消，旧运行期与切换聊天后的结果不能继续导航。

lifecycle 的220ms页面变化防抖和1300ms文本稳定等待仅进行本地读取。宿主回答中每1300ms检查本地忙碌状态，覆盖停止控件单独消失；结束后重新等待文本稳定，再按当前模式和缓存决定是否请求模型，不因轮询重复生成。

聊天测速由 tools 信号按 tokenMeterEnabled 安装/销毁，使用输入目标而非工作台阅读锁定；scan/desktopStatus 复用原调度刷新目标，不新增轮询。正文扫描排除测速根节点。全局销毁移除测速监听与定时器。

Grok Bot 由 grokbotEnabled 独立开启，syncTools 安装/销毁 __palbooBots；runtimeEnabled 包含此开关，允许只启用 Bot 功能。调用记录随宿主实例销毁，不持久化。

大纲定位/锚点命令成功只返回 ok=true；仅失败时附带错误文案，避免成功回执误报失败。

大纲在回答身份变化时独立失效，即使新旧正文相同也重建当前目录；正文变化、停用与销毁清除定位上下文并作废旧刷新。虚拟卸载仅转为 unavailable 并保留目录，观察器覆盖最新与历史来源的纯移除事件；缺失期间不重复解析，回挂载后按节点/可用性变化重新核验。投影沿用 outlineStatus，不改变目录 token；仅来源上下文和原文均匹配才恢复条目及首尾导航，不影响建议生成配置。

state 默认关闭 sidebarNewChat/sidebarDots；presentation 从外观偏好同步，旧快照缺省关闭，通知旧工作台和独立功能外壳重新计算停靠，不改变 dockOpen 意愿。

术语导入由 lifecycle 按只读 terminologyImportsPending 安装/回收主聊天发送衔接，settings-sync 沿既有设置通知更新；不受术语标注显示开关控制，不修改 Agent 或供应商配置。

lifecycle 的现有公开运行接口增加只读 translate，用于独立 CDP 脚本文案。presentation 接收带 language/action 的外观投影并兼容旧动作字符串；桌面旧入口读取 language，内容身份加入语言以刷新产品文案，保持草稿和阅读状态。宿主 document.lang 不由 Palboo 修改。

presentation 同步三种入口动作；exportPanelState 的 viewToken 包含空聊天唯一输入目标 token，quick-fill 仅在有效临时输入目标下放行空上下文。lifecycle 暴露只读 hostPageAllowed 与 DesktopStatus.pageKind，入口遵守范围；runtimeEnabled 包含仅术语开启的情况。

常用语独立开关参与 runtimeEnabled 与 settings-sync 的即时启停；投影使用共享 quickPromptToken，预设动作不依赖 generationRevision。只开常用语时不为填入启动回答扫描，锁定聊天仍使用真实来源身份，旧建议命令校验不变。

生命周期公开 settingsAppearance 只读函数，复用后台现有 desktop_status 刷新传递设置页外观；不新增观察器或定时器。

syncTypography 在旧偏好上携带 surfaces 映射，typography 返回三来源原始快照；旧桌面投影明确解析 desktop 偏好，避免沿用出发窗口字号。

lifecycle 将主功能交接状态传给左栏菜单，交接期间内/外及往返动作不重复发起，设置入口保留；状态来自 embedded/features，不新增后台轮询或改变已确认位置指示。

公开运行接口导出 openSettings，供后台统一设置导航调用；宿主桥只返回本机目的地，不外跳系统浏览器。presentation 消费共享 systemLanguage，不修改宿主 document.lang。

lifecycle 停用与销毁时调用 disposePopoutFonts，取消旧浮窗字体读取并回收自有 FontFace；不触碰宿主文档的字形资源。

lifecycle 公开 openWebsite，网站与设置共用单飞、取消和运行期身份保护；网站点击由后台提供已校验的目的地，不调用模型。webLibraryEnabled 独立参与入口启停，不启动回答扫描。

lifecycle 只同步既有 Palboo 左栏入口，不再创建网站独立图标。网站功能的文件夹/网站列表及按 ID 打开仍走受限桥，设置目的地使用 section=sites；入口不加入模型上下文。
