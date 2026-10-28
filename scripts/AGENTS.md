# scripts/ — 开发与分发工具

> L2 | 父级：[AGENTS.md](../AGENTS.md)

Dev 后台启动接受 performance.integrationEnabled=false 的暂停状态，不等待宿主注入；重新唤起入口时保留暂停，不自动 connect。日常 App 检测暂停后只打开设置，不请求弹出窗口。暂停的 Dev 只复用现有可调试宿主，缺失时明确停止启动，不委托宿主重开。稳定设置服务继续提供恢复开关，`npm run dev:settings` 可打开。脚本升级后正常重开一次 Dev 会话，保持原 Codex 进程与目标。

npm 命令进入开发、构建、审计、安装和验证编排工具；具体测试实现与辅助文件位于 [tests/](../tests/AGENTS.md)。源码安装器生成的 macOS applet 调用已安装 CLI；DMG 内的完整 App 使用 Swift 入口与包内 CLI，二者运行时均不依赖 Node。独立 Dev applet 依赖本地源码和开发工具。默认检查与打包只读取仓库及已安装依赖，不安装或启动用户宿主。

成员清单：

- [dev-dock.mjs](dev-dock.mjs)：install:dev 安装成功后，将当前用户已固定的旧/新 Dev 图标原位指向 /Applications/Palboo Dev.app，丢弃旧文件书签并合并重复项；不自动新增图标，其他 Dock 项和偏好保留。修改前在 Codex-Archive/backups 保存私有恢复副本，通过 Foundation 偏好服务写入并回读后仅刷新 Dock，不退出宿主。

- [dev-launcher.mjs](dev-launcher.mjs)：install:dev 生成独立 Palboo Dev.app，首次后台执行带 --restart-running 的开发流程，日志写入 launcher.log；按开发配置（首次回退日常配置）的策略准备无连接宿主；重复打开按 session 中所选来源唤起工作台，dev:settings 打开固定开发设置地址；失联重连原目标，失败显式提示，并发启动的失败记录不干扰已取得占用的会话；--stop 校验进程身份后正常退出后台会话。Applet 启动期间显示 Dock 图标，唤起响应中的失效窗口 PID 回到后台重查，AppKit 目标注册最多等待 2 秒，经协作交接焦点后退出；连接成功后的目标缺失与前台切换失败仅发系统通知，通知异常不升级为弹窗；不更新日常安装，复用 launcher 的图标生成。
- [dev.mjs](dev.mjs)：真实 Codex 开发入口，管理独立后台、源码监听和编译失败回退，独立模型控制资源变化随原生后台重建；持有宿主目标与所选 worktree 租约，先绑定统一设置服务地址再传给开发后台齿轮，每个来源独立 Vite 缓存并去重 React；先编译后交接来源、失败回退，切换 Vite/监听/后台而不重启宿主；启动前先发现可调试宿主；显式 --restart-running 时先构建当前 CLI，再通过 host-only 模式准备宿主，仅在接管安装版后启用退出恢复，含占用获取和初始化在内的失败原因与进程 ID 写入私有 launcher-error.json，退出只清理本次会话记录；Ctrl+C 清理自身进程并恢复安装版连接。
- [material-preview.mjs](material-preview.mjs)：`dev:materials` 入口，将 Swift 对照工具编译到 target/material-preview 后打开；`--check` 验证同步控制，`--package` 在 dist/material-preview 生成自带程序和 GPL-3.0-only 完整许可包的独立 App，并输出 ZIP；source/ 同时导出源码、独立构建入口和说明，可脱离主仓库二次开发；不修改安装版或产品偏好。
- [material-preview.swift](material-preview.swift)：14 种 NSVisualEffectView 材质的原生并排对照；独立背景窗口提供重复图案，统一切换外观、焦点状态与背景，支持真实桌面采样；标题栏固定不透明底色并跟随预览明暗。
- [dev-host.mjs](dev-host.mjs)：选择真实窗口与宿主启动配置（开发优先、首次继承日常），仅无宿主且显式授权自动准备时调用共享启动器，指定目标或歧义不触发重开；首次复制独立开发配置，暂停并恢复安装版连接；新目标已发现且旧目标不可用，或安装版 API 不可达且其原 PID 明确退出时，将旧恢复记录原样保留为带唯一后缀的归档，不启动安装版或将它改连新聊天；API 失败但进程存活、身份缺失或无法确认退出时仍保留并停止，不将断连当成退出；退出清理没有新宿主时不归档；API 错误保留后端原因；不创建浏览器或修改官方应用。
- [dev-panel.mjs](dev-panel.mjs)：原子发布开发资源快照（含术语目录指纹与监听），CSS 更新保留实例，逻辑更新销毁并恢复胶囊，页面引导变化重载窗口页面；共享 measurePanel 仅采集两端几何、材质能力和实例计数。
- [dev-sources.mjs](dev-sources.mjs)：Git worktree 清单及启动来源记忆、独占进程/目标租约、串行切换和失败回退状态；通过独占恢复记录串行回收已退出监督进程的租约，检查关联 worktree 与上次会话的后台，损坏记录或状态不明时保留并报错；不自行操作宿主或结束其他进程。
- [dev-runtime.mjs](dev-runtime.mjs)：受控子进程与稳定鉴权代理，开发来源 API 在后台切换时仍可用，切换中请求暂停、旧设置页写入按来源标识拒绝；可捕获宿主准备命令的端点及具体失败原因；后台重启后设置页会话保持有效；模型超时由后台控制，客户端断开时取消上游代理请求。
- [verify.mjs](verify.mjs)：统一检查、工作台/模型控制浏览器行为、构建、模型控制 HTTP/CDP 链路、端到端与生命周期验收；先按源码/工具链摘要准备当前网页与程序，release 自动加入路径映射并将最终编译参数与审计器计入缓存身份；再运行读取 target/web 的浏览器用例，排除 Markdown 与 Finder 的 .DS_Store；原生检查显式选择。
- [verify-web.mjs](verify-web.mjs)：`npm run verify:web` 执行前端构建、格式/源码检查、Node 测试和合成工作台/液态/模型宿主测试，逐项记录失败并返回非零；支持两种现有浏览器路径变量，Linux 优先复用系统 Chromium。结果位于 `target/reports/web-pilot/`，明确排除原生与完整发布验收；Node 许可集成测试仍需 Cargo，不因缺失而跳过。

- [build-panel.mjs](build-panel.mjs)：从 ui/codex/runtime/lifecycle.js 入口解析 ES modules，输出可重复注入的脚本，供 Cargo 内嵌。
- [install.mjs](install.mjs)：源码安装入口，不修改 shell PATH；本地 CLI / .app 启动器安装、旧默认数据目录迁移、旧程序保留和服务恢复；App 默认位于 /Applications。
- [launcher.mjs](launcher.mjs)：为安装器生成带本地签名的 Palboo.app；从 ui/icon.png 生成多尺寸 ICNS 并绑定应用图标；双击调用 launch --restart-running 按设置处理缺少连接的宿主，取消不再弹错误；连接后在受支持系统弹出，以后台应用方式运行、不显示运行中的 Dock 图标；macOS 14 遇到浮窗门槛时保留内嵌，其他错误用系统对话框显示。
- [package.mjs](package.mjs)：本地/CI 共用打包入口；补丁版本在编译前退出，X.Y.0 构建并审计 release、收集完整许可与中英文 `INSTALL.txt`，再以临时目录组装 App/DMG，全部检查通过后原子写入 dist。只输出 DMG，证据在 target/reports/package.json，不安装、不发布、不清理历史发行包。GitHub 标签源码必须与发布程序精确修订对应。
- [release-plan.mjs](release-plan.mjs)：严格解析 SemVer，统一 X.Y.0 的 DMG 计划、补丁无附件和预发布状态；CI 核对标签、Cargo/npm及锁文件版本、已审核说明，不接触远端。
- [artifact-audit.mjs](artifact-audit.mjs)：release 编译路径映射及成品字节扫描，包含二进制、常见凭据/个人目录、UTF-16主目录与禁止文件；错误只输出文件和问题类型。它是有限检查，不证明不存在所有敏感内容或漏洞。
- [package-app.mjs](package-app.mjs)：编译最低 macOS 14 arm64 Swift 入口、复制包内 CLI/资源、清理扩展属性与本地签名；校验系统动态库、最低版本和程序摘要，以普通用户权限创建 HFS+ DMG，避免 tar 的属主名称字段和设置 root 引发的授权；挂载读回并复制到新位置验证，成功后卸载镜像。
- [app-launcher.swift](app-launcher.swift)：通过 Bundle 定位同目录 CLI，不固化主目录或数据目录；双击沿用 launch/popout、暂停、取消和旧系统行为；只读镜像提示先复制，--check 不连接宿主或写配置。LAUNCHER_TEST 为编译期合成测试入口，正式 App 不含该分支。
- [project-licenses.mjs](project-licenses.mjs)：验证完整 GPL 原文、历史 MIT 原文及授权范围，并为主程序与独立材质工具复制统一许可包。
- [source-audit.mjs](source-audit.mjs)：Git 与无 Git 源码目录共用文件清单，供审计、打包和测试复用；无 Git 时排除构建目录，拒绝私有文件与符号链接。核对包名、固定 GPL-3.0-only 元数据、完整许可与历史原文，并拒绝历史排除的上游诊断标记、私有文档、运行配置、凭据和个人绝对路径。
- [license-texts.json](license-texts.json)：依赖包未附带的公开许可、署名原文与固定来源 URL，供许可生成器离线使用。
- [third-party-notices.mjs](third-party-notices.mjs)：collectLicenseFiles 递归收集包内许可与署名；generateNotices 合入固定补充与本地 shadcn/ui、OpenAI apps-sdk-ui 图标及 Model Deck 宿主适配许可并生成 THIRD_PARTY_NOTICES.md 和 dependencies.json，保留相对路径，只合并相同原文。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

内嵌液态：build-panel 在正式与开发构建中追加 ui/surfaces/theme/glass/lab.js，且只在非弹出页面启动；dev-panel 的只读测量记录实际渲染路径和阶段，不记录画面或错误文本。SVG 无第三方渲染依赖；third-party-notices 继续收集现用依赖及 shadcn/ui、OpenAI apps-sdk-ui 图标的许可。

任务看板由现有 Vite 多入口和 RustEmbed 随程序分发。verify 运行 board.mjs；提醒事项原生辅助 App 按需由程序在自身数据目录创建，不要求安装额外 CLI 或模型服务。

胶囊 bundle 包含共用功能内容；build-panel 使用现有 React JSX 转换和隔离样式。dev-panel 将 ui/features 的内容 CSS 与 ui/surfaces/workspace 的隔离挂载计入逻辑指纹，dev 监听 ui/codex、ui/features、ui/surfaces、ui/shared；外壳 CSS 可原位更新。

build/dev 追踪功能内容、容器和 Codex 适配的实际依赖；verify 纳入独立功能的真实 HTTP/CDP 验收，原生窗口另选 features-e2e --native。

Dev 控制器使用所选源码的 dev-panel 构建器，监听看板和通用功能视图；不能以控制器自身较旧的资源指纹确认新分支。构建脚本自身更新后须正常重启 Dev 监督进程。

开发快照从 ui/surfaces/main.ts 构建 feature.html/feature-dev.js；独立桌面和贴边以独立功能修订号检测更新，保存全部视图草稿后重载，忙碌/交接/分栏拖动时延期。development 几何回读区分宿主与桌面/贴边，不读取卡片标题或聊天正文。

Dev 来源识别和原生资源输入兼容新旧源码布局；旧路径仅作为历史 worktree 回退。升级目录布局时使用新版监督脚本正常重开，分别核对嵌入与实际存在的原生窗口资源修订号；没有活动窗口的旧遥测不代表当前已加载。

CodexHost接续：findDevelopmentHost仅在选择启用、显式restart-running且未指定其他连接时委托当前源码CLI。dev.mjs记录supervisorPid、监听CodexHost兼容脚本构建；重启停用兼容旧owner记录。开发编排脚本更新在下次正常打开Dev入口使用。

Dev生命周期修复：App入口串行openDevelopment、校验监督进程就绪，确认旧宿主退出后才清理旧Dev并启动一个替代；日志追加保留故障。dev-host按PID/启动时间/路径观察退出，连续缺失才清理，读取异常保留；dev.mjs在exit-with-host下调用统一且幂等的cleanup，回收后台、监听器和归属，终端默认不启用。脚本升级须正常停止现有Dev后台后重新打开入口，新会话生效。

startBackgroundDevelopment可显式传入现有connection(endpoint/targetId)进行无宿主重启的接续；参数通过本机端点/窗口ID校验，以--cdp/--target固定目标。session.launchConnection用于stop校验完整进程参数，仍核对owner PID/nonce。CodexHost已选择但待启用时可用此路径重开Dev，不覆盖用户开关或隐式应用宿主重启。

npm run check 将 Node 测试并发固定为 4；verify 沿用该入口，所有用例与后续工作台、Rust、端到端和生命周期检查保持。

Dev 租约先在同目录写完整私有临时文件，再通过独占硬链接原子发布；正常领取与失效恢复共用该方式，冲突不覆盖既有记录。并发读取只会看到完整 JSON 或记录不存在；损坏、活动及无法确认退出的旧记录仍保留并拒绝接管。

开发原生功能回读在现有 800ms 周期记录模型行数/滚动范围、底部按钮/预设矩形和原生显示器几何；仅传递有界数字，不读取正文或预设文字。

独立功能资源修订同时覆盖业务 bundle 和开发回读客户端；仅回读脚本改变也触发保存草稿后的页面更新，避免运行旧诊断代码。

verify 追加 config-cli.mjs，以隔离真实后台验证配置命令与数据保留；不访问用户后台或提醒事项。

- `brand.mjs`：当前/旧环境变量兼容，新变量优先；按所选源码包名选择旧或新可执行文件，兼容未迁移 worktree。install 在已核验的旧程序正常停止后调用新程序的本地 schema 路径执行数据迁移；新 CLI 与启动器成功后归档旧启动器和程序，并建立旧命令别名。

开发目标独占记录保留原 codex-buddy 缓存命名空间，确保旧源码 worktree 和 Palboo 共享同一把锁；它不属于产品显示名。

发布流程在完整验证、打包及建立草稿后停止，公开须由用户审阅具体说明与附件后单独授权；历史版本仅准备标题和说明修订，安装附件与标签保持。Dev 监督进程将 dev-sources.js 打包为独立 IIFE，再注入跨来源的稳定设置页面；先完成运行中后台与宿主发现检查，保持原有失败边界。原生 App 启动器读取已保存界面语言，缺省按系统语言显示错误与按钮。

dev-host 暂停安装版前将原先打开的 edge 功能 ID 写入恢复记录，以 owner 校验关闭；停止 Dev 后仅在原连接 reveal 原功能，保留关闭/位置/业务偏好，不把已关闭功能一起打开。涉及 edge 的在途交接阻止接管；恢复须等功能 ready 后才删除记录，失败或异常中断保留恢复记录。
