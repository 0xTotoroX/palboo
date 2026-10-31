/* [INPUT]: Visible Bot metadata, an explicit selection and a guarded read-only reply loader.
 * [OUTPUT]: Message directory and one complete Markdown reply with independent reading positions.
 * [POS]: Bot reading view; never invokes composer actions. [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tr } from '../../shared/i18n.js';
import { errorMessage } from '../../shared/text.js';
import { readWorkbenchScroll, writeWorkbenchScroll } from '../../shared/scroll.js';
import type { Reading } from '../../shared/features';

export type BotReply = {
  botId: string;
  agent: string;
  revision: string;
  messageId: string;
  text: string;
  hasAttachments: boolean;
};
export type ReplyLoader = (data: {
  botId: string;
  agent: string;
  revision: string;
}) => Promise<BotReply>;
type MessageBot = { id?: string; name: string; preview?: string; available?: boolean };

export function BotMessages({
  bots,
  selected,
  select,
  revision,
  stale,
  readReply,
  reading,
  id,
}: {
  bots: MessageBot[];
  selected: string | null;
  select: (id: string | null) => void;
  revision: string;
  stale: boolean;
  readReply?: ReplyLoader;
  reading?: Reading;
  id: string;
}) {
  const root = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  const previous = useRef('directory');
  const returnFocus = useRef<string | null>(null);
  const [result, setResult] = useState<{ key: string; reply?: BotReply; error?: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const bot = bots.find((bot) => (bot.id || bot.name) === selected);
  const key = bot ? `${revision}:${bot.id || bot.name}` : 'directory';
  const loader = useRef(readReply);
  loader.current = readReply;
  const active = result?.key === key ? result : null;

  const scrollNode = () =>
    root.current?.closest<HTMLElement>('.feature-body') ||
    (document.scrollingElement as HTMLElement | null);
  useLayoutEffect(() => {
    const node = scrollNode();
    const save = () => {
      if (node?.clientHeight && (key === 'directory' || active?.reply))
        positions.current.set(key, readWorkbenchScroll(node));
    };
    const top = positions.current.get(key) || 0;
    if (reading) reading.top = top;
    writeWorkbenchScroll(node, top);
    if (previous.current !== key) {
      if (key === 'directory')
        Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-bot-id]') || [])
          .find((button) => button.dataset.botId === returnFocus.current)
          ?.focus({ preventScroll: true });
      else root.current?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
    }
    previous.current = key;
    node?.addEventListener('scroll', save);
    return () => node?.removeEventListener('scroll', save);
  }, [key, Boolean(active?.reply), reading]);

  useEffect(() => {
    if (!bot) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    void (async () => {
      try {
        if (stale || bot.available === false)
          throw Error(tr('Bot 资料已变化，请返回最近消息后重试。'));
        if (!loader.current || !bot.id) throw Error(tr('当前预览不读取 Bot 回答。'));
        const reply = await loader.current({ botId: bot.id, agent: bot.name, revision });
        if (
          reply.botId !== bot.id ||
          reply.agent !== bot.name ||
          reply.revision !== revision ||
          typeof reply.text !== 'string'
        )
          throw Error(tr('Bot 资料已变化，请返回最近消息后重试。'));
        if (!cancelled) setResult({ key, reply });
      } catch (error) {
        if (!cancelled) setResult({ key, error: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, retry, stale, bot?.available]);

  if (bot)
    return (
      <article ref={root} className="palboo-bot-reader" id={id} aria-label={bot.name}>
        <h3 tabIndex={-1}>{bot.name}</h3>
        {!active && <p role="status">{tr('正在读取回答…')}</p>}
        {active?.error && (
          <div className="palboo-bot-read-error">
            <p role="alert">{active.error}</p>
            <button type="button" onClick={() => setRetry(retry + 1)}>
              {tr('重试')}
            </button>
          </div>
        )}
        {active?.reply && (
          <>
            {active.reply.text ? (
              <div className="palboo-bot-markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => (/^(https?:\/\/|mailto:|#)/i.test(url) ? url : '')}
                  components={{
                    a: ({ children, href }) =>
                      href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      ),
                    img: ({ alt, src }) =>
                      src ? (
                        <a href={src} target="_blank" rel="noreferrer noopener">
                          {alt || tr('图片')}
                        </a>
                      ) : (
                        <span>{alt || tr('图片')}</span>
                      ),
                  }}
                >
                  {active.reply.text}
                </Markdown>
              </div>
            ) : (
              !active.reply.hasAttachments && <p role="status">{tr('暂无完整回答')}</p>
            )}
            {active.reply.hasAttachments && (
              <p role="status">{tr('此回答包含附件，请在 Grok Bot 中查看。')}</p>
            )}
          </>
        )}
      </article>
    );
  return (
    <section ref={root} className="palboo-bot-messages" id={id} aria-label={tr('最近消息')}>
      {bots.length ? (
        bots.map((bot) => (
          <button
            type="button"
            className="palboo-bot-message"
            data-bot-id={bot.id || bot.name}
            key={bot.id || bot.name}
            aria-label={tr('查看「{{agent}}」的完整回答', { agent: bot.name })}
            onClick={() => {
              returnFocus.current = bot.id || bot.name;
              positions.current.set('directory', scrollNode()?.scrollTop || 0);
              select(bot.id || bot.name);
            }}
          >
            <span className="palboo-bot-message-name">{bot.name}</span>
            <span className="palboo-bot-preview">{bot.preview}</span>
          </button>
        ))
      ) : (
        <p role="status" aria-label={tr('暂无最近消息')}>
          {tr('暂无最近消息')}
        </p>
      )}
    </section>
  );
}
