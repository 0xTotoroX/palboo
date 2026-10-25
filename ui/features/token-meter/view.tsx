import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: 可选测速数值快照；不依赖模型选择、承载形式或宿主DOM。
 * [OUTPUT]: 单行估算速度或状态，官方用量仅按需查看，无快照时完全移除。
 * [POS]: 可插拔内容组件；由组合层放入模型快切的可选footer。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import type { TokenMeterSnapshot } from '../../shared/token-meter';
import styles from './styles.css?inline';
const LABELS: Record<string, string> = {
  idle: '— tok/s',
  get waiting() {
    return tr('等待输出');
  },
  get thinking() {
    return tr('思考中');
  },
  get tool() {
    return tr('工具执行中');
  },
  get completed() {
    return tr('已完成');
  },
  get failed() {
    return tr('未完成');
  },
  get interrupted() {
    return tr('已停止');
  },
  get streaming() {
    return tr('接收中');
  },
};
export function TokenMeterView({ snapshot }: { snapshot?: TokenMeterSnapshot | null }) {
  useLocale();
  if (!snapshot) return null;
  const rate =
    snapshot.speed === null
      ? LABELS[snapshot.phase] || '— tok/s'
      : `≈ ${snapshot.speed.toFixed(1)} tok/s`;
  const u = snapshot.official;
  const lines = [tr('速度为最近3秒可见回复的文本估算，不含隐藏思考和工具输出。')];
  if (u) {
    lines.push(
      tr(
        '官方{{value1}}：输入 {{value2}} · 缓存命中 {{value3}} · 输出 {{value4}} · 其中思考 {{value5}} token',
        {
          value1: snapshot.scope === 'turn' ? tr('本轮累计') : tr('最近一次模型调用'),
          value2: u.inputTokens.toLocaleString('en-US'),
          value3: u.cachedInputTokens.toLocaleString('en-US'),
          value4: u.outputTokens.toLocaleString('en-US'),
          value5: u.reasoningOutputTokens.toLocaleString('en-US'),
        },
      ),
    );
    if (snapshot.scope === 'call') lines.push(tr('从本轮中途开始观察，未推算整轮用量。'));
    if (snapshot.average !== null)
      lines.push(
        tr('整轮平均 {{value1}} tok/s（含思考、工具和等待）', {
          value1: snapshot.average.toFixed(1),
        }),
      );
  }
  const title = lines.join('\n');
  return (
    <>
      <style>{styles}</style>
      <output
        className="token-meter-readout"
        aria-live="off"
        tabIndex={0}
        title={title}
        aria-label={`${rate}。${title}`}
      >
        <span>{rate}</span>
      </output>
    </>
  );
}
