# reader/ — 独立阅读网页

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

- `api.ts`：仅读取reader fragment与本标签页sessionStorage；立即移除URL凭证，GET请求附独立Bearer，不访问设置页token。
- `main.tsx`：目录/搜索/正文、候选选择、反链、文章目录、历史与会话阅读位置；取消过期搜索/笔记请求，刷新和聚焦读取变更；主题只消费宿主外观快照。
- `markdown.tsx`：react-markdown/remark-gfm与wiki AST转换；忽略原始HTML，支持别名、标题/段落锚点和callout；认证fetch图片后使用可回收Blob，远端图片仅显式点击后加载。笔记嵌入显示链接，不执行Obsidian插件。
- `tree.tsx`：图标目录披露、自然排序与笔记按钮，关闭目录不挂载子节点。
- `style.css`：独立阅读排版与窄屏目录切换，颜色沿用宿主语义/系统回退，不向宿主注入样式。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

目录使用共享轻量文件夹/文档图标，开合仅改变图标状态并保留原生键盘披露；每层文件夹优先，下划线前缀优先，数字自然排序。正文已有一级标题时不重复绘制文件名大标题。
