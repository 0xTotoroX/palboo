# icons/ — 共享图标

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `features.js`：Palboo 自绘的六个功能图标，使用项目 GPL-3.0-only 许可；24×24 画布、1.8px 圆角描边，Bot 双眼为2.5px，颜色继承 currentColor。
- `index.js`：统一导出自绘功能与第三方控件的静态 SVG，供外壳、工作台、宿主窄入口与窗口控件使用；bolt 对应公开 Bolt.tsx，用于模型快切 Fast。
- `index.d.ts`：共享 SVG 入口的 TypeScript 类型，供独立功能视图复用。
- `LICENSE`：仅适用于 OpenAI 来源控件图标的原始 MIT 许可；分发许可生成器收集原文，自绘 features.js 遵循项目根许可。

第三方控件来源：https://github.com/openai/apps-sdk-ui/tree/0f00143c7a639906f1621fe58e1b6be7b5bea46d/src/components/Icon/svg

第三方控件仅摘取所用图标，去除 React 包装并转换 SVG 属性名；保留路径、24×24 画布和 currentColor。控制图标统一渲染为 18px、按钮命中区域至少 28px；表情属于状态控件，不套用图标尺寸。没有复制本机官方应用资源。

[PROTOCOL]: 图标变更时同步语义映射与固定来源，保留许可原文。

- `react.tsx`：设置和看板共用的React适配，读取共享 --buddy-action-icon-size，缺少样式时回退18px；SVG与外层占位保持同尺寸，不引入第二套图标。新增语义映射：eye→Eye、eye-off→EyeOff、arrow-up→ArrowUp、arrow-down→ArrowDown、trash→Trash、search→Search、warning→ExclamationMarkCircle；均来自上述固定提交。加载动画复用refresh旋转。

window-expand→ExpandMd、window-restore→CollapseSmall，来自同一固定提交；仅供窗口控件，不改变内容面板专注图标。

sparkles→Sparkles，来自同一固定公开提交，供输入框“优化”按钮使用。

prompt-improve→PencilSparkle，同一固定公开提交；提示词优化采用此笔形图标的无填充描边样式，React stroke属性转换为标准SVG属性；保留sparkles资源供兼容。

bookmark / bookmark-filled / check 分别摘取同一固定提交的 SavedXs / SavedFilledXs / Check，保留原路径；SavedXs 的18px源画布等比规范化到24px，控件统一18px，用于术语浮卡收藏与掌握。

grip 使用同一固定提交的 DotsVertical.tsx 路径，分别平移 −4 / +4 组成双列握柄，保持24px画布和18px显示，用于模型列宽拖动。

catalog 摘取同一固定公开提交的 Grid.tsx，四个空心圆表示模型目录，使用原路径及24px画布，以18px显示。

pencil 摘取同一固定公开提交的 Pencil.tsx，原路径和24px画布，用于模型预设统一编辑模式。

bolt-filled 复用同一固定提交 Bolt 的外轮廓路径，去除内轮廓形成实心变体，用于 Fast 开启状态与充电填充；保留来源署名、24px画布及18px显示。

模型预设添加复用 bookmark（SavedXs）书签图标，保持18px图形与28px点击区，不另行放大路径。

theme-auto 摘取上述固定提交的 MoonSunSystem.tsx，日月组合表示“自动”，供设置主题入口使用；保留原路径、24px 画布和 MIT 许可。

功能入口统一使用 feature-outline（层级大纲）、feature-next（水平右箭头）、feature-board（分栏看板）、feature-model（双方块双向切换）、feature-terms（词典）、feature-bots（对话双眼）。主工作台、贴边／刘海及设置预览通过 shared/features 的同一映射取图；旧 outline／next 保留为通用控件，不混入功能映射。

website 为 Palboo 自绘地球；github 复用官网已引入的 Octicons mark-github-24 原几何，许可存于 octicons/LICENSE，完整 App 声明收录。GitHub 标记仅指向仓库，不作为 Palboo 品牌，不暗示合作。
