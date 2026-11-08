# features/ — 共享主界面

> L2 | 父级：[AGENTS.md](../AGENTS.md)

main_surface::apply_startup 仅由 App::new 调用：沿用上次为旧配置默认；显式收起/打开应用到非贴边主功能，缺失的已启用成员在启动时补登记，关闭业务不重启。打开时选择宿主内或桌面，内沿用原侧栏/浮层，桌面能力不足回到内且保留启动选择。主内容已接管时禁用旧 panel detached，避免两套桌面窗口；保留布局、尺寸和贴边条目。

- `main_surface.rs`：由 features.rs 调用，读取并迁移主界面偏好，通过 window_process 管理归属统一 Palboo.app 的唯一桌面进程与 main lease；全部非贴边功能统一位置，来源快照和全部目标 ready 后整组提交，失败恢复原归属并保留关闭状态；最后一个桌面成员交出后同步回收旧窗口/租约，避免快速重开复用正在退出的进程。按主形式保存经过校验的递归分栏布局，读取兼容旧单轴分组；支持七功能独立成行及可选 collapsed（缺省false且不写出），跨层拒绝重复功能、无效比例和过深布局，布局类型提供语义相等比较用于并发校验，兼容 JSON 整数与浮点比例；提供共享尺寸（内容宽度至少320，原生最小内容320×340且另含24外框；保留旧高度校验）、置顶持久化、统一 Dev 设置入口和锚点请求，不管理任务或模型业务。

[PROTOCOL]: 职责或接口变化时更新本文，并检查父级地图。

features.rs负责主界面接管后的缺失成员补登记，只补开关已开启且无条目的outline/next/prompts/board；旧桌面/旧看板窗口存在、整组交接中或当前系统不支持目标形式时暂不迁移。已有条目的owner/open/布局不改。task_command复用原任务服务，打开看板与功能开关统一接入这一策略。

terms 使用同一主窗口与功能owner，业务读取/操作转 terminology，locate 沿用 owner 与交接互斥校验；有私有词库时为已管理主界面补登记，不重开已关闭条目。

bots 使用现有主界面与 owner，独立 grokbotEnabled 开关控制；已有设置可恢复缺失成员但不重开已关闭条目。元数据读取和填入由 features.rs::bot_view 委托当前 CDP 的 __palbooBots，连接变化拒绝投影；咨询动作保持主聊天输入，latest-reply 为独立只读动作，不要求 composer。

- `bots.rs`：本机 BDK 名单传输与 OS 文件监听；过滤账号槽/roster/侧栏分组/ui-agent-refs 事件，以原有可见读取节奏消费变化，60秒健康兜底；手动模式回收 watcher，首次/显式刷新/动作时读取；停止时回收缓存；校验账号、修订、stale布尔值及 Bot 身份字段，保留有效的过期目录供展示，过期资料仍禁止填入操作，异常目录显示同步失败；可选 sidebar 校验版本、组 ID、置顶位置与可见身份的唯一完整覆盖，兼容旧目录；不消费回复游标。

Bot 的 open-app 动作沿用功能 owner 和开关校验，通过 LaunchServices 按固定 bundle ID 打开 Grok Bot，不接受任意路径或 URL；不依赖 Codex 连接或有效目录，不调用咨询、不改变 stale 状态、不消费回复。

- `layout_presets.rs`：命名主布局预设的保存、覆盖、改名、删除和应用；独立 layoutPresetsRevision 拒绝过期管理请求，应用同时校验 expectedLayout、当前位置、桌面 lease 与功能交接状态。仅修改主布局可见组合和分栏，不改变业务开关/owner/视图或其他形式偏好；主布局及命名预设共用可选 tabPosition，缺省为顶部，left 表示合并后左侧显示。文件保存失败回滚内存，旧配置默认空列表。

main-placement 对相同目标的在途整组交接返回原快照，不新建 owner、不重置超时或草稿；不同目标及其他业务操作继续按原交接互斥和归属校验拒绝。

主窗口 `main-settings` 与独立功能 `settings` 经共享 `settings_navigation` 在 ChatGPT 内打开完整设置及预设目的地，原 lease/owner 校验保留。预设保存/应用/改名/删除同时提供 `config layout` 写入，复用上述事务；CLI 删除及覆盖需确认。

LayoutPreset.scope 兼容旧 all/sidebar/overlay/desktop。新建按主界面位置写入 sidebar 或 overlay；旧 all 缺省视为侧栏，旧 desktop 视为悬浮。应用和覆盖校验归属，名称在组内唯一，改名保留归属。应用只替换当前 placement 对应布局。

- `bot_reply.rs`：显式阅读时从本机当前账号的 transcript.replicas 读取所选 Bot，使用已验证目录的账号摘要、稳定 ID、名称和修订核对身份；校验 schema、roster 最新 entry 标记、消息顺序、回答分段边界和文件一致性。同次 request 的 send-message 正文完整拼接，附件单独标记；缓存缺失、过期或不完整时返回同步提示，不用摘要降级冒充全文。目录轮询不读取聊天，正文不写盘、不记录日志、不访问凭据或调用 BDK check。

sites 是默认关闭的第八个固定功能，开关与目录/网站配置由 web_library 独立保存。读取仅投影网站名称/URL与是否配置库；动作沿 owner 校验交给宿主浏览器，不投影笔记正文。支持已有四种承载与启动/关闭状态恢复。
