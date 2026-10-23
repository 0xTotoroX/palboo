# Palboo 设计系统

这份文档记录仓库当前使用的设计语言与复用入口。界面沿用 Tom Modern 设置页及现有工作台；设计系统由源码中的语义变量、基础组件、共享外壳和交互约定组成。

## 设计参考与实际选型

Tom Modern 是本项目已选定的界面方案名称，代表中性色、细分隔线、平直控件和少量橙色强调；它不是 npm 组件库。具体外观以本仓库的变量和样式为准。Nova 独立预览已移除，现有设置页继续使用原方案。

| 范围 | 参考来源 / 实际采用 | 仓库入口与边界 |
| --- | --- | --- |
| 基础组件 | [shadcn/ui](https://ui.shadcn.com/docs) | [components.json](components.json) 使用 `new-york` 生成配置；组件源码位于 [components/ui/](ui/settings/components/ui/)，按 Palboo 主题定制，保留本地许可 |
| 开关与组件组合 | [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | 仅引入 `@radix-ui/react-switch`、`@radix-ui/react-slot`；抽屉和确认继续复用现有原生 `dialog` 封装 |
| 样式与语义变量 | [Tailwind CSS v4](https://tailwindcss.com/docs/styling-with-utility-classes) | [styles.css](ui/settings/styles.css)、[settings-layout.css](ui/settings/settings-layout.css) 与 [tokens.css](ui/shared/tokens.css)；只在设置文档加载 Preflight |
| 图标 | 自绘功能图标 + [OpenAI apps-sdk-ui](https://github.com/openai/apps-sdk-ui) 的 MIT 控件 SVG 子集 | [shared/icons/](ui/shared/icons/) 统一提供 SVG；自绘采用项目许可，第三方保留原许可，不安装整套 SDK UI |
| 动效 | 现有 CSS / Web Animations API | [settings-motion.ts](ui/settings/settings-motion.ts)、[settings-list-motion.ts](ui/settings/settings-list-motion.ts) 与共享工作台动效；目前未引入 Motion |
| 布局与拖拽 | 现有共享工作台实现 | [surfaces/workspace/](ui/surfaces/workspace/) 统一分栏、标签、拖动和阅读状态；目前未引入 react-resizable-panels 或 dnd-kit |
| 设置状态 | React 状态与现有串行保存队列 | [use-settings-form.ts](ui/settings/use-settings-form.ts) 维护草稿、保存和修订冲突；目前未引入 Zustand |

前期方案中的 Lucide、Motion、react-resizable-panels、dnd-kit、Zustand 是候选示例，不代表已安装。实际依赖以 [package.json](package.json) 和锁文件为准；新增能力先检查本表的复用入口。

## 品牌

- 日常名称、窗口标题和正文使用 **Palboo**；Logo 字标使用 **PALBOO**。包名、命令和数据目录继续使用 `palboo`。
- [ui/icon.png](ui/icon.png) 是产品和启动器图标的唯一源图。保留双眼、腮红和原始构图，不反色、不加主题滤镜；安装器由它生成 ICNS。
- [PalbooWordmark](ui/shared/brand.tsx) 是自有融合矢量字标：PALB 保留厚实几何字形和轻微前倾，末尾双 O 直接由图标中的直立圆润双眼构成，两侧保留淡粉腮红。字母与双眼使用 `currentColor` 跟随正文颜色，腮红固定淡粉；无外部字体、图片请求或循环动画。
- 设置页只显示这一融合字标，不再并列独立图标；字标自身为装饰图形，链接保留完整可访问名称。favicon 与启动器继续使用原图标。不要把品牌字形用作普通文本或操作图标。
- 宿主头像与官方菜单不属于品牌修改范围。独立眼睛入口继续使用既有表情和点击行为。

## 颜色与材质

基础语义变量来自 [ui/shared/tokens.css](ui/shared/tokens.css)。设置页在 [settings-layout.css](ui/settings/settings-layout.css) 覆盖取值；工作台从宿主读取自己的语义色。组件引用变量，不另建一套同义颜色。

| 设置语义 | 变量 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 页面 | `--buddy-page` | `#fafafa` | `#19191b` |
| 内容表面 | `--buddy-surface` | `#ffffff` | `#212124` |
| 正文 | `--buddy-text` | `#27272a` | `#eeeeef` |
| 次级文字 | `--buddy-muted` | `#64646e` | `#adadb6` |
| 边界 | `--buddy-border` | `#e2e2e6` | `#36363c` |
| 输入底色 | `--buddy-input` | `#f0f0f3` | `#252528` |
| 次级底色 | `--buddy-subtle` | `#f1f1f2` | `#2c2c30` |
| 焦点 | `--buddy-focus` | `#85858f` | `#9898a3` |
| 强调文字 | `--settings-accent-text` | `#bd4200` | `#ff9a64` |

`--settings-orange: #ff5a00` 用于有限的品牌强调和状态图形；正文、选项、开关和焦点沿用中性色。失败、警告和等待反馈使用现有语义变量，不把橙色当成通用警告色。

输入、下拉框、未选中的选项按钮和描边按钮统一使用柔和灰底；浅色控件边界为 `#e8e8ed`，悬停加深灰阶，聚焦保留细线，选中背景与普通控件区分。开关行只显示功能名，不重复“启用”。

设置页默认跟随宿主明暗，页头允许保存浅色/深色覆盖。工作台、页面浮层、桌面和贴边容器使用 [ui/surfaces/theme/](ui/surfaces/theme/)，只读跟随宿主；black 容器保留纯黑。材质分哑光、磨砂、液态，Regular/Clear 是液态变体；原生与网页各自使用适合承载环境的实现。预览仅作材质近似，不把示意画布的效果复制进真实窗口。

## 字体、间距与尺寸

统一字体由 [ui/shared/typography.ts](ui/shared/typography.ts) 解析。设置页通过 [use-typography.ts](ui/settings/use-typography.ts) 接收快照；功能视图复用同一解析器及祖先缩放补偿。跟随宿主与自定义字号共用一条路径，标题和辅助文字按相对比例排版。

| 对象 | 当前约定 | 源码入口 |
| --- | --- | --- |
| 基础间距 | 4、8、12、16、20px | `--buddy-space-1` 至 `--buddy-space-5` |
| 设置控件 | 高 38px，圆角 4px | `--settings-control-height`、`--settings-control-radius` |
| 动作图形 | 18px，点击区至少 28px | `--buddy-action-icon-size`、`--buddy-action-hit-size` |
| 普通容器控件 | 高 32px，控制圆角 12px | `--buddy-control-height`、`--buddy-radius-control` |
| 独立设置分组 / 预览内边距 | 组间距 24px；全部预览 20px（窄屏 14px） | `.settings-body`、`.preview-frame` |
| 设置预览画布 | 布局场景最大宽 493px，约高 220px | `.layout-demo-scene` |
| 侧栏 / 桌面顶栏 | 16px 留白 / 44px 拖动条 | `ui/surfaces/workspace/styles.css` |

这些尺寸对应不同用途，不能用全局圆角或全局缩放把所有表面强行变成一种形状。设置开关保留现有 6px 轨道 / 4px 滑块圆角与动画。字号偏好不机械放大动作图标或原生窗口。

## 页面与组件

设置页按“界面 → 功能 → 系统”排列，常用开关归界面并排在其首位。641px 起使用左侧目录，641–900px 时侧栏收窄为128px。640px 及以下只显示“分类 / 当前页 ▾”单行入口；展开后按三组直接选页面，每组两列，菜单在视口内滚动，当前页沿用橙色文字。共用一份链接，支持方向键/Home/End、Esc 返回入口、外点及 Tab 离开关闭；跨断点保留可见焦点。所有表单只挂载一份，分类切换隐藏原节点，保留草稿、修订保护和阅读位置。常用配置直接展示；高级设置、模型分组和词库管理使用共用右侧抽屉，不嵌套折叠表单。

导航已经标明当前页，正文不再重复放页面大标题；`main` 保留页面的可访问名称。预览直接显示内容，以区域名称供辅助技术识别，仅在配置未保存或断线时显示必要状态。预览不附带免责声明或操作教学，也不把它们改成小字、弱色或悬停提示；输入区使用正常占位。内容只保留用于区分不同设置组的短标题，不把每一层容器都命名。

| 页面 | 从上到下的阅读顺序（有预览时始终置顶） |
| --- | --- |
| 常用开关 | 功能示例 → 各功能开关 |
| 下一步 | 示例 → 启用与生成时机 → 建议方向 → 显示与操作 |
| 常用提示词 | 示例 → 名称与内容列表 → 添加与保存 |
| 术语释义 | 卡片预览 → 标注、识别与点击行为 → 卡片外观 → 词库搜索、管理、筛选与结果 |
| 任务看板 | 示例 → 启用 → 分组编辑 |
| 模型快切 | 当前模型示意 → 启用与额度显示 → 模型分组入口 |
| Grok Bot | 示例 → 启用与接入入口 → 自动同步 → 按组排列的资料名单 |
| 布局与位置 | 工作空间示例 → 主界面位置与排列 → 各功能位置 → 侧栏显示范围 → 尺寸与置顶 → 贴边位置 |
| 外观 | 工作空间示例 → 各形式材质 → 字体 → 表情操作 |
| 模型服务 | 当前连接概况 → 来源、协议、地址、凭据与模型 → 测试 → 高级设置 |
| 启动与连接 | 真实连接状态 → 当前连接与操作 → 后续启动行为 |
| 性能与开关 | 连接总开关 → 监测开关 → 实际指标 |
| 宿主管理 | 启用 → 实际状态、版本与路径 → 管理操作 |
| 开发来源 | 当前来源与可选来源 → 显式切换操作 |

同一表单中的标签、选择器和输入框共用 `Field` 对齐。功能偏好用开关行，临时列表筛选用复选框；两者保持明确区分。相关操作就近放置：词库管理紧邻词库搜索，导入导出留在管理抽屉，长术语与英文允许自然换行。

所有有效预览位于该页第一组设置之前，外框与控件左右对齐。使用 [PreviewFrame](ui/settings/preview-frame.tsx)；外观与布局复用 [LayoutPreview](ui/settings/layout-preview.tsx) 的工作台内容：布局页保留设备示意，外观页使用正常尺寸材质样本及有明暗层次的背景，术语保留真实卡片示例。宿主管理、性能与开发来源显示实际状态，不增加无关示意。

预览默认紧凑：先去掉隐藏场景占位与重复空白，再限制画布尺寸；不缩小整页字号。专用功能页只由当前场景决定高度，常用开关中的场景切换保留稳定高度与草稿。足够宽时，建议与示例输入并排；窄屏自然换行。演示只改内存，不保存配置、写入真实任务或发送消息。

模型切换预览复用实际 `ModelView`，仅复制目录名称与能力，使用独立示例选择和内存动作适配器；目录未就绪时显示明确命名的示例模型，不把缺少实时当前模型显示成预览故障。布局演示的“上下/左右”使用两个可读分栏，功能不足时补充临时示例，左右演示留出必要宽度；“重置预览”仅清除临时位置、排列和新增示例，不写真实配置。外观页材质保存成功后自动跟随对应位置，失败保留已保存效果。

全部预览共用随主题变化的中性灰底、12px 圆角和统一内边距，与下面的平直表单区分；功能内容与连接概况使用轻阴影圆角面板，布局和术语在同一灰底上保留各自场景与真实卡片材质。建议、目录和输入按内容分区，不套双层描边、不为每条建议画分隔线；悬停和当前选择用中性底色反馈，键盘焦点保留细线。

| 需要的能力 | 复用入口 |
| --- | --- |
| 按钮、图标按钮、输入、选择、开关 | [components/ui/](ui/settings/components/ui/)，本地 shadcn/ui 组件与 Radix 原语 |
| 设置行、开关行、保存反馈 | [settings-controls.tsx](ui/settings/settings-controls.tsx) |
| 右侧抽屉 | [settings-drawer.tsx](ui/settings/settings-drawer.tsx) |
| 危险操作确认 | [settings-confirmation.tsx](ui/settings/settings-confirmation.tsx) |
| 可输入候选 | 现有 `SuggestionInput`，保留原生表单语义 |
| 操作图标 | [shared/icons/](ui/shared/icons/)，OpenAI apps-sdk-ui MIT SVG 子集及原许可 |
| 共享工作台、分栏、标签与拖动 | [surfaces/workspace/](ui/surfaces/workspace/) |
| 真实业务内容 | [features/](ui/features/)，由各承载外壳复用 |

普通图标按钮使用 `IconButton`；操作名称放在 `aria-label`。公共窗口控制不显示来源文字或浏览器原生 `title` 提示；不可用原因和失败反馈仍须可读。顶部窗口按钮保持图形与至少 28px 点击区，键盘聚焦仍显现；工作台的悬停规则不扩散到设置表单。

主工作台、贴边／刘海和设置预览的功能导航统一使用 [自绘图标](ui/shared/icons/features.js)：大纲为章节层级，下一步为简洁水平右箭头，看板为分栏轮廓，模型为双方块与双向箭头，术语为词典，Bot为对话气泡与双眼。采用24×24画布、1.8px圆角描边（Bot双眼2.5px），通过 currentColor 跟随主题；自绘图形遵循项目 GPL-3.0-only，其他控件保留原 MIT 来源。图形18px，点击区28px，间距4px；单击直接切换，选中项用明暗区分，悬停显示功能名称，辅助技术保留名称及动作。主工作台保留拖动分栏／合并、双击放大及原键盘操作；贴边保留拖动及 Alt+左右方向键排序。窄空间自然换行并计入容器高度；Fast、推理强度及模型目录操作始终预留独立空间。

内容层次依靠对齐、文字明暗、尺寸和留白。标签已说明的事情不重复写小字；辅助说明仅保留影响操作、判断或风险的信息。独立操作组默认右对齐，附加图标不得挤偏标题或数值中轴。

## 动效与状态

- 设置分类入场 220ms；功能预览交叉切换 200ms / 4px；列表增删补位 200ms；具体曲线以 [settings-motion.ts](ui/settings/settings-motion.ts)、[settings-list-motion.ts](ui/settings/settings-list-motion.ts) 为准。
- 小菜单统一180ms展开、140ms收起，4px轻移与0.985缩放淡入，箭头同步转向；导航和普通候选从左上、主题从右上、向上候选从左下展开。收起立即禁止交互，保留内容完成退出，连续开关平滑接续。
- 搜索/确认弹窗沿用180ms进入、140ms退出，遮罩同步淡入淡出；右侧抽屉以16px横移进入，220ms进入、160ms退出。查询、确认文字和草稿在退出过程中不闪空。开关保留160ms滑动和轻微按压，抽屉入口箭头悬停轻移2px；原几何、保存和焦点行为不变。
- 鼠标操作保留可中断的轻量反馈；键盘与“减少动态效果”立即响应并取消在途装饰动画。主题、菜单、抽屉等使用现有 [settings-motion.css](ui/settings/settings-motion.css)，不新增动画框架。
- 工作台到原生窗口的交接沿用真实窗口几何与 ready/presented 协议，不以设置预览动画替代。
- 保存反馈依据真实请求结果。隐藏、切页、窗口交接不丢草稿；异步回读不覆盖新编辑；错误与外部修订冲突明确呈现。

## 依赖与维护

当前使用 React、Tailwind v4、本地 shadcn/ui、Radix、自绘功能 SVG 和公开控件 SVG 子集。Tailwind 的全局重置仅在设置文档内，不进入宿主或隔离功能视图。`components.json` 的生成器图标字段不代表已引入 Lucide；新增生成组件须适配现有 `Icon`，不能带入第二套图标包。

优先复用现有组件和成熟依赖。工作台已有共享分栏、拖动和状态协议，新增库须解决明确缺口，并替代重叠实现；不为技术清单同时引入第二套 UI、图标、动效或状态库。组件源代码、许可和依赖范围保持可追踪。

修改前查最近的 `AGENTS.md` 地图。新增公共组件或契约后同步源码头部、模块地图及本文；只改数值时优先修改现有变量。验证实际渲染的对齐、焦点、长内容、窄屏、深浅主题、减少动态效果及草稿保留。默认只读 DOM、状态与窗口几何；没有明确截图请求时，不截图或申请屏幕录制权限。
