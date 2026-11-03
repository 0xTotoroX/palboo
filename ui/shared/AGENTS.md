# ui/shared/ — 共用契约与资源

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

- `demo-state.ts`：设置与网站共用的完整合成投影和带修订校验的内存任务适配器；可显式复制传入的本地任务快照；不传seed时只用示例数据，原快照不变，网站不读取本地数据。术语示例共用sampleTerms，不读取真实聊天、配置凭据或调用模型。未知动作拒绝，不回落到业务服务；示例原文随语言切换，访客编辑保留。

- `features.ts`：按语言读取的功能名称及共享图标映射、默认字号与旧偏移回退、owner、递归分栏与标签组布局（叶子可选 collapsed，缺省展开）、传输与临时阅读状态类型，closing/disable-ready 用于关闭前捕获；Reading.modelPresetDraft 保存预设新增/改名的 ID、名称、原始选择及 creating，仅用于内存交接。
- `contracts.ts`：设置、字体、上下文、投影和受限命令类型；presentationError 区分保存成功后的窗口失败。
- `constants.js`：注入实例 DOM 标识、尺寸、时间和开发存储键。
- `performance.js`：默认无计时器的同步工作计时；采样建立12秒租约，断开/停用/过期清理长任务观察器，嵌套工作不重复计入总耗时；宿主页 JS 内存与长任务单列，不视为 Palboo 独占。
- `scroll.js`：功能预览与容器共用的滚动读写，保留隐藏标签和尺寸变化时被浏览器夹紧的阅读意图。
- `text.js`：错误文案去除 Error 前缀、翻译已知产品提示并保留原始有效原因；文本归一化、数值限制与 HTML/属性转义的纯函数。
- `preview-conversation.ts`：设置、官网与设备画面共用的合成问答、短段落和编号条目；无真实聊天或配置。
- `preview-frame.css`：设置与独立介绍页共用的单层预览外框、内容容器及提示词示例输入样式；颜色由消费方注入，包含聊天左右分栏、窄屏堆叠和共享消息输入框；普通功能高度自适应，设置整体场景16:9，介绍页设备场景独立约束比例与外部控件。
- `tokens.css`：功能及设置页共用的基础颜色、间距、圆角和控件尺寸变量；action-icon-size/action-hit-size 统一18px动作图标与28px点击区，旧 icon-size 继续保留16px文字控件语义。
- `brand.tsx`：自有 PALBOO 融合矢量字标，末尾双 O 直接使用图标的直立圆润双眼与淡粉腮红；字母及双眼继承正文颜色，无外部字体、状态或动效。产品图标仍使用 ui/icon.png，品牌规范见根 DESIGN_SYSTEM.md。`PalbooLettering` 提供同源PALB路径供官网结尾复用，不改变原静态字标。
- [bridge/AGENTS.md](bridge/AGENTS.md)：受限 CDP 请求生命周期。
- [icons/AGENTS.md](icons/AGENTS.md)：自绘功能 SVG、公开 MIT 控件 SVG 子集及各自许可。

仅放真正跨模块使用的契约与资源；不承担功能呈现、窗口管理或业务保存。

AppearanceSettings.settingsStyle/settingsAccent 保留旧配置兼容，设置页不再消费或编辑。HostSettingsAppearance 另有页面标题、分组圆角/边框和中性导航选中角色；Typography 可携带字形特性、可变轴、样式/伸缩与光学尺寸，缺省保持兼容。

contracts 的 __buddyNativeChrome 标识原生标题栏能力；__buddyWindowControls 的 minimized/fullscreen 只用于临时几何保护，不写业务配置。

[PROTOCOL]: 结构、职责或接口变化时更新本文；父级描述受影响时同步父级地图。

features.ts 的 mainManaged 是后台主界面归属投影，不持久化为另一份配置；旧快照可省略。

AppearanceSettings 增加可选 settingsTarget（plugin/web），旧后台缺省按 plugin 展示。

AppearanceSettings.launcherAction/launcherDoubleAction/launcherContextAction 分别保存眼睛单击、双击、右键动作；旧配置默认 inside/toggle/settings，双击和右键额外支持 toggle，设置修订与生成设置分离。

AppearanceSettings.startup 保存 mode（restore/closed/open）和 location（inside/outside）；缺省 restore/inside，外观修订独立保存，仅后台冷启动应用，普通读回不改变当前开合与位置。

contracts.ts声明宿主inputTarget只读目标和提示词优化verify/destroy生命周期接口；原文不进入持久化配置或窗口投影。

codex-host.ts 定义独立后台管理状态、启动更新策略、重启进度及 Agent 预览快照。快照包含真实名单与分组、就绪状态、可添加状态和当前 Agent，不含聊天身份和正文。available 表示 Agent 就绪，不把已锁定会话的禁用按钮当成不可用。contracts 声明上游只读 Agent 探针。

contracts 声明术语实例 locate(id, context)/verify/refresh/destroy、受请求身份校验的 progress 与可选 typography 只读字体快照接口与无正文错误状态；正式词库不放入 shared。

EditableSettings.promptEnhancementEnabled是提示词优化独立开关，历史配置由后台默认true；不归入四功能FeatureId或布局。

features.ts 增加 terms、默认14px字号与术语筛选/选择阅读状态，其他功能身份和保存协议不变。

`typography.ts` 定义 TypographyPreferences/字体快照、默认值、有效祖先缩放及跨表面的字号计算；不采集 DOM 文本。跟随按宿主字号×相对比例×宿主缩放/当前容器缩放，自定义用固定逻辑像素并保留字体家族。

AppearanceSettings 增加可选 settingsTheme（codex/light/dark/null），只控制设置页，旧后台缺省兼容浏览器偏好；功能显示名调整不改变 FeatureId。

- `next-drag.js`：推荐复制拖放的 MIME 与纯身份载荷（实例、视图、聊天、建议版本、条目索引）；不包含正文、不持久化。

Reading.quickPromptDraft/quickPromptEditing/quickPromptSaved保存快捷指令编辑与确认结果，quickPromptExpanded按条目身份保存临时全文开合，供窗口交接和内容重绘保留草稿；不写业务配置，提交仍带原configurationRevision。

FeatureState.edgeTabs/edgeTabsRevision 提供贴边标签顺序和选择的确认快照；EdgeTabs 不属于临时业务 Reading，也不影响功能优先级。

EditableSettings.tokenMeterEnabled 声明聊天测速独立开关；__palbooTokenMeter 提供 refresh/read(expectedThreadId)/snapshot/destroy，快照不含正文；inputTarget.selection 可选提供当前模型、推理与速度模式，仅作为只读归属依据。

- `token-meter.ts`：当前聊天状态与当前模型测速的只读投影，lastSpeed 可跨聊天保留，model/fast 标明归属，独立于承载方式，不含正文或持久化配置。

EditableSettings.grokbotEnabled 默认关闭，沿现有配置修订保存。features 增加 bots/Grok Bot 与默认字号；__palbooBots 仅提供 read/fill/destroy，fill 接收当前输入目标 token 和聊天身份，不暴露发送能力。

EditableSettings.grokbotAutoSync 默认开启，控制本机资料监听，独立于功能开关与生成版本。

- `bot-catalog.ts`：可选 sidebar v1 类型及纯 botGroups 投影，保留 kind 以区分置顶，主面板与设置共用已验证的分组顺序/隐藏过滤；旧接口保留平铺名单，无 I/O。

- `brand-storage.js`：仅首次复制旧 codex-buddy 前缀偏好至 palboo 前缀，值原样保留、新键优先、旧键不删除；分别处理 localStorage/sessionStorage，受限存储不阻塞启动。constants 与设置主题在读取偏好前复用。

PanelPreferences.sidebarNewChat/sidebarDots 保留旧键名，现控制新聊天/Dots 的 Palboo 全功能启用范围，缺省均关闭；由 Web 外观设置保存，运行时与窗口投影保留。FeatureState.scopeAllowed 是临时页面范围投影，不写入功能开合偏好。

Settings 的 builtInDirections/directionLibraryLimit 是后台只读目录及上限，EditableSettings 仍只提交本机方向库和位置；前端按内置 ID 区分来源，不能用显示名称判断系统方向。

Settings.terminologyImportsPending 为只读待处理状态；__palbooTerminologyImports 仅暴露当前发送意图的 verify 与 destroy，不暴露任意发送接口。

- `i18n.js` / `locales/en.js`：本地 i18next 单实例、中文源文案与英文目录，支持 system/zh-CN/en、同步订阅及数字格式；无联网翻译。只在显示层处理产品文案，不改变数据标识或用户内容。`use-locale.ts` 为 React 外部订阅，切换不重挂载表单；网站注册自己的文案，网站内容不进入 App 包。
- AppearanceSettings/FeatureState.appearance.language 为可选共享外观偏好，旧快照兼容；默认值由后台提供。内置方向只有稳定ID及字段均与原始目录一致时才翻译，模型厂家分类的保存ID始终使用原值。

- `quick-prompts.js`：独立常用语内容身份和可选名称的纯函数；quickPromptName 在短名称为空时取正文首行前20字，仅用于显示，不改写指令；宿主投影与保存成功后的设置合并共用，避免新条目立即点击时带旧版本。text.js 提供共享 hashText，runtime 保留原导出。

EditableSettings.quickPromptsEnabled/quickPromptClickMode/quickPromptLabelOnly 声明独立开关、可空点击模式与默认关闭的仅名称显示；显示偏好不进入 quickPromptToken。PanelSnapshot/PanelCommand.quickPromptToken 独立于建议生成版本，旧命令仍兼容 promptToken。features.ts 的 prompts 与 feature-prompts 使用同一位置、字号和草稿交接协议。

`features.ts` 的 FeatureLayout.visible 是可选的主界面显示组合，缺省保留全部已打开功能；LayoutPreset 与 layoutPresetsRevision 描述命名布局和并发版本，独立于模型预设及业务配置。

contracts.ts 的 HostSettingsAppearance 仅传递宿主界面语义色、字体和可选 geometry 尺寸/状态表现变量、reducedMotion 及可选双色 palettes；可选导航/标题字号行高、toolbarRadius、菜单尺寸和 inputBorder/segmented/ghost/slider 颜色按控件角色补充，旧快照保持回退，不含正文；AppearanceSettings.settingsStyle 为 chatgpt/palboo/null，缺省采用跟随，独立于 settingsTheme 明暗选择。

typography 增加 SurfaceTypography（五类窗口）及快照 sources；surfaceTypography 保留旧全局偏好继承，fontFamily 空值跟随，指定本机字体后以宿主字体链回退。contracts/FeatureState 传递独立字体设置与贴边头部有效偏好，不改变业务布局。

i18n.setLocale 接收只读 systemLanguage 并缓存后台解析的系统首选语言；显式 en/zh-CN 优先，system 使用同一来源。旧后台和独立网站无此字段时才回退 navigator；不改用户语言偏好或内容。

LayoutPreset.scope 为可选的 LayoutPresetScope（all/sidebar/overlay/desktop），缺省视为通用。标签仅推荐；共享排序、标签翻译与布局匹配由 workspace/layout-presets.js 提供，设置和各承载共用，不各自过滤预设。

`host-fonts.ts`：不含 React 或认证凭据的文档字体加载器，消费有效字体族与 HostFontSource；本机 PostScript 别名走 local()，可确认的 App 字形按需读取。按字体族保留加载状态，普通轮询/未变备用字体不重复请求；替换或销毁取消请求、删除自有 FontFace，迟到结果不注册。PopoutBridge 只新增可选的受限 hostFonts 读取契约。

- `web-library.ts`：网站条目、多个文件夹摘要/授权与独立修订 DTO，保留旧单目录字段兼容，不含访问凭证和笔记正文。features 增加可选 sites、feature-sites 图标和临时 siteSearch；contracts 的 webLibraryEnabled 允许独立启停。
