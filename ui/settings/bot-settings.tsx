/* [INPUT]: Saved sync preference, shared settings queue and read-only local Bot catalog.
 * [OUTPUT]: Sync control, Bot descriptions and copyable Agent setup instructions.
 * [POS]: Settings only; no Bot conversations or dependency installation.
 * [PROTOCOL]: Keep ui/settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Toggle, Feedback } from './settings-controls';
import { SettingsDrawer } from './settings-drawer';
import { Button } from './components/ui/button';
import type { SettingsEditor } from './use-settings-form';
import { botSetupPrompt } from './bot-setup-prompt';

type Catalog = {
  stale: boolean;
  error?: string;
  bots: { id: string; name: string; description?: string }[];
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
  const [copied, setCopied] = useState('');
  const sequence = useRef(0);
  const auto = editor.form?.grokbotAutoSync ?? true;
  async function load(refresh = false) {
    const id = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const value = await request<Catalog>('features', { op: 'bots-catalog', refresh });
      if (id === sequence.current) setCatalog(value);
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
    } finally {
      if (id === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (active && live) void load();
    return () => {
      sequence.current++;
    };
  }, [active, live, editor.saved?.grokbotAutoSync]);
  return (
    <section data-settings-page="bots" hidden={!active} className="settings-section">
      <Toggle
        label="自动同步 Bot 资料"
        checked={auto}
        disabled={!live || !editor.form}
        onChange={(value) => editor.change('grokbotAutoSync', value)}
      />
      <p className="settings-hint">
        {auto
          ? '资料变化时自动更新。'
          : '停止文件监听；点击刷新更新名单与资料。调用前仍会核验 Bot 身份。'}
      </p>
      <div className="flex items-center justify-between gap-4">
        <h2>Bot 简介</h2>
        {!auto && (
          <Button type="button" disabled={!live || busy} onClick={() => void load(true)}>
            刷新 Bot 资料
          </Button>
        )}
      </div>
      <Feedback text={error || catalog?.error} failed />
      {!catalog?.error && catalog?.stale && <Feedback text="资料已过期，请打开 Grok Bot。" />}
      {catalog?.bots.map((bot) => (
        <div key={bot.id} className="py-3">
          <h3>{bot.name}</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
            {bot.description || '暂无简介'}
          </p>
        </div>
      ))}
      <SettingsDrawer title="接入 Grok Bot" hidden={!active}>
        <p>把这段 Prompt 交给你的 Agent 或 Codex，按当前官方文档完成接入和后续更新。</p>
        <textarea
          aria-label="Grok Bot 接入 Prompt"
          className="mt-4 min-h-80 w-full resize-y rounded border bg-transparent p-3 text-sm"
          readOnly
          value={botSetupPrompt}
        />
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
        <Feedback text={copied} />
      </SettingsDrawer>
    </section>
  );
}
