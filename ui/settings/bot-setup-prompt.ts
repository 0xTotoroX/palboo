/* [INPUT]: Palboo's local catalog and main-chat integration contract.
 * [OUTPUT]: Copyable instructions for the user's Agent; no installer or runtime dependency.
 * [POS]: Settings help content. [PROTOCOL]: Keep ui/settings/AGENTS.md in sync. */
export const botSetupPrompt = `请帮我把已有的 Grok Bot 接入本机 Codex，并让 Palboo 能显示我的 Bot。所有输入、追问和回复都留在 Codex 主聊天，不另建聊天面板，不新建 Bot。

先阅读当前官方文档并检查本机已有接入：
https://cursor.com/docs/bdk/guides/grokbot-agents
https://cursor.com/docs/bdk/guides/export-grokbot
https://developers.openai.com/codex/mcp
https://developers.openai.com/codex/skills

1. 检查已安装的 Grok Bot、BDK、Codex MCP、Skill 和本地服务；优先复用已有配置，不覆盖其他 MCP、个人 Skill 或登录。不从旧示例盲目锁定 BDK 版本，选择当前可用且经过实际验证的版本。依赖、适配器、Skill 和后台服务独立于 Palboo 安装和维护，保留来源、版本、更新及卸载方法。不要修改 Palboo 程序或官方应用包。
2. 从应用或受支持的接口确认当前账号及现有 Bot 名单，不能写死名称。需要登录时使用官方流程并告诉我；核对 BDK 和 Grok Bot 使用同一账号。不要输出或复制凭据。
3. 通过本机 BDK 注册名为 grokbot 的 MCP。Palboo 目前通过 POST http://127.0.0.1:3417/v1/tools/grokbot__list（JSON 请求体 {"input":{}}）读取资料。接口返回 {"result":{"catalog":{"version":1,"account":"账号匿名标识","revision":"身份修订","stale":false,"bots":[]}}}；错误必须明确返回，不能用示例名单冒充。
   catalog.bots 每项包含稳定 id、精确 name、available，以及可选 description、preview、avatar:{shape,color,photoAvailable}。account 使用账号的不可逆匿名标识，不包含凭据；revision 必须在账号、Bot 身份或名称变化时改变；stale 表示资料过期或账号无法核验。简介与摘要只读，不消费回复游标。官方 BDK 原版 list 不一定提供此目录协议，先核实，必要时在独立接入工程实现兼容层。没有可验证的真实数据来源就停止并报告缺口。
4. Palboo 的自动同步会监听当前 Grok Bot 本机账号槽和 roster 缓存变化；如果官方缓存结构已经改变，明确报告兼容问题，不伪造同步成功。优先使用公开接口；使用本机缓存必须校验格式、账号和时效，不读取完整聊天或登录文件。未知头像形状可以不提供，不猜测官方动画接口。
5. 为当前用户安装可独立更新的 grokbot Skill，使“请问「Bot名」：内容”“追问「Bot名」”“查看「Bot名」的进度”“停止「Bot名」在本聊天中的任务”能调用已有 MCP。先查询动态名单，再整理当前问题和必要上下文。当前 Palboo 识别 grokbot/call_tool 中的 grokbot__ask、grokbot__check、grokbot__interrupt 及 input.agent；如新版名称不同，先验证兼容适配。
6. 账号变化、名单过期、重名或 Bot 不存在时停止，不调用创建接口。先核实上游是否有按名称 get-or-create 行为；如果无法保证仅调用已有 Bot，说明限制，不把本地检查当作云端原子保证。同一 Bot 的会话可能与应用共享；检查任务归属，不能擅自中断其他聊天的任务。
7. 验证 MCP/Skill 发现、真实名单与 Palboo 目录协议，再用我指定的已有 Bot 做无副作用回声测试；验证主聊天能接收回复和继续追问，不输出真实历史全文。没有指定 Bot 时先只读验证。不要自动重启正在工作的 Codex；如需要刷新连接或新开聊天，请明确告知。最后给出真实测试结果、剩余限制，以及独立接入的更新和恢复方法。`;
