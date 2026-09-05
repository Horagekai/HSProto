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

/**
 * 状況Requestの「お膳立て」（§26-28）。
 *
 * v2 まで状況Requestは「直前にオブジェクトへ触っていること」が必須で、
 * 移動中や幽霊を見失った直後には構造的に出せなかった。設計意図と逆だった。
 */
export type SituationSetup =
  | 'object'
  | 'behind'
  | 'ghostLost'
  | 'afterPhone'
  | 'afterHorror'
  | 'roomTransition'
  | 'hallway'
  | 'returning'
  | 'lingering'
  | 'moving'
  | 'quietSuspense';

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
  /** これより近いと出さない。遠いとき用の Request に使う */
  minDistance?: number;
  /** Core Opportunity 中でも距離を緩めない。遠距離版が別にある Request 用 */
  noCoreReach?: boolean;
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
  /**
   * 状況Requestが「その部屋にいるだけで」候補になれる部屋（§5-6）。
   * Eligibility は「今これを言ったら完全に意味不明か」だけを見る。
   * 自然さの強弱は Score が決める。
   */
  allowedRooms?: Floor1Room[];
  /** この対象が近い / 最近触ったなら候補になれる（§8-14） */
  relatedObjects?: string[];
  maxRelatedObjectDistance?: number;
  recentObjectWindow?: number;
  /**
   * お膳立て。**Eligibility の条件ではなく Score のボーナス**（§3, §23）。
   * これが無くても部屋や距離で候補には入る。順位が下がるだけ。
   */
  preferredSetups?: SituationSetup[];
  /**
   * 連鎖の役割（§33-35）。
   * followup は「同じ流れの続き」なので、状況Requestの連発ペナルティを免除する。
   * DON'T TURN AROUND → NOW TURN AROUND が fatigue で消えていた。
   */
  chainRole?: 'opener' | 'followup' | 'finisher';
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
    // 電話は一度見つけていれば、別の部屋にいても Viewer は場所を知っている（§32-33）
    id: 'phone_return',
    label: 'GO BACK AND ANSWER IT',
    desc: "IT'S STILL RINGING",
    type: 'action',
    reward: 4000,
    riskTier: 3,
    object: 'phone',
    targetName: 'THE PHONE',
    maxDistance: 40,
    minDistance: 8,
    requiredState: 'phone|ringing',
    cooldown: 70,
    weight: 1.4,
    time: 26,
    danger: 4,
    haunting: 6,
  },
  {
    id: 'phone_answer',
    label: 'PICK IT UP',
    desc: '[E] ANSWER THE PHONE',
    type: 'action',
    reward: 2000,
    riskTier: 2,
    object: 'phone',
    targetName: 'THE PHONE',
    // 「取れ」と言えるのは、歩いて行ける距離にいるとき（§31）。
    // 遠いときは phone_return（GO BACK AND ANSWER IT）が担当する
    maxDistance: 8,
    noCoreReach: true,
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
    // 「フレームに収め続けろ」は距離を緩めない。
    // Core の緩和（2.2倍）が効くと 30m 先でも提示でき、直後に TOO FAR になる。
    maxDistance: 14,
    noCoreReach: true,
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
    relatedObjects: ['ghost', 'phone', 'mirror', 'portraits'],
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
    // 背後の音・幽霊を見失った・電話のあとが本命。オブジェクトは要らない
    preferredSetups: ['behind', 'ghostLost', 'afterPhone', 'afterHorror', 'object'],
  },
  {
    id: 'sit_turn',
    relatedObjects: ['ghost', 'phone', 'mirror', 'portraits'],
    label: 'TURN AROUND',
    desc: 'LOOK BEHIND YOU',
    type: 'action',
    reward: 6000,
    riskTier: 4,
    cooldown: 120,
    weight: 1.1,
    time: 10,
    danger: 4,
    haunting: 6,
    afterObject: ['ghost', 'phone', 'mirror'],
    preferredSetups: ['behind', 'ghostLost', 'afterPhone', 'afterHorror', 'object'],
  },
  {
    id: 'sit_dont_move',
    relatedObjects: ['altar', 'bath', 'phone', 'portraits', 'fridge'],
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
    preferredSetups: ['quietSuspense', 'lingering', 'afterHorror', 'behind', 'object'],
  },
  {
    id: 'sit_lights_off',
    relatedObjects: ['mirror', 'altar', 'fridge', 'bath'],
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
    preferredSetups: ['quietSuspense', 'lingering', 'afterHorror', 'returning', 'object'],
  },
  {
    id: 'sit_turn_last',
    relatedObjects: ['ghost', 'phone', 'mirror'],
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
    preferredSetups: ['returning', 'behind', 'object'],
  },
  {
    // 背後で何かが鳴った直後だけ。Random には出さない（§13）
    id: 'sit_look_behind',
    relatedObjects: ['ghost', 'phone', 'mirror'],
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
    preferredSetups: ['behind', 'ghostLost'],
  },
  {
    id: 'sit_stay_here',
    relatedObjects: ['ghost', 'altar', 'bath'],
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
    preferredSetups: ['roomTransition', 'hallway', 'afterHorror', 'ghostLost', 'quietSuspense', 'lingering'],
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
    preferredSetups: ['moving', 'behind'],
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
    preferredSetups: ['moving', 'behind'],
  },
  {
    id: 'sit_go_back',
    relatedObjects: ['ghost', 'altar', 'bath', 'portraits'],
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
    preferredSetups: ['roomTransition', 'returning', 'ghostLost'],
  },
  {
    // DON'T TURN AROUND を守り切った直後だけの追い討ち（§16）
    id: 'sit_now_turn',
    relatedObjects: ['ghost', 'phone', 'mirror'],
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
    preferredSetups: ['behind', 'afterHorror', 'lingering', 'quietSuspense'],
    chainRole: 'followup',
  },
  {
    id: 'sit_dont_look_away',
    relatedObjects: ['ghost', 'portraits', 'mirror', 'altar'],
    label: "DON'T LOOK AWAY",
    desc: 'KEEP YOUR CAMERA ON IT',
    type: 'constraint',
    reward: 3000,
    riskTier: 3,
    minHaunted: 18,
    cooldown: 90,
    weight: 1.0,
    constraintSeconds: 5,
    time: 18,
    danger: 4,
    haunting: 6,
    preferredSetups: ['quietSuspense', 'lingering', 'afterHorror', 'behind'],
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

/**
 * 部屋ごとに「そこにいるだけで意味が通る」状況Request（§5, §38）。
 * 全部を全部屋でONにはしない。Bath で KEEP WALKING は意味が薄い。
 */
export const ROOM_SITUATION_POOLS: Record<string, string[]> = {
  entrance: ['sit_turn', 'sit_dont_turn', 'sit_look_behind', 'sit_stop', 'sit_keep_walking', 'sit_go_back'],
  hallway: [
    'sit_turn', 'sit_dont_turn', 'sit_look_behind', 'sit_stop',
    'sit_keep_walking', 'sit_dont_move', 'sit_go_back',
  ],
  butsuma: [
    'sit_dont_move', 'sit_turn', 'sit_dont_turn', 'sit_dont_look_away',
    'sit_lights_off', 'sit_stay_here', 'sit_look_behind',
  ],
  washroom: ['sit_lights_off', 'sit_dont_move', 'sit_dont_look_away', 'sit_turn', 'sit_stay_here'],
  bath: ['sit_dont_move', 'sit_turn', 'sit_dont_look_away', 'sit_stay_here', 'sit_lights_off'],
  ldk: [
    'sit_dont_move', 'sit_turn', 'sit_dont_turn', 'sit_dont_look_away',
    'sit_go_back', 'sit_stay_here', 'sit_look_behind',
  ],
};

/**
 * 最近触ったオブジェクトから候補化する状況Request（§39-43）。
 * 「さっき電話を切った」なら、振り向け・動くな、が自然に言える。
 */
export const OBJECT_SITUATION_POOLS: Record<string, string[]> = {
  phone: ['sit_turn', 'sit_dont_move', 'sit_dont_turn', 'sit_stop', 'sit_look_behind'],
  altar: ['sit_dont_move', 'sit_dont_look_away', 'sit_turn', 'sit_lights_off'],
  bath: ['sit_dont_move', 'sit_turn', 'sit_go_back', 'sit_lights_off'],
  ghost: ['sit_dont_look_away', 'sit_dont_turn', 'sit_turn', 'sit_go_back', 'sit_stay_here'],
  portraits: ['sit_dont_look_away', 'sit_dont_move', 'sit_turn', 'sit_go_back'],
  mirror: ['sit_lights_off', 'sit_dont_look_away', 'sit_dont_move', 'sit_turn'],
  fridge: ['sit_dont_move', 'sit_turn', 'sit_lights_off'],
};

/**
 * Viewer の関心が一点に向く瞬間（§52-54）。
 *
 * 普段はコメント欄が状況に口を出しているが、
 * 電話が鳴る・汚い風呂を見つける・仏壇を調べる・幽霊を見つける、
 * という瞬間だけ全員の関心がそこへ向く。
 */
export type CoreSource = 'altar' | 'bath' | 'phone' | 'ghost';
export type CoreState = 'active' | 'suspended' | 'paused' | 'expired' | 'resolved';

/**
 * 関連する部屋のまとまり（§13）。
 * 風呂と洗面所を行き来しただけで機会を失うのは、プレイヤーから見て同じ場所にいる。
 */
export const CORE_AREAS: Record<string, string[]> = {
  altar: ['butsuma'],
  bath: ['bath', 'washroom'],
  phone: ['hallway', 'entrance'],
  ghost: ['ldk'],
};

export interface CoreOpportunity {
  source: CoreSource;
  /**
   * persistent    そこに在り続けるもの。別Request中は待てる（仏壇・風呂・幽霊）
   * timeSensitive 今を逃すと機会自体が消える（鳴っている電話）
   */
  kind: 'persistent' | 'timeSensitive';
  state: CoreState;
  startedAt: number;
  /** 実時間 */
  wallTime: number;
  /**
   * **RequestDirector が実際に Offer できた累計時間。**
   * 壁時計ではなくこれで寿命を数える。
   * 別Requestを処理していただけで機会を失うのは、内部都合であって世界の都合ではない。
   */
  eligibleActiveTime: number;
  pausedTime: number;
  /** eligibleActiveTime がこれを超えたら期限切れ */
  budget: number;
  /** 0..1。残り予算 */
  strength: number;
  /** 今を逃すとどれくらい取り返しがつかないか */
  urgency: number;
  preferred: string[];
  pauseReason?: string;

  // --- Session（§3-4, §18）---
  sessionId: number;
  /** 最後に文脈が十分成立していた時刻 */
  lastRelevantAt: number;
  /** 中断が始まった時刻 */
  suspendedAt: number;
  /** 中断と再開の回数。出入りは失敗ではない */
  softLosts: number;
  resumes: number;
}

/** どの Request が Core か（§6） */
export const CORE_REQUESTS = new Set([
  'altar_beat', 'altar_again',
  'bath_sip', 'bath_sip2', 'bath_finish',
  'phone_answer', 'phone_return', 'phone_listen', 'phone_last',
  'ghost_closer', 'ghost_selfie', 'ghost_selfie_close', 'ghost_frame', 'ghost_refind',
]);

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
  /** 幽霊が画面中央にどれだけ寄っているか 0..1。端に映り込んだだけを弾く */
  ghostCenter: number;
  selfie: boolean;
  lightOn: boolean;
  /** 今カメラを向けている対象。KEEP LOOKING 系の成立判定に使う */
  focusObject: string | null;
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
  /** 直前に達成したリクエスト。連鎖の判定に使う */
  lastCompleted: string | null;
  objectRequestNeed: number;
  /**
   * Situation Request がどれだけ足りていないか 0..1（§9-11）。
   * Object と取り合いにしない。別々に持つ。
   */
  situationRequestNeed: number;
  /** 今どんな「お膳立て」が成立しているか。値は 0..1 の強さ */
  setups: Record<SituationSetup, number>;
  /** 今 Viewer の関心が向いている対象。無ければ空 */
  coreOpportunities: CoreOpportunity[];
  /** 明確な機会を何度逃したか。逃すほど次を押す（§59-62） */
  coreMisses: number;
  /** 直前に触った / 達成したオブジェクト。状況Requestはこれに紐づく */
  lastObject: string | null;
  /** その出来事からの経過秒 */
  sinceObject: number;
}

export interface Candidate {
  def: Floor1RequestDef;
  score: number;
  reasons: string[];
  /** 世界で今まさに起きていることへの反応か（電話が鳴った、仏壇を調べた等） */
  core?: boolean;
  /** なぜ候補になれたか（room / nearby_object / recent_object / setup） */
  eligibleBy: string[];
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
  /** 直前の Core 優先判定。ログとデバッグ用 */
  lastCoreSelection: { bestCore: string; bestOther: string; dominance: number; prob: number } | null = null;

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
  /**
   * なぜ候補になれるのか。空なら候補にならない（§16, §60）。
   *   room          その部屋にいるだけで意味が通る
   *   nearby_object 関連オブジェクトが近い
   *   recent_object 最近その対象に触った
   *   setup         背後の音・幽霊を見失った等の明確なお膳立て
   */
  eligibleBy(def: Floor1RequestDef, ctx: Floor1Context): string[] {
    const by: string[] = [];
    if (ROOM_SITUATION_POOLS[ctx.room]?.includes(def.id)) by.push('room');
    const related = def.relatedObjects ?? [];
    const maxD = def.maxRelatedObjectDistance ?? CONFIG.floor1.situationContext.nearbyDistance;
    for (const o of related) {
      const d = o === 'ghost' ? ctx.ghostDistance : ctx.distances[o] ?? 999;
      if (d <= maxD) {
        by.push('nearby_object');
        break;
      }
    }
    const window = def.recentObjectWindow ?? CONFIG.floor1.situationContext.recentWindow;
    if (ctx.lastObject && ctx.sinceObject <= window) {
      if (OBJECT_SITUATION_POOLS[ctx.lastObject]?.includes(def.id)) by.push('recent_object');
      else if (related.includes(ctx.lastObject)) by.push('recent_object');
    }
    for (const k of def.preferredSetups ?? []) {
      if (k !== 'object' && ctx.setups[k] > 0) {
        by.push('setup');
        break;
      }
    }
    return by;
  }

  /** 本当に意味が成立しないものだけ落とす（§17-22） */
  private hardInvalid(def: Floor1RequestDef, ctx: Floor1Context): string | null {
    // 既に暗いのに「電気を消せ」は成立しない
    if (def.id === 'sit_lights_off' && !ctx.lightOn) return 'light_already_off';
    // 見るものが無いのに「目を離すな」は成立しない
    if (def.id === 'sit_dont_look_away' && !ctx.focusObject) return 'no_target_to_watch';
    // 帰り道が無いのに「戻れ」は成立しない
    if (def.id === 'sit_go_back' && !ctx.lastObject) return 'nowhere_to_go_back';
    return null;
  }

  /** Offer 直前の再評価に使う。距離だけでなく全条件をやり直す（§49-50） */
  revalidate(def: Floor1RequestDef, ctx: Floor1Context): string | null {
    return this.eligible(def, ctx, true);
  }

  private eligible(def: Floor1RequestDef, ctx: Floor1Context, revalidating = false): string | null {
    if (def.oncePerRun && ctx.completed.has(def.id)) return 'once_per_run';
    const last = this.lastOffered.get(def.id);
    if (last !== undefined && this.elapsed - last < def.cooldown) return 'cooldown';
    if (this.offeredIds.slice(-5).includes(def.id)) return 'recent_repeat';
    // 再評価では距離を少しだけ甘くする。歩いている途中で毎回落ちてしまうため
    const slack = revalidating ? 1.25 : 1;
    void slack;

    if (def.object) {
      const isGhost = def.object === 'ghost';
      if (!isGhost && !ctx.discovered.has(def.object)) return 'not_discovered';
      if (isGhost && !ctx.discovered.has('ghost')) return 'not_discovered';
      const d = isGhost ? ctx.ghostDistance : ctx.distances[def.object];
      if (d === undefined) return 'no_distance';
      // Core Opportunity の最中は、少し離れても関心は続いている（§19, §25）。
      // 仏壇を調べて一歩下がっただけで PLAY A BEAT が消えるのは不自然。
      const core = ctx.coreOpportunities.find(
        (c) => c.state !== 'expired' && c.preferred.includes(def.id),
      );
      const reach = core && !def.noCoreReach ? CONFIG.floor1.coreOpportunity.reachMult : 1;
      if (def.maxDistance !== undefined && d > def.maxDistance * slack * reach) return 'too_far';
      if (def.minDistance !== undefined && d < def.minDistance) return 'too_close';
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
    // 「今まさに映っているもの」に対してだけ出す Request（§37-38）。
    // 画面の端にかすっているだけで出すと、提示した次の瞬間に TARGET LOST になる。
    // 進捗判定と同じ厳しさに揃える。
    if (def.requiresVisible && ctx.ghostCenter < CONFIG.floor1.frameRequestCenter) {
      return 'target_not_centered';
    }
    if (def.lastTemptation && !ctx.returning) return 'not_returning';

    // --- 状況Requestの Eligibility（§16, §69）---
    // 「今これを言ったら完全に意味不明か」だけを見る。自然さの強弱は Score が決める。
    if (!def.object) {
      const hard = this.hardInvalid(def, ctx);
      if (hard) return hard;
      if (!this.eligibleBy(def, ctx).length) return 'no_context';
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
      const cc = CONFIG.floor1.situationContext;
      // 部屋・距離・履歴は「候補になれる理由」であって、足し合わせるものではない。
      // 全部足すと状況Requestだけで Object を押しのけてしまう。一番強い理由だけ採る。
      let ctxBonus = 0;
      let ctxWhy = '-';
      const consider = (v: number, why: string) => {
        if (v > ctxBonus) {
          ctxBonus = v;
          ctxWhy = why;
        }
      };
      if (ROOM_SITUATION_POOLS[ctx.room]?.includes(def.id)) consider(cc.roomBonus, `room:${ctx.room}`);
      let nearest = 999;
      for (const o of def.relatedObjects ?? []) {
        const d = o === 'ghost' ? ctx.ghostDistance : ctx.distances[o] ?? 999;
        nearest = Math.min(nearest, d);
      }
      if (nearest < 999) {
        consider(nearest <= 3 ? cc.dist0 : nearest <= 6 ? cc.dist3 : nearest <= 10 ? cc.dist6 : 0, 'near');
      }
      if (ctx.lastObject && OBJECT_SITUATION_POOLS[ctx.lastObject]?.includes(def.id)) {
        const t = ctx.sinceObject;
        consider(t <= 5 ? cc.recent0 : t <= 12 ? cc.recent5 : t <= 20 ? cc.recent12 : 0, `after_${ctx.lastObject}`);
      }
      if (ctxBonus > 0) {
        s += ctxBonus;
        reasons.push(`${ctxWhy}+${ctxBonus}`);
      }

      // お膳立ては Gate ではなく順位を変えるもの（§3, §23-24）
      const cfg = CONFIG.floor1.setupWeight;
      let best = 0;
      let bestKey = '-';
      for (const k of def.preferredSetups ?? []) {
        const strength = k === 'object'
          ? Math.max(0, 1 - ctx.sinceObject / CONFIG.floor1.pacing.situationWindow)
          : ctx.setups[k];
        const v = strength * (cfg[k] ?? 12);
        if (v > best) {
          best = v;
          bestKey = k;
        }
      }
      if (best > 0) {
        s += best;
        reasons.push(`setup:${bestKey}+${best.toFixed(0)}`);
      }

      // 状況Requestが続きすぎないように。ただし連鎖の続きは免除する（§34）
      if (def.chainRole !== 'followup') {
        const sameCount = this.offeredIds.slice(-5).filter((id) =>
          FLOOR1_POOL.find((p) => p.id === id && !p.object),
        ).length;
        if (sameCount > 0) {
          s -= sameCount * 9;
          reasons.push(`situation_fatigue-${sameCount * 9}`);
        }
      }
      // 直前のRequestの続きなら強く押す（§35）
      if (def.chainRole === 'followup' && def.afterRequest && ctx.lastCompleted === def.afterRequest) {
        s += CONFIG.floor1.chainBonus;
        reasons.push(`chain+${CONFIG.floor1.chainBonus}`);
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

    return { def, score: s, reasons, eligibleBy: def.object ? ['object'] : this.eligibleBy(def, ctx) };
  }

  /** 候補を出す。null なら今は出さない（沈黙も正解） */
  /**
   * Object Request が出ていない状態が続くほど、Object Request を押し出す。
   * Situation Request（DON'T TURN AROUND など）に埋め尽くされるのを防ぐ（§43）。
   */
  /**
   * Need は「救済」であって支配項ではない（§4）。
   * 線形 ×26 だと Situation が常に勝ってしまうので、平方根で頭を打たせる。
   * 互いを減点することは絶対にしない（§2）。
   */
  private needBonus(def: Floor1RequestDef, ctx: Floor1Context) {
    const cfg = CONFIG.floor1.objectNeed;
    const need = def.object ? ctx.objectRequestNeed : ctx.situationRequestNeed;
    if (need <= 0) return 0;
    return cfg.needBonus * Math.sqrt(need);
  }

  /**
   * 世界で今まさに何かが起きている瞬間を Viewer が拾う（§5-6, §46）。
   * これは baseWeight を上げるのとは違い、**文脈が成立した時だけ**乗る。
   */
  private coreOpportunity(def: Floor1RequestDef, ctx: Floor1Context, reasons: string[]) {
    const cfg = CONFIG.floor1.coreOpportunity;
    const op = ctx.coreOpportunities.find(
      (c) => c.state !== 'expired' && c.preferred.includes(def.id),
    );
    if (!op) return 0;

    let s = cfg.base[op.source] * op.strength;
    reasons.push(`core:${op.source}+${s.toFixed(0)}`);
    // 今を逃すと機会自体が消えるものを優先する（§18-25）。
    // 重要度ではなく緊急度。幽霊はいつでも撮れるが、電話は鳴り止む。
    if (op.urgency > 0) {
      s += op.urgency;
      reasons.push(`urgency+${op.urgency.toFixed(0)}`);
    }

    // 近い / 見ている なら、もっと自然
    if (def.object) {
      const d = def.object === 'ghost' ? ctx.ghostDistance : ctx.distances[def.object] ?? 99;
      if (d < 8) {
        s += cfg.near;
        reasons.push(`near+${cfg.near}`);
      }
      if (ctx.focusObject === def.object) {
        s += cfg.lookingAt;
        reasons.push(`lookingAt+${cfg.lookingAt}`);
      }
    }
    // 明確な機会を何度も逃していたら押す（§59-62）
    if (ctx.coreMisses > 0) {
      const b = Math.min(cfg.missCap, ctx.coreMisses * cfg.missStep);
      s += b;
      reasons.push(`coreMiss+${b}`);
    }
    return s;
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
          c.reasons.push(`need+${nb.toFixed(0)}`);
        }
        c.score += this.coreOpportunity(d, ctx, c.reasons);
        c.core = CORE_REQUESTS.has(d.id);
        return c;
      })
      .sort((a, b) => b.score - a.score);
    this.lastCandidates = scored.slice(0, 5);
    if (!scored.length) return null;

    // 上位3〜5件から重み付き抽選。毎回同じ順にはならない。
    // 部屋だけで候補になったものも抽選に残す。順位は Score が決める
    const top = scored.slice(0, Math.min(5, scored.length)).filter((c) => c.score > 0);
    if (!top.length) return null;

    const pickFrom = (list: Candidate[]) => {
      const total = list.reduce((a, c) => a + c.score, 0);
      let r = Math.random() * total;
      for (const c of list) {
        r -= c.score;
        if (r <= 0) return c.def;
      }
      return list[0].def;
    };

    // --- Core Priority Selection（§8-13）---
    // bath_sip 84 に対して STAY HERE 26 が普通に勝つのは、数学的には正しいが
    // ゲームとして不自然。差が開いているほど Core を選ぶ確率を上げる。
    const core = top.filter((c) => c.core);
    const other = top.filter((c) => !c.core);
    if (core.length) {
      const bestCore = core[0].score;
      const bestOther = other.length ? other[0].score : 0;
      const dominance = bestCore / Math.max(bestOther, 1);
      const cfg = CONFIG.floor1.coreOpportunity;
      const prob =
        dominance >= cfg.dominance[2] ? cfg.prob[2]
        : dominance >= cfg.dominance[1] ? cfg.prob[1]
        : dominance >= cfg.dominance[0] ? cfg.prob[0]
        : 0;
      this.lastCoreSelection = {
        bestCore: `${core[0].def.id}:${bestCore.toFixed(0)}`,
        bestOther: other.length ? `${other[0].def.id}:${bestOther.toFixed(0)}` : '-',
        dominance: Math.round(dominance * 100) / 100,
        prob,
      };
      if (prob > 0 && Math.random() < prob) return pickFrom(core);
    } else {
      this.lastCoreSelection = null;
    }
    return pickFrom(top);
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
