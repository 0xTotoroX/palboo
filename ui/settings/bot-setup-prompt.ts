/* [INPUT]: Palboo's local catalog and main-chat integration contract.
 * [OUTPUT]: Copyable instructions for the user's Agent; no installer or runtime dependency.
 * [POS]: Settings help content. [PROTOCOL]: Keep ui/settings/AGENTS.md in sync. */
import { getLocale } from '../shared/i18n.js';

export const botSetupPrompt = `请帮我把已有的 Grok Bot 接入本机 Codex，并让 Palboo 能显示我的 Bot。所有输入、追问和回复都留在 Codex 主聊天，不另建聊天面板，不新建 Bot。

先阅读当前官方文档并检查本机已有接入：
https://cursor.com/docs/bdk/guides/grokbot-agents
https://cursor.com/docs/bdk/guides/export-grokbot
https://developers.openai.com/codex/mcp
https://developers.openai.com/codex/skills

1. 检查已安装的 Grok Bot、BDK、Codex MCP、Skill 和本地服务；优先复用已有配置，不覆盖其他 MCP、个人 Skill 或登录。不从旧示例盲目锁定 BDK 版本，选择当前可用且经过实际验证的版本。依赖、适配器、Skill 和后台服务独立于 Palboo 安装和维护，保留来源、版本、更新及卸载方法。不要修改 Palboo 程序或官方应用包。
2. 从应用或受支持的接口确认当前账号及现有 Bot 名单，不能写死名称。需要登录时使用官方流程并告诉我；核对 BDK 和 Grok Bot 使用同一账号。不要输出或复制凭据。
3. 通过本机 BDK 注册名为 grokbot 的 MCP。Palboo 目前通过 POST http://127.0.0.1:3417/v1/tools/grokbot__list（JSON 请求体 {"input":{}}）读取资料。接口返回 {"result":{"catalog":{"version":1,"account":"账号匿名标识","revision":"身份修订","stale":false,"bots":[]}}}；错误必须明确返回，不能用示例名单冒充。
   catalog.bots 每项包含稳定 id、精确 name、available，以及可选 description、preview、hidden（是否在侧栏隐藏）、avatar:{shape,color,photoAvailable}。account 使用账号的不可逆匿名标识，不包含凭据；revision 必须在账号、Bot 身份或名称变化时改变；stale 表示资料过期或账号无法核验。简介与摘要只读，不消费回复游标。官方 BDK 原版 list 不一定提供此目录协议，先核实，必要时在独立接入工程实现兼容层。没有可验证的真实数据来源就停止并报告缺口。
   已保存的侧栏使用可选 catalog.sidebar:{version:1,groups:[{id,kind,name,botIds}]}；kind 为 pinned、section 或 unassigned。groups 按真实保存的显示顺序，置顶组排第一，各 botIds 按最终显示顺序。所有未隐藏 Bot 必须恰好出现一次，不能引用未知或隐藏 ID；catalog.bots 仍保留隐藏 Bot 的身份，避免影响主聊天调用关联。排序或隐藏变化不改变身份 revision。缺失或未知侧栏格式应省略 sidebar 并提供 sidebarError，不伪造空分组或完整同步；旧接口无 sidebar 时沿用基础名单。
4. Palboo 的自动同步会监听当前 Grok Bot 本机账号槽、roster、sidebar.last-sections 和 ui-agent-refs 缓存变化；如果官方缓存结构已经改变，明确报告兼容问题，不伪造同步成功。优先使用公开接口；使用本机缓存必须校验格式、账号和时效，不读取完整聊天或登录文件。侧栏三份资料须来自同一账号并核对读取期间文件未变化；按当前客户端核实置顶、分组、隐藏与排序语义，不把 group conversation 当侧栏分组，也不把成员数组误当组内排序；不跟随临时搜索、未读筛选、拖动或分组折叠。未知头像形状可以不提供，不猜测官方动画接口。
5. 为当前用户安装可独立更新的 grokbot Skill，使“请问「Bot名」：内容”“追问「Bot名」”“查看「Bot名」的进度”“停止「Bot名」在本聊天中的任务”能调用已有 MCP。先查询动态名单，再整理当前问题和必要上下文。当前 Palboo 识别 grokbot/call_tool 中的 grokbot__ask、grokbot__check、grokbot__interrupt 及 input.agent；如新版名称不同，先验证兼容适配。
6. 账号变化、名单过期、重名或 Bot 不存在时停止，不调用创建接口。先核实上游是否有按名称 get-or-create 行为；如果无法保证仅调用已有 Bot，说明限制，不把本地检查当作云端原子保证。同一 Bot 的会话可能与应用共享；检查任务归属，不能擅自中断其他聊天的任务。
7. 验证 MCP/Skill 发现、真实名单与 Palboo 目录协议，再用我指定的已有 Bot 做无副作用回声测试；验证主聊天能接收回复和继续追问，不输出真实历史全文。没有指定 Bot 时先只读验证。不要自动重启正在工作的 Codex；如需要刷新连接或新开聊天，请明确告知。最后给出真实测试结果、剩余限制，以及独立接入的更新和恢复方法。`;

const botSetupPromptEn = `Help me connect my existing Grok Bots to Codex on this Mac and make them available in Palboo. Keep all questions, follow-ups and replies in the main Codex chat. Do not create another chat panel or new Bots.

First read the current official documentation and inspect the existing local integration:
https://cursor.com/docs/bdk/guides/grokbot-agents
https://cursor.com/docs/bdk/guides/export-grokbot
https://developers.openai.com/codex/mcp
https://developers.openai.com/codex/skills

1. Inspect the installed Grok Bot, BDK, Codex MCP servers, Skills and local services. Reuse existing configuration; do not overwrite other MCP servers, personal Skills or sign-ins. Do not pin BDK to a version copied from an old example: choose an available version and verify it. Install and maintain dependencies, adapters, Skills and background services independently of Palboo, recording their sources, versions, update and uninstall procedures. Do not modify Palboo or any official application bundle.
2. Verify the current account and existing Bot roster through the application or a supported interface. Do not hardcode names. If sign-in is required, use the official flow and tell me. Check that BDK and Grok Bot use the same account. Do not print or copy credentials.
3. Register an MCP server named grokbot through the local BDK. Palboo currently reads the catalog using POST http://127.0.0.1:3417/v1/tools/grokbot__list with JSON body {"input":{}}. The response is {"result":{"catalog":{"version":1,"account":"anonymous-account-id","revision":"identity-revision","stale":false,"bots":[]}}}. Return explicit errors; never substitute an example roster for real data.
   Each catalog.bots entry contains a stable id, exact name and available, plus optional description, preview, hidden (whether hidden from the sidebar) and avatar:{shape,color,photoAvailable}. account must be an irreversible anonymous identifier without credentials. revision must change when the account, Bot identity or name changes. stale indicates an outdated catalog or an account that cannot be verified. Descriptions and previews are read-only and must not consume reply cursors. The official BDK list operation may not provide this catalog contract. Verify it first; if needed, implement compatibility in a separate integration project. Stop and report the gap if no verifiable real data source exists.
   A saved sidebar may provide catalog.sidebar:{version:1,groups:[{id,kind,name,botIds}]}, where kind is pinned, section or unassigned. Keep groups in their actual saved display order, with pinned first and each botIds list in its final display order. Every visible Bot must appear exactly once. Do not reference unknown or hidden IDs. Retain hidden Bot identities in catalog.bots so main-chat calls can still be associated. Reordering or hiding must not change the identity revision. If the sidebar format is missing or unknown, omit sidebar and provide sidebarError; do not fabricate empty groups or claim complete synchronization. An older interface without sidebar continues to use the basic roster.
4. Palboo auto-sync watches the active local Grok Bot account slot, roster, sidebar.last-sections and ui-agent-refs caches. If the official cache format has changed, report the compatibility issue rather than claiming successful sync. Prefer public interfaces. Local caches require format, account and freshness validation; do not read full chats or login files. The three sidebar data sources must belong to the same account and remain unchanged during the read. Verify pinning, groups, hiding and ordering against the current client. A group conversation is not a sidebar group, and a member array is not necessarily the group display order. Ignore temporary searches, unread filters, dragging and collapsed groups. Omit unknown avatar shapes; do not guess official animation APIs.
5. Install an independently updatable grokbot Skill for the current user. It should route “Ask [Bot name]: question”, “Follow up with [Bot name]”, “Check [Bot name]'s progress” and “Stop [Bot name]'s task in this chat” to the existing MCP, and support the Chinese equivalents “请问「Bot名」：内容”, “追问「Bot名」”, “查看「Bot名」的进度” and “停止「Bot名」在本聊天中的任务”. Query the live roster first, then prepare the question and necessary context. Palboo currently recognizes grokbot__ask, grokbot__check and grokbot__interrupt within grokbot/call_tool, plus input.agent. Verify compatibility if newer tool names differ.
6. Stop if the account changes, the roster is stale, a name is ambiguous or the Bot does not exist. Do not invoke creation APIs. Check whether the upstream uses get-or-create by name. If existing-Bot-only calls cannot be guaranteed, explain the limitation; a local check is not an atomic cloud guarantee. A Bot session may be shared with its application. Verify task ownership and never interrupt another chat's task without authorization.
7. Verify MCP and Skill discovery, the real roster and Palboo's catalog contract. Then use an existing Bot I specify for a harmless echo test, checking that the main chat receives replies and supports follow-ups. Do not output full real chat history. If I have not specified a Bot, perform read-only checks first. Do not automatically restart an active Codex session. Tell me if the connection needs refreshing or a new chat is necessary. Finish with actual test results, remaining limitations and independent integration update and recovery steps.`;

export function localizedBotSetupPrompt() {
  return getLocale() === 'en' ? botSetupPromptEn : botSetupPrompt;
}
