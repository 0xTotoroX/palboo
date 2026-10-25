# ui/shared/ — 共用契约与资源

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

- `features.ts`：按语言读取的功能名称及共享图标映射、默认字号与旧偏移回退、owner、递归分栏与标签组布局（叶子可选 collapsed，缺省展开）、传输与临时阅读状态类型，closing/disable-ready 用于关闭前捕获；Reading.modelPresetDraft 保存预设新增/改名的 ID、名称、原始选择及 creating，仅用于内存交接。
- `contracts.ts`：设置、字体、上下文、投影和受限命令类型；presentationError 区分保存成功后的窗口失败。
- `constants.js`：注入实例 DOM 标识、尺寸、时间和开发存储键。
- `performance.js`：默认无计时器的同步工作计时；采样建立12秒租约，断开/停用/过期清理长任务观察器，嵌套工作不重复计入总耗时；宿主页 JS 内存与长任务单列，不视为 Palboo 独占。
- `scroll.js`：功能预览与容器共用的滚动读写，保留隐藏标签和尺寸变化时被浏览器夹紧的阅读意图。
- `text.js`：错误文案去除 Error 前缀、翻译已知产品提示并保留原始有效原因；文本归一化、数值限制与 HTML/属性转义的纯函数。
- `tokens.css`：功能及设置页共用的基础颜色、间距、圆角和控件尺寸变量；action-icon-size/action-hit-size 统一18px动作图标与28px点击区，旧 icon-size 继续保留16px文字控件语义。
- `brand.tsx`：自有 PALBOO 融合矢量字标，末尾双 O 直接使用图标的直立圆润双眼与淡粉腮红；字母及双眼继承正文颜色，无外部字体、状态或动效。产品图标仍使用 ui/icon.png，品牌规范见根 DESIGN_SYSTEM.md。
- [bridge/AGENTS.md](bridge/AGENTS.md)：受限 CDP 请求生命周期。
- [icons/AGENTS.md](icons/AGENTS.md)：自绘功能 SVG、公开 MIT 控件 SVG 子集及各自许可。

仅放真正跨模块使用的契约与资源；不承担功能呈现、窗口管理或业务保存。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。

features.ts 的 mainManaged 是后台主界面归属投影，不持久化为另一份配置；旧快照可省略。

AppearanceSettings 增加可选 settingsTarget（plugin/web），旧后台缺省按 plugin 展示。

AppearanceSettings.launcherAction 保存独立眼睛的默认动作（inside/outside/settings）；与工作台布局及生成设置分离。

contracts.ts声明宿主inputTarget只读目标和提示词优化verify/destroy生命周期接口；原文不进入持久化配置或窗口投影。

codex-host.ts定义独立后台管理状态和重启进度，不扩展FeatureId或插件注册。contracts声明上游只读Agent探针。

contracts 声明术语实例 locate(id, context)/verify/refresh/destroy、受请求身份校验的 progress 与可选 typography 只读字体快照接口与无正文错误状态；正式词库不放入 shared。

EditableSettings.promptEnhancementEnabled是提示词优化独立开关，历史配置由后台默认true；不归入四功能FeatureId或布局。

features.ts 增加 terms、默认14px字号与术语筛选/选择阅读状态，其他功能身份和保存协议不变。

`typography.ts` 定义 TypographyPreferences/字体快照、默认值、有效祖先缩放及跨表面的字号计算；不采集 DOM 文本。跟随按宿主字号×相对比例×宿主缩放/当前容器缩放，自定义用固定逻辑像素并保留字体家族。

AppearanceSettings 增加可选 settingsTheme（codex/light/dark/null），只控制设置页，旧后台缺省兼容浏览器偏好；功能显示名调整不改变 FeatureId。

- `next-drag.js`：推荐复制拖放的 MIME 与纯身份载荷（实例、视图、聊天、建议版本、条目索引）；不包含正文、不持久化。

Reading.quickPromptDraft/quickPromptEditing/quickPromptSaved保存快捷指令编辑与确认结果，供窗口交接和内容重绘保留草稿；不写业务配置，提交仍带原configurationRevision。

FeatureState.edgeTabs/edgeTabsRevision 提供贴边标签顺序和选择的确认快照；EdgeTabs 不属于临时业务 Reading，也不影响功能优先级。

EditableSettings.tokenMeterEnabled 声明聊天测速独立开关；__palbooTokenMeter 提供 refresh/read(expectedThreadId)/snapshot/destroy，快照不含正文。

- `token-meter.ts`：当前聊天测速的只读数值投影，独立于模型选择和承载方式，不含正文或持久化配置。

EditableSettings.grokbotEnabled 默认关闭，沿现有配置修订保存。features 增加 bots/Grok Bot 与默认字号；__palbooBots 仅提供 read/fill/destroy，fill 接收当前输入目标 token 和聊天身份，不暴露发送能力。

EditableSettings.grokbotAutoSync 默认开启，控制本机资料监听，独立于功能开关与生成版本。

- `bot-catalog.ts`：可选 sidebar v1 类型及纯 botGroups 投影，保留 kind 以区分置顶，主面板与设置共用已验证的分组顺序/隐藏过滤；旧接口保留平铺名单，无 I/O。

- `brand-storage.js`：仅首次复制旧 codex-buddy 前缀偏好至 palboo 前缀，值原样保留、新键优先、旧键不删除；分别处理 localStorage/sessionStorage，受限存储不阻塞启动。constants 与设置主题在读取偏好前复用。

PanelPreferences.sidebarNewChat/sidebarDots 为兼容旧快照的可选布尔字段，缺省均关闭；由 Web 外观设置保存，运行时与窗口投影保留。

Settings 的 builtInDirections/directionLibraryLimit 是后台只读目录及上限，EditableSettings 仍只提交本机方向库和位置；前端按内置 ID 区分来源，不能用显示名称判断系统方向。

Settings.terminologyImportsPending 为只读待处理状态；__palbooTerminologyImports 仅暴露当前发送意图的 verify 与 destroy，不暴露任意发送接口。

- `i18n.js` / `locales/en.js`：本地 i18next 单实例、中文源文案与英文目录，支持 system/zh-CN/en、同步订阅及数字格式；无联网翻译。只在显示层处理产品文案，不改变数据标识或用户内容。`use-locale.ts` 为 React 外部订阅，切换不重挂载表单；网站注册自己的文案，网站内容不进入 App 包。
- AppearanceSettings/FeatureState.appearance.language 为可选共享外观偏好，旧快照兼容；默认值由后台提供。内置方向只有稳定ID及字段均与原始目录一致时才翻译，模型厂家分类的保存ID始终使用原值。
