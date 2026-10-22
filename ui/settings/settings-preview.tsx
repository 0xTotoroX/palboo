/* [INPUT]: Shared preview frame, existing form snapshots, saved surfaces and feature layout.
 * [OUTPUT]: Compact linked diagrams and state-preserving samples; only the common switcher reserves inactive geometry.
 * [POS]: Settings presentation only; no requests, credentials, task bodies or host commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { LayoutPreview } from './layout-preview';
import { useState, type ReactNode } from 'react';
import type { SettingsPage } from './settings-outline';
import type { EditableSettings, View } from './api';
import type { SurfaceState } from './surface-settings';
import { titles, type FeatureState } from '../shared/features';
import type { ModelState } from '../features/model/catalog';
import type { TaskState } from '../features/board/api';
import { columns as defaultColumns } from '../features/board/api';
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
  const [tab, setTab] = useState<'outline' | 'next' | 'board' | 'model' | 'bots'>('next');
  const [selected, setSelected] = useState(0);
  const [demoDraft, setDemoDraft] = useState('');
  const [selectedBot, setSelectedBot] = useState('通用');
  const activeScene =
    page === 'bots'
      ? 'bots'
      : page === 'board'
        ? 'board'
        : page === 'model-control'
          ? 'model'
          : ['next', 'prompts'].includes(page)
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
  const groups = tasks?.store.columns || defaultColumns;
  const examples = ['完善实现方案', '检查边界条件', '补充验证步骤'];
  return (
    <Frame title="功能如何呈现" status={dirty ? '包含未保存的编辑' : undefined}>
      <div
        className="preview-selector"
        role="group"
        aria-label="功能预览"
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
                      aria-label="大纲定位示例"
                      data-settings-navigation
                    >
                      {['整体思路', '具体实现', '验证与交付'].map((label, index) => (
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
                      <span>示例段落</span>
                      <strong>{['整体思路', '具体实现', '验证与交付'][selected]}</strong>
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
                          <button type="button" key={text} onClick={() => setDemoDraft(text)}>
                            <span>0{index + 1}</span>
                            <div>
                              <strong>{text}</strong>
                              {!view?.panelPreferences.ui.labelOnly && (
                                <small>
                                  {
                                    [
                                      '把已选方案分解成可执行的步骤。',
                                      '检查输入、异常和兼容情况。',
                                      '用具体场景核对预期行为。',
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
                            {item.label || '未命名'}
                          </button>
                        ))}
                      </div>
                      <div className="preview-draft" role="status">
                        {demoDraft || '点选建议，查看示例输入效果'}
                      </div>
                    </div>
                  </>
                )}
                {scene === 'board' && (
                  <div className="preview-board">
                    {groups.map((group, index) => (
                      <div key={group.id}>
                        <h3>{group.title}</h3>
                        <div className="preview-task-sample">
                          <i />
                          {['梳理目标', '完善细节', '完成验证'][index % 3]}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {scene === 'bots' && (
                  <>
                    <div
                      className="preview-outline"
                      role="group"
                      aria-label="Bot 选择示例"
                      data-settings-navigation
                    >
                      {['通用', '代码审查', '资料整理'].map((name) => (
                        <button
                          type="button"
                          key={name}
                          aria-pressed={selectedBot === name}
                          onClick={() => setSelectedBot(name)}
                        >
                          {name}
                          <Icon name="chevron-right" />
                        </button>
                      ))}
                    </div>
                    <div
                      className="preview-draft"
                      role="status"
                    >{`请问「${selectedBot}」：帮我检查这个方案。`}</div>
                  </>
                )}
                {scene === 'model' && (
                  <>
                    <div className="preview-model-name">
                      <span>当前模型</span>
                      <strong>{model?.snapshot?.current?.model || '尚未识别'}</strong>
                      <small>
                        {[model?.snapshot?.current?.reasoning, model?.snapshot?.current?.speed]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </div>
                    <Facts
                      items={[
                        ['常用模型', String(model?.preferences.pinned?.length ?? 0)],
                        ['收藏预设', String(model?.preferences.presets?.length ?? 0)],
                        ['自定义分组', String(model?.preferences.groups?.length ?? 0)],
                      ]}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="preview-note">示例操作不发送消息或修改任务。</p>
    </Frame>
  );
}

function GenerationPreview({ form, dirty }: PreviewProps) {
  return (
    <Frame title="共享模型连接" status={dirty ? '包含未保存的编辑' : undefined}>
      <div className="preview-model-name">
        <strong>{form?.model || '尚未配置模型'}</strong>
        <span>{form?.provider === 'codex' ? 'Codex 登录' : form?.protocol || '—'}</span>
      </div>
      <p className="preview-note">下一步、提示词优化与术语共用此连接，只在功能开启且需要时调用。</p>
      <Facts
        items={[
          ['输出上限', `${form?.maxOutputTokens ?? '—'} tokens`],
          ['请求超时', `${form ? form.timeoutMs / 1000 : '—'} 秒`],
        ]}
      />
    </Frame>
  );
}
function ConnectionPreview({ view, live, form }: PreviewProps) {
  const status = view?.connection.status;
  const connected = live && status === 'connected';
  return (
    <Frame title="连接状态">
      <div className="preview-connection" data-connected={connected}>
        <Icon name="connection" />
        <strong>
          {connected
            ? '连接已就绪'
            : !live
              ? '本地服务未连接'
              : status === 'unresponsive'
                ? '页面暂未响应'
                : '等待桌面连接'}
        </strong>
        <span>Palboo → ChatGPT</span>
      </div>
      <Facts
        items={[
          ['本地服务', live ? '可用' : '未连接'],
          ['桌面页面', connected ? '已连接' : status === 'unresponsive' ? '暂未响应' : '未连接'],
          ['启动行为', form?.hostRestartPolicy === 'force' ? '直接强制重开' : '询问后正常重开'],
          ['版本', view?.version || '—'],
        ]}
      />
    </Frame>
  );
}

export function SettingsPreview(props: PreviewProps) {
  const workspace = props.page === 'surfaces' || props.page === 'appearance';
  return (
    <aside
      className="settings-preview"
      aria-label="联动预览"
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
      ) : ['features', 'next', 'prompts', 'board', 'model-control', 'bots'].includes(props.page) ? (
        <FeaturePreview {...props} />
      ) : props.page === 'model' ? (
        <GenerationPreview {...props} />
      ) : (
        <ConnectionPreview {...props} />
      )}
    </aside>
  );
}
