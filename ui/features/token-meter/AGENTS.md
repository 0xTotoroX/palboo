# ui/features/token-meter/ — 可插拔测速内容

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `view.tsx`：只消费可选 TokenMeterSnapshot，仅显示估算速度或当前状态，官方输出量只在详情中显示；空闲显示破折号，null/停用时不占位置。详细计数在 title/无障碍说明。自身没有采集、请求、定时器或持久状态。
- `styles.css`：与组件一起挂载/卸载的独立样式，支持 Shadow DOM；使用承载方语义颜色，字号继承承载插槽（模型底栏为14px辅助字号），保持数字等宽、左对齐和窄屏换行。

采集归 ui/codex/token-meter.js，契约归 ui/shared/token-meter.ts。features/content.tsx 将本组件插入 ModelView 可选 footer，不让模型快切依赖测速实现；不增加 FeatureId、插件注册器或新承载形式。断线时组合层移除旧快照。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
