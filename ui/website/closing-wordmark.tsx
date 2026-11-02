/* [INPUT]: Shared PALB lettering and the journey's settled footer state.
 * [OUTPUT]: The familiar face opens into two O counters after a short rest.
 * [POS]: Website ending only; shared product wordmarks retain their original face.
 * [PROTOCOL]: Keep website/AGENTS.md and motion acceptance in sync. */
import { useId } from 'react';
import { PalbooLettering } from '../shared/brand';

export function ClosingWordmark() {
  const mask = useId();
  return (
    <div className="install-brand">
      <svg
        className="install-wordmark"
        viewBox="0 0 186 32"
        fill="currentColor"
        fillRule="evenodd"
        aria-hidden="true"
        focusable="false"
      >
        <PalbooLettering />
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" x="-16" y="-14" width="32" height="28">
            <rect x="-16" y="-14" width="32" height="28" fill="white" />
            <ellipse className="closing-counter" rx="5.5" ry="5" fill="black" />
          </mask>
        </defs>
        <g className="closing-face" data-closing-face="">
          <g className="closing-eyes">
            {[136.5, 157.5].map((x, index) => (
              <g key={x} className={`closing-letter closing-letter-${index}`}>
                <g transform={`translate(${x} 15)`} mask={`url(#${mask})`}>
                  <rect className="closing-eye" x="-4.5" y="-12" width="9" height="24" rx="4.5" />
                </g>
              </g>
            ))}
          </g>
          <g className="closing-blush" fill="#f4a3ad">
            <circle cx="128.4" cy="26.3" r="2.5" />
            <circle cx="165.6" cy="26.3" r="2.5" />
          </g>
        </g>
      </svg>
    </div>
  );
}
