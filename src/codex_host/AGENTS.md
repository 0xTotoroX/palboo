# codex_host/ — 独立 CodexHost 管理

> L2 | 父级：[AGENTS.md](../AGENTS.md)

src/codex_host.rs管理Options、安装/运行身份、启停选择、有界冷启动和认证/codex-host API，不进入面板布局或依赖MCP。

认证GET /codex-host/agents按需在当前CDP连接执行ui/codex/codex-host-preview.js，3秒超时；只返回Agent名单、分组、可用性与当前选择，不打开菜单、不写配置、不安装或切换Agent，不依赖模型快切开关。无连接或探针不支持时明确失败，不提供合成状态。

- restart.rs：显式重启停用的独立协调进程；复核修订、宿主进程、窗口探针和Dev来源。取消不退出宿主。旧Dev记录可从owner读取监督PID，仍核对准确命令、当前占用和sourceEpoch。
- update.rs：官方 Release 查询、启动提醒、私有指定版本安装与校验，保留前版本。后台启动时对已启用且已安装的 CodexHost 检查一次，默认有新版时提醒，可关闭或静默安装。静默安装选择下次启动版本，不重启宿主、不覆盖全局安装。显式重开入口遇到本数据目录管理的旧进程时，按宿主重开策略退出，等待旧控制器结束后应用所选安装。适配最低基线 0.10.2 与本机安装版本分开记录。
- macOS 上 0.17.0 起且 Desktop 提供内置 Node 时，由上游启动器选择官方签名运行时；其余组合保留系统 Node 启动路径。

开关只保存意愿；启用/停用通过现有启动策略及显式操作，普通会话不能被上游launcher隐式接管。codexHost、revision、previousExecutable和运行记录名保持兼容。

遵循根目录的外部环境原样接入约定：本模块只管理官方分发包、启动与 Palboo 连接，不修改上游程序、Agent CLI、模型或登录配置，不安装模型别名、启动包装或协议转换。

[PROTOCOL]: 成员或接口变化时同步本文及父级地图。
