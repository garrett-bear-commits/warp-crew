import { pan, unproject, zoomAt } from './shipCamera.js';

const DRAG_THRESHOLD = 8;
const CLICK_SUPPRESSION_MS = 350;

export function createCameraController({ surface, getCamera, setCamera, onTap, onFocus }) {
  const pointers = new Map();
  let gestureMoved = false;
  let lastGesture = false;
  let suppressClickUntil = 0;
  let suppressNativeClickUntil = 0;
  const point = event => ({ x: event.clientX, y: event.clientY });
  const local = event => {
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const ignored = event => event.target?.closest?.('.stage-hud, [data-slot="overlays"], [data-slot="ship-sequence"], .captain-marker');

  function pointerdown(event) {
    if (ignored(event) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!pointers.size) {
      gestureMoved = false;
      lastGesture = false;
    }
    pointers.set(event.pointerId, { start: point(event), current: point(event) });
    if (pointers.size > 1) gestureMoved = true;
    surface.setPointerCapture?.(event.pointerId);
  }

  function pointermove(event) {
    const moving = pointers.get(event.pointerId);
    if (!moving) return;
    const previous = moving.current;
    const next = point(event);
    if (pointers.size === 1) {
      const alreadyDragging = gestureMoved;
      if (Math.hypot(next.x - moving.start.x, next.y - moving.start.y) >= DRAG_THRESHOLD) gestureMoved = true;
      if (gestureMoved) {
        const from = alreadyDragging ? previous : moving.start;
        setCamera(pan(getCamera(), next.x - from.x, next.y - from.y));
      }
    } else if (pointers.size === 2) {
      const other = [...pointers.values()].find(pointer => pointer !== moving);
      const oldMid = { x: (previous.x + other.current.x) / 2, y: (previous.y + other.current.y) / 2 };
      const newMid = { x: (next.x + other.current.x) / 2, y: (next.y + other.current.y) / 2 };
      const oldDistance = Math.hypot(previous.x - other.current.x, previous.y - other.current.y);
      const newDistance = Math.hypot(next.x - other.current.x, next.y - other.current.y);
      const rect = surface.getBoundingClientRect();
      const anchor = { x: oldMid.x - rect.left, y: oldMid.y - rect.top };
      const zoomed = zoomAt(getCamera(), oldDistance ? newDistance / oldDistance : 1, anchor);
      setCamera(pan(zoomed, newMid.x - oldMid.x, newMid.y - oldMid.y));
      gestureMoved = true;
    }
    moving.current = next;
    event.preventDefault?.();
  }

  function end(event, cancelled = false) {
    const ending = pointers.get(event.pointerId);
    if (!ending) return;
    if (cancelled) suppressNativeClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
    if (!cancelled && pointers.size === 1 && !gestureMoved
      && Math.hypot(event.clientX - ending.start.x, event.clientY - ending.start.y) >= DRAG_THRESHOLD) {
      gestureMoved = true;
      setCamera(pan(getCamera(), event.clientX - ending.start.x, event.clientY - ending.start.y));
    }
    if (!cancelled) {
      const rect = surface.getBoundingClientRect();
      if (pointers.size === 1 && !gestureMoved && Date.now() >= suppressClickUntil) {
        onTap(unproject(getCamera(), { x: event.clientX - rect.left, y: event.clientY - rect.top }), event);
        suppressNativeClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      }
    }
    if (gestureMoved) {
      lastGesture = true;
      suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      suppressNativeClickUntil = suppressClickUntil;
    }
    pointers.delete(event.pointerId);
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture?.(event.pointerId);
  }

  function click(event) {
    if (ignored(event) || event.detail === 0 || Date.now() >= suppressNativeClickUntil) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function doubleclick(event) {
    if (ignored(event)) return;
    onFocus(unproject(getCamera(), local(event)), event);
  }

  const listeners = [
    ['pointerdown', pointerdown], ['pointermove', pointermove],
    ['pointerup', end], ['pointercancel', event => end(event, true)],
    ['lostpointercapture', event => end(event, true)],
    ['click', click], ['dblclick', doubleclick],
  ];
  for (const [name, listener] of listeners) surface.addEventListener(name, listener, name === 'click');
  return {
    wasGesture: () => lastGesture,
    destroy() {
      for (const [name, listener] of listeners) surface.removeEventListener(name, listener, name === 'click');
      pointers.clear();
    },
  };
}
