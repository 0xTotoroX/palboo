<div align="center">
  <img src="ui/icon.png" alt="Palboo 图标" width="96" />
  <h1>Palboo</h1>
  <p><strong>让对话，多一维度。</strong></p>
  <p>你的 Codex 桌面搭档，把阅读工具、下一步建议和任务放在对话旁。</p>
</div>

[English](README.md) · **简体中文**

[下载 macOS 版](https://github.com/0xTotoroX/palboo/releases) · [反馈问题](https://github.com/0xTotoroX/palboo/issues)

## 功能

把 Palboo 放在侧栏、页面浮层、桌面窗口或贴边／刘海面板。拖动排列工作台，选择哑光、磨砂或液态材质。

| 工具                  | 用途                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| **下一步 · Stepwise** | 生成相关的后续建议，选择建议方向，复用常用提示词。                             |
| **大纲**              | 浏览长回答，直接定位原文。                                                     |
| **术语释义**          | 理解语境中的词义，收藏词条或标记已掌握。                                       |
| **任务看板**          | 管理待办、进行中和完成的任务，支持分组与拖动调整。                             |
| **模型切换**          | 切换 Codex 模型、推理强度和 Fast，保存预设并查看可用额度。                     |
| **提示词优化**        | 发送前改写草稿，也可以还原原文。                                               |
| **聊天测速**          | 按模型跨聊天保留最近测速，标明旧读数直到更新；可查看 Codex 提供的 token 用量。 |
| **Grok Bot**          | 查找已有 Bot，在当前聊天中发起咨询。                                           |

## 安装

需要 **macOS 14+ 的 Apple Silicon Mac**，以及 **Codex / ChatGPT 桌面 App**。

1. 从 [GitHub Releases](https://github.com/0xTotoroX/palboo/releases) 下载 DMG。
2. 打开 DMG，把 **Palboo** 拖进「**应用程序**」。
3. 打开 Palboo。如果连接需要重开 Codex，会先询问。

DMG 包含完整 App，日常使用无需终端指令、Node.js 或 Rust。可选 Agent 和模型服务沿用你已有的安装与账号。

<details>
<summary>兼容性与首次打开帮助</summary>

- 桌面浮窗需要 macOS 15+；原生液态材质需要 macOS 26。不支持 Windows 和 Intel Mac。
- 如果 macOS 阻止打开，请确认安装包来自本仓库，再到「**系统设置 → 隐私与安全性 → 仍要打开**」中允许。不要关闭整个系统的安全防护。
- 如果 Codex 需要重开，默认策略会询问是否正常退出后重新打开，取消会让它继续运行。可选的强制重开策略可能中断任务或丢失未保存内容。
- 以 `.0` 结尾的版本提供 DMG。补丁版本只有说明与源码归档；旧 DMG 不包含新补丁。

</details>

## 开始使用

1. **打开工作台**：单击 Codex 左栏的双眼入口，右键打开设置。
2. **选择工具**：在「**界面 → 常用开关**」中开关功能，在「**布局与位置**」中安排位置，在「**外观与字体**」中选择材质和语言。
3. **配置建议**：在「**系统 → 模型服务**」中使用 Codex CLI 登录或模型 API，测试连接后，在「**功能 → 下一步**」选择手动或自动生成。

默认点击建议只填入输入框。已有草稿时追加内容，不自动发送。

<details>
<summary>工作台操作与快捷键</summary>

| 操作                               | 效果                          |
| ---------------------------------- | ----------------------------- |
| 双击双眼，或按 `Alt+Enter`         | 在聊天和桌面之间移动工作台。  |
| 把标题或标签拖到另一面板边缘／中心 | 拆分布局／合并为标签。        |
| 单击叠放面板中选中的图标           | 折叠或重新展开面板。          |
| 双击标题或标签                     | 临时放大面板，按 `Esc` 恢复。 |
| 拖动边缘或分隔线                   | 调整工作台或分栏大小。        |

悬停左栏双眼可选择聊天内、桌面和设置操作；单击、双击和右键动作均可在「**外观与字体**」中分别修改。

侧栏与桌面分别保存布局，切换位置保留草稿和阅读位置。贴边／刘海面板可以与主工作台并存，跟随 Codex 所在屏幕或固定在选定屏幕；悬停或按 `Command+Shift+M` 展开。可在「**布局与位置 → 启用范围**」分别启用新聊天和 Dots，默认关闭，适用于所有承载形式和功能；依赖回答内容的操作仍须等待回答。

Palboo 跟随 Codex 的外观。语言支持简体中文、英文和跟随系统，应用于全部 App 界面，不改个人内容；网站独立选择语言。展示页直接复用 Palboo 的真实界面组件，使用本页示例数据，可操作下一步、大纲、术语、看板、模型快切、测速、提示词优化和 Bot，无需连接账户。

</details>

<details>
<summary>Stepwise 方向与常用提示词</summary>

「**功能 → 下一步**」提供三种方向来源：

- **自动探索**：从当前问答中发现方向。
- **我来选择**：搜索十二个内置方向或自己的方向，拖动排序，也可使用 `Alt+上/下`。
- **智能挑选**：先让 Jev 判断候选方向，再由生成模型撰写建议。这是实验选项，需要独立凭据和同意。

新配置使用完整的最近一问一答，最多生成三条；没有合适建议时可以少给或不给。已有数量限制会保留。

常用提示词和方向库都在同页管理。内置方向的编辑与自定义方向只在本机生效，可恢复内置文案。点击可设为填入或发送，也可以把建议拖入关联输入框；已有草稿始终保留，不自动发送。

</details>

<details>
<summary>个人词库：新增、导入、导出与重置</summary>

在「**功能 → 术语释义**」开启聊天标注与释义。按当前聊天、收藏或已掌握浏览，可选点击术语跳转到上下文。

输入术语名称，或上传不超过 **8 MB** 的文件。下次主动发送主聊天消息时，由**该聊天当前的 Agent** 联网补全术语或解析文件。支持格式、联网和文件访问取决于 Agent，失败任务可以查看和重试。

导出只包含个人添加、收藏和已掌握的词条。重置删除个人添加、上传文件和待处理任务，保留基础词库及其中的收藏、掌握记录。没有来源记录的旧词条按基础词库保留。个人词库不会进入发布安装包。

</details>

<details>
<summary>模型、Bot 与连接</summary>

- **模型切换**控制 Codex 当前输入目标，与 Stepwise 使用的模型独立。模型、推理档位和额度来自 Codex，只显示可用能力。
- **Grok Bot** 默认关闭。在「**功能 → Grok Bot → 接入 Grok Bot**」复制接入提示词给 Agent，BDK、MCP 和 Skill 仍独立安装。咨询追加到输入框，不自动发送；关闭面板不会停止远端 Bot 任务。
- 「**系统 → CodexHost**」显示状态与版本，提供更新和恢复操作。外部宿主与 Agent 保留自己的配置。
- 「**系统 → 性能与开关**」可以暂停 Codex 连接，保留设置、任务和草稿。可选监测仅在该页可见时运行。

</details>

## 维护与开发

<details>
<summary>更新或卸载</summary>

替换或删除 App 前，先停止 Palboo：

```sh
"/Applications/Palboo.app/Contents/MacOS/palboo" stop
```

更新时用新版替换**整个 App**；卸载时删除 `/Applications/Palboo.app`。数据保存在 `~/Library/Application Support/palboo/`，只有希望清空数据时才删除该目录。

源码安装使用 `~/.local/bin/palboo stop`，卸载时也删除该可执行文件。

从 CodexBuddy 或 Codex Companion 升级时，先用 `~/.local/bin/codex-buddy stop` 或 `~/.local/bin/codex-companion stop` 停止旧后台。Palboo 会迁移默认数据目录，不自动合并独立目录。

</details>

<details>
<summary>源码构建与参与开发</summary>

需要受支持的 Mac、**Node.js 22.16+**、**Rust 1.88+** 和 **Xcode Command Line Tools**。

```sh
git clone https://github.com/0xTotoroX/palboo.git
cd palboo
npm ci
npm run install:local
```

源码安装器创建依赖已安装 CLI 的轻量启动器，DMG 中则是完整 App。

通过 Palboo 打开 Codex 后：

| 命令                                                            | 用途                                      |
| --------------------------------------------------------------- | ----------------------------------------- |
| `npm run dev`                                                   | 连接真实 Codex 开发。                     |
| `npm run install:dev`                                           | 创建独立 Palboo Dev.app 入口。            |
| `npm run dev:settings`                                          | 打开开发设置并选择 worktree。             |
| `npm run dev:stop`                                              | 停止后台开发会话。                        |
| `npm run verify`                                                | 完整验证，自动准备必要构建产物。          |
| `npm run verify:web`                                            | 前端与合成浏览器检查。                    |
| `npm run build`                                                 | 构建发布程序与设置网页。                  |
| `npm run package`                                               | 为 X.Y.0 打包完整 App DMG，补丁版本跳过。 |
| `npm run dev:site` / `npm run build:site` / `npm run test:site` | 预览、构建或检查独立介绍网站。            |

开发配置与日常安装隔离。界面修改自动更新，Rust 修改重新构建；启动脚本变化后重开 Dev，源码或 Node.js 移动后重新生成入口。切换 worktree 保留各自配置，不重启 Codex。

前端检查可在配有 Chromium 与 Cargo 的 Linux 环境运行，但不含原生验收，不代表 App 支持 Linux。构建和打包不会发布或更新已安装 App。

代码组织见[项目地图](AGENTS.md#架构地图l1)，界面约定见[设计系统](DESIGN_SYSTEM.md)。请保持两版 README 同步。反馈问题时附版本、系统和复现步骤，不附凭据或私人对话。

</details>

<details>
<summary>Agent 配置 CLI</summary>

使用当前运行 App 包内的 CLI。打开 Palboo 后：

```sh
PALBOO_BIN="/Applications/Palboo.app/Contents/MacOS/palboo"
"$PALBOO_BIN" config --help
"$PALBOO_BIN" config schema
"$PALBOO_BIN" config get settings
"$PALBOO_BIN" config set appearance --json '{"settingsTheme":"codex"}' --dry-run
"$PALBOO_BIN" config set appearance --json '{"settingsTheme":"codex"}'
"$PALBOO_BIN" config set settings --file - < settings-patch.json
```

源码安装时，将 `PALBOO_BIN` 设为 `"$HOME/.local/bin/palboo"`。以下示例对应当前源码，已安装版本支持哪些命令，以 `config --help` 为准。

用 `config schema <scope>` 查询嵌套字段、可选值和示例，涵盖下一步、外观、布局、模型切换、任务、术语、CodexHost 和性能。`config catalog models|displays|bots` 查询可用目录；Codex 可切换的实际模型见 `config get model-control`。

```sh
"$PALBOO_BIN" config set terminology --json '{"action":"add-names","names":["检索增强生成"]}'
"$PALBOO_BIN" config import terminology --file terms.pdf
"$PALBOO_BIN" config export terminology --format markdown --output my-terms.md
```

名称和文件（最多 8 MB）在下次主聊天发送时交给当前 Agent 处理。导出仅包含个人添加、收藏和已掌握词条。`config set terminology --json '{"action":"reset-library"}' --confirm` 删除个人内容及导入任务，保留基础词库及其中的收藏、掌握记录。

用 `--data-dir` 指向其他安装。CLI 不会启动或重启 Codex。未提供的字段和凭据保持不变，数组、字典和布局树整体替换；读取时隐藏秘密，凭据通过文件或标准输入提供。

`--dry-run` 检查客户端字段与修订号，后台在保存时完整校验。破坏性或授权操作需要 `--confirm`，冲突不自动重试。

</details>

## 隐私

配置保存在本机。下一步建议与可选的术语语义识别会将相关上下文发送到你选择的模型服务。Jev 仅在同意后接收最近问答，词库任务在下一次主动发送时交给当前聊天的 Agent。Palboo 不持久保存聊天正文，不修改官方 App 包；宿主更新可能影响兼容性。

[GPL-3.0-only](LICENSE) · [许可与第三方署名](LICENSING.md)
