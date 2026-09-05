import { CONFIG } from '../config';
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

/**
 * target_constraint は「対象を捉え続ける」タイプ。
 * constraint と分けるのは、UI に対象名と TARGET LOST を出す必要があるため（§50）。
 */
export type Floor1RequestType = 'action' | 'hold' | 'constraint' | 'target_constraint';

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
  /**
   * UI に出す対象名。「KEEP IT IN FRAME」だけでは何を撮るのか分からない（§35-36）。
   * object を持つ Request では必須に近い扱いにする。
   */
  targetName?: string;
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
  /** 提示の時点で対象が画面に入っていること */
  requiresVisible?: boolean;
  /** これを達成済みでないと出さない */
  afterRequest?: string;
  /**
   * 状況Request専用。直前に触ったオブジェクトがこの中にある時に出しやすくする。
   * v2 からは「これだけ」ではなく、下の setups のどれか1つで成立すればよい。
   */
  afterObject?: string[];
  /**
   * 状況Requestが成立する「お膳立て」（§10-13）。
   * どれか1つ満たせばよい。空なら afterObject だけで判断する。
   *
   *   object      直前にオブジェクトへ触った
   *   moving      部屋から部屋へ移動している
   *   lingering   同じ場所に留まっている
   *   behind      背後で音がした / 幽霊が背後にいる
   *   ghostLost   見えていた幽霊を見失った
   *   returning   帰路
   *   afterEvent  Horror Event の直後の静けさ
   */
  setups?: Array<'object' | 'moving' | 'lingering' | 'behind' | 'ghostLost' | 'returning' | 'afterEvent'>;
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
    targetName: 'THE ALTAR',
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
    targetName: 'THE ALTAR',
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
    targetName: 'THE PORTRAITS',
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
    targetName: 'THE PORTRAITS',
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
    targetName: 'THE PORTRAITS',
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
    targetName: 'THE PHONE',
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
    targetName: 'THE PHONE',
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
    targetName: 'THE PHONE',
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
    targetName: 'THE TUB',
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
    targetName: 'THE TUB',
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
    targetName: 'THE TUB',
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
    targetName: 'THE FRIDGE',
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
    targetName: 'THE MIRROR',
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
    label: 'KEEP LOOKING AT THE MIRROR',
    desc: 'DO NOT LOOK AWAY',
    type: 'target_constraint',
    reward: 5000,
    riskTier: 4,
    object: 'mirror',
    targetName: 'THE MIRROR',
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
    targetName: 'THE FIGURE ON THE SOFA',
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
    label: 'KEEP THE FIGURE IN FRAME',
    desc: 'DO NOT LOOK AWAY',
    type: 'target_constraint',
    reward: 3000,
    riskTier: 3,
    object: 'ghost',
    targetName: 'THE FIGURE ON THE SOFA',
    // 提示時点で「今まさに映っている」ことを要求する（§37-38）。
    // 20m 先の見えない相手に KEEP IT IN FRAME を出さない。
    maxDistance: 14,
    requiresVisible: true,
    requiredGhost: ['seated', 'aware', 'standing'],
    cooldown: 55,
    weight: 1.3,
    constraintSeconds: 6,
    time: 22,
    danger: 5,
    haunting: 6,
  },
  {
    // 見失った相手を撮り直させるのは別Request（§39）
    id: 'ghost_refind',
    label: 'GET IT BACK IN FRAME',
    desc: 'FIND IT AGAIN',
    type: 'target_constraint',
    reward: 4000,
    riskTier: 3,
    object: 'ghost',
    targetName: 'THE FIGURE',
    maxDistance: 26,
    requiredGhost: ['aware', 'standing', 'stalking'],
    cooldown: 70,
    weight: 1.2,
    constraintSeconds: 4,
    time: 24,
    danger: 5,
    haunting: 7,
  },
  {
    id: 'ghost_selfie',
    label: 'TAKE A SELFIE WITH IT',
    desc: '[C] SELFIE WITH IT IN FRAME',
    type: 'action',
    reward: 5000,
    riskTier: 4,
    object: 'ghost',
    targetName: 'THE FIGURE ON THE SOFA',
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
    targetName: 'THE FIGURE ON THE SOFA',
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
    targetName: 'THE FIGURE ON THE SOFA',
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
    setups: ['object', 'behind', 'ghostLost'],
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
    setups: ['object', 'behind', 'ghostLost', 'afterEvent'],
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
    setups: ['object', 'lingering', 'afterEvent'],
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
    setups: ['object', 'lingering', 'afterEvent', 'returning'],
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
    setups: ['object', 'returning', 'behind'],
  },
  {
    // 背後で何かが鳴った直後だけ。Random には出さない（§13）
    id: 'sit_look_behind',
    label: 'LOOK BEHIND YOU',
    desc: 'JUST LOOK',
    type: 'action',
    reward: 3000,
    riskTier: 3,
    cooldown: 70,
    weight: 1.5,
    time: 9,
    danger: 3,
    haunting: 5,
    setups: ['behind', 'ghostLost'],
  },
  {
    id: 'sit_stay_here',
    label: 'STAY HERE',
    desc: 'DO NOT LEAVE THIS ROOM',
    type: 'constraint',
    reward: 2500,
    riskTier: 2,
    cooldown: 80,
    weight: 1.0,
    constraintSeconds: 6,
    time: 20,
    danger: 3,
    haunting: 5,
    setups: ['moving', 'afterEvent', 'ghostLost'],
  },
  {
    id: 'sit_keep_walking',
    label: 'KEEP WALKING',
    desc: 'DO NOT STOP',
    type: 'constraint',
    reward: 2500,
    riskTier: 2,
    minHaunted: 15,
    cooldown: 80,
    weight: 1.0,
    constraintSeconds: 5,
    time: 18,
    danger: 3,
    haunting: 4,
    setups: ['moving', 'behind'],
  },
  {
    id: 'sit_stop',
    label: 'STOP',
    desc: 'STOP RIGHT THERE',
    type: 'constraint',
    reward: 2500,
    riskTier: 3,
    minHaunted: 20,
    cooldown: 85,
    weight: 1.1,
    constraintSeconds: 4,
    time: 14,
    danger: 4,
    haunting: 5,
    setups: ['moving', 'behind'],
  },
  {
    id: 'sit_go_back',
    label: 'GO BACK',
    desc: 'THE WAY YOU CAME',
    type: 'action',
    reward: 3000,
    riskTier: 3,
    minHaunted: 25,
    cooldown: 95,
    weight: 0.9,
    time: 22,
    danger: 4,
    haunting: 6,
    setups: ['moving', 'returning'],
  },
  {
    // DON'T TURN AROUND を守り切った直後だけの追い討ち（§16）
    id: 'sit_now_turn',
    label: 'NOW TURN AROUND',
    desc: 'LOOK. RIGHT NOW.',
    type: 'action',
    reward: 10000,
    riskTier: 5,
    afterRequest: 'sit_dont_turn',
    cooldown: 999,
    oncePerRun: true,
    weight: 0.6,
    time: 8,
    danger: 6,
    haunting: 9,
    setups: ['object', 'behind', 'afterEvent', 'lingering'],
  },
  // ---------------- CHASE ----------------
  {
    id: 'chase_film',
    label: 'FILM IT WHILE YOU RUN',
    desc: 'KEEP THE FIGURE IN FRAME',
    type: 'target_constraint',
    targetName: 'THE FIGURE',
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
  /**
   * Object Request がどれだけ足りていないか 0..1（§38-42）。
   * 調べた対象が増えているのに Object Request が一度も出ていない状態は不自然。
   * これは保証ではなく、スコアへの加点にしか使わない。
   */
  objectRequestNeed: number;
  /**
   * Situation Request がどれだけ足りていないか 0..1（§9-11）。
   * Object と取り合いにしない。別々に持つ。
   */
  situationRequestNeed: number;
  /** 今どんな「お膳立て」が成立しているか */
  setups: {
    object: boolean;
    moving: boolean;
    lingering: boolean;
    behind: boolean;
    ghostLost: boolean;
    returning: boolean;
    afterEvent: boolean;
  };
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
    // 「今まさに映っているもの」に対してだけ出す Request（§37-38）
    if (def.requiresVisible && !ctx.ghostOnScreen) return 'target_not_visible';
    if (def.lastTemptation && !ctx.returning) return 'not_returning';

    // 状況Requestには「お膳立て」が要る。ただし直前のオブジェクトだけに限定しない。
    // v1 では afterObject 必須にした結果、150秒のRunで状況Requestが1件しか出なかった。
    if (!def.object) {
      const setups = def.setups ?? ['object'];
      const ok = setups.some((k) => {
        if (k !== 'object') return ctx.setups[k];
        if (!ctx.lastObject) return false;
        if (ctx.sinceObject > CONFIG.floor1.pacing.situationWindow) return false;
        return !def.afterObject || def.afterObject.includes(ctx.lastObject);
      });
      if (!ok) return 'no_setup';
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
  /**
   * Object Request が出ていない状態が続くほど、Object Request を押し出す。
   * Situation Request（DON'T TURN AROUND など）に埋め尽くされるのを防ぐ（§43）。
   */
  private needBonus(def: Floor1RequestDef, ctx: Floor1Context) {
    // Object と Situation は取り合いではない。それぞれの不足に応じて別々に押す（§9, §61）。
    const cfg = CONFIG.floor1.objectNeed;
    return def.object
      ? ctx.objectRequestNeed * cfg.objectBonus
      : ctx.situationRequestNeed * cfg.situationBonus;
  }

  select(ctx: Floor1Context): Floor1RequestDef | null {
    const rejections: Rejection[] = [];
    const eligible: Floor1RequestDef[] = [];
    for (const def of FLOOR1_POOL) {
      const why = this.eligible(def, ctx);
      if (why) rejections.push({ id: def.id, reason: why });
      else eligible.push(def);
    }
    this.lastRejections = rejections;

    const scored = eligible
      .map((d) => {
        const c = this.score(d, ctx);
        const nb = this.needBonus(d, ctx);
        if (nb) {
          c.score += nb;
          c.reasons.push(`objectNeed${nb > 0 ? '+' : ''}${nb.toFixed(0)}`);
        }
        return c;
      })
      .sort((a, b) => b.score - a.score);
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
  private createdAt = new Map<string, number>();
  private elapsed = 0;

  onCreated: ((m: string) => void) | null = null;

  reset() {
    this.set.clear();
    this.createdAt.clear();
    this.elapsed = 0;
  }

  has(m: string) {
    return this.set.has(m);
  }

  all() {
    return this.set;
  }

  /** 記録されてからの秒数。忘れた頃ほど効かせるために使う */
  ages(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [m, t] of this.createdAt) out[m] = this.elapsed - t;
    return out;
  }

  /**
   * 記録する。
   * **ここでは何も発火させない。** Memory は即時トリガーではなく、
   * 関連する恐怖イベントのスコアを上げるだけ（HorrorDirector が時機を選ぶ）。
   */
  remember(m: string) {
    if (this.set.has(m)) return;
    this.set.add(m);
    this.createdAt.set(m, this.elapsed);
    this.onCreated?.(m);
  }

  update(dt: number) {
    this.elapsed += dt;
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
