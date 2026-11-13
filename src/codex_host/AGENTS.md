# codex_host/ — 独立 CodexHost 管理

> L2 | 父级：[AGENTS.md](../AGENTS.md)

src/codex_host.rs管理Options、安装/运行身份、启停选择、有界冷启动和认证/codex-host API，不进入面板布局或依赖MCP。启动前只读核验启动器、映射锁持有者与控制端口；活动控制器、损坏或身份不明时保留并报错。shared_host.rs 识别属于所选安装的共享后台；0.18 直启仅复用仍属于同一桌面祖先的实例，独立/外部后台保留并拒绝接管。0.18 系列由 Palboo 经 LaunchServices 直接打开 Codex，并协调官方 Shim/Host/Controller；其他版本沿用官方 launcher 路径。保留活动的旧 launcher 会话，不隐式重开。没有与上游共享的互斥时不删除其记录；不依据命令行子串终止进程。

认证GET /codex-host/agents按需在当前CDP连接执行ui/codex/codex-host-preview.js，3秒超时；只返回Agent名单、分组、可用性与当前选择，不打开菜单、不写配置、不安装或切换Agent，不依赖模型快切开关。无连接或探针不支持时明确失败，不提供合成状态。

- direct.rs：0.18 直启资源与私有请求、运行记录及恢复入口；固定每次会话的 Palboo CLI 副本，避免 App 原子更新/Dev 二进制替换改变原生身份。协调子进程由当前调用方的原生父子身份授权，跨热更存续；进程身份保存在 palboo-launcher/codex-host-session.json，自有副本正常退出时移除。兼容既有 codex-host-owned.json，运行版本取实际安装。恢复只接受本 Palboo 原会话，不重开原 Codex、不假写官方 descriptor 或 launcher PID。
- direct_session.rs：LaunchServices 进程级环境交接及官方 Controller 监督，持有自有及官方 launcher 互斥。Controller 只在本宿主 Shim 链和真实祖先内的共享 Host 就绪后启动，真正就绪还须 installed Controller 及 CDP 页面。准备失败转入 native 状态：不启动或停止原 Controller，释放官方锁并继续跟随原生桌面，不把回退当兼容成功；direct/lifecycle 可重连此原生端点，状态 API 使用原错误字段说明。Controller 退出后重连，宿主原生身份连续消失才清理。协调异常后停止自己创建的 Controller，保留 Codex 供重新打开 Palboo 恢复；宿主已退出时释放官方锁，再由 Lease 双锁重验并关闭共享 Host，不终止外部或并发替换实例。
- native_cli.rs：0.18 直启的私有 CLI 交接，使用与协调进程独立的固定二进制及0600记录；只有显式交接、精确父进程路径/调试端点、桌面 originator 和主 app-server 参数同时匹配才 exec 官方 Shim。原生工具缺失交接环境时，仅从自身所属的私有 UUID 会话目录读取相邻记录并核验所有者、权限和入口身份，始终 exec 官方 CLI，不搜索其他配置。辅助调用清除 CODEXHOST_*、CODEX_CLI_PATH 及私有入口标记，保留原生其他环境和进程语义。未知调用保留原生行为；恢复原会话沿用入口，桌面退出后才清理。不伪造官方 launcher 身份，不修改官方文件或协议。

Desktop 派生的 `CODEX_APP_RUNTIME_CLI_PATH` 若仍指向本次 Palboo 私有入口，在主 Shim、辅助 stock 及提前启动的前台 Host 交接时均改为官方 stock CLI；否则移除私有上下文后会再次把辅助调用送入普通 Palboo。原本已指向其他原生运行时的合法别名保持不变。

主服务识别须检查完整参数，只接受已核实的 app-server、analytics 和配置选项；启动配置读取/登出、帮助、版本及未知调用直接走官方 CLI。Desktop 的 `--print-startup-config` 短任务同样带有 app-server 与 analytics，不能据此前缀启动共享 Host，否则短任务退出会断开桌面祖先关系。
- native_host.rs：主 CLI 在原 PID exec Shim 前，以官方 `host serve` 前台入口准备共享 Host，保留当前桌面的真实祖先关系；先取官方生命周期锁，只复用同安装且仍属于当前桌面的 Host。独立/外部实例不停止、不接管；准备失败由 native_cli 清除兼容环境后 exec 官方 CLI，写入0600 compatibility-error.json 的错误、桌面身份及最多12级 Host 祖先（无凭据/正文），同一会话保持原生回退。失败或 exec 失败只向本次精确身份的子进程发 SIGTERM，不升级强杀。官方管道的祖先和代码签名校验不变，不做管道转发。direct 的 installed 与协调就绪门控均复核 Host 的真实桌面祖先。
- direct_session_tests.rs 与 tests/direct-session-fixture.swift/mjs：显式原生隔离验收，覆盖启动门控、修订/锁竞争、原宿主不接管、Controller 恢复、协调丢失恢复、无页面保留和正常退出。真实用户聊天冷启动另验，不启动第二个真实 ChatGPT。
- readiness.rs：App 成功前检查 0.18+ Controller 的 installed 状态；直启还要求协调就绪。核对私有文件、原生 PID/启动时间/父进程和控制端口，拒绝旧记录及仅 compatible 的中间状态。有界等待失败保留当前会话，不重开宿主。
- restart.rs：显式重启的独立协调进程，按开关应用所选安装或停用。复核修订、宿主进程、窗口探针和 Dev 来源，重开后验证运行身份。取消不退出宿主。旧 Dev 记录可从 owner 读取监督 PID，兼容从设置切换模式时与 `launchConnection` 一致的 `--cdp / --target` 固定连接参数，仍核对准确命令、当前占用和 sourceEpoch。
- shared_host.rs：冷启动只读核验 0.18+ 共享后台；映射锁 PID 必须与官方就绪记录一致，并核对 macOS 微秒级进程启动时间、原生程序路径及所选安装的 runtime 精确路径和版本（不接受 runtime 别名）。仅放行同安装正常持锁，旧版、缺失/损坏记录、PID 复用或其他安装继续拒绝；冷启动不停止后台或改写上游文件。关联退出时只捕获已由 Palboo 管理的实际运行安装，保存共享后台、监督进程和私有控制通道；在官方 launcher/shared-host 两把互斥内重验进程、通道、监听端口和宿主退出状态，经固定原通道的认证 `/v1/shutdown` 正常退出并等待监督进程；不选择最新通道、不全局 stop、不强杀。桌面 launch 显式设置官方 CODEXHOST_WEB_SERVICE=0，不顺带启动或替换 Web 后台。
- controller.rs：项目内维护已验证的调试源码缓存/重复安装修复。对 0.17.1 起的官方控制器校验已知结构，仅在 Palboo 自有 `palboo/codex-host-controllers/` 缓存生成控制器及所需 Renderer 副本，经 Node 语法检查后通过上游 `--desktop-controller` 加载；控制器从经验证的缓存 Renderer 路径读取，不改官方文件；目录绑定官方文件规范路径和修复内容哈希。启动、安装更新与回退共用准备；新版本结构不兼容时不改变所选版本，已识别上游修复后不生成副本。运行识别支持同一官方安装的旧修复副本继续工作，不接管其他安装，不热换活动控制器。
- renderer.rs：对已验证的 0.17.1/0.17.2 Renderer 形状修正只读探针的控件ID，使用同一 mounted composer 的实际 DOM control.composerId，保留真实 Agent/锁定状态；0.17.1 原生模型识别补齐新版 onCommitPower/powerSelections 回调，0.17.2 已有实现沿用；未知或重复结构拒绝，不改变模型、权限或发送行为。
- controller_tests.rs：合成控制器及 Renderer 的结构校验、幂等、双文件缓存/更新隔离、损坏修复与失败保留，以及 VM 中的所有权重验、延迟挂载和 document 重载；显式 ignored 用例只验证指定本机官方文件，不启动宿主。
- update.rs：官方 Release 查询、启动提醒、私有指定版本安装与校验，以及历史版本清理。启动（不受启用及启动检查开关影响）、安装成功或失败、恢复后清理私有版本目录，只保留已选版本、一个回退版本及活动进程使用的版本；进程读取失败则跳过清理并记录警告，下次启动或安装/恢复时重试。不清理外部安装、符号链接及临时安装目录。重复安装当前版本不覆盖回退记录。后台启动时对已启用且已安装的 CodexHost 检查一次，默认有新版时提醒，可关闭或静默安装。静默安装选择下次启动版本，不重启宿主、不覆盖全局安装。显式重开入口遇到本数据目录管理的旧进程时，按宿主重开策略退出，等待旧控制器结束后应用所选安装。适配最低基线 0.10.2 与本机安装版本分开记录。
- macOS 上 0.17.0 起且 Desktop 提供内置 Node 时使用官方签名运行时；0.18 由 Palboo 选择同一路径，其余版本交给上游启动器。没有内置 Node 时保留系统 Node 启动路径。

开关只保存意愿；启用/停用通过现有启动策略及显式操作，普通会话不能被上游launcher隐式接管。`managed_by` 的开发模式可从监督进程传入的原启动归属记录核验实际 PID/安装，跨来源交接不复制运行记录；正式构建忽略该开发路径。codexHost、revision、previousExecutable和运行记录名保持兼容。

遵循根目录的外部环境约定：官方分发包保持原样，上述内存与界面兼容修复由 Palboo 自有缓存承担；直启私有入口仅区分桌面主服务与原生工具，不修改 Agent CLI、模型或登录配置，不安装供应商 CLI 包装、模型别名或协议转换。

[PROTOCOL]: 成员或接口变化时同步本文及父级地图。
