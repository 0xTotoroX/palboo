import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared preview frame, existing form snapshots, saved surfaces and feature layout.
 * [OUTPUT]: Compact linked diagrams and floating feature samples without instructional footnotes; only the common switcher reserves inactive geometry.
 * [POS]: Settings presentation only; no requests, credentials, task bodies or host commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { LayoutPreview } from './layout-preview';
import { ModelPreview } from './model-preview';
import { useState, type ReactNode } from 'react';
import type { SettingsPage } from './settings-outline';
import type { EditableSettings, View } from './api';
import type { SurfaceState } from './surface-settings';
import { titles, type FeatureState } from '../shared/features';
import type { ModelState } from '../features/model/catalog';
import type { TaskState } from '../features/board/api';
import { columns as defaultColumns, columnTitle } from '../features/board/api';
import { Icon } from '../shared/icons/react';
import { PreviewFrame as Frame } from './preview-frame';
import { usePreviewTransition } from './settings-motion';

function suggestionLimit(form: EditableSettings | null) {
  return form?.directionSource === 'manual'
    ? form.selectedDirections.length
    : (form?.maxItems ?? 3);
}
type PreviewProps = {
  page: SettingsPage;
  form: EditableSettings | null;
  dirty: boolean;
  features: FeatureState | null;
  surfaces: SurfaceState | null;
  model: ModelState | null;
  tasks: TaskState | null;
  view: View | null;
  live: boolean;
};

function Facts({ items }: { items: [string, ReactNode][] }) {
  useLocale();
  return (
    <dl className="preview-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FeaturePreview({ form, tasks, model, view, dirty, page }: PreviewProps) {
  useLocale();
  const [tab, setTab] = useState<'outline' | 'next' | 'board' | 'model' | 'bots'>('next');
  const [selected, setSelected] = useState(0);
  const [demoDraft, setDemoDraft] = useState('');
  const [selectedBot, setSelectedBot] = useState('general');
  const [boardGroup, setBoardGroup] = useState('');
  const activeScene =
    page === 'bots'
      ? 'bots'
      : page === 'board'
        ? 'board'
        : page === 'model-control'
          ? 'model'
          : page === 'next'
            ? 'next'
            : tab;
  const transition = usePreviewTransition(activeScene);
  const enabled = {
    outline: form?.answerOutlineEnabled,
    next: form?.enabled,
    board: tasks?.store.boardEnabled,
    model: model?.preferences.enabled,
    bots: form?.grokbotEnabled,
  };
  const groups = (tasks?.store.columns || defaultColumns).map((column) => ({
    ...column,
    title: columnTitle(column),
  }));
  const examples = [tr('完善实现方案'), tr('检查边界条件'), tr('补充验证步骤')];
  return (
    <Frame title={tr('功能如何呈现')} status={dirty ? tr('包含未保存的编辑') : undefined}>
      <div
        className="preview-selector"
        role="group"
        aria-label={tr('功能预览')}
        hidden={page !== 'features'}
        data-settings-navigation
      >
        {(['outline', 'next', 'board', 'model', 'bots'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeScene === id}
            onClick={() => setTab(id)}
          >
            {titles[id]}
          </button>
        ))}
      </div>
      <div className="preview-scenes" data-single-scene={page !== 'features'} ref={transition}>
        {(['outline', 'next', 'board', 'model', 'bots'] as const).map((scene) => {
          const active = enabled[scene];
          return (
            <div
              key={scene}
              className="preview-scene"
              data-preview-scene={scene}
              data-active={activeScene === scene}
              aria-hidden={activeScene !== scene}
              inert={activeScene !== scene}
            >
              <div className="preview-demo" data-enabled={active !== false}>
                {scene === 'outline' && (
                  <>
                    <div
                      className="preview-outline"
                      role="group"
                      aria-label={tr('大纲定位示例')}
                      data-settings-navigation
                    >
                      {[tr('整体思路'), tr('具体实现'), tr('验证与交付')].map((label, index) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected === index}
                          onClick={() => setSelected(index)}
                        >
                          <span>0{index + 1}</span>
                          {label}
                          <Icon name="chevron-right" />
                        </button>
                      ))}
                    </div>
                    <div className="preview-answer">
                      <strong>
                        {[tr('整体思路'), tr('具体实现'), tr('验证与交付')][selected]}
                      </strong>
                      <i />
                      <i />
                      <i />
                    </div>
                  </>
                )}
                {scene === 'next' && (
                  <>
                    <div className="preview-suggestions" data-settings-navigation>
                      {examples
                        .slice(0, Math.max(0, Math.min(3, suggestionLimit(form))))
                        .map((text, index) => (
                          <button
                            type="button"
                            key={text}
                            aria-pressed={demoDraft === text}
                            onClick={() => setDemoDraft(text)}
                          >
                            <span>0{index + 1}</span>
                            <div>
                              <strong>{text}</strong>
                              {!view?.panelPreferences.ui.labelOnly && (
                                <small>
                                  {
                                    [
                                      tr('把已选方案分解成可执行的步骤。'),
                                      tr('检查输入、异常和兼容情况。'),
                                      tr('用具体场景核对预期行为。'),
                                    ][index]
                                  }
                                </small>
                              )}
                            </div>
                            <Icon name="chevron-right" />
                          </button>
                        ))}
                    </div>
                    <div className="preview-composer">
                      <div className="preview-quick-prompts" data-settings-navigation>
                        {form?.quickPrompts.map((item, index) => (
                          <button
                            type="button"
                            key={index}
                            onClick={() => setDemoDraft(item.prompt)}
                          >
                            {item.label || tr('未命名')}
                          </button>
                        ))}
                      </div>
                      <div
                        className="preview-draft"
                        role="status"
                        aria-label={tr('示例输入框')}
                        data-empty={!demoDraft}
                      >
                        {demoDraft || tr('发消息…')}
                      </div>
                    </div>
                  </>
                )}
                {scene === 'board' && (
                  <div className="preview-board-container">
                    <div
                      className="preview-selector preview-board-tabs"
                      role="group"
                      aria-label={tr('看板分组预览')}
                    >
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          aria-pressed={
                            group.id ===
                            (groups.some((g) => g.id === boardGroup) ? boardGroup : groups[0]?.id)
                          }
                          onClick={() => setBoardGroup(group.id)}
                        >
                          {group.title}
                        </button>
                      ))}
                    </div>
                    <div className="preview-board">
                      {groups.map((group, index) => (
                        <div
                          key={group.id}
                          data-active={
                            group.id ===
                            (groups.some((g) => g.id === boardGroup) ? boardGroup : groups[0]?.id)
                          }
                        >
                          <h3>{group.title}</h3>
                          <div className="preview-task-sample">
                            <i />
                            {[tr('梳理目标'), tr('完善细节'), tr('完成验证')][index % 3]}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {scene === 'bots' && (
                  <>
                    <div
                      className="preview-outline"
                      role="group"
                      aria-label={tr('Bot 选择示例')}
                      data-settings-navigation
                    >
                      {[
                        ['general', tr('通用')],
                        ['review', tr('代码审查')],
                        ['research', tr('资料整理')],
                      ].map(([id, name]) => (
                        <button
                          type="button"
                          key={name}
                          aria-pressed={selectedBot === id}
                          onClick={() => setSelectedBot(id)}
                        >
                          {name}
                          <Icon name="chevron-right" />
                        </button>
                      ))}
                    </div>
                    <div className="preview-draft" role="status">
                      {tr('请问「{{selectedBot}}」：帮我检查这个方案。', {
                        selectedBot: tr(
                          selectedBot === 'general'
                            ? '通用'
                            : selectedBot === 'review'
                              ? '代码审查'
                              : '资料整理',
                        ),
                      })}
                    </div>
                  </>
                )}
                {scene === 'model' && <ModelPreview model={model} />}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function GenerationPreview({ form, dirty }: PreviewProps) {
  useLocale();
  return (
    <Frame title={tr('共享模型连接')} status={dirty ? tr('包含未保存的编辑') : undefined}>
      <div className="preview-demo">
        <div className="preview-model-name">
          <strong>{form?.model || tr('尚未配置模型')}</strong>
          <span>{form?.provider === 'codex' ? tr('Codex 登录') : form?.protocol || '—'}</span>
        </div>
        <Facts
          items={[
            [tr('输出上限'), `${form?.maxOutputTokens ?? '—'} tokens`],
            [tr('请求超时'), tr('{{value1}} 秒', { value1: form ? form.timeoutMs / 1000 : '—' })],
          ]}
        />
      </div>
    </Frame>
  );
}
function ConnectionPreview({ view, live, form }: PreviewProps) {
  useLocale();
  const status = view?.connection.status;
  const connected = live && status === 'connected';
  return (
    <Frame title={tr('连接状态')}>
      <div className="preview-demo">
        <div className="preview-connection" data-connected={connected}>
          <Icon name="connection" />
          <strong>
            {connected
              ? tr('连接已就绪')
              : !live
                ? tr('本地服务未连接')
                : status === 'unresponsive'
                  ? tr('页面暂未响应')
                  : tr('等待桌面连接')}
          </strong>
        </div>
        <Facts
          items={[
            [tr('本地服务'), live ? tr('可用') : tr('未连接')],
            [
              tr('桌面页面'),
              connected ? tr('已连接') : status === 'unresponsive' ? tr('暂未响应') : tr('未连接'),
            ],
            [
              tr('启动行为'),
              form?.hostRestartPolicy === 'force' ? tr('直接强制重开') : tr('询问后正常重开'),
            ],
            [tr('版本'), view?.version || '—'],
          ]}
        />
      </div>
    </Frame>
  );
}

export function SettingsPreview(props: PreviewProps) {
  useLocale();
  const workspace = props.page === 'surfaces' || props.page === 'appearance';
  return (
    <aside
      className="settings-preview"
      aria-label={tr('联动预览')}
      hidden={['performance', 'terminology', 'codex-host', 'dev'].includes(props.page)}
      data-preview-kind={workspace ? 'workspace' : props.page}
    >
      {workspace ? (
        <LayoutPreview
          features={props.features}
          surfaces={props.surfaces}
          live={props.live}
          appearance={props.page === 'appearance'}
          typography={props.view?.panelTypography}
          typographyPreferences={props.view?.panelPreferences.typography}
        />
      ) : ['features', 'next', 'board', 'model-control', 'bots'].includes(props.page) ? (
        <FeaturePreview {...props} />
      ) : props.page === 'model' ? (
        <GenerationPreview {...props} />
      ) : (
        <ConnectionPreview {...props} />
      )}
    </aside>
  );
}
