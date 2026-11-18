/* [INPUT]: Separator, axis and value callbacks with optional CSS-coordinate scale.
 * [OUTPUT]: Element scale and shared pointer/keyboard resizing.
 * [POS]: Business-independent interaction. [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
export function elementScale(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: element.offsetWidth ? rect.width / element.offsetWidth : 1,
    y: element.offsetHeight ? rect.height / element.offsetHeight : 1,
  };
}

/**
 * @param {(value: any, dropped: boolean) => void} [save]
 * @param {(value: any) => void} [cancel]
 */
export function bindSeparator(handle, axis, read, change, save, cancel) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || handle.dataset.resizing) return;
    event.preventDefault();
    handle.dataset.resizing = 'true';
    handle.setPointerCapture(event.pointerId);
    const direction = typeof axis === 'function' ? axis() : axis;
    const origin = direction === 'x' ? event.clientX : event.clientY;
    const value = read();
    const pointerId = event.pointerId;
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const finish = (dropped) => {
      listeners.abort();
      delete handle.dataset.resizing;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (!dropped && cancel) cancel(value);
      else save?.(value, dropped);
    };
    handle.addEventListener(
      'pointermove',
      (move) => {
        if (move.pointerId !== pointerId) return;
        const position = direction === 'x' ? move.clientX : move.clientY;
        change(value, (position - origin) / (value.scale || 1), true);
      },
      options,
    );
    const endPointer = (end) => {
      if (end.pointerId !== pointerId) return;
      if (
        end.type === 'lostpointercapture' &&
        handle.isConnected &&
        !end.composedPath().includes(handle)
      )
        return;
      finish(end.type === 'pointerup');
    };
    handle.addEventListener('pointerup', endPointer, options);
    handle.addEventListener('pointercancel', endPointer, options);
    // A disconnected capture target receives lostpointercapture on its document.
    handle.ownerDocument.addEventListener('lostpointercapture', endPointer, {
      ...options,
      capture: true,
    });
    window.addEventListener('blur', () => finish(false), options);
    if (cancel)
      window.addEventListener(
        'keydown',
        (key) => {
          if (key.key !== 'Escape') return;
          key.preventDefault();
          key.stopImmediatePropagation();
          finish(false);
        },
        { ...options, capture: true },
      );
  });
  handle.addEventListener('keydown', (event) => {
    if (handle.dataset.resizing) return;
    const direction = typeof axis === 'function' ? axis() : axis;
    const delta = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[event.key];
    if (
      !delta ||
      (direction === 'x'
        ? !['ArrowLeft', 'ArrowRight'].includes(event.key)
        : !['ArrowUp', 'ArrowDown'].includes(event.key))
    )
      return;
    event.preventDefault();
    const value = read();
    change(value, delta, false);
    save?.(value, false);
  });
}
