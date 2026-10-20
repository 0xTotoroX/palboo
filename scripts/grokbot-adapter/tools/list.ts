// [INPUT]: Grok Bot local roster and BDK contact metadata.
// [OUTPUT]: Dynamic PALBOO catalog, never remote message reads.
// [POS]: Read-only BDK overlay. [PROTOCOL]: See scripts/AGENTS.md.
import { defineTool } from '@cursor/bdk/tools';
import { catalog, upstream } from '../guard.mjs';
const original = await upstream('list');
export default defineTool({
  description:
    '读取当前账号已有 Grok Bot 的动态名单、头像资料和最新摘要。仅本机缓存，不创建 Bot，不消费未读回复。',
  effect: 'read',
  inputSchema: original.inputSchema,
  async execute(input, ctx) {
    const current = catalog();
    const result = await original.execute(input, ctx);
    return {
      ...result,
      configured: current.bots.map(
        ({ name, description }: { name: string; description: string }) => ({ name, description }),
      ),
      catalog: current,
    };
  },
});
