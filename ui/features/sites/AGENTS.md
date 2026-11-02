# sites/ — 网站与本地阅读入口

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `view.tsx`：搜索和打开已保存网站/Obsidian，临时查询经Reading接续，操作在途禁用并展示失败；不接收笔记正文、凭证或调用模型。样式复用styles.ts。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

- `styles.ts`：SitesView 共用的局部样式字符串，供已有工作台和左栏弹出列表使用；单列左对齐，少于七项且无查询时不显示搜索框。
