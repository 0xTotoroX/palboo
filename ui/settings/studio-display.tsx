/* [INPUT]: Website-only stand retraction progress from the scroll timeline.
 * [OUTPUT]: Reference-built Three.js display behind the live settings preview.
 * [POS]: Optional hardware frame; rendered model posters cover loading and WebGL loss.
 * [PROTOCOL]: Keep settings/AGENTS.md and the model source record in sync. */
import { useEffect, useRef, useState } from 'react';
import type { mountStudioDisplay } from './studio-display-renderer';

type DisplayRenderer = ReturnType<typeof mountStudioDisplay>;

export function StudioDisplayFrame({ progress = 0 }: { progress?: number }) {
  const shellPoster = new URL('./studio-display-shell.webp', import.meta.url).href;
  const standPoster = new URL('./studio-display-stand.webp', import.meta.url).href;
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<DisplayRenderer | null>(null);
  const latestProgress = useRef(progress);
  const [ready, setReady] = useState(false);
  latestProgress.current = progress;
  useEffect(() => {
    let disposed = false;
    const element = canvas.current;
    if (!element) return;
    const lost = (event: Event) => {
      event.preventDefault();
      setReady(false);
      renderer.current?.dispose();
      renderer.current = null;
    };
    element.addEventListener('webglcontextlost', lost);
    void import('./studio-display-renderer')
      .then(({ mountStudioDisplay }) => {
        if (disposed) return;
        try {
          renderer.current = mountStudioDisplay(element);
          renderer.current.render(latestProgress.current);
          setReady(true);
        } catch {
          // The same model remains visible as a local render when WebGL is unavailable.
          renderer.current?.dispose();
          renderer.current = null;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      element.removeEventListener('webglcontextlost', lost);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => renderer.current?.render(progress), [progress]);
  const retraction = Math.max(0, Math.min(1, progress));
  const layer = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%' };
  return (
    <foreignObject
      className="studio-display-frame"
      x="0"
      y="0"
      width="736"
      height="600"
      aria-hidden="true"
      data-progress={retraction}
      data-renderer={ready ? 'webgl' : 'poster'}
      style={{ pointerEvents: 'none' }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div style={{ ...layer, visibility: ready ? 'hidden' : 'visible' }}>
          <img
            src={standPoster}
            alt=""
            draggable={false}
            style={{
              ...layer,
              transform: `translateY(${-148 * retraction}px)`,
              opacity: retraction === 1 ? 0 : 1,
            }}
          />
          <img src={shellPoster} alt="" draggable={false} style={layer} />
        </div>
        <canvas
          ref={canvas}
          width="736"
          height="600"
          style={{ ...layer, opacity: ready ? 1 : 0 }}
        />
      </div>
    </foreignObject>
  );
}
