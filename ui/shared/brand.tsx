/* [INPUT]: Current text color and a caller-owned accessible brand label.
 * [OUTPUT]: PALBOO geometric wordmark with paired capsule-shaped O counters.
 * [POS]: Static first-party brand artwork; no font downloads, animation or product state.
 * [PROTOCOL]: Keep shared/AGENTS.md and DESIGN_SYSTEM.md in sync. */
export function PalbooWordmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 178 32"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
      fillRule="evenodd"
    >
      <g transform="translate(4 0) skewX(-6)">
        <path d="M0 28V4h16c7 0 11 3.5 11 10s-4 10-11 10H8v4Zm8-17v6h7c2.7 0 4-1 4-3s-1.3-3-4-3Z" />
        <path d="m29 28 9-24h11l9 24h-8l-1.6-5H38.6L37 28Zm12-12h5l-2.5-7Z" />
        <path d="M63 4h8v17h15v7H63Z" />
        <path d="M91 28V4h15c6.5 0 10 2.3 10 6.3 0 2.5-1.5 4.5-3.8 5.5 3 1 4.8 3 4.8 5.5 0 4.4-3.8 6.7-10.5 6.7Zm8-18v4h6c2 0 3-.6 3-2s-1-2-3-2Zm0 9v3h7c2 0 3-.3 3-1.5s-1-1.5-3-1.5Z" />
        <path d="M132 3c7.8 0 12 4.5 12 13s-4.2 13-12 13-12-4.5-12-13S124.2 3 132 3Zm0 7c-3 0-4 1.8-4 6s1 6 4 6 4-1.8 4-6-1-6-4-6ZM160 3c7.8 0 12 4.5 12 13s-4.2 13-12 13-12-4.5-12-13S152.2 3 160 3Zm0 7c-3 0-4 1.8-4 6s1 6 4 6 4-1.8 4-6-1-6-4-6Z" />
      </g>
    </svg>
  );
}
