/* [INPUT]: CodexHost 0.16.1 public plugin manifests and unmodified identification assets.
 * [OUTPUT]: Bundled identity icon lookup for IDs returned by the current host.
 * [POS]: Static icon metadata only; live names, ordering, availability and selection come from codex-host/agents. Attribution lives in codex-host-assets/NOTICE.md.
 * [PROTOCOL]: Keep settings/AGENTS.md and asset provenance in sync. */
export const codexHostAgents = [
  {
    id: 'codex',
    label: 'Codex',
    icon: new URL('./codex-host-assets/codex.png', import.meta.url).href,
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    icon: new URL('./codex-host-assets/antigravity.svg', import.meta.url).href,
  },
  {
    id: 'zcode',
    label: 'ZCode',
    icon: new URL('./codex-host-assets/zcode.svg', import.meta.url).href,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    icon: new URL('./codex-host-assets/opencode.png', import.meta.url).href,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    icon: new URL('./codex-host-assets/claude-code.svg', import.meta.url).href,
  },
  {
    id: 'workbuddy',
    label: 'WorkBuddy',
    icon: new URL('./codex-host-assets/workbuddy.svg', import.meta.url).href,
  },
  {
    id: 'grok',
    label: 'Grok',
    icon: new URL('./codex-host-assets/grok.png', import.meta.url).href,
  },
  { id: 'pi', label: 'Pi', icon: new URL('./codex-host-assets/pi.svg', import.meta.url).href },
  {
    id: 'deepseek-harness',
    label: 'DeepSeek Harness',
    icon: new URL('./codex-host-assets/deepseek-harness.svg', import.meta.url).href,
  },
  {
    id: 'omp',
    label: 'Oh My Pi',
    icon: new URL('./codex-host-assets/omp.svg', import.meta.url).href,
  },
  {
    id: 'qoder',
    label: 'Qoder',
    icon: new URL('./codex-host-assets/qoder.svg', import.meta.url).href,
  },
  {
    id: 'qoder-cn',
    label: 'Qoder CN',
    icon: new URL('./codex-host-assets/qoder-cn.svg', import.meta.url).href,
  },
  {
    id: 'cursor-cli',
    label: 'Cursor CLI',
    icon: new URL('./codex-host-assets/cursor-cli.svg', import.meta.url).href,
  },
  {
    id: 'kimi-code',
    label: 'Kimi Code',
    icon: new URL('./codex-host-assets/kimi-code.svg', import.meta.url).href,
  },
  {
    id: 'kiro-cli',
    label: 'Kiro CLI',
    icon: new URL('./codex-host-assets/kiro-cli.svg', import.meta.url).href,
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    icon: new URL('./codex-host-assets/codebuddy.svg', import.meta.url).href,
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    icon: new URL('./codex-host-assets/copilot.png', import.meta.url).href,
  },
  {
    id: 'hermes',
    label: 'Hermes',
    icon: new URL('./codex-host-assets/hermes.png', import.meta.url).href,
  },
] as const;
