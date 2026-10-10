// @ts-nocheck
/**
 * The story player (Phase 3 design §1): an incoming transmission, one panel at a time, with the speaker's portrait
 * in a scanline frame and the line typed out word by word. Presentation only: it never changes game state.
 * The queue and taps live in main.js (`tx-next` finishes the line, then turns the panel; `tx-skip` closes it).
 */
import { artUrl } from '../shared/artUrl.js';
import { speakerFor, fillStoryText } from '../data/speakers.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Milliseconds per word of the typing effect (reduced motion shows the whole line at once). */
export const TX_WORD_MS = 55;

/** How long a panel's line takes to type. */
export const panelTypingMs = text => String(text || '').split(/\s+/).filter(Boolean).length * TX_WORD_MS;

/**
 * entry: { id, kicker, title, art, panels: [{ speaker, text }] }; view: { panel, instant }.
 * The first panel of a titled transmission shows the title card over its art.
 */
export function renderTransmission(entry, player, { panel = 0, instant = false } = {}) {
  if (!entry?.panels?.length) return '';
  const i = Math.max(0, Math.min(entry.panels.length - 1, panel));
  const line = entry.panels[i];
  const who = speakerFor(line.speaker, player);
  const words = fillStoryText(line.text, player).split(/\s+/).filter(Boolean);
  const typed = words.map((word, n) => `<span style="--w:${n}">${esc(word)}</span>`).join(' ');
  const last = i === entry.panels.length - 1;
  const art = entry.art ? `<img class="tx-art" src="${esc(artUrl(entry.art))}" alt="" />` : '';
  // A scene carries its title card above the sheet; without one, the title sits inside the sheet.
  const titleCard = entry.title && i === 0 ? `<div class="tx-title">${entry.kicker ? `<span>${esc(entry.kicker)}</span>` : ''}<b>${esc(entry.title)}</b></div>` : '';
  const title = entry.art ? titleCard : '';
  const inTitle = !entry.art && entry.title ? `<p class="tx-intitle">${entry.kicker ? `<span>${esc(entry.kicker)}</span> · ` : ''}${esc(entry.title)}</p>` : '';
  const dots = entry.panels.length > 1 ? `<span class="tx-dots" aria-hidden="true">${entry.panels.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</span>` : '';
  return `<div class="modal-backdrop tx-backdrop${entry.art ? ' has-art' : ''}" data-act="tx-next">
    ${art}${title}
    <section class="tx-sheet tx-${esc(who.style || 'plain')}${instant ? ' is-instant' : ''}" role="dialog" aria-modal="true" aria-label="Transmission from ${esc(who.name)}" data-panel="${i}">
      ${inTitle}<header class="tx-head"><span class="tx-signal" aria-hidden="true"></span><b>${esc(who.name)}</b><span class="tx-from">${esc(who.from || '')}</span>${dots}</header>
      <div class="tx-body">
        <div class="tx-portrait"><img src="${esc(who.portrait)}" alt="" /><span class="tx-scan" aria-hidden="true"></span></div>
        <p class="tx-line" aria-live="polite">${typed}</p>
      </div>
      <footer class="tx-foot">
        <button type="button" class="tx-skip" data-act="tx-skip">Skip</button>
        <button type="button" class="primary tx-next" data-act="tx-next">${last ? 'Close' : 'Next'}</button>
      </footer>
    </section>
  </div>`;
}
