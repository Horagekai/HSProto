import { CONFIG } from '../config';
import { pick, randRange } from '../core/util';
import type { Floor1Room } from '../world/floor1Level';
import { FLOOR1_OBJECTS } from '../world/floor1Level';

/**
 * HS FLOOR 1 MODE の中核。
 *
 * Request Director は「次のタスクを選ぶAI」ではない。
 * プレイヤーが今なにを見ていて、なにをやった直後で、どれくらい怖い状態かを見て、
 * **「今ここであと一歩だけ欲張らせるなら何が自然か」** を選ぶ。
 *
 * そのため Request は
 *   全候補 → Contextでフィルタ → スコア付け → 上位から重み付き抽選
 * で選ぶ。完全固定でも完全ランダムでもない。
 */

export type Floor1RequestType = 'action' | 'hold' | 'constraint';

export interface HoldTier {
  /** 何秒押し続けたら */
  at: number;
  reward: number;
  /** 次に見せる文言 */
  label: string;
}

export interface Floor1RequestDef {
  id: string;
  label: string;
  desc: string;
  type: Floor1RequestType;
  /** action / constraint の報酬。hold は tiers 側 */
  reward: number;
  /** 1(軽い) 〜 5(最高) */
  riskTier: number;
  /** 関連オブジェクト。近くにいることが条件になる */
  object?: string;
  room?: Floor1Room;
  maxDistance?: number;
  /** "phone|ringing" のように オブジェクト|状態 */
  requiredState?: string;
  forbiddenState?: string;
  requiredMemory?: string;
  forbiddenMemory?: string;
  minHaunted?: number;
  maxHaunted?: number;
  /** 幽霊がこの段階でないと出さない */
  requiredGhost?: GhostState[];
  /** これを達成済みでないと出さない */
  afterRequest?: string;
  /**
   * 状況Request専用。**直前に触ったオブジェクトがこの中にある時だけ出す。**
   * これが無いと「文脈と無関係な制約」が受け皿として出続けてしまう。
   */
  afterObject?: string[];
  cooldown: number;
  oncePerRun?: boolean;
  weight: number;
  holdTiers?: HoldTier[];
  constraintSeconds?: number;
  /** 制限時間 */
  time: number;
  danger: number;
  haunting: number;
  /** 目標達成後に出やすくする高額枠か */
  overtime?: boolean;
  /** 帰り際の最後の誘惑にだけ使う */
  lastTemptation?: boolean;
}

export type GhostState = 'seated' | 'aware' | 'standing' | 'stalking' | 'chasing';

/* ------------------------------------------------------------------ *
 * Request Pool
 *
 * オブジェクト固有の Pool と、状況に制約を足す SITUATION_POOL を分ける。
 * 固有 Request だけだとお使いゲームになり、状況 Request だけだと文脈が消える。
 * ------------------------------------------------------------------ */

const HOLD_ALTAR: HoldTier[] = [
  { at: 2, reward: 1000, label: 'KEEP THE BEAT' },
  { at: 5, reward: 2000, label: "DON'T STOP" },
  { at: 8, reward: 4000, label: 'KEEP GOING' },
  { at: 12, reward: 7000, label: '...' },
];

const HOLD_PHONE: HoldTier[] = [
  { at: 2, reward: 1000, label: 'KEEP LISTENING' },
  { at: 5, reward: 2500, label: "DON'T HANG UP" },
  { at: 9, reward: 5000, label: 'STAY ON THE LINE' },
  { at: 13, reward: 9000, label: '...' },
];

const HOLD_FRIDGE: HoldTier[] = [
  { at: 2, reward: 2000, label: 'KEEP IT OPEN' },
  { at: 5, reward: 4000, label: 'LOOK INSIDE' },
  { at: 8, reward: 7000, label: 'CLOSER' },
];

export const FLOOR1_POOL: Floor1RequestDef[] = [
  // ---------------- ALTAR ----------------
  {
    id: 'altar_beat',
    label: 'PLAY A BEAT',
    desc: '[HOLD E] RING THE BELL',
    type: 'hold',
    reward: 1000,
    riskTier: 1,
    object: 'altar',
    maxDistance: 3.2,
    cooldown: 60,
    weight: 1.2,
    holdTiers: HOLD_ALTAR,
    time: 26,
    danger: 2,
    haunting: 3,
  },
  {
    id: 'altar_again',
    label: 'DO IT AGAIN',
    desc: '[HOLD E] ONE MORE TIME',
    type: 'hold',
    reward: 1500,
    riskTier: 3,
    object: 'altar',
    maxDistance: 3.2,
    requiredMemory: 'altar_overplayed',
    cooldown: 90,
    weight: 0.7,
    holdTiers: HOLD_ALTAR,
    time: 24,
    danger: 5,
    haunting: 8,
    overtime: true,
  },
  // ---------------- PORTRAITS ----------------
  {
    id: 'portrait_look',
    label: 'LOOK CLOSER',
    desc: '[E] EXAMINE THE CENTRE ONE',
    type: 'action',
    reward: 800,
    riskTier: 1,
    object: 'portraits',
    maxDistance: 3,
    forbiddenState: 'portraits|fallen',
    cooldown: 60,
    oncePerRun: true,
    weight: 1.0,
    time: 22,
    danger: 1,
    haunting: 3,
  },
  {
    id: 'portrait_pick',
    label: 'PICK IT UP',
    desc: '[E] LIFT THE FALLEN PORTRAIT',
    type: 'action',
    reward: 2000,
    riskTier: 2,
    object: 'portraits',
    maxDistance: 3,
    requiredState: 'portraits|fallen',
    cooldown: 40,
    oncePerRun: true,
    weight: 1.3,
    time: 22,
    danger: 3,
    haunting: 5,
  },
  {
    id: 'portrait_back',
    label: 'PUT IT BACK',
    desc: '[E] HANG IT WHERE IT WAS',
    type: 'action',
    reward: 4000,
    riskTier: 3,
    object: 'portraits',
    maxDistance: 3,
    requiredState: 'portraits|held',
    afterRequest: 'portrait_pick',
    cooldown: 40,
    oncePerRun: true,
    weight: 1.1,
    time: 22,
    danger: 5,
    haunting: 9,
  },
  // ---------------- PHONE ----------------
  {
    id: 'phone_answer',
    label: 'PICK IT UP',
    desc: '[E] ANSWER THE PHONE',
    type: 'action',
    reward: 1500,
    riskTier: 2,
    object: 'phone',
    maxDistance: 3,
    requiredState: 'phone|ringing',
    cooldown: 30,
    weight: 2.0,
    time: 18,
    danger: 2,
    haunting: 4,
  },
  {
    id: 'phone_listen',
    label: 'KEEP LISTENING',
    desc: '[HOLD E] HOLD IT TO YOUR EAR',
    type: 'hold',
    reward: 1000,
    riskTier: 3,
    object: 'phone',
    maxDistance: 3,
    requiredState: 'phone|answered',
    cooldown: 40,
    weight: 2.2,
    holdTiers: HOLD_PHONE,
    time: 30,
    danger: 4,
    haunting: 6,
  },
  {
    id: 'phone_last',
    label: 'ONE LAST LISTEN',
    desc: '[HOLD E] PICK IT UP ONE MORE TIME',
    type: 'hold',
    reward: 10000,
    riskTier: 5,
    object: 'phone',
    maxDistance: 4,
    requiredMemory: 'phone_listened_long',
    cooldown: 999,
    oncePerRun: true,
    weight: 1.0,
    holdTiers: [
      { at: 2, reward: 4000, label: 'KEEP LISTENING' },
      { at: 5, reward: 10000, label: "DON'T HANG UP" },
    ],
    time: 22,
    danger: 8,
    haunting: 10,
    lastTemptation: true,
  },
  // ---------------- BATH ----------------
  {
    id: 'bath_sip',
    label: 'TAKE A SIP',
    desc: '[E] DRINK FROM THE TUB',
    type: 'action',
    reward: 2000,
    riskTier: 2,
    object: 'bath',
    maxDistance: 3,
    forbiddenMemory: 'bath_sip_1',
    cooldown: 45,
    oncePerRun: true,
    weight: 1.8,
    time: 24,
    danger: 3,
    haunting: 4,
  },
  {
    id: 'bath_sip2',
    label: 'ONE MORE SIP',
    desc: '[E] AGAIN',
    type: 'action',
    reward: 5000,
    riskTier: 3,
    object: 'bath',
    maxDistance: 3,
    requiredMemory: 'bath_sip_1',
    forbiddenMemory: 'bath_sip_2',
    cooldown: 45,
    oncePerRun: true,
    weight: 1.6,
    time: 24,
    danger: 6,
    haunting: 7,
  },
  {
    id: 'bath_finish',
    label: 'FINISH IT',
    desc: '[E] ALL OF IT',
    type: 'action',
    reward: 10000,
    riskTier: 5,
    object: 'bath',
    maxDistance: 3,
    requiredMemory: 'bath_sip_2',
    cooldown: 60,
    oncePerRun: true,
    weight: 0.8,
    time: 22,
    danger: 12,
    haunting: 14,
    overtime: true,
  },
  // ---------------- FRIDGE ----------------
  {
    id: 'fridge_open',
    label: 'KEEP IT OPEN',
    desc: '[HOLD E] HOLD THE DOOR',
    type: 'hold',
    reward: 2000,
    riskTier: 2,
    object: 'fridge',
    maxDistance: 3,
    requiredState: 'fridge|bugs',
    cooldown: 50,
    weight: 1.5,
    holdTiers: HOLD_FRIDGE,
    time: 26,
    danger: 3,
    haunting: 5,
  },
  // ---------------- MIRROR ----------------
  {
    id: 'mirror_dark',
    label: 'TURN OFF THE LIGHT',
    desc: '[F] KILL YOUR LIGHT AT THE MIRROR',
    type: 'constraint',
    reward: 3000,
    riskTier: 3,
    object: 'mirror',
    maxDistance: 3.5,
    minHaunted: 25,
    cooldown: 70,
    weight: 1.2,
    constraintSeconds: 5,
    time: 24,
    danger: 5,
    haunting: 8,
  },
  {
    id: 'mirror_stare',
    label: 'KEEP LOOKING',
    desc: 'DO NOT LOOK AWAY',
    type: 'constraint',
    reward: 5000,
    riskTier: 4,
    object: 'mirror',
    maxDistance: 3.5,
    afterRequest: 'mirror_dark',
    cooldown: 70,
    weight: 1.1,
    constraintSeconds: 5,
    time: 22,
    danger: 8,
    haunting: 10,
  },
  // ---------------- GHOST ----------------
  {
    id: 'ghost_closer',
    label: 'GET CLOSER',
    desc: 'WALK UP TO IT',
    type: 'action',
    reward: 2000,
    riskTier: 2,
    object: 'ghost',
    maxDistance: 16,
    requiredGhost: ['seated', 'aware'],
    cooldown: 45,
    weight: 1.6,
    time: 22,
    danger: 4,
    haunting: 5,
  },
  {
    id: 'ghost_frame',
    label: 'KEEP IT IN FRAME',
    desc: 'DO NOT LOOK AWAY',
    type: 'constraint',
    reward: 3000,
    riskTier: 3,
    object: 'ghost',
    maxDistance: 18,
    requiredGhost: ['seated', 'aware', 'standing'],
    cooldown: 55,
    weight: 1.3,
    constraintSeconds: 6,
    time: 22,
    danger: 5,
    haunting: 6,
  },
  {
    id: 'ghost_selfie',
    label: 'TAKE A SELFIE WITH IT',
    desc: '[C] SELFIE WITH IT IN FRAME',
    type: 'action',
    reward: 5000,
    riskTier: 4,
    object: 'ghost',
    maxDistance: 12,
    requiredGhost: ['seated', 'aware', 'standing'],
    cooldown: 60,
    weight: 1.5,
    time: 26,
    danger: 10,
    haunting: 10,
  },
  {
    id: 'ghost_selfie_close',
    label: 'GET CLOSER FOR THE SELFIE',
    desc: '[C] WITHIN 4m',
    type: 'action',
    reward: 8000,
    riskTier: 5,
    object: 'ghost',
    maxDistance: 10,
    requiredMemory: 'ghost_selfie_taken',
    cooldown: 70,
    weight: 1.2,
    time: 24,
    danger: 16,
    haunting: 12,
    overtime: true,
  },
  {
    id: 'ghost_last_selfie',
    label: 'TAKE ONE LAST SELFIE',
    desc: '[C] BEFORE YOU GO',
    type: 'action',
    reward: 15000,
    riskTier: 5,
    object: 'ghost',
    maxDistance: 26,
    requiredMemory: 'ghost_selfie_taken',
    cooldown: 999,
    oncePerRun: true,
    weight: 1.0,
    time: 24,
    danger: 18,
    haunting: 14,
    lastTemptation: true,
  },
  // ---------------- SITUATION ----------------
  {
    id: 'sit_dont_turn',
    label: "DON'T TURN AROUND",
    desc: 'KEEP FACING FORWARD',
    type: 'constraint',
    reward: 5000,
    riskTier: 4,
    minHaunted: 30,
    cooldown: 110,
    weight: 1.0,
    constraintSeconds: 5,
    time: 20,
    danger: 6,
    haunting: 8,
    afterObject: ['ghost', 'phone', 'mirror', 'fridge', 'portraits'],
  },
  {
    id: 'sit_turn',
    label: 'TURN AROUND',
    desc: 'LOOK BEHIND YOU',
    type: 'action',
    reward: 10000,
    riskTier: 4,
    afterRequest: 'sit_dont_turn',
    cooldown: 120,
    weight: 1.1,
    time: 10,
    danger: 4,
    haunting: 6,
    afterObject: ['ghost', 'phone', 'mirror'],
  },
  {
    id: 'sit_dont_move',
    label: "DON'T MOVE",
    desc: 'STAND STILL',
    type: 'constraint',
    reward: 3000,
    riskTier: 3,
    minHaunted: 20,
    cooldown: 115,
    weight: 0.7,
    constraintSeconds: 6,
    time: 20,
    danger: 4,
    haunting: 6,
    afterObject: ['altar', 'bath', 'phone', 'portraits'],
  },
  {
    id: 'sit_lights_off',
    label: 'LIGHTS OFF',
    desc: '[F] KILL THE LIGHT AND WAIT',
    type: 'constraint',
    reward: 4000,
    riskTier: 3,
    minHaunted: 30,
    cooldown: 120,
    weight: 0.7,
    constraintSeconds: 6,
    time: 22,
    danger: 5,
    haunting: 9,
    afterObject: ['mirror', 'altar', 'fridge'],
  },
  {
    id: 'sit_turn_last',
    label: 'TURN AROUND',
    desc: 'ONE LAST LOOK BEHIND YOU',
    type: 'action',
    reward: 12000,
    riskTier: 5,
    minHaunted: 40,
    cooldown: 999,
    oncePerRun: true,
    weight: 1.0,
    time: 12,
    danger: 6,
    haunting: 8,
    lastTemptation: true,
    afterObject: ['ghost', 'phone', 'mirror'],
  },
  // ---------------- CHASE ----------------
  {
    id: 'chase_film',
    label: 'FILM IT WHILE YOU RUN',
    desc: 'KEEP IT IN FRAME',
    type: 'constraint',
    reward: 8000,
    riskTier: 5,
    requiredGhost: ['chasing'],
    cooldown: 20,
    weight: 3.0,
    constraintSeconds: 2,
    time: 20,
    danger: 0,
    haunting: 5,
  },
];

/* ------------------------------------------------------------------ *
 * Context / Director
 * ------------------------------------------------------------------ */

export interface Floor1Context {
  room: Floor1Room;
  /** id → 距離 */
  distances: Record<string, number>;
  /** id → 現在の状態 */
  states: Record<string, string>;
  discovered: Set<string>;
  memory: Set<string>;
  completed: Set<string>;
  haunted: number;
  ghost: GhostState;
  ghostDistance: number;
  ghostOnScreen: boolean;
  selfie: boolean;
  lightOn: boolean;
  goalReached: boolean;
  returning: boolean;
  /** 最後に意味のあることが起きてからの秒数 */
  sinceEvent: number;
  /** カメラを向けている時間（id → 秒） */
  attention: Record<string, number>;
  /** 一度離れて戻ってきた対象 */
  reengaged: Set<string>;
  /** 直前に触った / 達成したオブジェクト。状況Requestはこれに紐づく */
  lastObject: string | null;
  /** その出来事からの経過秒 */
  sinceObject: number;
}

export interface Candidate {
  def: Floor1RequestDef;
  score: number;
  reasons: string[];
}

export interface Rejection {
  id: string;
  reason: string;
}

export class Floor1Director {
  /** id → 最後に出した時刻 */
  private lastOffered = new Map<string, number>();
  private offeredIds: string[] = [];
  elapsed = 0;

  /** デバッグ表示用 */
  lastCandidates: Candidate[] = [];
  lastRejections: Rejection[] = [];

  reset() {
    this.lastOffered.clear();
    this.offeredIds = [];
    this.elapsed = 0;
    this.lastCandidates = [];
    this.lastRejections = [];
  }

  update(dt: number) {
    this.elapsed += dt;
  }

  markOffered(id: string) {
    this.lastOffered.set(id, this.elapsed);
    this.offeredIds.push(id);
    if (this.offeredIds.length > 10) this.offeredIds.shift();
  }

  /**
   * 候補を絞る。
   * 「近くにいる」は**条件であってトリガーではない**。ここを通っても即提示はしない。
   */
  private eligible(def: Floor1RequestDef, ctx: Floor1Context): string | null {
    if (def.oncePerRun && ctx.completed.has(def.id)) return 'once_per_run';
    const last = this.lastOffered.get(def.id);
    if (last !== undefined && this.elapsed - last < def.cooldown) return 'cooldown';
    if (this.offeredIds.slice(-5).includes(def.id)) return 'recent_repeat';

    if (def.object) {
      const isGhost = def.object === 'ghost';
      if (!isGhost && !ctx.discovered.has(def.object)) return 'not_discovered';
      if (isGhost && !ctx.discovered.has('ghost')) return 'not_discovered';
      const d = isGhost ? ctx.ghostDistance : ctx.distances[def.object];
      if (d === undefined) return 'no_distance';
      if (def.maxDistance !== undefined && d > def.maxDistance) return 'too_far';
    }
    if (def.room && ctx.room !== def.room) return 'wrong_room';

    if (def.requiredState) {
      const [id, st] = def.requiredState.split('|');
      if (ctx.states[id] !== st) return 'state_mismatch';
    }
    if (def.forbiddenState) {
      const [id, st] = def.forbiddenState.split('|');
      if (ctx.states[id] === st) return 'state_forbidden';
    }
    if (def.requiredMemory && !ctx.memory.has(def.requiredMemory)) return 'memory_missing';
    if (def.forbiddenMemory && ctx.memory.has(def.forbiddenMemory)) return 'memory_present';
    if (def.afterRequest && !ctx.completed.has(def.afterRequest)) return 'prereq_missing';
    if (def.minHaunted !== undefined && ctx.haunted < def.minHaunted) return 'haunted_low';
    if (def.maxHaunted !== undefined && ctx.haunted > def.maxHaunted) return 'haunted_high';
    if (def.requiredGhost && !def.requiredGhost.includes(ctx.ghost)) return 'ghost_state';
    if (def.lastTemptation && !ctx.returning) return 'not_returning';

    // 状況Requestは、直前に触ったオブジェクトに紐づくものだけ出す（受け皿にしない）
    if (!def.object) {
      if (!ctx.lastObject) return 'no_recent_object';
      if (ctx.sinceObject > CONFIG.floor1.pacing.situationWindow) return 'object_too_old';
      if (def.afterObject && !def.afterObject.includes(ctx.lastObject)) return 'object_mismatch';
    }
    if (!def.lastTemptation && ctx.ghost === 'chasing' && def.id !== 'chase_film') return 'chasing';
    return null;
  }

  /**
   * スコア。
   *   関連度 + 近さ + 状態の一致 + テンポの必要性 + 新規性 + エスカレーション適合
   *   - 直近の繰り返し - 割り込み
   */
  private score(def: Floor1RequestDef, ctx: Floor1Context): Candidate {
    const reasons: string[] = [];
    let s = def.weight * 10;

    if (def.object) {
      const isGhost = def.object === 'ghost';
      const d = isGhost ? ctx.ghostDistance : ctx.distances[def.object] ?? 99;
      const max = def.maxDistance ?? 20;
      const prox = Math.max(0, 1 - d / max);
      s += prox * 14;
      reasons.push(`prox+${(prox * 14).toFixed(0)}`);

      // 「たまたま通りかかった」より「見ている・留まっている」を優先する
      const att = ctx.attention[def.object] ?? 0;
      const attScore = Math.min(10, att * 3);
      s += attScore;
      if (attScore > 0) reasons.push(`attention+${attScore.toFixed(0)}`);

      // 一度離れて戻ってきた = 自分から関わりに行っている。強いシグナル
      if (ctx.reengaged.has(def.object)) {
        s += 12;
        reasons.push('reengaged+12');
      }
    } else {
      // 状況Requestは「直前にやったことの続き」としてだけ出す。
      // 出来事から時間が経つほど価値が落ちる
      const fresh = Math.max(0, 1 - ctx.sinceObject / CONFIG.floor1.pacing.situationWindow);
      s += fresh * 12;
      reasons.push(`after_${ctx.lastObject}+${(fresh * 12).toFixed(0)}`);
      const sameCount = this.offeredIds.slice(-5).filter((id) =>
        FLOOR1_POOL.find((p) => p.id === id && !p.object),
      ).length;
      if (sameCount > 0) {
        s -= sameCount * 9;
        reasons.push(`situation_fatigue-${sameCount * 9}`);
      }
    }

    // 静かな時間が続いているほど出したい
    const pacing = Math.min(10, Math.max(0, ctx.sinceEvent - 6) * 1.2);
    s += pacing;
    if (pacing > 0) reasons.push(`pacing+${pacing.toFixed(0)}`);

    // Haunted と危険度の噛み合い。怖くなるほど高Tierが自然になる
    const want = 1 + Math.floor(ctx.haunted / 22);
    const fit = 6 - Math.abs(def.riskTier - want) * 2.5;
    s += fit;
    reasons.push(`escalation${fit >= 0 ? '+' : ''}${fit.toFixed(0)}`);

    // 目標達成後は高額枠を前に出す
    if (ctx.goalReached) {
      if (def.overtime || def.riskTier >= 4) {
        s += 8;
        reasons.push('overtime+8');
      } else {
        s -= 6;
        reasons.push('overtime-6');
      }
    }

    // 同じオブジェクトばかりにならないように
    const recentSameObject = this.offeredIds
      .slice(-3)
      .filter((id) => FLOOR1_POOL.find((p) => p.id === id)?.object === def.object).length;
    if (def.object && recentSameObject > 0) {
      s -= recentSameObject * 7;
      reasons.push(`fatigue-${recentSameObject * 7}`);
    }

    return { def, score: s, reasons };
  }

  /** 候補を出す。null なら今は出さない（沈黙も正解） */
  select(ctx: Floor1Context): Floor1RequestDef | null {
    const rejections: Rejection[] = [];
    const eligible: Floor1RequestDef[] = [];
    for (const def of FLOOR1_POOL) {
      const why = this.eligible(def, ctx);
      if (why) rejections.push({ id: def.id, reason: why });
      else eligible.push(def);
    }
    this.lastRejections = rejections;

    const scored = eligible.map((d) => this.score(d, ctx)).sort((a, b) => b.score - a.score);
    this.lastCandidates = scored.slice(0, 5);
    if (!scored.length) return null;

    // 上位3〜5件から重み付き抽選。毎回同じ順にはならない
    const top = scored.slice(0, Math.min(5, scored.length)).filter((c) => c.score > 0);
    if (!top.length) return null;
    const total = top.reduce((a, c) => a + c.score, 0);
    let r = Math.random() * total;
    for (const c of top) {
      r -= c.score;
      if (r <= 0) return c.def;
    }
    return top[0].def;
  }
}

/* ------------------------------------------------------------------ *
 * 世界の記憶と、遅れてやってくる結果
 * ------------------------------------------------------------------ */

export interface DelayedConsequence {
  memory: string;
  delay: number;
  kind: string;
}

export class WorldMemory {
  private set = new Set<string>();
  private pending: DelayedConsequence[] = [];

  onFire: ((c: DelayedConsequence) => void) | null = null;

  reset() {
    this.set.clear();
    this.pending = [];
  }

  has(m: string) {
    return this.set.has(m);
  }

  all() {
    return this.set;
  }

  /**
   * 記録する。同時に「後から効いてくる結果」を予約する。
   * 狙いは、プレイヤーに『これ、さっき自分がやったせいでは？』と思わせること。
   */
  remember(m: string) {
    if (this.set.has(m)) return;
    this.set.add(m);
    const table: Record<string, string[]> = {
      altar_overplayed: ['distant_bell', 'light_sway', 'portrait_tilt'],
      phone_listened_long: ['distant_phone', 'own_voice', 'footstep_behind'],
      bath_sip_2: ['water_running', 'drain', 'door_sound'],
      portrait_restored: ['portrait_changed', 'distant_bell'],
      ghost_selfie_taken: ['sofa_empty', 'footstep_behind'],
      fridge_held_long: ['kitchen_noise', 'door_sound'],
    };
    const kinds = table[m];
    if (!kinds) return;
    this.pending.push({ memory: m, delay: randRange(25, 75), kind: pick(kinds) });
  }

  update(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].delay -= dt;
      if (this.pending[i].delay > 0) continue;
      const c = this.pending[i];
      this.pending.splice(i, 1);
      this.onFire?.(c);
    }
  }
}

/* ------------------------------------------------------------------ *
 * オブジェクトの発見と状態
 * ------------------------------------------------------------------ */

export interface Floor1ObjectState {
  id: string;
  discovered: boolean;
  state: string;
  interactions: number;
  /** カメラを向けていた累計秒数 */
  attention: number;
  /** 一度離れたか（戻ってきた判定に使う） */
  wasAway: boolean;
  reengaged: boolean;
}

export class Floor1Objects {
  map = new Map<string, Floor1ObjectState>();

  reset() {
    this.map.clear();
    for (const o of FLOOR1_OBJECTS) {
      this.map.set(o.id, {
        id: o.id,
        discovered: false,
        state: 'normal',
        interactions: 0,
        attention: 0,
        wasAway: true,
        reengaged: false,
      });
    }
    // 幽霊は専用の擬似オブジェクトとして扱う
    this.map.set('ghost', {
      id: 'ghost',
      discovered: false,
      state: 'seated',
      interactions: 0,
      attention: 0,
      wasAway: true,
      reengaged: false,
    });
  }

  get(id: string) {
    return this.map.get(id);
  }

  setState(id: string, state: string) {
    const o = this.map.get(id);
    if (!o || o.state === state) return false;
    o.state = state;
    return true;
  }

  states(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, o] of this.map) out[id] = o.state;
    return out;
  }

  discoveredSet() {
    const s = new Set<string>();
    for (const [id, o] of this.map) if (o.discovered) s.add(id);
    return s;
  }

  attentionMap(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, o] of this.map) out[id] = o.attention;
    return out;
  }

  reengagedSet() {
    const s = new Set<string>();
    for (const [id, o] of this.map) if (o.reengaged) s.add(id);
    return s;
  }
}

/** 目標。時間だけでは達成にしない */
export function goalReached(opts: {
  elapsed: number;
  discoveries: number;
  earnings: number;
}) {
  return (
    opts.elapsed >= CONFIG.floor1.goal.minTime &&
    opts.discoveries >= CONFIG.floor1.goal.minDiscoveries &&
    opts.earnings >= CONFIG.floor1.goal.target
  );
}
