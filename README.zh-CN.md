<div align="center">
  <img src="ui/icon.png" alt="Palboo 图标" width="120" />
  <h1>Palboo</h1>
  <p><strong>让对话，多一维度。</strong></p>
  <p>你的 Codex 桌面搭档：读懂回答，推进想法，把工具留在手边。</p>
</div>

[English](README.md) · **简体中文**

[下载](https://github.com/0xTotoroX/palboo/releases) · [反馈问题](https://github.com/0xTotoroX/palboo/issues)

Palboo 把下一步建议、回答大纲、术语、任务与模型控制放在 Codex 对话旁。可以放在侧栏、叠在页面上、移到桌面，也可以放在贴边或刘海面板中。

## 安装

**需要运行 macOS 14 或更高版本的 Apple Silicon Mac，以及 Codex / ChatGPT 桌面 App。** 桌面浮窗需要 macOS 15 或更高版本，原生液态材质需要 macOS 26。目前不支持 Windows 和 Intel Mac。

1. 从 [GitHub Releases](https://github.com/0xTotoroX/palboo/releases) 下载 DMG。
2. 打开 DMG，把 **Palboo** 拖进「**应用程序**」。
3. 打开 Palboo。如果需要重开 Codex 才能建立连接，Palboo 会先询问。

DMG 包含完整 App。安装和日常使用不需要终端指令、Node.js 或 Rust。可选 Agent 和模型服务沿用你已有的安装与账号。

<details>
<summary>首次打开遇到问题</summary>

如果 macOS 阻止打开，请先确认安装包来自本仓库，再到「**系统设置 → 隐私与安全性 → 仍要打开**」中允许。不要关闭整个系统的安全防护。

如果 Codex 已经运行但没有可用连接，默认启动策略会询问是否正常退出后重新打开；取消会让它继续运行。可选的强制重开策略可能中断任务或丢失未保存内容。

</details>

以 `.0` 结尾的版本（如 `1.0.0`、`1.1.0`）提供新 DMG。补丁版本仅提供发布说明和源码归档；旧 DMG 不包含新补丁的改动。

## 可以做什么

| 工具 | 用途 |
| --- | --- |
| **下一步（Stepwise）** | 生成相关的后续建议，选择建议方向，复用常用提示词。 |
| **大纲** | 按标题浏览长回答，直接定位原文。 |
| **术语释义** | 阅读语境中的词义，建立个人词库，收藏词条或标记已掌握。 |
| **任务看板** | 管理待办、进行中和完成的任务，自定义分组，拖动调整。 |
| **模型切换** | 选择 Codex 实际提供的模型、推理强度和 Fast，保存预设并查看可用额度。 |
| **提示词优化** | 发送前改写草稿，继续编辑或还原原文。 |
| **聊天测速** | 查看可见回复的估算速度，以及宿主提供的 token 用量。 |
| **Grok Bot** | 浏览已有 Bot，在当前聊天中发起咨询。 |

### 打开与排列工作台

双眼入口位于 Codex 左栏。单击打开或收起工作台；悬停可选择聊天内、桌面和设置操作，右键直接打开设置。在「**界面 → 外观与字体**」中可修改默认单击动作。

| 操作 | 效果 |
| --- | --- |
| 双击双眼，或按 `Alt+Enter` | 在聊天和桌面之间移动工作台。 |
| 把功能标题或标签拖到另一面板边缘 | 拆分布局。 |
| 把它拖到另一面板中心 | 合并为标签。 |
| 单击叠放面板中当前选中的图标 | 折叠或重新展开该面板。 |
| 双击标题或标签 | 临时放大该面板，按 `Esc` 恢复。 |
| 拖动边缘或分隔线 | 调整工作台或分栏大小。 |

在「**界面 → 布局与位置**」中选择位置和布局。主工作台同时只占一个位置，可以与贴边／刘海面板并存。侧栏和桌面分别保存布局，切换位置保留草稿与阅读位置。新聊天和 Dots 中的侧栏可单独开启，默认关闭。

在「**界面 → 外观与字体**」中选择哑光、磨砂或液态。Palboo 跟随 Codex 明暗，不修改它的外观。贴边面板可以跟随 Codex 所在屏幕，或固定在选定屏幕；悬停或按 `Command+Shift+M` 展开。

同一页的「**语言**」提供简体中文、English 和跟随系统。选择同步到所有 App 界面；聊天原文和个人内容保持原样。网站可以独立切换语言。

### 配置下一步

打开「**系统 → 模型服务**」，使用已有 Codex CLI 登录或自己的模型 API。离开字段或切换选项时自动保存，也可以使用「**保存设置**」和「**测试连接**」。连接测试只发送固定短请求，不发送你的对话。

在「**功能 → 下一步**」中选择手动或自动生成，以及一种方向来源：

- **自动探索**：从当前问答中发现方向。
- **我来选择**：从十二个内置方向或自己的方向中选择，搜索方向库，并拖动调整已选顺序。键盘可使用 `Alt+上/下`。
- **智能挑选**：可选用 Jev 判断候选方向是否合适，再由生成模型撰写建议。这个实验模式需要独立凭据与明确同意。

数量是上限，不是必须凑满的目标；不合适的建议可以省略。新配置默认使用完整的最近一问一答，最多生成三条。已有上限和编辑会保留。

默认单击建议或常用提示词只填入输入框，发送行为可以设置。**已有草稿始终保留并追加，不会自动发送。** 也可以把建议拖进其关联输入框；切换聊天或建议更新后，旧拖动操作会失效。

常用提示词的名称和内容在同页编辑。方向库区分「**内置方向**」和「**我的方向**」；修改内置方向只影响本机，支持恢复原始文案。

### 管理术语

在「**功能 → 术语释义**」开启聊天标注与释义卡片。术语面板按当前聊天、收藏和已掌握浏览；可选开启「**点击术语时跳转到上下文**」，定位最近确认的位置。

在词库管理中输入名称，或上传不超过 8 MB 的文件。下次主动发送主聊天消息时，Palboo 将任务附给**该聊天当前的 Agent**，由它联网补全名称或解析文件。支持的格式、联网和本地文件访问取决于 Agent。失败任务可以查看和重试。

导出只包括个人添加、收藏和已掌握的词条。重置删除个人添加、上传文件与待处理导入任务，保留基础词库及其中的收藏、掌握记录。没有来源记录的旧词条保守地作为基础词库保留。发布安装包不会包含你的个人词库。

### 模型、Bot 与连接

**模型切换**控制当前 Codex 输入目标，与 Stepwise 配置的模型相互独立。模型列表和推理强度来自 Codex。在设置中管理收藏、预设、分组和排序；未知能力不会猜测。只有宿主提供额度时才显示。

**Grok Bot** 是可选功能，默认关闭。在「**功能 → Grok Bot → 接入 Grok Bot**」复制接入提示词给 Agent。BDK、MCP 和 Skill 保持独立安装。Palboo 读取兼容的 Bot 名单、分组和置顶，咨询追加到主聊天输入框，不自动发送。关闭面板不会停止远端 Bot 任务。

「**系统 → CodexHost**」显示状态、已安装与实际运行版本，提供更新和恢复版本操作。外部宿主、Agent 与模型服务保留各自的配置。

「**系统 → 性能与开关**」可以暂停 Codex 连接，保留设置、任务与草稿。可选监测只在该页面可见时运行，区分 Palboo 后台指标和整个宿主页面指标。

## 更新或卸载

DMG 安装版更新时，先停止 Palboo，再用新版替换**整个 App**。配置存放在 App 外，会继续保留。

从 CodexBuddy 或 Codex Companion 升级时，先用 `~/.local/bin/codex-buddy stop` 或 `~/.local/bin/codex-companion stop` 停止旧后台。Palboo 迁移默认数据目录并保留兼容链接，不会自动合并多个独立数据目录。历史安装包文件名和原始许可署名保留原名。

卸载前停止后台：

```sh
"/Applications/Palboo.app/Contents/MacOS/palboo" stop
```

然后删除 `/Applications/Palboo.app`。源码安装使用 `~/.local/bin/palboo stop`，并删除该可执行文件。只有希望删除保存数据时，才删除 `~/Library/Application Support/palboo/`。

## 构建与开发

需要受支持的 Mac、**Node.js 22.16+**、**Rust 1.88+** 和 **Xcode Command Line Tools**。

```sh
npm ci
npm run install:local  # 从源码构建并安装
```

源码安装器生成的轻量启动器依赖已安装 CLI，与 DMG 中的完整 App 不同。

通过 Palboo 打开 Codex 后：

```sh
npm run dev           # 连接真实 Codex 开发
npm run install:dev   # 生成独立 Palboo Dev.app 入口
npm run dev:settings  # 打开设置并选择开发 worktree
npm run dev:stop      # 停止后台开发会话
```

开发配置与日常安装隔离。界面修改自动更新，Rust 修改重新编译后台。启动脚本变化后重开 Dev；移动源码或 Node.js 后重新生成入口。worktree 切换保留各来源配置，不重启 Codex。

```sh
npm run verify        # 完整验证，自动准备必要构建产物
npm run verify:web    # 前端与合成浏览器检查
npm run build         # 构建 App
npm run package       # X.Y.0 生成完整 App DMG，补丁版本跳过
npm run dev:site       # 预览独立介绍网站
npm run build:site     # 静态网站输出到 target/site/
npm run test:site      # 网站交互与响应式检查
```

前端检查也可以在 Linux 运行，但不含原生验收，不代表 App 支持 Linux。有关集成检查仍需要 Chromium 和 Cargo。构建或打包不会发布版本，也不会更新已安装 App。

| 目录 | 职责 |
| --- | --- |
| `src/` | 后台、CLI 与原生窗口 |
| `ui/features/` | 共用功能内容 |
| `ui/surfaces/` | 侧栏、浮层、桌面、贴边与材质 |
| `ui/codex/` | 宿主读取、定位与输入适配 |
| `ui/terminology/` | 聊天标注与释义卡片 |
| `ui/shared/` | 契约、图标与共用资源 |
| `ui/settings/` | 设置网页 |
| `ui/website/` | 独立介绍与隔离演示 |
| `tests/`、`scripts/` | 验证、开发与打包 |

修改界面前遵循[设计系统](DESIGN_SYSTEM.md)和所在模块的 `AGENTS.md`，保持两版 README 同步。反馈问题时请附版本、系统和复现步骤，不附凭据或私人对话。

<details>
<summary>Agent 配置 CLI</summary>

正在运行的本机服务提供配置 CLI，不会自动启动或重启 Codex。可以用 `--data-dir` 指向其他安装，例如某 worktree 的 `target/dev/real`。

```sh
palboo config schema
palboo config get settings
palboo config set appearance --json '{"settingsTheme":"codex"}' --dry-run
palboo config set appearance --json '{"settingsTheme":"codex"}'
palboo config set settings --file - < settings-patch.json
```

未提供的字段和已有凭据保持不变；数组替换整个列表，读取时隐藏秘密。凭据请通过文件或标准输入提供。`--dry-run` 检查客户端字段和修订号，实际保存由后台完整校验。破坏性或授权操作需要 `--confirm`，冲突不自动重试。

</details>

## 隐私与许可

配置保存在本机。下一步建议及可选的术语语义识别，将相关上下文发送到你选择的模型服务。智能挑选只在同意后把最近问答发送给 Jev。名称或文件导入任务在下一次主动发送时交给当前聊天的 Agent。Palboo 不持久保存聊天正文，不修改官方 App 包；宿主更新可能影响兼容性。

自有源码采用 [GNU GPL 第三版限定许可](LICENSE)。第三方署名和历史 MIT 授权保留原条款，详见 [LICENSING.md](LICENSING.md)。
