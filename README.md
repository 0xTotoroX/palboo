<div align="center">
  <img src="ui/icon.png" alt="Palboo logo" width="120" />
  <h1>Palboo</h1>
  <p><strong>Give your conversations another dimension.</strong></p>
  <p>A desktop companion for Codex: read, plan, and keep your tools close.</p>
</div>

**English** · [Simplified Chinese](README.zh-CN.md)

[Download](https://github.com/0xTotoroX/palboo/releases) · [Report an issue](https://github.com/0xTotoroX/palboo/issues)

Palboo puts next-step suggestions, answer outlines, a glossary, tasks, and model controls beside your Codex conversation. Keep them in a sidebar, float them over the page, move them to the desktop, or use an edge/notch panel.

## Installation

**Requires an Apple Silicon Mac running macOS 14 or later, and the Codex / ChatGPT desktop app.** Desktop windows require macOS 15 or later; native Liquid Glass requires macOS 26. Windows and Intel Macs are not currently supported.

1. Download the DMG from [GitHub Releases](https://github.com/0xTotoroX/palboo/releases).
2. Open it and drag **Palboo** into **Applications**.
3. Open Palboo. If Codex needs to restart to establish a connection, Palboo asks first.

The DMG contains the complete App. Installation and everyday use do not require terminal commands, Node.js, or Rust. Optional Agents and model services use your existing installations and accounts.

<details>
<summary>Help with the first launch</summary>

If macOS blocks the App, verify that you downloaded it from this repository, then go to **System Settings → Privacy & Security → Open Anyway**. Do not disable system security globally.

If Codex is already running without a usable connection, the default launch policy asks before quitting and reopening it. Cancel to leave it running. The optional force-restart policy can interrupt tasks or lose unsaved work.

</details>

Versions ending in `.0`, such as `1.0.0` and `1.1.0`, include a new DMG. Patch releases include release notes and source archives only; an older DMG does not contain newer patch changes.

## What you can do

| Tool | Use it to |
| --- | --- |
| **Next steps (Stepwise)** | Generate relevant follow-ups, choose directions, and reuse quick prompts. |
| **Outline** | Navigate long answers by heading and jump to the original text. |
| **Terminology** | Read contextual definitions, build a personal glossary, and save favorites or mastered terms. |
| **Task board** | Keep tasks in To do, In progress, and Done; create groups and move tasks by dragging. |
| **Model switching** | Choose actual Codex models, reasoning levels, and Fast mode; save presets and view available usage limits. |
| **Prompt enhancement** | Refine a draft before sending it, then edit further or restore the original. |
| **Chat speed** | See estimated visible reply speed and token usage when the host provides it. |
| **Grok Bot** | Browse your Bots and bring a consultation into the current chat. |

### Open and arrange your workspace

The eyes button lives in Codex's left rail. Click to open or close the workbench. Hover for chat, desktop, and settings actions; right-click opens settings. Configure the default click action in **Interface → Appearance & fonts**.

| Action | Result |
| --- | --- |
| Double-click the eyes or press `Alt+Enter` | Move the workbench between the chat and desktop. |
| Drag a feature heading or tab to another panel's edge | Split the layout. |
| Drag it to the center of another panel | Group the features as tabs. |
| Click the active icon in a stacked panel | Fold or reopen that panel. |
| Double-click a heading or tab | Temporarily focus the panel; press `Esc` to restore. |
| Drag an edge or divider | Resize the workspace or its panels. |

Choose placement and layout in **Interface → Layout & position**. The main workspace has one location at a time; an edge/notch panel can coexist with it. Sidebar and desktop layouts are saved separately, and switching positions preserves drafts and reading position. New-chat and Dots sidebars are optional and off by default.

Choose matte, frosted, or liquid materials in **Interface → Appearance & fonts**. Palboo follows Codex's appearance without changing it. Edge panels can follow the display containing Codex or stay on a chosen display; hover to expand or use `Command+Shift+M`.

Choose **Language** on the same page: English, Simplified Chinese, or the system default. The choice applies to all App surfaces without rewriting conversations or personal content. The website has its own language choice.

### Configure next steps

Open **System → Model service** and use an existing Codex CLI login or your own model API. Changes save when you leave a field or select an option; **Save settings** and **Test connection** are also available. A connection test sends a fixed short request, not your conversation.

Under **Features → Next steps**, choose manual or automatic generation and one direction source:

- **Explore:** discover directions from the current exchange.
- **Choose directions:** select from twelve built-in directions or your own, search the library, and drag selected directions to reorder them. `Alt+Up/Down` is the keyboard alternative.
- **Smart selection:** optionally use Jev to assess candidate directions before your generation model writes the suggestions. This experimental mode requires separate credentials and explicit consent.

Counts are limits, not targets: irrelevant suggestions may be omitted. New configurations use the complete latest question and answer and allow up to three suggestions. Existing limits and edits are preserved.

Clicking a suggestion or quick prompt fills the composer by default. Sending behavior is configurable. **An existing draft is always preserved and appended to, without automatic sending.** You can also drag a suggestion into its linked composer. Changing the chat or suggestion invalidates an old drag.

Quick prompt labels and contents are editable on the same page. The direction library distinguishes **Built-in** from **My directions**; editing a built-in direction affects only your installation, and its original wording can be restored.

### Manage terminology

Enable **Features → Terminology** for chat annotations and definition popovers. The terminology panel lists concepts from the current chat, favorites, and mastered terms. **Jump to context on click** optionally locates a term's latest confirmed occurrence.

In glossary management, enter a name or upload a file up to 8 MB. The next time you deliberately send a main-chat message, Palboo attaches the task for **that chat's current Agent** to research the name or parse the file. Supported formats, web access, and local-file access depend on the Agent. Failed tasks can be reviewed and retried.

Export includes personal additions, favorites, and mastered terms. Reset removes personal additions, uploaded files, and pending import tasks while preserving the base glossary and its saved favorites/mastery. Existing entries without provenance remain part of the base glossary. Your personal glossary is not included in release downloads.

### Models, Bots, and connections

**Model switching** controls the current Codex input target, independently of the model configured for Stepwise. The model list and reasoning levels come from Codex. Manage favorites, presets, groups, and ordering in its settings; unavailable capabilities are not guessed. Usage limits appear only when the host supplies them.

**Grok Bot** is optional and off by default. In **Features → Grok Bot → Connect Grok Bot**, copy the setup prompt for your Agent. BDK, MCP, and the Skill remain independently installed. Palboo mirrors the compatible Bot roster, groups, and pins; consultations are appended to the main composer without automatic sending. Closing the panel does not stop remote Bot work.

**System → CodexHost** shows its status and installed/running versions, with update and restore actions. External hosts, Agents, and model services retain their own configuration.

**System → Performance & switches** can pause Codex integration without deleting settings, tasks, or drafts. Optional monitoring runs only while that page is visible and distinguishes Palboo backend metrics from whole-host page metrics.

## Update or uninstall

To update a DMG installation, stop Palboo and replace the **whole App** with the new one. Configuration is stored outside the App and is retained.

When upgrading from CodexBuddy or Codex Companion, stop the old background service first with `~/.local/bin/codex-buddy stop` or `~/.local/bin/codex-companion stop`. Palboo migrates the default data directory and retains compatibility links. Multiple independent data directories are never merged automatically. Historical package filenames and original license notices retain their original names.

To uninstall, stop the background service:

```sh
"/Applications/Palboo.app/Contents/MacOS/palboo" stop
```

Then delete `/Applications/Palboo.app`. Source installations use `~/.local/bin/palboo stop` and also remove that executable. Only delete `~/Library/Application Support/palboo/` if you want to remove your saved data.

## Build and develop

Requires **Node.js 22.16+**, **Rust 1.88+**, and **Xcode Command Line Tools** on a supported Mac.

```sh
npm ci
npm run install:local  # Build and install from source
```

The source installer creates a lightweight launcher that depends on the installed CLI. It is different from the self-contained App in the DMG.

After opening Codex through Palboo:

```sh
npm run dev           # Develop against a real Codex connection
npm run install:dev   # Create the separate Palboo Dev.app launcher
npm run dev:settings  # Open settings and select a development worktree
npm run dev:stop      # Stop background development
```

Development configuration is separate from the everyday installation. UI changes reload automatically; Rust changes rebuild the backend. Reopen Dev after changing its launch scripts, and recreate the launcher after moving the source or Node.js. Worktree switching preserves each source's configuration and does not restart Codex.

```sh
npm run verify        # Full verification; prepares required build outputs
npm run verify:web    # Frontend and synthetic-browser checks
npm run build         # Build the App
npm run package       # Build a full-App DMG for X.Y.0; skip patch versions
npm run dev:site       # Preview the standalone introduction website
npm run build:site     # Write static website files to target/site/
npm run test:site      # Check website interactions and responsive layouts
```

The frontend checks can also run on Linux, but exclude native verification and do not establish Linux App support. They need Chromium and Cargo for applicable integration checks. Building or packaging does not publish a release or update an installed App.

| Directory | Responsibility |
| --- | --- |
| `src/` | Backend, CLI, and native windows |
| `ui/features/` | Shared feature content |
| `ui/surfaces/` | Sidebar, overlay, desktop, edge, and materials |
| `ui/codex/` | Host reading, navigation, and input adapters |
| `ui/terminology/` | Chat annotations and definition popovers |
| `ui/shared/` | Contracts, icons, and shared resources |
| `ui/settings/` | Settings web app |
| `ui/website/` | Standalone introduction and isolated demos |
| `tests/`, `scripts/` | Verification, development, and packaging |

Follow the [design system](DESIGN_SYSTEM.md) and the relevant module's `AGENTS.md` before changing the UI. Keep both README editions in sync. Issue reports should include the version, OS, and reproduction steps, without credentials or private conversations.

<details>
<summary>Agent configuration CLI</summary>

The running local service exposes a configuration CLI. It never starts or restarts Codex automatically. Use `--data-dir` for another installation, such as a worktree's `target/dev/real`.

```sh
palboo config schema
palboo config get settings
palboo config set appearance --json '{"settingsTheme":"codex"}' --dry-run
palboo config set appearance --json '{"settingsTheme":"codex"}'
palboo config set settings --file - < settings-patch.json
```

Unmentioned fields and stored credentials are retained; arrays replace the full list. Reads redact secrets. Supply credentials through a file or stdin. `--dry-run` validates client fields and revisions; the backend performs full validation when saving. Destructive or authorization operations require `--confirm`, and conflicts are not retried automatically.

</details>

## Privacy and license

Configuration stays local. Next-step suggestions and optional semantic terminology detection send relevant conversation context to your chosen model service. Smart direction selection sends the latest exchange to Jev only after consent. Name/file import tasks go to the current chat's Agent on your next deliberate send. Palboo does not persist chat bodies or modify the official application bundle; host updates can affect compatibility.

Project-owned source is licensed under [GNU GPL version 3 only](LICENSE). Third-party notices and earlier MIT grants retain their original terms. See [LICENSING.md](LICENSING.md) for details.
