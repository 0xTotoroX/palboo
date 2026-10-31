/* [INPUT]: Verified desktop settings segmented-selection spring parameters.
 * [OUTPUT]: A shared Web Animations timing object; no runtime dependency.
 * [POS]: Settings presentation only, honoring caller interruption and reduced-motion guards.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
// Sampled at the desktop's 10ms interval from duration=.28, bounce=0,
// mass=1, velocity=0; retain the same 4-decimal CSS precision.
const curve =
  'linear(0, 0.0467, 0.1502, 0.2738, 0.397, 0.5098, 0.6079, 0.6902, 0.7578, 0.8122, 0.8554, 0.8893, 0.9157, 0.9361, 0.9518, 0.9637, 0.9728, 0.9797, 0.9848, 0.9887, 0.9916, 0.9938, 0.9954, 0.9966, 0.9975, 0.9982, 0.9986, 1)';
export const segmentedSpring = {
  duration: 280,
  easing:
    typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', curve)
      ? curve
      : 'cubic-bezier(.23,1,.32,1)',
};
