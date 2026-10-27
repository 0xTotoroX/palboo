/* [INPUT]: Original SVG face and an explicit completed/visible/idle gate.
 * [OUTPUT]: Bounded mouse gaze on the face group, independent of the authored timeline.
 * [POS]: Website-only embellishment; never handles clicks, wheel events or individual eye poses.
 * [PROTOCOL]: Keep website/AGENTS.md and opening interaction checks in sync. */
export function installBrandGaze(root: HTMLElement, enabled: () => boolean) {
  const svg = root.querySelector('svg')!;
  const eyes = root.querySelector('#eyes')!;
  const cheeks = root.querySelector('#cheeks')!;
  let frame = 0,
    x = 0,
    y = 0,
    targetX = 0,
    targetY = 0;
  const paint = () => {
    eyes.setAttribute('transform', `translate(${x.toFixed(3)} ${y.toFixed(3)})`);
    cheeks.setAttribute(
      'transform',
      `translate(${(x * 0.35).toFixed(3)} ${(y * 0.35).toFixed(3)})`,
    );
    root.dataset.gaze = `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = x = y = targetX = targetY = 0;
    eyes.removeAttribute('transform');
    cheeks.removeAttribute('transform');
    delete root.dataset.gaze;
  };
  const tick = () => {
    frame = 0;
    if (!enabled()) return reset();
    x += (targetX - x) * 0.22;
    y += (targetY - y) * 0.22;
    if (Math.abs(targetX - x) + Math.abs(targetY - y) < 0.04) {
      x = targetX;
      y = targetY;
      paint();
      return;
    }
    paint();
    frame = requestAnimationFrame(tick);
  };
  const look = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !enabled()) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const center = new DOMPoint(600, 307).matrixTransform(matrix);
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    targetX = clamp((event.clientX - center.x) / (innerWidth * 0.4)) * 28;
    targetY = clamp((event.clientY - center.y) / (innerHeight * 0.4)) * 18;
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const leave = (event: PointerEvent) => {
    if (!event.relatedTarget) reset();
  };
  addEventListener('pointermove', look, { passive: true });
  document.addEventListener('pointerout', leave);
  addEventListener('blur', reset);
  return {
    reset,
    destroy() {
      reset();
      removeEventListener('pointermove', look);
      document.removeEventListener('pointerout', leave);
      removeEventListener('blur', reset);
    },
  };
}
