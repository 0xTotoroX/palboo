/* [INPUT]: Desktop root, native gesture transport and completion callback.
 * [OUTPUT]: Captured corner resizing without text selection, with release/cancel cleanup.
 * [POS]: Desktop input adapter; AppKit owns window geometry. [PROTOCOL]: Keep AGENTS.md in sync. */
export function installNativeResize(root, { post, enabled, finished }) {
  const popover = root.querySelector('.csw-popover');
  let active = null;
  function finish() {
    if (!active) return;
    const { handle, pointerId, hosts } = active;
    active = null;
    delete popover.dataset.resizing;
    for (const host of hosts) delete host.dataset.windowResizing;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    finished();
  }
  function cancel() {
    if (!active) return;
    post({ kind: 'cancel-gesture' });
    finish();
  }
  function start(event) {
    const handle = event.target.closest('.csw-resize-handle');
    if (!handle || event.button !== 0 || !enabled()) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
    const hosts = [...root.querySelectorAll('.csw-feature-content > div')];
    active = { handle, pointerId: event.pointerId, hosts };
    popover.dataset.resizing = 'true';
    for (const host of hosts) host.dataset.windowResizing = 'true';
    handle.setPointerCapture(event.pointerId);
    post({ kind: 'resize', corner: handle.dataset.corner });
  }
  function move(event) {
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    // Recover even if the pointer was released outside the WebView.
    if (!(event.buttons & 1)) finish();
  }
  function release(event) {
    if (active?.pointerId === event.pointerId) finish();
  }
  function interrupted(event) {
    if (active?.pointerId === event.pointerId) cancel();
  }
  root.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', interrupted, true);
  root.addEventListener('lostpointercapture', interrupted);
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  return {
    finish,
    destroy() {
      cancel();
      root.removeEventListener('pointerdown', start);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', interrupted, true);
      root.removeEventListener('lostpointercapture', interrupted);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
    },
  };
}
