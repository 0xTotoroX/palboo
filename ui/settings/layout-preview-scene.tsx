/* [INPUT]: Demonstration children, current window geometry and secondary-screen visibility.
 * [OUTPUT]: Frontal ChatGPT display and secondary display with the approved anatomy-like finish.
 * [POS]: Local vector illustration; no screenshots, external assets or product commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import type { ReactNode } from 'react';
export type DemoFrame = { x: number; y: number; w: number; h: number; secondary: number };
export const demoFrames: Record<string, DemoFrame> = {
  sidebar: { x: 454, y: 82, w: 244, h: 380, secondary: 0 },
  overlay: { x: 402, y: 120, w: 270, h: 326, secondary: 0 },
  popped: { x: 414, y: 105, w: 274, h: 348, secondary: 0 },
  desktop: { x: 754, y: 230, w: 330, h: 246, secondary: 1 },
  edge: { x: 468, y: 100, w: 230, h: 362, secondary: 0 },
};
export function LayoutPreviewScene({ frame, children }: { frame: DemoFrame; children: ReactNode }) {
  const chatWidth = frame.x < 710 ? Math.max(230, frame.x - 190) : 498;
  return (
    <svg
      className="layout-demo-scene"
      viewBox={`${-188 * (1 - frame.secondary)} 16 1120 500`}
      role="group"
      aria-label="ChatGPT 与副屏中的交互示例"
    >
      <path className="demo-desk" d="M8 488H1112" />
      <rect className="demo-device-shadow" x="24" y="47" width="694" height="440" rx="9" />
      <rect className="demo-device" x="22" y="42" width="694" height="440" rx="9" />
      <rect className="demo-screen" x="28" y="48" width="682" height="428" rx="3" />
      <path className="demo-rim" d="M32 43H706Q715 43 715 52" />
      <g aria-hidden="true" transform="translate(28 48)">
        <path className="demo-rail" d="M3 0H126V428H3Q0 428 0 425V3Q0 0 3 0Z" />
        <text x="147" y="24" className="demo-title">
          ChatGPT
        </text>
        <text x="147" y="48" className="demo-title">
          布局与位置
        </text>
        {['新聊天', '搜索聊天', '项目', 'PALBOO', '布局与位置'].map((text, i) => (
          <text key={text} x="14" y={45 + i * 28}>
            {text}
          </text>
        ))}
        <g className="demo-eyes" transform="translate(16 392)">
          <rect width="4" height="10" rx="2" />
          <rect x="8" width="4" height="10" rx="2" />
        </g>
        <text x="37" y="401">
          PALBOO
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
          保留内容与阅读位置，
        </text>
        <text x="177" y="119">
          把工作台移到另一块屏幕。
        </text>
        <text x="151" y="163">
          先弹出，再移到副屏。
        </text>
        <text className="demo-title" x="151" y="201">
          保留当前内容
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
          切换承载位置
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
          询问任何问题
        </text>
        <text x="155" y="397">
          ＋　工具
        </text>
      </g>
      <g opacity={frame.secondary} aria-hidden={frame.secondary < 0.01}>
        <rect className="demo-device-shadow" x="750" y="229" width="342" height="258" rx="15" />
        <rect className="demo-device" x="748" y="224" width="342" height="258" rx="15" />
        <rect className="demo-screen" x="754" y="230" width="330" height="246" rx="9" />
        <path className="demo-rim" d="M763 225H1075Q1089 225 1089 239V467" />
      </g>
      <foreignObject
        x={frame.x}
        y={frame.y}
        width={frame.w}
        height={frame.h}
        className="layout-demo-window"
      >
        <div
          style={{
            width: frame.w * 1.5,
            height: frame.h * 1.5,
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
