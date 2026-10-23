/* [INPUT]: Shared direction drafts, built-in catalog and revision-aware save/delete queue.
 * [OUTPUT]: One drawer with categorized directory, single-item editing and retained navigation/drafts.
 * [POS]: Stepwise library presentation; never copies settings or creates a second save queue.
 * [PROTOCOL]: Keep settings/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '../shared/icons/react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Field } from './settings-controls';
import { ConfirmationButton } from './settings-confirmation';
import { SettingsDrawer, DrawerSaveControls } from './settings-drawer';
import type { SettingsEditor } from './use-settings-form';

export function DirectionLibrary({ editor }: { editor: SettingsEditor }) {
  const { form, saved, change, schedule } = editor;
  const root = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState<'builtin' | 'custom'>('builtin');
  const [selected, setSelected] = useState<string | null>(null);
  const scroll = useRef({ builtin: 0, custom: 0 });
  const returning = useRef<string | null>(null);
  const focusPending = useRef(false);
  const library = form!.directionLibrary;
  const originals = new Map(saved!.builtInDirections.map((item) => [item.id, item]));
  const groupName = group === 'builtin' ? '内置方向' : '我的方向';
  const active = library.find((item) => item.id === selected);
  const items = library.filter((item) => originals.has(item.id) === (group === 'builtin'));

  function openItem(id: string) {
    scroll.current[group] = root.current?.closest('.settings-drawer-content')?.scrollTop || 0;
    focusPending.current = true;
    setSelected(id);
  }
  function back() {
    returning.current = selected;
    focusPending.current = true;
    setSelected(null);
  }
  useLayoutEffect(() => {
    const node = root.current;
    const reveal = (event: Event) => {
      const target = event.target as HTMLElement;
      const id = target.closest<HTMLElement>('[data-direction-detail]')?.dataset.directionDetail;
      if (!id) return;
      // Validation/search must expose the original mounted field before focusing it.
      flushSync(() => {
        setGroup(saved!.builtInDirections.some((item) => item.id === id) ? 'builtin' : 'custom');
        setSelected(id);
      });
    };
    node?.addEventListener('buddy-settings-detail-reveal', reveal);
    return () => node?.removeEventListener('buddy-settings-detail-reveal', reveal);
  }, [saved?.builtInDirections]);
  useLayoutEffect(() => {
    if (selected && !active) {
      focusPending.current = true;
      setSelected(null);
      return;
    }
    if (!focusPending.current) return;
    focusPending.current = false;
    const node = root.current;
    const content = node?.closest('.settings-drawer-content');
    const target = active
      ? node?.querySelector<HTMLElement>('[data-direction-detail]:not([hidden]) input')
      : Array.from(node?.querySelectorAll<HTMLButtonElement>('[data-direction-open]') || []).find(
          (button) => button.dataset.directionOpen === returning.current,
        ) || node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    target?.focus({ preventScroll: true });
    if (content) content.scrollTop = active ? 0 : scroll.current[group];
  }, [selected, active?.id, group]);

  return (
    <SettingsDrawer
      id="settings-direction-library"
      title="方向库"
      footer={<DrawerSaveControls editor={editor} />}
    >
      <div ref={root} className="direction-library" data-settings-search-ignore>
        <div hidden={!!active}>
          <nav className="direction-library-nav" aria-label="方向分类" data-settings-navigation>
            {(['builtin', 'custom'] as const).map((key) => (
              <Button
                type="button"
                key={key}
                variant="ghost"
                aria-pressed={group === key}
                onClick={() => {
                  scroll.current[group] =
                    root.current?.closest('.settings-drawer-content')?.scrollTop || 0;
                  setGroup(key);
                  focusPending.current = true;
                  returning.current = null;
                }}
              >
                {key === 'builtin' ? '内置方向' : '我的方向'}
              </Button>
            ))}
          </nav>
          <div className="direction-library-list" role="region" aria-label={groupName}>
            {items.map((item) => (
              <div className="direction-library-row" key={item.id}>
                {form!.directionSource === 'smart' && (
                  <input
                    type="checkbox"
                    aria-label={`启用方向 ${item.name}`}
                    checked={item.enabled}
                    onChange={(event) => {
                      change(
                        'directionLibrary',
                        library.map((d) =>
                          d.id === item.id ? { ...d, enabled: event.target.checked } : d,
                        ),
                      );
                      schedule();
                    }}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  data-settings-navigation
                  data-direction-open={item.id}
                  onClick={() => openItem(item.id)}
                >
                  <span>{item.name || '未命名方向'}</span>
                  <Icon name="chevron-right" />
                </Button>
              </div>
            ))}
            {group === 'custom' && (
              <Button
                type="button"
                variant="ghost"
                className="direction-library-add"
                data-settings-navigation
                disabled={library.length >= saved!.directionLibraryLimit}
                onClick={() => {
                  const id = `custom-${crypto.randomUUID()}`;
                  change('directionLibrary', [
                    ...library,
                    { id, name: '', instruction: '', enabled: true },
                  ]);
                  openItem(id);
                }}
              >
                <Icon name="plus" />
                添加方向
              </Button>
            )}
          </div>
        </div>
        <div hidden={!active}>
          <Button
            type="button"
            variant="ghost"
            className="direction-library-back"
            data-settings-navigation
            onClick={back}
          >
            <Icon name="chevron-right" className="direction-back-icon" />
            {`返回${groupName}`}
          </Button>
          {library.map((item, index) => {
            const original = originals.get(item.id);
            const modified =
              original &&
              (original.name !== item.name || original.instruction !== item.instruction);
            return (
              <div key={item.id} data-direction-detail={item.id} hidden={item.id !== selected}>
                <Field id={`direction-${item.id}-name`} label="名称">
                  <Input
                    id={`direction-${item.id}-name`}
                    aria-label={`方向名称 ${index + 1}`}
                    required
                    maxLength={40}
                    value={item.name}
                    onChange={(event) =>
                      change(
                        'directionLibrary',
                        library.map((d) =>
                          d.id === item.id ? { ...d, name: event.target.value } : d,
                        ),
                      )
                    }
                  />
                </Field>
                <Field id={`direction-${item.id}-instruction`} label="方向说明">
                  <textarea
                    id={`direction-${item.id}-instruction`}
                    aria-label={`倾向说明 ${index + 1}`}
                    required
                    maxLength={4000}
                    rows={6}
                    value={item.instruction}
                    onChange={(event) =>
                      change(
                        'directionLibrary',
                        library.map((d) =>
                          d.id === item.id ? { ...d, instruction: event.target.value } : d,
                        ),
                      )
                    }
                  />
                </Field>
                <div className="settings-actions">
                  {modified && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`恢复方向 ${item.name} 的默认内容`}
                      onClick={() => {
                        change(
                          'directionLibrary',
                          library.map((d) =>
                            d.id === item.id
                              ? { ...d, name: original.name, instruction: original.instruction }
                              : d,
                          ),
                        );
                        schedule();
                      }}
                    >
                      <Icon name="refresh" />
                      恢复默认
                    </Button>
                  )}
                  <ConfirmationButton
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除方向 ${item.name}`}
                    revision={saved!.configurationRevision}
                    disabled={editor.saving || editor.remoteChanged}
                    title={`删除方向“${item.name || '未命名'}”？`}
                    description="会删除名称和说明，并从已选方向中移除；不会删除已生成的建议。"
                    confirmLabel="确认删除"
                    onConfirm={() =>
                      editor.removeEntry('direction', item.id, saved!.configurationRevision)
                    }
                  >
                    <Icon name="trash" />
                  </ConfirmationButton>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SettingsDrawer>
  );
}
