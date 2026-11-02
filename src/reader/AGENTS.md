# reader/ — 本机只读阅读器

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `files.rs`：唯一源文件读取边界；规范化后检查授权根，通过 O_RDONLY/O_NOFOLLOW 逐层打开目录和常规文件，限制笔记8 MB、图片32 MB，拒绝隐藏文件、链接及特殊文件。
- `index.rs`：按文件元数据增量读取 Markdown，使用 pulldown-cmark 提取真实链接，维护中文可用的全文搜索、路径/名称消歧与反链；索引限128 MB正文，目录限十万文件，跳过的笔记明确计数。索引仅在内存；首次、刷新与网页聚焦时检查源文件。
- `http.rs`：独立127.0.0.1随机端口、独立读凭证、Host/Origin校验和本地静态资源；GET读取catalog/search/note/resolve/image，图片也要求Bearer认证。修改目录使旧凭证失效，后台退出收回listener；不提供源文件写接口或设置权限。
- `tests.rs`：合成库检索、反链/代码排除、同名消歧、增量更新、附件授权、路径/链接/HTTP边界与源文件哈希验证。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
