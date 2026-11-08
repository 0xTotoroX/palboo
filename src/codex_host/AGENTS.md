# codex_host/ — 独立 CodexHost 管理

> L2 | 父级：[AGENTS.md](../AGENTS.md)

src/codex_host.rs管理Options、安装/运行身份、启停选择、有界冷启动和认证/codex-host API，不进入面板布局或依赖MCP。

认证GET /codex-host/agents按需在当前CDP连接执行ui/codex/codex-host-preview.js，3秒超时；只返回Agent名单、分组、可用性与当前选择，不打开菜单、不写配置、不安装或切换Agent，不依赖模型快切开关。无连接或探针不支持时明确失败，不提供合成状态。

- restart.rs：显式重启的独立协调进程，按开关应用所选安装或停用。复核修订、宿主进程、窗口探针和 Dev 来源，重开后验证运行身份。取消不退出宿主。旧 Dev 记录可从 owner 读取监督 PID，兼容从设置切换模式时与 `launchConnection` 一致的 `--cdp / --target` 固定连接参数，仍核对准确命令、当前占用和 sourceEpoch。
- controller.rs：项目内维护已验证的调试源码缓存/重复安装修复。对 0.17.1 起的官方控制器校验已知结构，仅在 Palboo 自有 `palboo/codex-host-controllers/` 缓存生成控制器及所需 Renderer 副本，经 Node 语法检查后通过上游 `--desktop-controller` 加载；控制器从经验证的缓存 Renderer 路径读取，不改官方文件；目录绑定官方文件规范路径和修复内容哈希。启动、安装更新与回退共用准备；新版本结构不兼容时不改变所选版本，已识别上游修复后不生成副本。运行识别支持同一官方安装的旧修复副本继续工作，不接管其他安装，不热换活动控制器。
- renderer.rs：对已验证的 0.17.1/0.17.2 Renderer 形状修正只读探针的控件ID，使用同一 mounted composer 的实际 DOM control.composerId，保留真实 Agent/锁定状态；0.17.1 原生模型识别补齐新版 onCommitPower/powerSelections 回调，0.17.2 已有实现沿用；未知或重复结构拒绝，不改变模型、权限或发送行为。
- controller_tests.rs：合成控制器及 Renderer 的结构校验、幂等、双文件缓存/更新隔离、损坏修复与失败保留，以及 VM 中的所有权重验、延迟挂载和 document 重载；显式 ignored 用例只验证指定本机官方文件，不启动宿主。
- update.rs：官方 Release 查询、启动提醒、私有指定版本安装与校验，以及历史版本清理。启动（不受启用及启动检查开关影响）、安装成功或失败、恢复后清理私有版本目录，只保留已选版本、一个回退版本及活动进程使用的版本；进程读取失败则跳过清理并记录警告，下次启动或安装/恢复时重试。不清理外部安装、符号链接及临时安装目录。重复安装当前版本不覆盖回退记录。后台启动时对已启用且已安装的 CodexHost 检查一次，默认有新版时提醒，可关闭或静默安装。静默安装选择下次启动版本，不重启宿主、不覆盖全局安装。显式重开入口遇到本数据目录管理的旧进程时，按宿主重开策略退出，等待旧控制器结束后应用所选安装。适配最低基线 0.10.2 与本机安装版本分开记录。
- macOS 上 0.17.0 起且 Desktop 提供内置 Node 时，由上游启动器选择官方签名运行时；其余组合保留系统 Node 启动路径。

开关只保存意愿；启用/停用通过现有启动策略及显式操作，普通会话不能被上游launcher隐式接管。codexHost、revision、previousExecutable和运行记录名保持兼容。

遵循根目录的外部环境约定：官方分发包保持原样，上述内存与界面兼容修复由 Palboo 自有缓存承担，不修改 Agent CLI、模型或登录配置，不安装模型别名、启动包装或协议转换。

[PROTOCOL]: 成员或接口变化时同步本文及父级地图。
