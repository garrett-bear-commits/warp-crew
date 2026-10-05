// The core client's own moments, in Warp Crew's sheet style: a boot prompt when this device and
// the cloud both moved on, the cloud being unreachable for a returning captain, a save that needs
// a newer build, and a second tab (only one tab plays; the other offers "Play here").
// Buttons use data-act like the rest of the UI; main.js handles the `core-*` actions.

const sheet = (label, body) =>
  `<div class="modal-backdrop core-backdrop"><section class="contract-sheet core-sheet" role="dialog" aria-modal="true" aria-label="${label}">${body}</section></div>`;

/** Saved depth as the player knows it: jumps, fights, expeditions and contracts together. */
const depth = (n) => `${Number(n) || 0} ${Number(n) === 1 ? 'mission' : 'missions'}`;

/**
 * @param {{ boot: { phase: string, prompt?: { local: { progress: number }, remote: { progress: number } } | null,
 *   blockedReason?: string | null } | null, follower: boolean }} s
 * @returns {string} HTML, or '' when there is nothing to show
 */
export function renderCoreOverlay({ boot, follower }) {
  if (boot?.phase === 'prompt' && boot.prompt) {
    return sheet('Choose a save', `<h2>Two saves found</h2>
      <p>This device and your cloud save both have progress.</p>
      <p class="muted">This device: ${depth(boot.prompt.local.progress)} · Cloud: ${depth(boot.prompt.remote.progress)}</p>
      <button class="primary" data-act="core-adopt-cloud">Use the cloud save</button>
      <button data-act="core-keep-local">Keep this device's save</button>`);
  }
  if (boot?.phase === 'cloudUnreachable') {
    return sheet('Cloud save unreachable', `<h2>Can't reach your cloud save</h2>
      <p>Check your connection and try again, or start playing on this device. A deeper cloud save still wins when it is back.</p>
      <button class="primary" data-act="core-retry">Try again</button>
      <button data-act="core-start-new">Play on this device</button>`);
  }
  if (boot?.phase === 'blocked') {
    const erased = boot.blockedReason === 'erased';
    return sheet(erased ? 'Save erased' : 'Update required', erased
      ? '<h2>This save was erased</h2><p>Your account data was erased at your request.</p>'
      : '<h2>Update required</h2><p>Your save was made by a newer version of Warp Crew. Reload to update; your save is kept safe.</p><button class="primary" data-act="core-reload">Reload</button>');
  }
  if (follower) {
    return sheet('Open in another tab', `<h2>Warp Crew is open in another tab</h2>
      <p>Only one tab can fly the ship at a time.</p>
      <button class="primary" data-act="core-play-here">Play here</button>`);
  }
  return '';
}
