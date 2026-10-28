# config_cli/ — Agent 配置命令

> L2 | 父级：[src/AGENTS.md](../AGENTS.md)

- `../config_cli.rs`：命令路由、局部补丁展开、并发保护、确认和脱敏输出；业务验证由原后台执行。
- `schema.rs`：离线配置域、字段/操作白名单、嵌套结构、枚举与实例；优先从后端序列化类型提取字段。
- `transfer.rs`：只读目录查询、最多 8 MB 的原样术语文件上传、个人术语 JSON/Markdown 导出；输出文件不覆盖，CLI 不调用聊天 Agent。

不创建第二套设置服务，不修改外部环境。新设置同时核对 schema 和隔离 `tests/config-cli.mjs`；字号、材质、Jev、贴边标签局部修改保留同组字段，数组/字典/布局树整体替换。术语写入按操作采用词库或偏好修订，删除/重置需确认。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

settings schema 包含 quickPromptsEnabled 与 quickPromptClickMode；常用语列表、开关、模式沿原设置修订保存，不改变模型服务配置。
