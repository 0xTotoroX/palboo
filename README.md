<div align="center">
  <img src="ui/icon.png" alt="Palboo logo" width="96" />
  <h1>Palboo</h1>
  <p><strong>Give your conversations another dimension.</strong></p>
  <p>A desktop companion for Codex, with reading tools, next steps, and tasks beside your conversation.</p>
</div>

**English** · [Simplified Chinese](README.zh-CN.md)

[Download for macOS](https://github.com/0xTotoroX/palboo/releases) · [Report an issue](https://github.com/0xTotoroX/palboo/issues)

## Features

Keep Palboo in a sidebar, float it over the page, move it to the desktop, or tuck it into an edge/notch panel. Drag to arrange your workspace and choose matte, frosted, or liquid materials.

| Tool                      | What it does                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| **Next steps · Stepwise** | Suggest relevant follow-ups, choose directions, and reuse quick prompts.                           |
| **Outline**               | Navigate long answers and jump to the original text.                                               |
| **Terminology**           | Explain terms in context; collect favorites and mark terms as mastered.                            |
| **Task board**            | Organize tasks into To do, In progress, and Done, with groups and drag-and-drop.                   |
| **Model switching**       | Switch Codex models, reasoning levels, and Fast mode; save presets and see available usage limits. |
| **Prompt enhancement**    | Refine a draft before sending, with the option to restore the original.                            |
| **Chat speed**            | See estimated reply speed and token usage when Codex provides it.                                  |
| **Grok Bot**              | Find your Bots and start a consultation in the current chat.                                       |

## Installation

Requires **macOS 14+ on Apple Silicon** and the **Codex / ChatGPT desktop app**.

1. Download a DMG from [GitHub Releases](https://github.com/0xTotoroX/palboo/releases).
2. Open it and drag **Palboo** into **Applications**.
3. Open Palboo. It asks first if Codex needs to restart to connect.

The DMG contains the complete App. Everyday use needs no terminal commands, Node.js, or Rust. Optional Agents and model services use your existing installations and accounts.

<details>
<summary>Compatibility and first-launch help</summary>

- Desktop windows require macOS 15+; native Liquid Glass requires macOS 26. Windows and Intel Macs are not supported.
- If macOS blocks the App, confirm you downloaded it from this repository, then choose **System Settings → Privacy & Security → Open Anyway**. Do not disable system security globally.
- If Codex needs to restart, the default policy asks before quitting and reopening it. Cancel to keep it running. The optional force-restart policy can interrupt tasks or lose unsaved work.
- Releases ending in `.0` include a DMG. Patch releases contain notes and source archives only; an older DMG does not include newer patches.

</details>

## Get started

1. **Open the workbench:** click the eyes in Codex's left rail. Right-click for settings.
2. **Choose your tools:** turn features on or off in **Interface → Common switches**. Set their placement in **Layout & position**, and their material and language in **Appearance & fonts**.
3. **Set up suggestions:** in **System → Model service**, use your Codex CLI login or a model API, then test the connection. Choose manual or automatic generation in **Features → Next steps**.

Suggestions fill the composer by default. If you already have a draft, Palboo appends to it without sending.

<details>
<summary>Workspace controls and shortcuts</summary>

| Action                                                 | Result                                     |
| ------------------------------------------------------ | ------------------------------------------ |
| Double-click the eyes or press `Alt+Enter`             | Move between the chat and desktop.         |
| Drag a heading or tab to another panel's edge / center | Split the layout / group features as tabs. |
| Click a stacked panel's active icon                    | Fold or reopen that panel.                 |
| Double-click a heading or tab                          | Focus the panel; press `Esc` to restore.   |
| Drag an edge or divider                                | Resize the workspace or its panels.        |

Hover over the left-rail eyes for chat, desktop, and settings actions. The default click action is configurable in **Appearance & fonts**.

Sidebar and desktop layouts are saved separately; switching positions preserves drafts and reading position. An edge/notch panel can coexist with the main workspace, follow Codex's display, or stay on a chosen display. Hover or press `Command+Shift+M` to expand it. Sidebars in new chats and Dots are optional and off by default.

Palboo follows Codex's appearance. English, Simplified Chinese, and system-default language choices apply across the App without changing personal content. The website keeps its own language choice.

</details>

<details>
<summary>Stepwise directions and quick prompts</summary>

**Features → Next steps** offers three direction sources:

- **Explore:** discover directions from the current exchange.
- **Choose directions:** search twelve built-in directions or your own, then drag to reorder selections (`Alt+Up/Down` also works).
- **Smart selection:** let Jev assess candidates before your generation model writes suggestions. This experimental option needs separate credentials and consent.

New configurations use the complete latest question and answer, with up to three suggestions. Fewer or no suggestions may be returned when appropriate. Existing limits are retained.

Edit quick prompts and manage the direction library on the same page. Built-in edits and custom directions stay local; built-in wording can be restored. Choose whether a click fills or sends, or drag a suggestion into its linked composer. Existing drafts are always preserved and never sent automatically.

</details>

<details>
<summary>Your glossary: add, import, export, and reset</summary>

Enable **Features → Terminology** for annotations and definitions. Browse the current chat, favorites, or mastered terms; optionally jump from a term to its context.

Enter a term name or upload a file up to **8 MB**. On your next deliberate main-chat message, **that chat's current Agent** receives the task to research the term or parse the file. Formats, web access, and file access depend on the Agent. Failed tasks can be reviewed and retried.

Export includes personal additions, favorites, and mastered terms. Reset deletes personal additions, uploaded files, and pending tasks, while keeping the base glossary and its favorites/mastery. Older entries without source records are kept as base entries. Your personal glossary is never bundled into release downloads.

</details>

<details>
<summary>Models, Bots, and connections</summary>

- **Model switching** controls the current Codex input target, independently of Stepwise's model. Models, reasoning levels, and usage limits come from Codex; only available capabilities are shown.
- **Grok Bot** is optional and off by default. Copy the setup prompt from **Features → Grok Bot → Connect Grok Bot** to your Agent. BDK, MCP, and the Skill remain separately installed. Consultations append to the composer without sending; closing the panel does not stop remote Bot work.
- **System → CodexHost** shows status and versions, with update and restore actions. External hosts and Agents keep their own configuration.
- **System → Performance & switches** can pause the Codex connection while retaining settings, tasks, and drafts. Optional monitoring runs only while that page is visible.

</details>

## Maintenance and development

<details>
<summary>Update or uninstall</summary>

Stop Palboo before replacing or removing the App:

```sh
"/Applications/Palboo.app/Contents/MacOS/palboo" stop
```

To update, replace the **whole App** with the new one. To uninstall, delete `/Applications/Palboo.app`. Saved data stays in `~/Library/Application Support/palboo/`; delete that directory only if you also want to erase your data.

Source installations use `~/.local/bin/palboo stop`; also remove that executable when uninstalling.

Upgrading from CodexBuddy or Codex Companion? Stop the old service with `~/.local/bin/codex-buddy stop` or `~/.local/bin/codex-companion stop` first. Palboo migrates the default data directory; independent directories are not merged automatically.

</details>

<details>
<summary>Build from source and contribute</summary>

Use a supported Mac with **Node.js 22.16+**, **Rust 1.88+**, and **Xcode Command Line Tools**.

```sh
git clone https://github.com/0xTotoroX/palboo.git
cd palboo
npm ci
npm run install:local
```

The source installer creates a lightweight launcher that depends on the installed CLI. The DMG contains a self-contained App.

After opening Codex through Palboo:

| Command                                                         | Purpose                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `npm run dev`                                                   | Develop against the real Codex connection.               |
| `npm run install:dev`                                           | Create a separate Palboo Dev.app launcher.               |
| `npm run dev:settings`                                          | Open development settings and choose a worktree.         |
| `npm run dev:stop`                                              | Stop background development.                             |
| `npm run verify`                                                | Run full verification, preparing required build outputs. |
| `npm run verify:web`                                            | Run frontend and synthetic-browser checks.               |
| `npm run build`                                                 | Build the release binary and settings web app.           |
| `npm run package`                                               | Package a full-App DMG for X.Y.0; skip patch versions.   |
| `npm run dev:site` / `npm run build:site` / `npm run test:site` | Preview, build, or check the standalone website.         |

Development configuration is isolated from the everyday installation. UI changes reload; Rust changes rebuild. Reopen Dev after changing launcher scripts, and recreate the launcher after moving the source or Node.js. Switching worktrees preserves their configurations and does not restart Codex.

Frontend checks can run on Linux with Chromium and Cargo, but exclude native verification and do not imply Linux App support. Building and packaging do not publish or update an installed App.

See the [project map](AGENTS.md#架构地图l1) for code organization and the [design system](DESIGN_SYSTEM.md) for UI conventions. Keep both README editions in sync. Include the version, OS, and reproduction steps in issues; leave out credentials and private conversations.

</details>

<details>
<summary>Agent configuration CLI</summary>

With the local service running:

```sh
palboo config schema
palboo config get settings
palboo config set appearance --json '{"settingsTheme":"codex"}' --dry-run
palboo config set appearance --json '{"settingsTheme":"codex"}'
palboo config set settings --file - < settings-patch.json
```

Use `--data-dir` to target another installation. The CLI does not start or restart Codex. Omitted fields and credentials are retained; arrays replace the full list. Reads redact secrets. Pass credentials through a file or stdin.

`--dry-run` checks client fields and revisions; the backend validates on save. Destructive or authorization operations need `--confirm`; conflicts are not retried automatically.

</details>

## Privacy

Configuration stays local. Suggestions and optional semantic term detection send relevant context to your chosen model service. Jev receives the latest exchange only after consent; glossary tasks go to the current chat's Agent on your next deliberate send. Palboo does not persist chat bodies or modify the official App bundle. Host updates may affect compatibility.

[GPL-3.0-only](LICENSE) · [Licensing and third-party notices](LICENSING.md)
