/* [INPUT]: Saved sync preference, shared settings queue and read-only local Bot catalog.
 * [OUTPUT]: Grouped sync controls, compact profile entries and Agent setup instructions.
 * [POS]: Settings only; no Bot conversations or dependency installation.
 * [PROTOCOL]: Keep ui/settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Toggle, Feedback } from './settings-controls';
import { SettingsDrawer } from './settings-drawer';
import { Button, IconButton } from './components/ui/button';
import type { SettingsEditor } from './use-settings-form';
import { botSetupPrompt } from './bot-setup-prompt';
import { ActionIcon } from './components/ui/action-feedback';
import { botGroups, type BotSidebar } from '../shared/bot-catalog';

type Catalog = {
  stale: boolean;
  error?: string;
  sidebar?: BotSidebar;
  sidebarError?: string;
  bots: { id: string; name: string; description?: string; hidden?: boolean }[];
};
export function BotSettings({
  active,
  live,
  editor,
}: {
  active: boolean;
  live: boolean;
  editor: SettingsEditor;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const sequence = useRef(0);
  const auto = editor.form?.grokbotAutoSync ?? true;
  async function load(refresh = false, quiet = false) {
    const id = ++sequence.current;
    if (!quiet) {
      setBusy(true);
      setError('');
      setRefreshed(false);
    }
    try {
      const value = await request<Catalog>('features', { op: 'bots-catalog', refresh });
      if (id === sequence.current) {
        setCatalog((previous) =>
          JSON.stringify(previous) === JSON.stringify(value) ? previous : value,
        );
        setError('');
        setRefreshed(refresh && !value.stale && !value.error);
      }
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
    } finally {
      if (id === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!active || !live) return;
    let stopped = false,
      reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const automatic =
      editor.saved?.grokbotEnabled === true && (editor.saved?.grokbotAutoSync ?? true);
    const read = async (initial = false) => {
      if (stopped || reading || document.hidden) return;
      reading = true;
      try {
        await load(false, !initial);
      } finally {
        reading = false;
        if (!stopped && automatic && !document.hidden) timer = setTimeout(() => void read(), 2000);
      }
    };
    const visible = () => {
      clearTimeout(timer);
      if (!document.hidden && automatic) void read();
    };
    void read(true);
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      sequence.current++;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, live, editor.saved?.grokbotAutoSync, editor.saved?.grokbotEnabled]);
  return (
    <section data-settings-page="bots" hidden={!active} className="settings-section bot-settings">
      <Toggle
        label="自动同步 Bot 资料"
        checked={auto}
        disabled={!live || !editor.form}
        onChange={(value) => editor.change('grokbotAutoSync', value)}
      />
      <div className="bot-settings-catalog" aria-busy={busy}>
        <div className="bot-settings-heading">
          <h2>Bot 资料</h2>
          {!auto && (
            <IconButton
              aria-label="刷新 Bot 资料"
              title={busy ? '正在刷新…' : '刷新 Bot 资料'}
              disabled={!live || busy}
              onClick={() => void load(true)}
            >
              <ActionIcon
                name="refresh"
                state={busy ? 'pending' : refreshed ? 'success' : 'idle'}
              />
            </IconButton>
          )}
        </div>
        <Feedback text={error || catalog?.error} failed />
        <Feedback text={catalog?.sidebarError} failed />
        {!catalog?.error && catalog?.stale && <Feedback text="资料已过期，请打开 Grok Bot。" />}
        {!catalog && busy && <Feedback text="正在读取 Bot 资料…" />}
        {catalog && !catalog.stale && !catalog.error && catalog.bots.length === 0 && (
          <Feedback text="暂无 Bot" />
        )}
        <div className="bot-settings-profiles">
          {botGroups(catalog?.bots ?? [], catalog?.sidebar).map((group) => (
            <section
              key={group.id}
              className="bot-settings-group"
              aria-label={group.name || 'Bot 列表'}
            >
              {group.name && <h3>{group.name}</h3>}
              {group.bots.map((bot) => (
                <SettingsDrawer key={bot.id} title={bot.name} hidden={!active}>
                  <p className="bot-settings-description">{bot.description || '暂无简介'}</p>
                </SettingsDrawer>
              ))}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BotSetupInstructions({ hidden }: { hidden: boolean }) {
  const [copied, setCopied] = useState('');
  return (
    <div className="bot-settings-setup" hidden={hidden}>
      <SettingsDrawer title="接入 Grok Bot" hidden={hidden}>
        <p>把这段 Prompt 交给你的 Agent 或 Codex，按当前官方文档完成接入和后续更新。</p>
        <textarea
          aria-label="Grok Bot 接入 Prompt"
          className="mt-4 min-h-80 w-full resize-y rounded border bg-transparent p-3 text-sm"
          readOnly
          value={botSetupPrompt}
        />
        <div className="settings-actions">
          <Button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(botSetupPrompt).then(
                () => setCopied('已复制'),
                () => setCopied('无法自动复制，请选中上方文本复制。'),
              )
            }
          >
            复制接入 Prompt
          </Button>
        </div>
        <Feedback text={copied} />
      </SettingsDrawer>
    </div>
  );
}
