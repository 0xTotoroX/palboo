/* [INPUT]: Focus and pointer events from product Shadow DOM and term popovers.
 * [OUTPUT]: The focused control and its owning website demonstration.
 * [POS]: Website scroll protection; does not change product focus or event handling.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
let lastSurface: HTMLElement | null = null;
export function rememberDemoSurface(element: HTMLElement) {
  lastSurface = element;
}
export function isDemoPopover(element: EventTarget | null) {
  return element instanceof Element && element.matches('[data-buddy-terms]');
}
export function demoFocus(container?: Element | null): HTMLElement | null {
  const outer = document.activeElement;
  if (
    !container ||
    (!container.contains(outer) &&
      !(
        isDemoPopover(outer) &&
        lastSurface?.dataset.realFeature === 'terms' &&
        container.contains(lastSurface)
      ))
  )
    return null;
  let focused = outer;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused instanceof HTMLElement ? focused : null;
}
export function demoEventTarget(event: Event): HTMLElement | null {
  return (event.composedPath().find((node) => node instanceof HTMLElement) as HTMLElement) || null;
}
