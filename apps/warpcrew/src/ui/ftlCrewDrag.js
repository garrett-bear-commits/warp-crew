// @ts-nocheck
// FTL-lite fights: press and drag a crew chip (or the crew sprite on the ship) onto a room to send
// them there. A ghost follows the finger, the rooms they can go to light up, and dropping anywhere
// else cancels. Tap-then-tap still works: a press that never moves is left to the normal click.
//
// Pointer events only (touch, pen and mouse). A press on a sprite is taken before the ship camera
// sees it, so dragging a crew member never pans; every other press (empty hull, two fingers) is the
// camera's as before.

/** Pixels a press must travel before it becomes a drag (the camera's pan threshold is 8). */
export const DRAG_START_PX = 8;
/** Screen pixels added around a crew sprite so it stays pressable when the ship is zoomed out. */
const SPRITE_PAD_PX = 10;
const CLICK_SUPPRESSION_MS = 350;

/** The room button under a screen point while dragging, if any. */
export function dropTargetAt(doc, x, y) {
  const stack = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [doc.elementFromPoint?.(x, y)].filter(Boolean);
  for (const el of stack) {
    const target = el.closest?.('.ftl-move-target');
    if (target) return target;
  }
  return null;
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The ghost that follows the finger: portrait and first name. */
export function renderDragGhost(member) {
  return `${member.portrait ? `<img src="${esc(member.portrait)}" alt="" />` : ''}<span>${esc(String(member.name || '').split(' ')[0])}</span>`;
}

/**
 * hooks:
 *   view()             — the live FTL encounter view, or null
 *   spriteAt(x, y, pad) — crew id drawn under a screen point (pad in screen px), or null
 *   setDragging(id)    — show (id) or clear (null) the drop targets for a dragged crew member
 *   send(dataset)      — dispatch the move (the drop target's data-* fields)
 *   select(id)         — tap on a sprite: select that crew member (same as tapping their chip)
 *   edgePan(x, y)      — optional: nudge the camera when the finger rests at a view edge; true if it moved
 */
export function bindFtlCrewDrag(root, hooks) {
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  let press = null;
  let suppressClickUntil = 0;

  const live = view => view && !view.result && !view.downed;

  function clearHover() {
    for (const el of root.querySelectorAll('.ftl-move-target.is-drop-hover')) el.classList.remove('is-drop-hover');
  }

  function hover(x, y) {
    const target = dropTargetAt(doc, x, y);
    press.hoverRoom = target?.dataset.room || null;
    clearHover();
    target?.classList.add('is-drop-hover');
    press.ghost?.classList.toggle('is-over-room', Boolean(target));
  }

  function startDrag(event) {
    const member = hooks.view()?.crew.find(c => c.id === press.crewId);
    if (!member) return finish(null);
    press.dragging = true;
    const ghost = doc.createElement('div');
    ghost.className = 'ftl-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = renderDragGhost(member);
    (root.querySelector('.wc-shell') || root).appendChild(ghost);
    press.ghost = ghost;
    root.querySelector('.wc-shell')?.classList.add('ftl-crew-dragging');
    hooks.setDragging(press.crewId);
    place(event);
  }

  function place(event) {
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    press.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    hover(event.clientX, event.clientY);
    if (hooks.edgePan && win.requestAnimationFrame) {
      if (press.panFrame) win.cancelAnimationFrame?.(press.panFrame);
      press.panFrame = win.requestAnimationFrame(edgeStep);
    }
  }

  // Held near the top or bottom of the ship view, the camera drifts so off-screen rooms come into reach.
  function edgeStep() {
    if (!press?.dragging) return;
    press.panFrame = null;
    if (!hooks.edgePan(press.lastX, press.lastY)) return;
    hover(press.lastX, press.lastY);
    press.panFrame = win.requestAnimationFrame(edgeStep);
  }

  function down(event) {
    if (press || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const view = hooks.view();
    if (!live(view)) return;
    let crewId = null;
    let source = null;
    const chip = event.target.closest?.('.ftl-crew-chip[data-crew-id]');
    if (chip && root.contains(chip) && !chip.disabled) {
      crewId = chip.dataset.crewId;
      source = 'chip';
    } else if (event.target.closest?.('.stage') && !event.target.closest('button, a, input, .stage-hud, [data-slot="overlays"], [data-slot="ship-sequence"]')) {
      crewId = hooks.spriteAt(event.clientX, event.clientY, SPRITE_PAD_PX);
      source = 'sprite';
    }
    if (!crewId || !view.crew.some(member => member.id === crewId)) return;
    // A sprite press is ours: keep the ship camera from treating it as a pan.
    if (source === 'sprite') {
      event.stopPropagation();
      event.preventDefault?.();
    }
    press = { pointerId: event.pointerId, crewId, source, x: event.clientX, y: event.clientY, dragging: false, ghost: null, hoverRoom: null };
    win.addEventListener('pointermove', move, { passive: false });
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', cancel);
  }

  function move(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX) return;
      if (!live(hooks.view())) return finish(null);
      startDrag(event);
    } else place(event);
    event.preventDefault?.();
  }

  function up(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!press.dragging) {
      // A tap on a sprite selects that crew member; a tap on a chip is left to its click.
      if (press.source === 'sprite') {
        const id = press.crewId;
        finish(null);
        suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
        hooks.select(id);
        return;
      }
      return finish(null);
    }
    const target = dropTargetAt(doc, event.clientX, event.clientY);
    const drop = target && target.dataset.crewId === press.crewId && live(hooks.view()) ? { ...target.dataset } : null;
    finish(drop);
  }

  function cancel(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    finish(null);
  }

  function finish(drop) {
    if (!press) return;
    const wasDragging = press.dragging;
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', up);
    win.removeEventListener('pointercancel', cancel);
    if (press.panFrame) win.cancelAnimationFrame?.(press.panFrame);
    press.ghost?.remove();
    clearHover();
    root.querySelector('.wc-shell')?.classList.remove('ftl-crew-dragging');
    press = null;
    if (wasDragging) {
      suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      hooks.setDragging(null);
    }
    if (drop) hooks.send(drop);
  }

  // The click that follows a drag (or a sprite tap) must not also select a chip or press a room.
  function click(event) {
    if (Date.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  root.addEventListener('pointerdown', down, true);
  root.addEventListener('click', click, true);
  return {
    get active() { return Boolean(press?.dragging); },
    get hoverRoom() { return press?.hoverRoom || null; },
    cancel: () => finish(null),
    destroy() {
      finish(null);
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('click', click, true);
    },
  };
}
