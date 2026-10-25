import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Demonstration children, window geometry and optional website camera/material progress.
 * [OUTPUT]: Shared device/secondary display; a continuous material close-up preserves the workspace node.
 * [POS]: Local vector illustration; no screenshots, external assets or product commands.
 * [PROTOCOL]: Keep settings/AGENTS.md and website/AGENTS.md in sync. */
import type { ReactNode, Ref } from 'react';
import { PalbooWordmark } from '../shared/brand';
export type DemoFrame = { x: number; y: number; w: number; h: number; secondary: number };
export const demoFrames: Record<string, DemoFrame> = {
  sidebar: { x: 454, y: 82, w: 244, h: 380, secondary: 0 },
  overlay: { x: 402, y: 120, w: 270, h: 326, secondary: 0 },
  popped: { x: 414, y: 105, w: 274, h: 348, secondary: 0 },
  desktop: { x: 754, y: 230, w: 330, h: 246, secondary: 1 },
  edge: { x: 468, y: 100, w: 230, h: 362, secondary: 0 },
};
export function LayoutPreviewScene({
  frame,
  children,
  title = tr('布局与位置'),
  hostName = 'ChatGPT',
  placement,
  zoom,
  entryRef,
  focusWorkspace = false,
  materialProgress,
}: {
  frame: DemoFrame;
  children: ReactNode;
  title?: string;
  hostName?: string;
  placement?: string;
  zoom?: number;
  entryRef?: Ref<SVGGElement>;
  focusWorkspace?: boolean;
  materialProgress?: number;
}) {
  useLocale();
  const chatWidth =
    (!placement || placement === 'sidebar') && frame.x < 710 ? Math.max(230, frame.x - 190) : 498;
  // The website approaches this same device; settings keep their original framing.
  const camera = Math.max(0, Math.min(1, zoom ?? 0)) * (1 - frame.secondary);
  const width = 1120 - 384 * camera;
  const height = width / 1.6;
  const center = 368 + 192 * frame.secondary;
  const material = Math.max(0, Math.min(1, materialProgress ?? 0));
  const mix = (from: number, to: number) => from + (to - from) * material;
  const reveal = (start: number, end: number) => {
    const t = Math.max(0, Math.min(1, (material - start) / (end - start)));
    return t * t * (3 - 2 * t);
  };
  const sampleFrame = focusWorkspace
    ? frame
    : {
        ...frame,
        x: mix(frame.x, 148),
        y: mix(frame.y, 60),
        w: mix(frame.w, 440),
        h: mix(frame.h, 340),
      };
  const materialBackdrop = focusWorkspace
    ? { x: frame.x - 12, y: frame.y - 12, w: frame.w + 24, h: frame.h + 24 }
    : { x: 22, y: 16, w: 694, h: 428 };
  return (
    <svg
      className="layout-demo-scene"
      viewBox={
        focusWorkspace
          ? `${frame.x - 12} ${frame.y - 12} ${frame.w + 24} ${frame.h + 24}`
          : zoom === undefined
            ? `${-188 * (1 - frame.secondary)} 16 1120 500`
            : `${mix(center - width / 2, 0)} ${mix(264 - height / 2, 0)} ${mix(width, 736)} ${mix(height, 460)}`
      }
      style={focusWorkspace ? { aspectRatio: `${frame.w + 24} / ${frame.h + 24}` } : undefined}
      role="group"
      aria-label={tr('{{hostName}} 与副屏中的交互示例', { hostName: hostName })}
    >
      <g visibility={focusWorkspace ? 'hidden' : undefined} opacity={1 - reveal(0, 0.65)}>
        <path className="demo-desk" d="M8 488H1112" />
        <rect className="demo-device-shadow" x="24" y="47" width="694" height="440" rx="9" />
        <rect className="demo-device" x="22" y="42" width="694" height="440" rx="9" />
        <rect className="demo-screen" x="28" y="48" width="682" height="428" rx="3" />
        <path className="demo-rim" d="M32 43H706Q715 43 715 52" />
        <g aria-hidden="true" transform="translate(28 48)">
          <path className="demo-rail" d="M3 0H126V428H3Q0 428 0 425V3Q0 0 3 0Z" />
          <text x="147" y="24" className="demo-title">
            {hostName}
          </text>
          <text x="147" y="48" className="demo-title">
            {title}
          </text>
          {[tr('新聊天'), tr('搜索聊天'), tr('项目'), 'Palboo', title].map((text, i) => (
            <text key={text} x="14" y={45 + i * 28}>
              {text}
            </text>
          ))}
          <g ref={entryRef} className="demo-eyes demo-entry" transform="translate(16 392)">
            <rect width="4" height="10" rx="2" />
            <rect x="8" width="4" height="10" rx="2" />
          </g>
          <text x="37" y="401">
            Palboo
          </text>
          <rect
            className="demo-bubble"
            x="165"
            y="84"
            width={Math.min(260, chatWidth - 15)}
            height="46"
            rx="10"
          />
          <text x="177" y="104">
            {tr('保留内容与阅读位置，')}
          </text>
          <text x="177" y="119">
            {tr('把工作台移到另一块屏幕。')}
          </text>
          <text x="151" y="163">
            {tr('先弹出，再移到副屏。')}
          </text>
          <text className="demo-title" x="151" y="201">
            {tr('保留当前内容')}
          </text>
          {[218, 230, 274, 286].map((y, i) => (
            <rect
              className="demo-line"
              key={y}
              x="151"
              y={y}
              width={chatWidth * (i % 2 ? 0.72 : 0.9)}
              height="3"
              rx="1.5"
            />
          ))}
          <text className="demo-title" x="151" y="257">
            {tr('切换承载位置')}
          </text>
          <rect
            className="demo-composer"
            x="143"
            y="347"
            width={chatWidth + 18}
            height="64"
            rx="15"
          />
          <text x="155" y="370">
            {tr('询问任何问题')}
          </text>
          <text x="155" y="397">
            {tr('＋　工具')}
          </text>
        </g>
        <g opacity={frame.secondary} aria-hidden={frame.secondary < 0.01}>
          <rect className="demo-device-shadow" x="750" y="229" width="342" height="258" rx="15" />
          <rect className="demo-device" x="748" y="224" width="342" height="258" rx="15" />
          <rect className="demo-screen" x="754" y="230" width="330" height="246" rx="9" />
          <path className="demo-rim" d="M763 225H1075Q1089 225 1089 239V467" />
        </g>
      </g>
      {materialProgress !== undefined && (
        <foreignObject
          className="layout-demo-material-background"
          x={materialBackdrop.x}
          y={materialBackdrop.y}
          width={materialBackdrop.w}
          height={materialBackdrop.h}
          opacity={reveal(0.15, 1)}
          aria-hidden="true"
          style={{ pointerEvents: 'none' }}
        >
          <div className="layout-demo-material-stage" style={{ height: '100%', minHeight: 0 }}>
            <div className="layout-demo-material-backdrop">
              <PalbooWordmark />
            </div>
          </div>
        </foreignObject>
      )}
      <foreignObject
        x={sampleFrame.x}
        y={sampleFrame.y}
        width={sampleFrame.w}
        height={sampleFrame.h}
        className="layout-demo-window"
        data-placement={placement}
      >
        <div
          style={{
            width: sampleFrame.w * 1.5,
            height: sampleFrame.h * 1.5,
            transform: 'scale(0.666666667)',
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </foreignObject>
    </svg>
  );
}
