/* [INPUT]: Native progress for the original brand flight and shared workspace.
 * [OUTPUT]: Bounded hardware approach, placement tour and material stops.
 * [POS]: Website presentation constants, independent of product state.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
export const openingTiming = { intro: 0.65, transition: 0.3 };
export const materialStart = 2.1;
export const openingDistance = 3.5;
const stop = (
  at: number,
  placement: string,
  edge = 'right',
  material = 'matte',
  variant = 'regular',
) => ({
  at,
  layout: { placement },
  edge,
  material: material as 'matte' | 'frosted' | 'native-glass' | 'black',
  variant: variant as 'regular' | 'clear',
});
export const openingStops = [
  stop(0, 'sidebar'),
  stop(0.95, 'overlay'),
  stop(1.2, 'desktop'),
  stop(1.6, 'edge'),
  stop(1.85, 'edge', 'top'),
  stop(2.1, 'overlay'),
  stop(2.5, 'overlay', 'right', 'frosted'),
  stop(2.75, 'overlay', 'right', 'native-glass'),
  stop(3, 'overlay', 'right', 'native-glass', 'clear'),
  stop(3.25, 'overlay', 'right', 'black'),
];
export function openingStop(distance: number) {
  return openingStops.reduce(
    (current, entry) => (distance >= entry.at ? entry : current),
    openingStops[0],
  );
}
