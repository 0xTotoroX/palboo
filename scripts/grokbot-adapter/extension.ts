// [INPUT]: Pinned BDK extension; guarded dynamic roster overlays.
// [OUTPUT]: Existing grokbot namespace, with no static Bot names.
// [POS]: PALBOO BDK directory mount. [PROTOCOL]: See scripts/AGENTS.md.
import grokbot from '@cursor/bdk/extensions/cursor-grokbot-agents';
export default grokbot({ needsApproval: false });
