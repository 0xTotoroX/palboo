/* [INPUT]: Reader note/image identity and authenticated image transport.
 * [OUTPUT]: Opt-in external images, authenticated local images and lightbox.
 * [POS]: Live reader only; the website imports the transport-free Markdown view.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { raw } from './api';
import { tr } from '../shared/i18n.js';
import { webUrl } from './markdown';
export function ReaderPicture({
  from,
  source,
  alt,
  width,
  height,
}: {
  from: string;
  source: string;
  alt: string;
  width?: string | number;
  height?: string | number;
}) {
  const external = webUrl(source);
  const [allowed, setAllowed] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setUrl('');
    setError('');
    setAllowed(false);
    if (!source || external) return;
    const controller = new AbortController();
    let blob = '';
    void raw('image', { id: from, target: source }, controller.signal)
      .then((r) => r.blob())
      .then((value) => {
        if (controller.signal.aborted) return;
        blob = URL.createObjectURL(value);
        setUrl(blob);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [from, source, external]);
  const displayed = external ? (allowed ? external : '') : url;
  if (external && !allowed)
    return (
      <button className="reader-remote-image" onClick={() => setAllowed(true)} title={external}>
        {tr('加载外部图片')} · {alt || new URL(external).hostname}
      </button>
    );
  if (error)
    return (
      <span className="reader-image-error" role="status">
        {alt} — {error}
      </span>
    );
  if (!displayed) return <span role="status">{tr('正在读取图片…')}</span>;
  return (
    <span className="reader-picture">
      <button type="button" aria-label={tr('放大图片')} onClick={() => dialog.current?.showModal()}>
        <img
          src={displayed}
          alt={alt}
          width={width}
          height={height}
          referrerPolicy="no-referrer"
          onError={() => setError(tr('图片无法显示'))}
        />
      </button>
      <dialog ref={dialog} className="reader-lightbox" onClick={() => dialog.current?.close()}>
        <button type="button" aria-label={tr('关闭')} onClick={() => dialog.current?.close()}>
          ×
        </button>
        <img src={displayed} alt={alt} referrerPolicy="no-referrer" />
      </dialog>
    </span>
  );
}
