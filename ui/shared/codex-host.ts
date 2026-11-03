/* [INPUT]: Authenticated CodexHost status and read-only Agent projection. [OUTPUT]: Management and isolated preview contracts.
 * [POS]: Standalone background feature, independent of MCP and panel placement.
 * [PROTOCOL]: Keep shared/AGENTS.md in sync. */
export type CodexHostStatus = {
  enabled: boolean;
  startupUpdate: 'off' | 'notify' | 'automatic';
  revision: number;
  state:
    | 'disabled'
    | 'notInstalled'
    | 'pendingEnable'
    | 'pendingDisable'
    | 'pendingUpdate'
    | 'running'
    | 'error';
  executable: string | null;
  version: string | null;
  runningVersion: string | null;
  runningExecutable: string | null;
  managed: boolean;
  error: string | null;
  baseline: string;
  canRestore: boolean;
  restart?: {
    state: 'queued' | 'confirming' | 'restarting' | 'cancelled' | 'completed' | 'failed';
    message: string;
  } | null;
};

export type CodexHostAgentSnapshot = {
  status: 'ready' | 'unavailable';
  message: string;
  current: string | null;
  agents: {
    id: string;
    label: string;
    group: 'main' | 'more';
    availability: string;
    available: boolean;
    canAdd: boolean;
  }[];
};
