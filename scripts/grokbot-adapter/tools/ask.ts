// [INPUT]: Verified current roster and upstream BDK tool.
// [OUTPUT]: Guarded ask, keeping upstream session locks and unread cursor.
// [POS]: PALBOO BDK overlay. [PROTOCOL]: See scripts/AGENTS.md.
import { defineTool } from '@cursor/bdk/tools';
import { requireBot, upstream } from '../guard.mjs';
const original = await upstream('ask');
export default defineTool({
  description: original.description,
  effect: original.effect,
  inputSchema: original.inputSchema,
  async execute(input, ctx) {
    return original.execute(requireBot(input), ctx);
  },
});
