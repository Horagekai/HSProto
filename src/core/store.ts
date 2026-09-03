import type { GameMode, MonsterBehavior, MonsterState } from '../config';
import type { OneGhostKpi } from '../systems/oneGhost';

export type Phase = 'menu' | 'playing' | 'dying' | 'ended';

export interface ChatMessage {
  id: number;
  user: string;
  text: string;
  hot: boolean;
}

export interface RequestView {
  id: number;
  title: string;
  description: string;
  reward: number;
  timeLeft: number;
  progress: number;
  temptation: boolean;
  /** リスク表示（受けるか断るかの判断材料） */
  risk: 'low' | 'medium' | 'high' | 'extreme';
  /** 1 = 本題 / 2 = 到着後の選択 */
  stage: 1 | 2;
  options: Array<{ id: string; label: string; reward: number }>;
  /** 達成したら次に来る要求（チキンレースの見せ札） */
  nextTitle: string | null;
  nextReward: number;
  /** すでに行動で応じているか */
  engaged: boolean;
}

export interface ResultData {
  mode: GameMode;
  survived: boolean;
  /** 円 */
  gross: number;
  lost: number;
  bonus: number;
  final: number;
  peakViewers: number;
  likes: number;
  maxEngagement: number;
  maxStars: number;
  discoveries: number;
  discoveryTotal: number;
  requestsCompleted: number;
  requestsOffered: number;
  temptations: number;
  turnBacks: number;
  duration: number;
  /** チキンレース分析 */
  chicken: {
    longestChain: number;
    continued: number;
    abandoned: number;
    heyUses: number;
    heyAgainRate: number;
    avgHesitation: number;
    lastTemptationTaken: boolean;
    highestHaunting: number;
  };
  /** ONE GHOST MODE のKPI（通常モードでは null） */
  oneGhost: OneGhostKpi | null;
  /** テンポ分析（何も起きない時間が長すぎないかの検証用） */
  tempo: {
    events: number;
    decisions: number;
    avgEventGap: number;
    avgDecisionGap: number;
    longestQuiet: number;
    forcedEvents: number;
    requestsShown: number;
    requestsAccepted: number;
    requestsIgnored: number;
    chases: number;
  };
}

export interface Snapshot {
  phase: Phase;
  mode: GameMode;
  viewers: number;
  likes: number;
  /** 円 */
  earnings: number;
  engagement: number;
  clip: number;
  stars: number;
  chaseFilmMultiplier: number;
  selfieMultiplier: number;
  subject: string | null;
  danger: number;
  haunting: number;
  monsterState: MonsterState;
  monsterBehavior: MonsterBehavior;
  distance: number;
  onScreen: boolean;
  centerScore: number;
  discovered: boolean;
  chasing: boolean;
  discoveries: number;
  chat: ChatMessage[];
  request: RequestView | null;
  /** コンテキストアクションの表示（[E] INSPECT など） */
  prompt: string | null;
  /** 入口付近で出す収支表示 */
  atEntrance: boolean;
  leaving: boolean;
  selfie: boolean;
  /** LIGHTS OFF リクエスト中 */
  lightsOff: boolean;
  /** 人形を抱えている */
  carrying: boolean;
  /** ポインタロックが外れた直後だけ出す一時的な案内 */
  mouseHint: boolean;
  toast: string | null;
  footage: string | null;
  hint: string | null;
  connectionLost: boolean;
  result: ResultData | null;
  debug: boolean;
  pointerLocked: boolean;
  playerPos: { x: number; z: number };
  fps: number;
}

const initial: Snapshot = {
  phase: 'menu',
  mode: 'standard',
  viewers: 0,
  likes: 0,
  earnings: 0,
  engagement: 1,
  clip: 0,
  stars: 0,
  chaseFilmMultiplier: 1,
  selfieMultiplier: 1,
  subject: null,
  danger: 0,
  haunting: 0,
  monsterState: 'dormant',
  monsterBehavior: 'idle',
  distance: 0,
  onScreen: false,
  centerScore: 0,
  discovered: false,
  chasing: false,
  discoveries: 0,
  chat: [],
  request: null,
  prompt: null,
  atEntrance: false,
  leaving: false,
  selfie: false,
  lightsOff: false,
  carrying: false,
  mouseHint: false,
  toast: null,
  footage: null,
  hint: null,
  connectionLost: false,
  result: null,
  debug: false,
  pointerLocked: false,
  playerPos: { x: 0, z: 0 },
  fps: 0,
};

/**
 * ゲームループ(60fps)とReactの橋渡し。
 * 通常は約20Hzでフラッシュし、重要な変化は即時フラッシュする。
 */
class Store {
  private snapshot: Snapshot = initial;
  private pending: Snapshot = initial;
  private listeners = new Set<() => void>();
  private dirty = false;
  private lastFlush = 0;

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  set(patch: Partial<Snapshot>) {
    this.pending = { ...this.pending, ...patch };
    this.dirty = true;
  }

  setNow(patch: Partial<Snapshot>) {
    this.set(patch);
    this.flush(true);
  }

  flush(force = false) {
    if (!this.dirty) return;
    const now = performance.now();
    if (!force && now - this.lastFlush < 50) return;
    this.lastFlush = now;
    this.dirty = false;
    this.snapshot = this.pending;
    this.listeners.forEach((l) => l());
  }

  reset() {
    this.pending = { ...initial };
    this.dirty = true;
    this.flush(true);
  }
}

export const store = new Store();
