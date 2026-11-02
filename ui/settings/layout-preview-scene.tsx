import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Demonstration children, window geometry and optional website camera/material/display/stand progress.
 * [OUTPUT]: Shared device/secondary display or a 16:9 desktop monitor; transitions preserve the workspace node.
 * [POS]: Shared live preview and optional local hardware model; no external requests or product commands.
 * [PROTOCOL]: Keep settings/AGENTS.md and website/AGENTS.md in sync. */
import { useId, useState, type ReactNode, type Ref } from 'react';
import { PalbooWordmark } from '../shared/brand';
import { previewQuestion, previewSections } from '../shared/preview-conversation';
import { StudioDisplayFrame } from './studio-display';
import { PreviewComposer } from './preview-composer';
import { PreviewHostNavigation, previewHostWidth } from './preview-host';
export type DemoFrame = { x: number; y: number; w: number; h: number; secondary: number };
export const demoFrames: Record<string, DemoFrame> = {
  sidebar: { x: 516, y: 70, w: 182, h: 392, secondary: 0 },
  overlay: { x: 402, y: 120, w: 270, h: 326, secondary: 0 },
  popped: { x: 414, y: 105, w: 274, h: 348, secondary: 0 },
  desktop: { x: 754, y: 230, w: 330, h: 247.5, secondary: 1 },
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
  display,
  standProgress,
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
  display?: 'studio';
  standProgress?: number;
}) {
  useLocale();
  const hostClip = useId();
  const [draft, setDraft] = useState('');
  const studio = display === 'studio';
  const screenHeight = studio ? 384 : 428;
  const trim = 428 - screenHeight;
  const deviceFrame =
    studio && !focusWorkspace ? { ...frame, h: frame.h - trim * (1 - frame.secondary) } : frame;
  const chatX = 28 + previewHostWidth + 18;
  const chatRight = (!placement || placement === 'sidebar') && frame.x < 710 ? frame.x - 16 : 692;
  const chatWidth = Math.max(210, chatRight - chatX);
  // The website approaches this same device; settings keep their original framing.
  const camera = Math.max(0, Math.min(1, zoom ?? 0)) * (1 - frame.secondary);
  const width = studio ? 800 - 64 * camera + 320 * frame.secondary : 1120 - 384 * camera;
  const height = studio ? 600 - 140 * camera + 100 * frame.secondary : width / 1.6;
  const centerY = studio ? 310 - 46 * camera : 264;
  const center = 368 + 192 * frame.secondary;
  const material = Math.max(0, Math.min(1, materialProgress ?? 0));
  const mix = (from: number, to: number) => from + (to - from) * material;
  const reveal = (start: number, end: number) => {
    const t = Math.max(0, Math.min(1, (material - start) / (end - start)));
    return t * t * (3 - 2 * t);
  };
  const sampleFrame = focusWorkspace
    ? deviceFrame
    : {
        ...deviceFrame,
        x: mix(deviceFrame.x, 148),
        y: mix(deviceFrame.y, 60),
        w: mix(deviceFrame.w, 440),
        h: mix(deviceFrame.h, 340),
      };
  const materialBackdrop = focusWorkspace
    ? { x: frame.x - 12, y: frame.y - 12, w: frame.w + 24, h: frame.h + 24 }
    : { x: 22, y: 16, w: 694, h: 428 };
  // Apple 13-inch iPad Pro: 281.6 × 215.5 mm body, 13-inch 4:3 display.
  // Front corner radii are estimated from Apple's display reference, not CAD measurements.
  const tabletScale = 330 / 264.16;
  const tablet = {
    x: 754 - ((281.6 - 264.16) * tabletScale) / 2,
    y: 230 - ((215.5 - 198.12) * tabletScale) / 2,
    w: 281.6 * tabletScale,
    h: 215.5 * tabletScale,
    r: 22,
    screenRadius: 22 - ((281.6 - 264.16) * tabletScale) / 2,
  };
  const screenRadius = tablet.screenRadius * frame.secondary * (1 - material);
  return (
    <svg
      className="layout-demo-scene"
      data-display={display}
      viewBox={
        focusWorkspace
          ? `${frame.x - 12} ${frame.y - 12} ${frame.w + 24} ${frame.h + 24}`
          : zoom === undefined
            ? `${-188 * (1 - frame.secondary)} 16 1120 500`
            : `${mix(center - width / 2, 0)} ${mix(centerY - height / 2, 0)} ${mix(width, 736)} ${mix(height, 460)}`
      }
      style={focusWorkspace ? { aspectRatio: `${frame.w + 24} / ${frame.h + 24}` } : undefined}
      role="group"
      aria-label={tr('{{hostName}} 与副屏中的交互示例', { hostName: hostName })}
    >
      <defs>
        <clipPath id={hostClip}>
          <rect x="28" y="48" width="682" height={screenHeight} rx={studio ? 2 : 3} />
        </clipPath>
      </defs>
      <g visibility={focusWorkspace ? 'hidden' : undefined} opacity={1 - reveal(0, 0.65)}>
        {studio ? (
          <StudioDisplayFrame progress={standProgress} />
        ) : (
          <>
            <path className="demo-desk" d="M8 488H1112" />
            <rect className="demo-device-shadow" x="24" y="47" width="694" height="440" rx="9" />
            <rect className="demo-device" x="22" y="42" width="694" height="440" rx="9" />
            <path className="demo-rim" d="M32 43H706Q715 43 715 52" />
          </>
        )}
        <rect
          className="demo-screen"
          x="28"
          y="48"
          width="682"
          height={screenHeight}
          rx={studio ? 2 : 3}
        />
        <g clipPath={`url(#${hostClip})`}>
          <g aria-hidden="true" transform="translate(28 48)">
            <foreignObject x="0" y="0" width={previewHostWidth} height={screenHeight}>
              <PreviewHostNavigation hostName={hostName} />
            </foreignObject>
            <text x={chatX - 28} y="24" className="demo-title">
              {tr('两天的作品集计划')}
            </text>
            <g
              ref={entryRef}
              className="demo-eyes demo-entry"
              transform={`translate(8 ${screenHeight - 50})`}
            >
              <rect width="4" height="10" rx="2" />
              <rect x="8" width="4" height="10" rx="2" />
            </g>
            <foreignObject x={chatX - 28} y="46" width={chatWidth} height={screenHeight - 130}>
              <div className="demo-chat-copy">
                <p className="demo-chat-question">{previewQuestion()}</p>
                {previewSections()
                  .slice(0, 3)
                  .map((section) => (
                    <section key={section.id}>
                      <h4>{section.title}</h4>
                      <p>{section.text}</p>
                      {section.items && (
                        <ol>
                          {section.items.map((text) => (
                            <li key={text}>{text}</li>
                          ))}
                        </ol>
                      )}
                    </section>
                  ))}
              </div>
            </foreignObject>
          </g>
          <foreignObject
            className="layout-demo-host-composer"
            x={chatX}
            y={395 - trim}
            width={chatWidth}
            height="64"
            aria-hidden={focusWorkspace || material >= 0.65}
          >
            <div className="demo-chat-composer" inert={focusWorkspace || material >= 0.65}>
              <PreviewComposer value={draft} onValueChange={setDraft} />
            </div>
          </foreignObject>
        </g>
        <g className="demo-tablet" opacity={frame.secondary} aria-hidden={frame.secondary < 0.01}>
          <rect
            className="demo-device-shadow"
            x={tablet.x + 1}
            y={tablet.y + 3}
            width={tablet.w}
            height={tablet.h}
            rx={tablet.r}
          />
          <rect
            className="demo-tablet-metal"
            x={tablet.x}
            y={tablet.y}
            width={tablet.w}
            height={tablet.h}
            rx={tablet.r}
          />
          <rect
            className="demo-tablet-glass"
            x={tablet.x + 1}
            y={tablet.y + 1}
            width={tablet.w - 2}
            height={tablet.h - 2}
            rx={tablet.r - 1}
          />
          <rect
            className="demo-screen demo-tablet-screen"
            x="754"
            y="230"
            width="330"
            height="247.5"
            rx={tablet.screenRadius}
          />
          <circle className="demo-tablet-camera" cx="919" cy={tablet.y + 5.5} r="0.85" />
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
          data-device-viewport
          data-screen-radius={screenRadius}
          style={{
            width: sampleFrame.w * 1.75,
            height: sampleFrame.h * 1.75,
            transform: 'scale(0.571428571)',
            transformOrigin: 'top left',
            borderRadius: screenRadius * 1.75,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </foreignObject>
    </svg>
  );
}
