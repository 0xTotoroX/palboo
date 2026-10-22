# Palboo 设计系统

这份文档记录仓库当前使用的设计语言与复用入口。界面沿用 Tom Modern 设置页及现有工作台；设计系统由源码中的语义变量、基础组件、共享外壳和交互约定组成。

## 品牌

- 日常名称、窗口标题和正文使用 **Palboo**；Logo 字标使用 **PALBOO**。包名、命令和数据目录继续使用 `palboo`。
- [ui/icon.png](ui/icon.png) 是产品和启动器图标的唯一源图。保留双眼、腮红和原始构图，不反色、不加主题滤镜；安装器由它生成 ICNS。
- [PalbooWordmark](ui/shared/brand.tsx) 是自有矢量字标：厚实几何字形、轻微前倾，双 O 的胶囊形内白呼应眼睛。使用 `currentColor` 跟随正文颜色，无外部字体、图片请求或循环动画。
- 设置页使用原图标与字标的组合；字标自身为装饰图形，链接保留完整可访问名称。不要把品牌字形用作普通文本或操作图标。
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
| 输入底色 | `--buddy-input` | `#ffffff` | `#252528` |
| 次级底色 | `--buddy-subtle` | `#f1f1f2` | `#2c2c30` |
| 焦点 | `--buddy-focus` | `#85858f` | `#9898a3` |
| 强调文字 | `--settings-accent-text` | `#bd4200` | `#ff9a64` |

`--settings-orange: #ff5a00` 用于有限的品牌强调和状态图形；正文、选项、开关和焦点沿用中性色。失败、警告和等待反馈使用现有语义变量，不把橙色当成通用警告色。

设置页默认跟随宿主明暗，页头允许保存浅色/深色覆盖。工作台、页面浮层、桌面和贴边容器使用 [ui/surfaces/theme/](ui/surfaces/theme/)，只读跟随宿主；black 容器保留纯黑。材质分哑光、磨砂、液态，Regular/Clear 是液态变体；原生与网页各自使用适合承载环境的实现。预览仅作材质近似，不把示意画布的效果复制进真实窗口。

## 字体、间距与尺寸

统一字体由 [ui/shared/typography.ts](ui/shared/typography.ts) 解析。设置页通过 [use-typography.ts](ui/settings/use-typography.ts) 接收快照；功能视图复用同一解析器及祖先缩放补偿。跟随宿主与自定义字号共用一条路径，标题和辅助文字按相对比例排版。

| 对象 | 当前约定 | 源码入口 |
| --- | --- | --- |
| 基础间距 | 4、8、12、16、20px | `--buddy-space-1` 至 `--buddy-space-5` |
| 设置控件 | 高 38px，圆角 4px | `--settings-control-height`、`--settings-control-radius` |
| 动作图形 | 18px，点击区至少 28px | `--buddy-action-icon-size`、`--buddy-action-hit-size` |
| 普通容器控件 | 高 32px，控制圆角 12px | `--buddy-control-height`、`--buddy-radius-control` |
| 设置预览标题行 | 最小高 44px | `.preview-heading` |
| 设置预览画布 | 布局场景最大宽 493px，约高 220px | `.layout-demo-scene` |
| 侧栏 / 桌面顶栏 | 16px 留白 / 44px 拖动条 | `ui/surfaces/workspace/styles.css` |

这些尺寸对应不同用途，不能用全局圆角或全局缩放把所有表面强行变成一种形状。设置开关保留现有 6px 轨道 / 4px 滑块圆角与动画。字号偏好不机械放大动作图标或原生窗口。

## 页面与组件

设置页在宽屏使用左侧目录，760px 及以下改为顶部两级导航。所有表单只挂载一份，分类切换隐藏原节点，保留草稿、修订保护和阅读位置。常用配置直接展示；高级设置、模型分组和词库管理使用共用右侧抽屉，不嵌套折叠表单。

所有有效预览位于该页第一组设置之前，外框与控件左右对齐。使用 [PreviewFrame](ui/settings/preview-frame.tsx)；外观与布局共用 [LayoutPreview](ui/settings/layout-preview.tsx)，术语保留真实卡片示例。宿主管理、性能与开发来源显示实际状态，不增加无关示意。

预览默认紧凑：先去掉隐藏场景占位与重复空白，再限制画布尺寸；不缩小整页字号。专用功能页只由当前场景决定高度，常用开关中的场景切换保留稳定高度与草稿。足够宽时，建议与示例输入并排；窄屏自然换行。演示只改内存，不保存配置、写入真实任务或发送消息。

| 需要的能力 | 复用入口 |
| --- | --- |
| 按钮、图标按钮、输入、选择、开关 | [components/ui/](ui/settings/components/ui/)，本地 shadcn/ui 与 Radix 源码 |
| 设置行、开关行、保存反馈 | [settings-controls.tsx](ui/settings/settings-controls.tsx) |
| 右侧抽屉 | [settings-drawer.tsx](ui/settings/settings-drawer.tsx) |
| 危险操作确认 | [settings-confirmation.tsx](ui/settings/settings-confirmation.tsx) |
| 可输入候选 | 现有 `SuggestionInput`，保留原生表单语义 |
| 操作图标 | [shared/icons/](ui/shared/icons/)，OpenAI apps-sdk-ui MIT SVG 子集及原许可 |
| 共享工作台、分栏、标签与拖动 | [surfaces/workspace/](ui/surfaces/workspace/) |
| 真实业务内容 | [features/](ui/features/)，由各承载外壳复用 |

普通图标按钮使用 `IconButton`；操作名称放在 `aria-label`。公共窗口控制不显示来源文字或浏览器原生 `title` 提示；不可用原因和失败反馈仍须可读。顶部窗口按钮保持图形与至少 28px 点击区，键盘聚焦仍显现；工作台的悬停规则不扩散到设置表单。

内容层次依靠对齐、文字明暗、尺寸和留白。标签已说明的事情不重复写小字；辅助说明仅保留影响操作、判断或风险的信息。独立操作组默认右对齐，附加图标不得挤偏标题或数值中轴。

## 动效与状态

- 设置分类入场 220ms；功能预览交叉切换 200ms / 4px；列表增删补位 200ms；具体曲线以 [settings-motion.ts](ui/settings/settings-motion.ts)、[settings-list-motion.ts](ui/settings/settings-list-motion.ts) 为准。
- 鼠标操作保留可中断的轻量反馈；键盘与“减少动态效果”立即响应并取消在途装饰动画。主题、菜单、抽屉等使用现有 [settings-motion.css](ui/settings/settings-motion.css)，不新增动画框架。
- 工作台到原生窗口的交接沿用真实窗口几何与 ready/presented 协议，不以设置预览动画替代。
- 保存反馈依据真实请求结果。隐藏、切页、窗口交接不丢草稿；异步回读不覆盖新编辑；错误与外部修订冲突明确呈现。

## 依赖与维护

当前使用 React、Tailwind v4、本地 shadcn/ui、Radix 和公开 SVG 子集。Tailwind 的全局重置仅在设置文档内，不进入宿主或隔离功能视图。`components.json` 的生成器图标字段不代表已引入 Lucide；新增生成组件须适配现有 `Icon`，不能带入第二套图标包。

优先复用现有组件和成熟依赖。工作台已有共享分栏、拖动和状态协议，新增库须解决明确缺口，并替代重叠实现；不为技术清单同时引入第二套 UI、图标、动效或状态库。组件源代码、许可和依赖范围保持可追踪。

修改前查最近的 `AGENTS.md` 地图。新增公共组件或契约后同步源码头部、模块地图及本文；只改数值时优先修改现有变量。验证实际渲染的对齐、焦点、长内容、窄屏、深浅主题、减少动态效果及草稿保留。默认只读 DOM、状态与窗口几何；没有明确截图请求时，不截图或申请屏幕录制权限。
