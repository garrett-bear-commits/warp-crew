import type { BootPhase, GameClient } from '@foundation/client';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  cityView,
  previewAssign,
  type CardId,
  type CityView,
  type IdleCivAction,
  type IdleCivEffect,
  type IdleCivState,
  type JobId,
  type ProfessionId,
  type ToolKind,
} from './sim/index.ts';

export type Overlay =
  'none' | 'boot' | 'kit' | 'name' | 'hamlet' | 'founderCard' | 'returnReport' | 'dailySupply';

export type IdleCivClient = GameClient<IdleCivState, IdleCivAction, IdleCivEffect>;

export interface IdleCivStoreState {
  client: IdleCivClient | null;
  sim: IdleCivState | null;
  view: CityView | null;
  rev: number;
  booted: boolean;
  bootPhase: BootPhase;
  bootError: string | null;
  selectedProfession: ProfessionId | null;
  preview: { foodNet: number; woodNet: number; workPerMinute: number } | null;
  toasts: { id: number; text: string }[];
  dailySupplySeen: boolean;
  nameDraft: string;
  milestoneMarked: boolean;
  overlay: Overlay;
}

export interface IdleCivStore extends IdleCivStoreState {
  bind(client: IdleCivClient): () => void;
  enterCamp(): void;
  retryBoot(): void;
  selectProfession(p: ProfessionId | null): void;
  assign(profession: Exclude<ProfessionId, 'laborer'>, delta: number): void;
  equipKit(): void;
  fundJob(jobId: JobId): void;
  craftTool(kind: ToolKind): void;
  nameSettlement(name: string): void;
  skipName(): void;
  finishHamlet(): void;
  openFounderPack(): void;
  equipFounderCard(cardId: CardId): void;
  ackReturnReport(): void;
  dismissDailySupply(): void;
  setNameDraft(name: string): void;
}

function overlayOf(s: IdleCivStoreState): Overlay {
  if (!s.booted || !s.sim) return 'boot';
  if (s.sim.returnReport && !s.sim.returnReportAcked) return 'returnReport';
  if (s.sim.kitGranted && !s.sim.kitEquipped) return 'kit';
  if (s.sim.jobs.hut.completed && !s.sim.settlementName && !s.sim.nameSkipped) return 'name';
  if (s.sim.hamletReached && !s.sim.hamletCelebrationDone) return 'hamlet';
  if (s.sim.founderPackOpened && !s.sim.founderCardEquipped) return 'founderCard';
  if (s.sim.founderCardEquipped && s.sim.dailySupplyDueAtWallMs !== null && !s.dailySupplySeen)
    return 'dailySupply';
  return 'none';
}

function project(sim: IdleCivState | null): Pick<IdleCivStoreState, 'sim' | 'view'> {
  return { sim, view: sim ? cityView(sim) : null };
}

let toastSeq = 0;

export function createIdleCivStore(): StoreApi<IdleCivStore> {
  return createStore<IdleCivStore>((set, get) => ({
    client: null,
    sim: null,
    view: null,
    rev: 0,
    booted: false,
    bootPhase: 'booting',
    bootError: null,
    selectedProfession: null,
    preview: null,
    toasts: [],
    dailySupplySeen: false,
    nameDraft: '',
    milestoneMarked: false,
    overlay: 'boot',
    bind(client) {
      const pushToasts = (effects: IdleCivEffect[]): void => {
        const texts = effects.filter((e) => e.kind === 'toast').map((e) => e.payload.text);
        if (!texts.length) return;
        set((s) => ({
          toasts: [...s.toasts, ...texts.map((text) => ({ id: ++toastSeq, text }))].slice(-8),
        }));
      };
      const sync = (): void => {
        const sim = client.state();
        const next = {
          ...project(sim),
          rev: client.rev(),
          booted: client.booted,
          bootPhase: client.bootMachine.state().phase,
        };
        const overlay = overlayOf({ ...get(), ...next });
        set({ ...next, overlay });
        const drained = client.effects.drain(['toast', 'pulse']);
        pushToasts(drained);
        if (sim.foodStabilized && !get().milestoneMarked) {
          set({ milestoneMarked: true });
          client.platform.analytics.markFirstMilestone();
          client.platform.analytics.track('food_stabilized', { simMs: sim.simMs });
        }
      };
      set({ client });
      sync();
      const offState = client.subscribe(sync);
      const offBoot = client.bootMachine.onChange((b) => {
        set((s) => {
          const patch = { bootPhase: b.phase, booted: client.booted };
          return { ...patch, overlay: overlayOf({ ...s, ...patch, sim: s.sim }) };
        });
        if (b.phase === 'cloudUnreachable' && !b.preview) client.bootMachine.startNew();
      });
      return () => {
        offState();
        offBoot();
      };
    },
    enterCamp() {
      get().client?.bootMachine.startNew();
    },
    retryBoot() {
      get().client?.bootMachine.retry();
    },
    selectProfession(p) {
      const sim = get().sim;
      const preview = sim && p && p !== 'laborer' ? previewAssign(sim, p, 1) : null;
      set((s) => ({
        selectedProfession: p,
        preview,
        overlay: overlayOf({ ...s, selectedProfession: p }),
      }));
    },
    assign(profession, delta) {
      get().client?.dispatch({ type: 'assign_worker', profession, delta });
    },
    equipKit() {
      get().client?.dispatch({ type: 'equip_kit' });
    },
    fundJob(jobId) {
      get().client?.dispatch({ type: 'fund_job', jobId });
    },
    craftTool(kind) {
      get().client?.dispatch({ type: 'craft_tool', kind });
    },
    nameSettlement(name) {
      get().client?.dispatch({ type: 'name_settlement', name });
    },
    skipName() {
      get().client?.dispatch({ type: 'skip_name' });
    },
    finishHamlet() {
      get().client?.dispatch({ type: 'finish_hamlet_celebration' });
    },
    openFounderPack() {
      get().client?.dispatch({ type: 'open_founder_pack' });
    },
    equipFounderCard(cardId) {
      get().client?.dispatch({ type: 'equip_founder_card', cardId });
    },
    ackReturnReport() {
      get().client?.dispatch({ type: 'ack_return_report' });
    },
    dismissDailySupply() {
      set((s) => {
        const next = { dailySupplySeen: true };
        return { ...next, overlay: overlayOf({ ...s, ...next }) };
      });
    },
    setNameDraft(name) {
      set({ nameDraft: name.slice(0, 24) });
    },
  }));
}
