# config_cli/ — Agent 配置命令

> L2 | 父级：[src/AGENTS.md](../AGENTS.md)

- `../config_cli.rs`：命令路由、局部补丁展开、并发保护、确认和脱敏输出；业务验证由原后台执行。
- `schema.rs`：离线配置域、字段/操作白名单、嵌套结构、枚举与实例；优先从后端序列化类型提取字段。
- `transfer.rs`：只读目录查询、最多 8 MB 的原样术语文件上传、个人术语 JSON/Markdown 导出；输出文件不覆盖，CLI 不调用聊天 Agent。

不创建第二套设置服务，不修改外部环境。新设置同时核对 schema 和隔离 `tests/config-cli.mjs`；字号、材质、Jev、贴边标签局部修改保留同组字段，数组/字典/布局树整体替换。术语写入按操作采用词库或偏好修订，删除/重置需确认。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

settings schema 包含 quickPromptsEnabled 与 quickPromptClickMode；常用语列表、开关、模式沿原设置修订保存，不改变模型服务配置。

appearance schema 保留 settingsStyle（chatgpt/palboo）兼容旧配置，当前设置只读跟随宿主；settingsTheme（codex/light/dark）继续控制明暗。

settingsAccent.source（chatgpt/palboo/custom）与 color（#RRGGBB）仅作旧配置兼容，当前界面不消费；主按钮、开关与选中状态取宿主强调色。

appearance.startup 的 mode（restore/closed/open）与 location（inside/outside）支持局部更新并保留另一字段；仅下次启动应用，保存不搬动当前窗口。

layout 暴露 main-preset-save/apply/update/rename/delete；读取返回 layoutPresets/layoutPresetsRevision，操作携带 expectedRevision，保存/应用同时核对 expectedLayout 与 placement。visible 描述完整布局中的显示组合；预设 id 来自读取结果，move.id 才是功能目录。覆盖和删除需 --confirm，dry-run 不写入，与界面共享同一后台。

layout.scope=all/sidebar/overlay/desktop 是共享预设的推荐标签；save 未传时新建默认 all、覆盖保留旧值，update 支持 name/scope 局部保存。应用允许跨标签，只写当前形式布局；schema 同时暴露枚举、操作字段和示例，config-cli 集成验证旧命令、标记更新、非法标记和覆盖保留。

任务配置同步支持`{"op":"view","viewMode":"merged|expanded"}`，复用任务修订；只保存布局，任务与同步开关保留。

web-library 支持目录授权、网站增删/排序及开关，与设置共用 expectedRevision；catalog vaults 仅读 Obsidian 登记路径，open-website 仅按已保存 ID 在宿主内打开。更换授权及删除条目需 --confirm，schema 离线可查，目录选择器的 CLI 等价操作为 set web-library.vault。
