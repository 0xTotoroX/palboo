/* [INPUT]: 可选测速数值快照；不依赖模型选择、承载形式或宿主DOM。
 * [OUTPUT]: 单行估算速度或状态，官方用量仅按需查看，无快照时完全移除。
 * [POS]: 可插拔内容组件；由组合层放入模型快切的可选footer。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import type { TokenMeterSnapshot } from '../../shared/token-meter';
import styles from './styles.css?inline';
const LABELS: Record<string, string> = {
  idle: '— tok/s',
  waiting: '等待输出',
  thinking: '思考中',
  tool: '工具执行中',
  completed: '已完成',
  failed: '未完成',
  interrupted: '已停止',
  streaming: '接收中',
};
export function TokenMeterView({ snapshot }: { snapshot?: TokenMeterSnapshot | null }) {
  if (!snapshot) return null;
  const rate =
    snapshot.speed === null
      ? LABELS[snapshot.phase] || '— tok/s'
      : `≈ ${snapshot.speed.toFixed(1)} tok/s`;
  const u = snapshot.official;
  const lines = ['速度为最近3秒可见回复的文本估算，不含隐藏思考和工具输出。'];
  if (u) {
    lines.push(
      `官方${snapshot.scope === 'turn' ? '本轮累计' : '最近一次模型调用'}：输入 ${u.inputTokens.toLocaleString('en-US')} · 缓存命中 ${u.cachedInputTokens.toLocaleString('en-US')} · 输出 ${u.outputTokens.toLocaleString('en-US')} · 其中思考 ${u.reasoningOutputTokens.toLocaleString('en-US')} token`,
    );
    if (snapshot.scope === 'call') lines.push('从本轮中途开始观察，未推算整轮用量。');
    if (snapshot.average !== null)
      lines.push(`整轮平均 ${snapshot.average.toFixed(1)} tok/s（含思考、工具和等待）`);
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
