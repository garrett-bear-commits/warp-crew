// @ts-nocheck
/**
 * The reward reveal: one screen for everything the captain earns (Phase 2 design §1,
 * docs/superpowers/specs/2026-10-10-reward-feel-retention-design.md).
 *
 * Presentation only, like music.js: it never changes game state. Callers pass what was already granted (a reward
 * table or a wallet before/after), the reveal shows cards one by one, and on close each currency flies from its
 * card to its top-bar chip and the chip counts up. The sound and the frame grow with the reward's size.
 */
import { ICONS } from '../data/portraits.js';
import { artUrl } from '../shared/artUrl.js';

/** Currencies in card order. */
export const REWARD_KINDS = ['gems', 'credits', 'medals', 'fuel', 'reputation', 'marks'];
const LABEL = { gems: 'Gems', credits: 'Credits', medals: 'Medals', fuel: 'Fuel', reputation: 'Reputation', marks: 'Contract Marks' };
const ICON = {
  gems: ICONS.gems, credits: ICONS.credits, medals: ICONS.medals, fuel: ICONS.fuel,
  reputation: artUrl('art/pixel/ui/commission.png'), marks: artUrl('art/pixel/ui/marks.png'),
};
/** The picture for a shop product's reveal (Phase 2 art, public/art/pixel/ui/). */
const PRODUCT_ART = {
  wc_gems_s: 'gems-pouch', wc_gems_m: 'gems-pack', wc_gems_l: 'gems-crate', wc_gems_xl: 'gems-vault', wc_gems_xxl: 'gems-hoard',
  wc_starter_kit: 'starter-crate', wc_sub_commission: 'commission',
  wc_wall_spur: 'wall-spur', wc_wall_veil: 'wall-veil', wc_wall_ember: 'wall-ember', wc_wall_hollow: 'wall-hollow', wc_wall_crown: 'wall-crown',
};
export function productArt(sku) {
  return PRODUCT_ART[sku] ? artUrl(`art/pixel/ui/${PRODUCT_ART[sku]}.png`) : null;
}
/** Rough gem worth of one unit, only to size the moment (gem fuel refill: 50 gems for 5 fuel). */
const GEM_WORTH = { gems: 1, credits: 0.05, medals: 0.5, fuel: 10, reputation: 1, marks: 5, shard: 30 };
const RARITY_TIER = { common: 'medium', uncommon: 'medium', rare: 'large', epic: 'large', legendary: 'huge', mythic: 'huge', apex: 'huge' };
export const TIERS = ['small', 'medium', 'large', 'huge'];
/** The sounds the reveal plays as it opens (sound.js names), quiet to loud. */
export const TIER_SOUNDS = { small: ['coin'], medium: ['card', 'coin'], large: ['beacon', 'coin'], huge: ['win', 'boom'] };

/** The currencies that went up between two wallets, as reward items (spends and refunds of other kinds ignored). */
export function walletGain(before = {}, after = {}) {
  return Object.fromEntries(REWARD_KINDS.map(kind => [kind, Math.max(0, (after[kind] || 0) - (before[kind] || 0))]).filter(([, n]) => n > 0));
}

/** Reward items from a reward table ({ credits: 40, medals: 2, streak: 1 }); unknown keys and zeros are dropped. */
export function rewardItems(rewards = {}) {
  return REWARD_KINDS.filter(kind => Number(rewards[kind]) > 0).map(kind => ({ kind, amount: Math.floor(Number(rewards[kind])) }));
}

/** small / medium / large / huge, from the gem worth of the currencies and the rarest crew card. */
export function rewardTier(items = []) {
  let rank = 0;
  const worth = items.reduce((sum, item) => sum + (GEM_WORTH[item.kind] || 0) * (item.amount || 0), 0);
  if (worth >= 250) rank = 3;
  else if (worth >= 60) rank = 2;
  else if (worth >= 15) rank = 1;
  for (const item of items) {
    if (item.kind === 'crew') rank = Math.max(rank, TIERS.indexOf(RARITY_TIER[item.rarity] || 'medium'));
  }
  return TIERS[rank];
}

/**
 * One queued reveal. items: currency items ({ kind, amount }), crew cards ({ kind: 'crew', name, rarity, portrait }) and
 * shards ({ kind: 'shard', name, portrait, amount }).
 * Returns null when there is nothing to show, so callers can pass any grant.
 */
export function rewardEntry({ source, title, subtitle = '', items = [], art = null, cta = 'Collect', tier = null }) {
  const shown = items.filter(item => item.kind === 'crew' || (item.kind === 'shard' ? item.amount > 0 && item.portrait : item.amount > 0));
  if (!shown.length) return null;
  return { source, title, subtitle, art, cta, items: shown, tier: TIERS.includes(tier) ? tier : rewardTier(shown) };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The reveal modal. Cards pop in one after another (CSS --i); tapping anywhere closes it. */
export function renderRewardReveal(entry) {
  if (!entry) return '';
  const cards = entry.items.map((item, i) => item.kind === 'crew'
    ? `<li class="reward-card is-crew rarity-${esc(item.rarity)}" style="--i:${i}"><img src="${esc(item.portrait)}" alt="" /><b>${esc(item.name)}</b><span>${esc(item.rarity)}</span></li>`
    : item.kind === 'shard'
      ? `<li class="reward-card is-crew is-shard" style="--i:${i}"><img src="${esc(item.portrait)}" alt="" /><b>+${item.amount} shard</b><span>${esc(item.name)}</span></li>`
    : `<li class="reward-card" data-reward-kind="${esc(item.kind)}" data-amount="${item.amount}" style="--i:${i}"><img src="${esc(ICON[item.kind])}" alt="" /><b>+${item.amount.toLocaleString('en-US')}</b><span>${esc(LABEL[item.kind])}</span></li>`).join('');
  return `<div class="modal-backdrop reward-backdrop tier-${entry.tier}" data-act="reward-close">
    <section class="reward-reveal tier-${entry.tier}" role="dialog" aria-modal="true" aria-label="${esc(entry.title)}">
      ${entry.art ? `<img class="reward-art" src="${esc(entry.art)}" alt="" />` : ''}
      <h2>${esc(entry.title)}</h2>
      ${entry.subtitle ? `<p class="reward-sub">${esc(entry.subtitle)}</p>` : ''}
      <ul class="reward-cards">${cards}</ul>
      <button class="primary" data-act="reward-close">${esc(entry.cta || 'Collect')}</button>
    </section>
  </div>`;
}

/** Where each currency card sits on screen, read just before the reveal closes. */
export function rewardCardRects(root) {
  return [...(root?.querySelectorAll?.('.reward-card[data-reward-kind]') || [])]
    .map(el => ({ kind: el.dataset.rewardKind, amount: Number(el.dataset.amount) || 0, rect: el.getBoundingClientRect() }));
}

/** Flight starts for rewards shown on another screen (a contract result): side by side at mid-screen. */
export function centreCards(gains = {}) {
  const items = rewardItems(gains);
  const w = typeof innerWidth === 'number' ? innerWidth : 390;
  const h = typeof innerHeight === 'number' ? innerHeight : 844;
  return items.map((item, i) => ({ ...item, rect: { left: w / 2 - 40 + (i - (items.length - 1) / 2) * 56, top: h * 0.45, width: 80, height: 80 } }));
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * After the reveal closes and the HUD shows the new wallet: an icon flies from each card to its top-bar chip and the
 * chip counts up from the old value. Reduced motion: no flight, the numbers just land.
 */
export function flyToWallet(root, cards) {
  if (!root?.querySelector || !cards?.length || reducedMotion()) return;
  for (const card of cards) {
    const chip = root.querySelector(`.hud-chip[data-currency="${card.kind}"]`);
    if (!chip) continue;
    const target = chip.getBoundingClientRect();
    const icon = document.createElement('img');
    icon.className = 'reward-fly';
    icon.src = ICON[card.kind];
    icon.alt = '';
    icon.style.left = `${card.rect.left + card.rect.width / 2 - 16}px`;
    icon.style.top = `${card.rect.top + 8}px`;
    icon.style.setProperty('--dx', `${target.left + 12 - (card.rect.left + card.rect.width / 2 - 16)}px`);
    icon.style.setProperty('--dy', `${target.top - (card.rect.top + 8)}px`);
    document.body.appendChild(icon);
    icon.addEventListener('animationend', () => icon.remove(), { once: true });
    setTimeout(() => icon.remove(), 1500);
    countUp(chip.querySelector('b'), card.amount);
    chip.classList.add('is-gaining');
    setTimeout(() => chip.classList.remove('is-gaining'), 900);
  }
}

function countUp(el, amount) {
  if (!el) return;
  const end = Number(String(el.textContent).replace(/[^\d]/g, '')) || 0;
  const start = Math.max(0, end - amount);
  const began = performance.now();
  const step = t => {
    const k = Math.min(1, (t - began) / 700);
    el.textContent = String(Math.round(start + (end - start) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
