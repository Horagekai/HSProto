import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp01, pick, randRange } from '../core/util';
import type { RequestView } from '../core/store';
import { FLOOR1_POOL,
  Floor1Director,
  Floor1Objects,
  WorldMemory,
  goalReached,
  type Floor1Context,
  type Floor1RequestDef,
  type GhostState,
  type SituationSetup,
  type CoreOpportunity,
  type CoreSource,
  CORE_AREAS,
} from './floor1';
import { FLOOR1_OBJECTS, roomAt, type Floor1Room } from '../world/floor1Level';
import { HorrorDirector, type GhostAction, type HorrorEventDef, type RunPhase } from './horrorDirector';
import { FLOOR1_HORROR } from './horrorEvents';

/** Floor1Mode が外の世界へ触るための口 */
export interface Floor1Deps {
  playerPos: () => THREE.Vector3;
  playerForward: () => { x: number; z: number };
  selfie: () => boolean;
  lightOn: () => boolean;
  /** その座標が画面に映っているか */
  isVisible: (x: number, z: number, height: number) => boolean;
  /** 画面中央度 0..1（映っていなければ0） */
  centerOf: (x: number, z: number, height: number) => number;

  addLikes: (n: number) => void;
  addEarnings: (yen: number) => void;
  spikeViewers: (f: number) => void;
  addBoost: (amount: number, duration: number) => void;
  addHaunting: (n: number) => void;
  haunting: () => number;
  addDanger: (n: number) => void;
  danger: () => number;
  earnings: () => number;

  toast: (t: string, d: number) => void;
  footage: (t: string, d: number) => void;
  hint: (t: string, d: number) => void;
  chat: (category: string, n: number) => void;
  chatLine: (text: string) => void;

  sfxBell: () => void;
  sfxPhone: (d: number) => void;
  sfxKnock: (d: number) => void;
  sfxWhisper: (d: number) => void;
  sfxDoor: (d: number) => void;
  sfxCash: () => void;
  sfxShutter: () => void;
  sfxSpike: () => void;
  sfxStep: () => void;

  flickerLamp: (x: number, z: number, d: number) => void;
  dropPortrait: () => void;
  restorePortrait: () => void;
  setFridgeOpen: (open: boolean) => void;
  setGhostSeatVisible: (v: boolean) => void;
  ghostSeatPosture: () => void;
  /** 幽霊を立たせて動かし始める */
  wakeGhost: (x: number, z: number) => void;
  ghostPos: () => THREE.Vector3;
  ghostChasing: () => boolean;

  markEvent: (kind: string) => void;
  markDecision: () => void;
  log: (event: string, detail: string) => void;
  distanceToEntrance: () => number;
}

export type RequestState =
  | 'offered'
  | 'active'
  | 'completed'
  | 'dismissed'
  | 'ignored'
  | 'failed';

/**
 * 唯一の権威ある Request 状態。
 *
 * UI / [E] のアンロック / HOLD / 制約 / 完了 / Dismiss / ログ / Debug HUD は
 * **すべてここだけを見る。** 別に bool を持たない。
 *
 * v1.3 までは公開ログが STANDARD 側の RequestDirector を見ていたため、
 * FLOOR 1 で request_offered が出ているのに request_active=0 になっていた。
 */
export interface ActiveRequest {
  def: Floor1RequestDef;
  state: RequestState;
  timeLeft: number;
  progress: number;
  engaged: boolean;
  /** HOLD の累計時間と、到達済みの段 */
  hold: number;
  tier: number;
  earned: number;
  /** constraint の保持時間 */
  held: number;
  offeredAt: number;
  /** 提示された瞬間の部屋と入口までの距離（STAY HERE / GO BACK の基準） */
  startRoom: string;
  startEntranceDistance: number;
  activatedAt?: number;
  /**
   * [E] の特殊アクションが解放されているか。
   * リクエストの対象を見ていて、距離条件を満たしているときだけ true。
   */
  actionUnlocked: boolean;
  /** UI に出たことをログしたか */
  uiShown: boolean;
  /** アンロックをログしたか */
  unlockLogged: boolean;
  /** 進捗が止まったことをログしたか */
  pausedLogged: boolean;
  /** 25%刻みでログした段 */
  loggedStep: number;
}

const SOFA = { x: -9.3, z: -8 };

/**
 * 仏間へ気づかせるコメント。指示ではなく雑談として書く。
 * 「行け」と言わせない。
 */
const BUTSUMA_HINTS = [
  "what's that room on the left",
  'left door looks busted',
  'why is that one broken',
  'tatami room?',
  'something off about that doorway',
  'the left one is open',
];

/** 「振り向く / 振り向くな」系 */
const TURN_FAMILY = new Set([
  'sit_turn', 'sit_dont_turn', 'sit_now_turn', 'sit_look_behind', 'sit_turn_last',
]);

/** Request が解放されているときだけ出る [E] の動詞 */
const ACTION_VERB: Record<string, string> = {
  bath_sip: 'DRINK',
  bath_sip2: 'DRINK AGAIN',
  bath_finish: 'FINISH IT',
  phone_answer: 'PICK IT UP',
  fridge_open: 'OPEN IT',
  portrait_pick: 'PICK IT UP',
  portrait_back: 'HANG IT BACK',
};

/**
 * Inspect したときに出る説明。何も起こさない。
 * ここで「飲める」と誤解させないよう、行動を促す文にはしない。
 */
const INSPECT_TEXT: Record<string, Record<string, string>> = {
  altar: { default: 'A HOUSEHOLD ALTAR. THE BELL IS STILL HERE.' },
  portraits: {
    normal: 'THREE PORTRAITS. NOBODY IS SMILING.',
    fallen: 'ONE OF THEM IS ON THE FLOOR.',
    held: "YOU'RE HOLDING IT.",
    restored: 'BACK ON THE WALL. NOT QUITE STRAIGHT.',
    wrong: 'THAT IS NOT THE SAME FACE.',
    default: 'THREE PORTRAITS.',
  },
  phone: {
    ringing: 'IT IS RINGING.',
    answered: 'THE LINE IS STILL OPEN.',
    default: 'AN OLD CORDED PHONE.',
  },
  bath: { default: 'THE WATER HAS NOT BEEN CHANGED IN A LONG TIME.' },
  fridge: {
    open: 'IT IS OPEN. YOU CAN SMELL IT.',
    default: 'THE FRIDGE IS STILL HUMMING.',
  },
  mirror: {
    anomaly: 'SOMETHING IS WRONG WITH THE REFLECTION.',
    default: 'YOU LOOK TIRED.',
  },
  oshiire: { default: 'A CLOSET. PACKED WITH BEDDING.' },
  washer: { default: 'THE DRUM IS FULL OF WATER.' },
  photo: { default: 'A FAMILY PHOTO. FOUR PEOPLE.' },
  tv: { on: 'IT IS ON.', default: 'A DEAD CRT.' },
  sofa: { default: 'THE CUSHION IS STILL PRESSED DOWN.' },
};

/** 各オブジェクトの発見コメント */
const DISCOVERY_CHAT: Record<string, string[]> = {
  altar: ["that's surprisingly clean", 'everything else is filthy', 'someone took care of this'],
  portraits: ['three of them', 'who are they', 'the middle one'],
  phone: ['does that still work', 'call someone lol', 'old school'],
  bath: ['ew', 'what is that', "don't drink it", 'drink it', "he won't do it"],
  fridge: ['CLOSE IT', 'free protein', 'oh god', 'look closer'],
  mirror: ['check the mirror', 'anything behind you?'],
  photo: ['thats the family', 'they look happy'],
  ghost: ['is that a person', "that's not normal", 'get closer', 'selfie with it', 'leave'],
};

/**
 * 環境イベントのヒント。断定しない。
 * 「幽霊がいる」ではなく「今なんか鳴った？」で止めるのが目的（§15）。
 */
const AMBIENT_HINTS: Record<string, string> = {
  HousePop: 'THE HOUSE POPPED',
  FloorCreakDistant: 'A FLOOR CREAKED SOMEWHERE',
  PipeKnock: 'THE PIPES KNOCKED',
  DistantWaterDrop: 'A DROP OF WATER',
  FridgeHumStop: 'THE HUM STOPPED',
  TVStaticTick: 'THE TV TICKED',
  PhoneClick: 'THE PHONE CLICKED',
  LightCordSway: 'THE CORD IS SWAYING',
  ObjectTinyShift: 'DID THAT MOVE?',
  FabricRustle: 'FABRIC, SHIFTING',
};

export class Floor1Mode {
  objects = new Floor1Objects();
  director = new Floor1Director();
  memory = new WorldMemory();
  /** 世界側の恐怖と「間」を決める。Request とは別物 */
  horror = new HorrorDirector(FLOOR1_HORROR);

  active: ActiveRequest | null = null;
  /** 提示待ち。近くにいるだけでは出さず、間を置く */
  private pendingDef: Floor1RequestDef | null = null;
  private pendingDelay = 0;
  /** 候補が生まれてからの経過。長く Pending させない */
  private pendingAge = 0;
  /** 出来事に譲った合計秒数 */
  private pendingDeferred = 0;
  /** 次に候補を探すまでの静寂 */
  private quiet = 0;
  private elapsed = 0;
  private sinceEvent = 0;

  ghost: GhostState = 'seated';
  private ghostStandTimer = 0;
  private ghostRelocateCd = 0;

  goal = false;
  private lastTemptationDone = false;
  private returningTime = 0;
  private pressureLogged = 0;
  private pendingLogged = 0;
  private pendingFailLogged = 0;
  private lastEntranceDistance = 999;

  // --- KPI ---
  discoveries = 0;
  offered = 0;
  completed = 0;
  dismissed = 0;
  ignored = 0;
  holdDurations: Array<{ id: string; seconds: number; tier: number }> = [];
  uniqueRequests = new Set<string>();
  repeatedRequests = 0;
  bathSips = 0;
  ghostSelfies = 0;
  voluntaryContinuations = 0;
  /** Object Request と Situation Request の内訳 */
  objectRequestsOffered = 0;
  situationRequestsOffered = 0;
  private lastObjectRequestAt = 0;
  /** 直前に達成したリクエスト。連鎖の判定に使う */
  private lastCompleted: string | null = null;
  private interrupted = new Set<string>();
  /** 今 Viewer の関心が向いている対象 */
  private cores: CoreOpportunity[] = [];
  /** 電話が鳴り止むまでの残り秒数 */
  private phoneRingLeft = 0;
  /** 仏間へ気づかせるコメント。気づいたら止める */
  private butsumaSeen = false;
  private guideTimer = 8;
  private guideShown = 0;
  coreMissReasons: Record<string, number> = {};
  private sessionSeq = 0;
  private reopenBlock: Record<string, number> = {};
  /** Session の統計。出入りは失敗ではない（§21-24） */
  sessionStats = { started: 0, softLost: 0, resumed: 0, hardLost: 0, resolved: 0 };
  /** 明確な機会を逃した回数 */
  coreMisses = 0;
  /** Core が Filler を蹴った直後、短時間 Core を優先する（§41-43） */
  private coreReservation: { source: string; until: number } | null = null;
  opportunityCounts = { altar: 0, bath: 0, phone: 0, ghost: 0 };
  /** どの部屋に入ったか。Director の成績とは分けて見る */
  roomVisits: Record<string, number> = {};
  /** Offer 直前の再評価で捨てた候補の数 */
  cancelled = 0;
  /**
   * Request ファネル（§72-77）。
   * Weight を触る前に、どこで候補が消えているのかを見られるようにする。
   */
  funnel = {
    checked: 0,
    eligible: 0,
    scored: { object: 0, situation: 0 },
    positive: { object: 0, situation: 0 },
    warmup: { object: 0, situation: 0 },
    cancelled: { object: 0, situation: 0 },
    offered: { object: 0, situation: 0 },
    rejections: new Map<string, number>(),
    eligibleBy: new Map<string, number>(),
    candidateCounts: [] as number[],
  };
  /** Core Opportunity の計測（§79） */
  opportunities = {
    phoneRinging: 0,
    phonePickupOffered: 0,
    altarInspected: 0,
    altarBeatOffered: 0,
    bathDiscovered: 0,
    bathOffered: 0,
    ghostDiscovered: 0,
    ghostOffered: 0,
    behindSetups: 0,
    turnFamilyOffered: 0,
    ghostLostSetups: 0,
  };
  /** 提示時刻。間隔の統計に使う */
  offerTimes: number[] = [];
  private lastSituationRequestAt = 0;
  /** 移動している / 立ち止まっている時間 */
  private movingTime = 0;
  private stillTime = 0;
  /** 背後で何かが起きた時刻 */
  private behindAt = -999;
  private phoneEventAt = -999;
  private horrorAt = -999;
  /** 最後に幽霊が見えていた時刻 */
  private ghostSeenAt = -999;
  /** 部屋が変わった時刻 */
  private lastRoom: Floor1Room | null = null;
  /** 部屋が変わってからの経過。移動中の判定に使う */
  private roomChangedAt = -999;
  /** 今この瞬間、進捗が進んでいるか（HOLD 中 / 制約を満たしている） */
  private progressing = false;
  /** target_constraint の対象を今ちゃんと捉えているか */
  private targetLocked = false;
  private targetTooFar = false;
  private targetEverLocked = false;
  get sinceRoomChange() {
    return this.elapsed - this.roomChangedAt;
  }
  /** Request 無しで特殊アクションが起きた回数。0 でなければバグ */
  invalidSpecialActions = 0;
  private invalidLogged = new Set<string>();
  /** 触れる対象を Inspect した数（ObjectRequestNeed の入力） */
  inspectedObjects = new Set<string>();
  requestUiShown = 0;
  private offeredHistory: string[] = [];

  constructor(private d: Floor1Deps) {}

  reset() {
    this.objects.reset();
    this.director.reset();
    this.memory.reset();
    this.horror.reset();
    this.memory.onCreated = (m) =>
      this.d.log('world_memory_created', `memory=${m} haunted=${this.d.haunting().toFixed(0)}`);
    this.active = null;
    this.pendingDef = null;
    this.pendingDelay = 0;
    this.pendingAge = 0;
    this.pendingDeferred = 0;
    this.quiet = randRange(4, 8);
    this.elapsed = 0;
    this.sinceEvent = 0;
    this.ghost = 'seated';
    this.ghostStandTimer = 0;
    this.ghostRelocateCd = 0;
    this.goal = false;
    this.lastTemptationDone = false;
    this.returningTime = 0;
    this.pressureLogged = 0;
    this.pendingLogged = 0;
    this.pendingFailLogged = 0;
    this.lastEntranceDistance = 999;
    this.lastObject = null;
    this.sinceObject = 999;
    this.lastRiskTier = 0;
    this.finalTaken = false;
    this.completedIds.clear();
    this.discoveries = 0;
    this.offered = 0;
    this.completed = 0;
    this.dismissed = 0;
    this.ignored = 0;
    this.holdDurations = [];
    this.uniqueRequests.clear();
    this.repeatedRequests = 0;
    this.bathSips = 0;
    this.ghostSelfies = 0;
    this.voluntaryContinuations = 0;
    this.objectRequestsOffered = 0;
    this.situationRequestsOffered = 0;
    this.lastObjectRequestAt = 0;
    this.lastCompleted = null;
    this.interrupted.clear();
    this.cores = [];
    this.phoneRingLeft = 0;
    this.butsumaSeen = false;
    this.guideTimer = 8;
    this.guideShown = 0;
    this.coreMissReasons = {};
    this.sessionSeq = 0;
    this.reopenBlock = {};
    this.sessionStats = { started: 0, softLost: 0, resumed: 0, hardLost: 0, resolved: 0 };
    this.coreMisses = 0;
    this.coreReservation = null;
    this.opportunityCounts = { altar: 0, bath: 0, phone: 0, ghost: 0 };
    this.roomVisits = {};
    this.cancelled = 0;
    this.funnel = {
      checked: 0,
      eligible: 0,
      scored: { object: 0, situation: 0 },
      positive: { object: 0, situation: 0 },
      warmup: { object: 0, situation: 0 },
      cancelled: { object: 0, situation: 0 },
      offered: { object: 0, situation: 0 },
      rejections: new Map<string, number>(),
      eligibleBy: new Map<string, number>(),
      candidateCounts: [] as number[],
    };
    this.opportunities = {
      phoneRinging: 0,
      phonePickupOffered: 0,
      altarInspected: 0,
      altarBeatOffered: 0,
      bathDiscovered: 0,
      bathOffered: 0,
      ghostDiscovered: 0,
      ghostOffered: 0,
      behindSetups: 0,
      turnFamilyOffered: 0,
      ghostLostSetups: 0,
    };
    this.offerTimes = [];
    this.lastSituationRequestAt = 0;
    this.movingTime = 0;
    this.stillTime = 0;
    this.behindAt = -999;
    this.phoneEventAt = -999;
    this.horrorAt = -999;
    this.ghostSeenAt = -999;
    this.lastRoom = null;
    this.roomChangedAt = -999;
    this.invalidSpecialActions = 0;
    this.invalidLogged.clear();
    this.inspectedObjects.clear();
    this.requestUiShown = 0;
    this.offeredHistory = [];
    this.d.setGhostSeatVisible(true);
  }

  // ---------------------------------------------------------------- //

  room(): Floor1Room {
    const p = this.d.playerPos();
    return roomAt(p.x, p.z);
  }

  private objDistance(id: string) {
    const p = this.d.playerPos();
    if (id === 'ghost') {
      const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
      return Math.hypot(g.x - p.x, g.z - p.z);
    }
    const spec = FLOOR1_OBJECTS.find((o) => o.id === id);
    if (!spec) return 999;
    return Math.hypot(spec.x - p.x, spec.z - p.z);
  }

  private distances(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const o of FLOOR1_OBJECTS) out[o.id] = this.objDistance(o.id);
    out.ghost = this.objDistance('ghost');
    return out;
  }

  /** 一番近い、触れるオブジェクト */
  nearestInteractable(): string | null {
    let best: string | null = null;
    let bestD = CONFIG.floor1.interactRange;
    for (const o of FLOOR1_OBJECTS) {
      const d = this.objDistance(o.id);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  /** [E] の表示。遠くからは何も出さない（近づいて初めて出る） */
  prompt(): string | null {
    const a = this.active;
    // Request のアクションが解放されているときだけ、専用のプロンプトを出す。
    // それ以外で [E] にできるのは「見る」だけ（§17, §23, §26）。
    if (a && a.actionUnlocked) {
      if (a.def.type === 'hold') return `[HOLD E] ${a.def.label}`;
      if (a.def.type === 'action') return `[E] ${ACTION_VERB[a.def.id] ?? a.def.label}`;
    }
    const id = this.nearestInteractable();
    if (!id) return null;
    return '[E] EXAMINE';
  }

  private holdTargetReady() {
    const a = this.active;
    if (!a || a.def.type !== 'hold' || !a.def.object) return false;
    return this.objDistance(a.def.object) <= (a.def.maxDistance ?? 3);
  }

  // ---------------------------------------------------------------- //
  // Discovery
  // ---------------------------------------------------------------- //

  private updateDiscovery(dt: number) {
    const cfg = CONFIG.floor1;
    for (const spec of FLOOR1_OBJECTS) {
      const st = this.objects.get(spec.id);
      if (!st) continue;
      const d = this.objDistance(spec.id);
      const center = this.d.centerOf(spec.x, spec.z, spec.height);
      if (center > 0.2 && d < 18) st.attention += dt;
      // 一度離れて戻ってきたか
      if (d > 12) st.wasAway = true;
      else if (d < 5 && st.wasAway && st.discovered) {
        st.wasAway = false;
        st.reengaged = true;
      }
      if (st.discovered || !spec.notable) {
        if (!spec.notable && !st.discovered && d < cfg.discoverDistance) st.discovered = true;
        continue;
      }
      if (d < cfg.discoverDistance && center > 0.15 && st.attention >= cfg.discoverLook) {
        this.discover(spec.id, spec.label, spec.discoveryLikes);
      }
    }

    // 幽霊は遠くからでも見つかる
    const g = this.objects.get('ghost');
    if (g && !g.discovered) {
      const pos = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
      const center = this.d.centerOf(pos.x, pos.z, 1.3);
      const d = this.objDistance('ghost');
      if (center > 0.15 && d < cfg.ghostDiscoverDistance) {
        g.attention += dt;
        if (g.attention >= cfg.ghostDiscoverLook) {
          this.discover('ghost', 'SOMEONE ON THE SOFA', 150);
        }
      }
    }
  }

  private discover(id: string, label: string, likes: number) {
    // 視聴者は配信を見ている。プレイヤーが [E] を押さなくても、見つけた時点で口は出せる。
    // ここが対象ごとにバラバラだったせいで、仏壇だけ機会が開かない Run があった。
    if (id === 'bath') {
      this.opportunities.bathDiscovered += 1;
      this.openCore('bath', ['bath_sip', 'bath_sip2']);
    }
    if (id === 'altar') {
      this.openCore('altar', ['altar_beat', 'altar_again']);
    }
    if (id === 'ghost') {
      this.opportunities.ghostDiscovered += 1;
      this.openCore('ghost', ['ghost_closer', 'ghost_selfie', 'ghost_frame']);
    }
    // 発見トーストと視聴者の反応を見せる間を作る（§69-70）
    this.quiet = Math.max(this.quiet, CONFIG.floor1.pacing.afterDiscovery);
    const st = this.objects.get(id);
    if (!st || st.discovered) return;
    st.discovered = true;
    this.discoveries += 1;
    this.touchedObject(id);
    const amount = Math.round(likes * CONFIG.floor1.discoveryLikesMult);
    if (amount > 0) {
      this.d.addLikes(amount);
      this.d.spikeViewers(1.08);
      this.d.sfxSpike();
      this.d.footage(`FOUND: ${label}   +${amount} Likes`, 2.0);
    }
    this.d.addHaunting(1);
    this.d.addBoost(0.5, 8);
    const lines = DISCOVERY_CHAT[id];
    if (lines) {
      this.d.chatLine(pick(lines));
      if (Math.random() < 0.5) this.d.chatLine(pick(lines));
    }
    this.markEvent('discovery');
    this.d.log('discovery_found', `object=${id} likes=${amount}`);
  }

  // ---------------------------------------------------------------- //
  // Interaction
  // ---------------------------------------------------------------- //

  /** [E] の単押し */
  /**
   * [E] のルーター（§12-14, §29）。
   *
   *   1. 今の Request の特殊アクションが解放されていれば、それを実行
   *   2. そうでなければ Inspect のみ（無害）
   *   3. Request が無いのに危険な行動へ落ちない。HEY へも落とさない
   *
   * v1.3 までは [E] が直接 drinkBath() などを呼んでいて、
   * 初回の一口が Viewer Request を完全にバイパスしていた。
   */
  interact() {
    const id = this.nearestInteractable();
    if (!id) return false;

    const a = this.active;
    const isRequestTarget = !!a && a.def.object === id && a.actionUnlocked;
    this.d.log(
      'hey_input_context',
      `focusedObject=${id} activeRequest=${a?.def.id ?? '-'} requestActionAvailable=${isRequestTarget}`,
    );

    if (isRequestTarget) return this.performRequestAction(id, a!);

    // 特殊アクションを持つ対象は、Request が無ければ何も起こさない。
    // ここで「見るだけ」に落とすのが今回の中心。
    return this.inspectObject(id);
  }

  /**
   * 無害な調査（§13）。
   * 発見・説明・見た目の状態・視聴者の反応・Request の資格だけ。
   * 飲む / 鳴らす / 受話器を取る / セルフィーは絶対にしない。
   */
  private inspectObject(id: string) {
    const st = this.objects.get(id);
    if (!st) return false;
    const first = !this.inspectedObjects.has(id);
    this.inspectedObjects.add(id);
    // §13。Inspect は discovery を成立させる。
    // ここが繋がっていないと「調べたのに Request の資格が立たない」になる。
    if (!st.discovered) {
      const spec = FLOOR1_OBJECTS.find((o) => o.id === id);
      if (spec) this.discover(spec.id, spec.label, spec.discoveryLikes);
      else st.discovered = true;
    }
    st.interactions += 1;
    this.touchedObject(id);
    this.d.log(
      'object_inspected',
      `object=${id} state=${st.state} count=${st.interactions} first=${first}`,
    );

    // 調べた瞬間に Viewer の関心がそこへ向く（§9, §19, §24）
    if (id === 'altar') {
      this.opportunities.altarInspected += 1;
      if (!this.completedIds.has('altar_beat')) this.openCore('altar', ['altar_beat', 'altar_again']);
    }
    if (id === 'bath' && this.bathSips === 0) this.openCore('bath', ['bath_sip', 'bath_sip2']);
    this.d.toast(INSPECT_TEXT[id]?.[st.state] ?? INSPECT_TEXT[id]?.default ?? 'NOTHING HERE', 1.6);
    // 視聴者が煽る。ただしこれは Request ではない（§47）
    if (first) {
      const lines = DISCOVERY_CHAT[id];
      if (lines) this.d.chatLine(pick(lines));
    } else if (Math.random() < 0.35) {
      const lines = DISCOVERY_CHAT[id];
      if (lines) this.d.chatLine(pick(lines));
    }
    return true;
  }

  /**
   * Request がある時だけ実行できる特殊アクション（§14, §84）。
   * bath_sip / altar_hold / phone_listen / ghost selfie は
   * ActiveRequest 無しでは絶対に発生しない。
   */
  private performRequestAction(id: string, a: ActiveRequest) {
    if (a.state === 'offered') {
      a.state = 'active';
      a.activatedAt = this.elapsed;
    }
    this.d.log('request_action_started', `id=${a.def.id} object=${id}`);

    switch (id) {
      case 'altar':
        this.d.sfxBell();
        this.d.toast('...', 1.2);
        return true;
      case 'portraits':
        return this.interactPortrait(this.objects.get('portraits')!.state);
      case 'phone':
        return this.interactPhone(this.objects.get('phone')!.state);
      case 'bath':
        return this.drinkBath();
      case 'fridge':
        return this.openFridge();
      default:
        return this.inspectObject(id);
    }
  }

  private interactPortrait(state: string) {
    if (state === 'normal') {
      // 落下は Player の行動ではなく World Horror Event（§54）。ここでは何も起こさない
      this.d.toast('...', 1.2);
      return true;
    }
    if (state === 'fallen') {
      this.objects.setState('portraits', 'held');
      this.d.toast('YOU PICKED IT UP', 1.6);
      this.d.addHaunting(3);
      return true;
    }
    if (state === 'held') {
      this.objects.setState('portraits', 'restored');
      this.d.restorePortrait();
      this.d.toast('YOU HUNG IT BACK', 1.8);
      this.d.addHaunting(5);
      this.memory.remember('portrait_restored');
      this.d.log('subject_state_changed', 'subject=portraits old=held new=restored');
      return true;
    }
    return true;
  }

  private interactPhone(state: string) {
    if (state === 'ringing') {
      this.objects.setState('phone', 'answered');
      this.d.sfxWhisper(1);
      this.d.toast('...', 1.6);
      this.d.chat('anomaly', 2);
      this.d.addHaunting(4);
      this.d.log('subject_state_changed', 'subject=phone old=ringing new=answered');
      return true;
    }
    this.d.toast('NO DIAL TONE', 1.2);
    return true;
  }

  /**
   * §84。ActiveRequest 無しでは絶対に起きてはいけない特殊アクション。
   * 破られたら握りつぶさず記録する。テストはここを見る。
   */
  private requireRequestFor(object: string, what: string) {
    const a = this.active;
    const ok = !!a && a.def.object === object && a.actionUnlocked;
    if (!ok) {
      this.invalidSpecialActions += 1;
      // 毎フレーム同じ行を吐くと、本当の違反が埋もれる
      const key = `${what}:${a?.def.id ?? '-'}`;
      if (this.invalidLogged.has(key)) return false;
      this.invalidLogged.add(key);
      this.d.log(
        'invalid_special_action',
        `action=${what} object=${object} activeRequest=${a?.def.id ?? '-'} unlocked=${a?.actionUnlocked ?? false}`,
      );
    }
    return ok;
  }

  private drinkBath() {
    if (!this.requireRequestFor('bath', 'bath_sip')) return false;
    this.bathSips += 1;
    this.d.sfxWhisper(1);
    this.d.toast('YOU DRANK IT', 1.8);
    this.d.chat('anomaly', 3);
    this.d.addLikes(60);
    this.d.spikeViewers(1.14);
    this.d.addHaunting(this.bathSips >= 2 ? 7 : 4);
    this.d.addDanger(this.bathSips >= 2 ? 6 : 3);
    this.memory.remember(`bath_sip_${this.bathSips}`);
    if (this.bathSips >= 2) {
      this.memory.remember('bath_overdone');
      this.horror.addIntent('bath_sip_2');
    }
    this.d.log('bath_sip', `count=${this.bathSips}`);
    // 咳き込む
    window.setTimeout(() => this.d.hint('YOU COUGH', 1.6), 900);
    return true;
  }

  private openFridge() {
    const st = this.objects.get('fridge');
    if (!st) return false;
    if (st.state === 'normal') {
      this.objects.setState('fridge', 'bugs');
      this.d.setFridgeOpen(true);
      this.d.addLikes(120);
      this.d.spikeViewers(1.2);
      this.d.sfxSpike();
      this.d.footage('BUGS EVERYWHERE   +120 Likes', 2.6);
      this.d.chat('anomaly', 3);
      this.d.addHaunting(3);
      this.markEvent('discovery');
      this.d.log('subject_state_changed', 'subject=fridge old=normal new=bugs');
      return true;
    }
    this.d.setFridgeOpen(false);
    this.objects.setState('fridge', 'closed');
    this.d.toast('YOU CLOSED IT', 1.2);
    return true;
  }

  // ---------------------------------------------------------------- //
  // HOLD
  // ---------------------------------------------------------------- //

  /**
   * [E] を押している間だけ続く行為。
   * いつでも指を離せる。離した時点で終了し、すでに得た段の報酬は保持する。
   */
  /**
   * [E] の特殊アクションを解放するかどうか（§17, §50）。
   * 対象に近づいて初めて解放する。UI から見て「今なら押せる」が分かるようにする。
   */
  private updateActionUnlock() {
    const a = this.active;
    if (!a) return;
    if (a.state !== 'offered' && a.state !== 'active') {
      a.actionUnlocked = false;
      return;
    }
    if (!a.def.object) {
      // 状況リクエストは対象を持たない。[E] のアクションも無い
      a.actionUnlocked = false;
      return;
    }
    // 距離のルールは1つだけ。nearestInteractable() は interactRange 固定なので、
    // maxDistance がそれより大きい Request と食い違う。
    const range = a.def.maxDistance ?? CONFIG.floor1.interactRange;
    const unlocked = this.objDistance(a.def.object) <= range;
    if (unlocked && !a.unlockLogged) {
      a.unlockLogged = true;
      this.d.log('request_action_unlocked', `id=${a.def.id} object=${a.def.object}`);
    }
    a.actionUnlocked = unlocked;
  }

  private updateHold(dt: number, holding: boolean) {
    const a = this.active;
    if (!a || a.def.type !== 'hold' || !a.def.holdTiers) return;
    if (!holding && a.hold > 0 && !a.pausedLogged) {
      a.pausedLogged = true;
      this.logProgress(a, 'request_progress_paused');
      this.progressing = false;
    }
    if (holding) a.pausedLogged = false;
    const ready = this.holdTargetReady();
    if (holding && ready) {
      if (a.hold === 0) {
        if (a.def.object && !this.requireRequestFor(a.def.object, `${a.def.object}_hold`)) return;
        this.d.log('hold_started', `object=${a.def.object} request=${a.def.id}`);
        this.startHoldEffect(a.def);
      }
      if (a.hold === 0) this.logProgress(a, 'request_progress_started');
      a.hold += dt;
      a.engaged = true;
      this.progressing = true;
      this.holdEffect(a.def, a.hold, dt);
      // 段に到達したら即確定
      while (a.tier < a.def.holdTiers.length && a.hold >= a.def.holdTiers[a.tier].at) {
        const t = a.def.holdTiers[a.tier];
        a.tier += 1;
        a.earned += t.reward;
        this.d.addEarnings(t.reward);
        this.d.sfxCash();
        this.d.spikeViewers(CONFIG.floor1.hold.viewerSpike);
        this.d.addBoost(0.8, 8);
        this.d.addHaunting(2 + a.tier * 2);
        this.d.addDanger(1 + a.tier * 2);
        this.d.toast(`+¥${t.reward.toLocaleString()}`, 1.6);
        this.d.chat('provoke', 2);
        if (a.tier >= 2) this.voluntaryContinuations += 1;
        this.horror.markGreed(Math.min(5, a.tier + 1));
        this.d.log('hold_tier_reached', `request=${a.def.id} tier=${a.tier} duration=${a.hold.toFixed(1)} reward=${t.reward}`);
        this.holdTierEffect(a.def, a.tier);
      }
      a.progress = clamp01(a.hold / CONFIG.floor1.hold.maxSeconds);
      if (a.hold >= CONFIG.floor1.hold.maxSeconds) this.releaseHold('max');
      return;
    }
    if (a.hold > 0) this.releaseHold('released');
  }

  private releaseHold(reason: string) {
    const a = this.active;
    if (!a || a.def.type !== 'hold') return;
    this.holdDurations.push({ id: a.def.id, seconds: Math.round(a.hold * 10) / 10, tier: a.tier });
    this.d.log('hold_released', `request=${a.def.id} total_duration=${a.hold.toFixed(1)} highest_tier=${a.tier} reason=${reason}`);
    if (a.def.object === 'altar' && a.hold >= 5) {
      this.memory.remember('altar_overplayed');
      this.horror.addIntent('altar_overplayed');
    }
    if (a.def.object === 'phone' && a.hold >= 5) {
      this.memory.remember('phone_listened_long');
      this.horror.addIntent('phone_listened_long');
    }
    if (a.def.object === 'fridge' && a.hold >= 5) this.memory.remember('fridge_held_long');
    if (a.def.object === 'phone') {
      this.objects.setState('phone', 'idle');
      this.d.log('subject_state_changed', 'subject=phone old=answered new=idle');
    }
    if (a.def.object === 'fridge') this.d.setFridgeOpen(false);
    if (a.tier > 0) this.finish(a, a.earned);
    else this.endRequest('ignored');
  }

  private startHoldEffect(def: Floor1RequestDef) {
    if (def.object === 'altar') this.d.sfxBell();
    if (def.object === 'phone') this.d.sfxWhisper(1);
  }

  private holdBeat = 0;
  private holdEffect(def: Floor1RequestDef, hold: number, dt: number) {
    this.holdBeat -= dt;
    if (this.holdBeat > 0) return;
    if (def.object === 'altar') {
      this.holdBeat = 0.85;
      this.d.sfxBell();
    } else if (def.object === 'phone') {
      this.holdBeat = 2.4;
      // 聞き続けるほど、音が近づいてくる
      if (hold < 5) this.d.sfxKnock(14);
      else if (hold < 9) this.d.sfxWhisper(6);
      else this.d.sfxWhisper(1);
    } else {
      this.holdBeat = 1.6;
      this.d.sfxKnock(8);
    }
  }

  /** 段を超えたときの世界側の反応。毎回追跡にはしない */
  private holdTierEffect(def: Floor1RequestDef, tier: number) {
    const p = this.d.playerPos();
    if (tier === 2) {
      this.d.flickerLamp(p.x, p.z, 1.6);
      this.d.hint('THE LIGHT MOVED', 2);
    } else if (tier === 3) {
      if (def.object === 'phone') {
        this.d.hint('THAT SOUNDS LIKE YOU', 2.4);
      } else {
        this.d.sfxDoor(12);
        this.d.hint('A DOOR, SOMEWHERE', 2.2);
      }
      this.maybeGhostStir();
    } else if (tier >= 4) {
      this.d.sfxStep();
      this.d.hint('SOMETHING IS BEHIND YOU', 2.6);
      this.d.addDanger(8);
    }
  }

  /** 幽霊を少しだけ動かす。画面内では動かさない */
  private maybeGhostStir() {
    if (this.ghost === 'seated') {
      this.d.addDanger(6);
      return;
    }
    if (this.ghostRelocateCd > 0) return;
    const pos = this.d.ghostPos();
    if (this.d.isVisible(pos.x, pos.z, 1.5)) return;
    this.ghostRelocateCd = CONFIG.floor1.ghost.relocateCooldown;
    const p = this.d.playerPos();
    const f = this.d.playerForward();
    this.d.wakeGhost(p.x - f.x * 7, p.z - f.z * 7);
  }

  // ---------------------------------------------------------------- //
  // Ghost
  // ---------------------------------------------------------------- //

  private updateGhost(dt: number) {
    this.ghostRelocateCd = Math.max(0, this.ghostRelocateCd - dt);
    const g = CONFIG.floor1.ghost;
    // 家をどれだけ荒らしたかも段階に効かせる（Danger だけでは一生座ったままだった）
    const danger = Math.max(this.d.danger(), this.d.haunting() * CONFIG.floor1.hauntedWeight);
    const prev = this.ghost;
    let next: GhostState = this.ghost;
    if (this.d.ghostChasing() || danger >= g.chasing) next = 'chasing';
    else if (danger >= g.stalking) next = 'stalking';
    else if (danger >= g.standing) next = 'standing';
    else if (danger >= g.aware) next = 'aware';
    else if (this.ghost !== 'seated') next = 'aware';

    if (next !== prev) {
      if (next === 'chasing') this.horror.markChase(true);
      else if (prev === 'chasing') this.horror.markChase(false);
      this.ghost = next;
      this.objects.setState('ghost', next);
      this.d.log('subject_state_changed', `subject=ghost old=${prev} new=${next}`);
      if (next === 'standing' && prev !== 'standing') {
        this.ghostStandTimer = g.standDelay;
      }
      if (next === 'aware' && prev === 'seated') {
        this.d.hint('IT MOVED ITS HEAD', 2);
        this.d.chat('discovered', 2);
      }
    }

    // ソファから立ち上がる
    if (this.ghostStandTimer > 0) {
      this.ghostStandTimer -= dt;
      if (this.ghostStandTimer <= 0) {
        this.d.setGhostSeatVisible(false);
        this.d.wakeGhost(SOFA.x, SOFA.z);
        this.d.hint('IT STOOD UP', 2.4);
        this.d.chat('danger', 3);
        this.markEvent('monster_appear');
        this.memory.remember('ghost_stood');
      }
    }
  }

  // ---------------------------------------------------------------- //
  // World memory の遅れた結果
  // ---------------------------------------------------------------- //

  /**
   * 低 Haunted 用の環境イベント（§13-21）。
   * 狙いは「幽霊がいる！」ではなく「今なんか鳴った？」。確信は持たせない。
   *
   * 同じ HousePop でも毎回同じに聞こえないよう、音源方向・距離・遅延・variant を振る。
   * 全部を背後から出すとすぐ読まれるので、方向は定義側の sources から選ぶ。
   */
  private runAmbient(def: HorrorEventDef) {
    const sources = def.sources ?? ['distant_room', 'side'];
    const src = sources[Math.floor(Math.random() * sources.length)];
    // 音源の遠さ。same_room ほど近く、distant_room ほど遠い
    const base =
      src === 'same_room' ? 4 :
      src === 'ahead' || src === 'side' ? 10 :
      src === 'behind' ? 7 : 18;
    const dist = base * (0.75 + Math.random() * 0.6);
    const variant = def.variants ? Math.floor(Math.random() * def.variants) : 0;
    // 演出上の部屋。定義に相手オブジェクトがあればその部屋、なければ今いない部屋へ
    const targetRoom = def.relatedObject
      ? (FLOOR1_OBJECTS.find((o) => o.id === def.relatedObject)?.room ?? this.room())
      : src === 'same_room'
        ? this.room()
        : this.elsewhere();

    switch (def.family) {
      case 'AMBIENT_HOUSE':
        this.d.sfxKnock(dist + variant * 3);
        break;
      case 'AMBIENT_WATER':
        if (def.id === 'DistantWaterDrop') this.d.sfxKnock(dist + 6 + variant * 2);
        else this.d.sfxKnock(dist + 2);
        break;
      case 'AMBIENT_ELECTRIC':
        if (def.id === 'FridgeHumStop') this.d.sfxDoor(dist + 8);
        else if (def.id === 'PhoneClick') this.d.sfxPhone(dist + 14);
        else this.d.sfxWhisper(dist + 8);
        break;
      case 'AMBIENT_OBJECT':
        if (def.id === 'ObjectTinyShift') this.d.sfxKnock(dist + 4);
        else this.d.sfxDoor(dist + 6);
        break;
      case 'AMBIENT_LIVING':
        this.d.sfxWhisper(dist + 6);
        break;
    }

    // 断定的なヒントは出さない。確信を持たせないのが目的
    if (Math.random() < 0.45) this.d.hint(AMBIENT_HINTS[def.id] ?? '...', 1.8);
    this.d.chat('idle', 1);
    this.markEvent('anomaly');
    this.d.log(
      'horror_event_triggered',
      `event_id=${def.id} family=${def.family} intensity=${def.intensity} ` +
        `haunted=${this.d.haunting().toFixed(0)} tension=${this.horror.tension.toFixed(0)} room=${this.room()}`,
    );
    this.d.log(
      'ambient_event',
      `ambient_family=${def.family} variant=${variant} source=${src} ` +
        `source_room=${this.room()} target_room=${targetRoom} distance=${dist.toFixed(1)}`,
    );
  }

  /** 今いない部屋を1つ返す。音を毎回自分の背後から出さないため */
  private elsewhere() {
    const here = this.room();
    const rooms = ['entrance', 'butsuma', 'hallway', 'washroom', 'bath', 'ldk'].filter((r) => r !== here);
    return rooms[Math.floor(Math.random() * rooms.length)];
  }

  /** HorrorDirector が選んだイベントを実際に鳴らす */
  private runHorror(def: HorrorEventDef) {
    const p = this.d.playerPos();
    const f = this.d.playerForward();
    const behind = { x: p.x - f.x * 5, z: p.z - f.z * 5 };

    if (def.family.startsWith('AMBIENT')) {
      this.runAmbient(def);
      return;
    }

    switch (def.id) {
      case 'LightFlicker':
        this.d.flickerLamp(p.x, p.z, 2.0);
        break;
      case 'HouseSettle':
        this.d.sfxKnock(16);
        break;
      case 'DoorCreak':
        this.d.sfxDoor(13);
        break;
      case 'DistantFootstep':
        this.d.sfxStep();
        this.d.hint('FOOTSTEPS, SOMEWHERE', 2.2);
        break;
      case 'BehindFootstep':
        this.markBehindEvent();
        this.d.sfxStep();
        this.d.hint('A STEP BEHIND YOU', 2.4);
        this.d.addDanger(3);
        break;
      case 'PortraitTilt':
        this.objects.setState('portraits', 'tilted');
        this.d.sfxKnock(10);
        this.d.hint('SOMETHING ABOUT THE PORTRAITS', 2.4);
        break;
      case 'PortraitChanged':
        this.objects.setState('portraits', 'wrong');
        this.d.hint('THAT IS NOT THE SAME FACE', 2.8);
        this.d.addHaunting(3);
        break;
      case 'MirrorAnomaly':
        this.objects.setState('mirror', 'anomaly');
        this.d.sfxWhisper(4);
        this.d.hint('SOMETHING IN THE MIRROR', 2.4);
        break;
      case 'FridgeHum':
      case 'KitchenNoise':
        this.d.sfxKnock(11);
        break;
      case 'DistantBell':
        this.d.sfxBell();
        this.d.hint('A BELL. SOMEWHERE ELSE.', 2.6);
        break;
      case 'DistantPhone':
        this.d.sfxPhone(18);
        this.d.hint('A PHONE, FURTHER IN', 2.6);
        break;
      case 'OwnVoice':
        this.d.sfxWhisper(2);
        this.d.hint('THAT WAS YOUR VOICE', 2.8);
        this.d.addDanger(5);
        break;
      case 'WaterRunning':
        this.d.sfxWhisper(10);
        this.d.hint('WATER, RUNNING SOMEWHERE', 2.4);
        break;
      case 'SofaEmpty':
        this.d.setGhostSeatVisible(false);
        this.d.hint('THE SOFA IS EMPTY NOW', 2.6);
        break;
      case 'GhostPeek':
        this.requestGhost('PEEK', behind);
        break;
      case 'GhostReposition':
        this.requestGhost('REPOSITION', behind);
        this.d.hint('IT IS NOT WHERE IT WAS', 2.4);
        break;
      case 'GhostCrossing':
        this.requestGhost('CROSS', behind);
        this.d.hint('SOMETHING CROSSED THE HALL', 2.4);
        break;
      case 'GhostStand':
        this.requestGhost('STAND', SOFA);
        break;
      // ---- Safe Suspense Peak。強い演出だが危険は増やさない ----
      case 'PortraitCrash':
        // 見ている目の前で落ちる（§56）。ガラスが割れる
        this.objects.setState('portraits', 'fallen');
        this.d.dropPortrait();
        this.d.sfxKnock(1.5);
        this.d.footage('THE PORTRAIT CAME DOWN   +120 Likes', 3);
        this.d.hint('IT FELL WHILE YOU WERE LOOKING', 3);
        this.d.addLikes(120);
        this.d.spikeViewers(1.2);
        this.d.chat('anomaly', 3);
        this.d.addHaunting(3);
        break;
      case 'PortraitFellUnseen':
        // 音だけ聞こえて、戻ったら落ちている版
        this.objects.setState('portraits', 'fallen');
        this.d.dropPortrait();
        this.d.sfxKnock(14);
        this.d.hint('SOMETHING FELL IN THE OTHER ROOM', 2.6);
        this.d.addHaunting(2);
        break;
      case 'PhoneSuddenRing':
        this.objects.setState('phone', 'ringing');
        this.d.sfxPhone(this.objDistance('phone'));
        this.d.footage('THE PHONE IS RINGING', 3);
        this.d.hint('THE PHONE. RIGHT NOW.', 3);
        break;
      case 'WholeHouseLightDrop':
        this.d.flickerLamp(p.x, p.z, 5.5);
        this.d.sfxDoor(3);
        this.d.footage('THE WHOLE HOUSE WENT DARK', 3);
        this.d.hint('EVERY LIGHT AT ONCE', 3);
        break;
      case 'TVSuddenOn':
        this.objects.setState('tv', 'on');
        this.d.sfxWhisper(6);
        this.d.footage('THE TV TURNED ITSELF ON', 3);
        this.d.hint('THE TV IS ON', 2.8);
        break;
      case 'BathroomDoorMove':
        this.d.sfxDoor(6);
        this.d.footage('THE BATHROOM DOOR MOVED', 3);
        this.d.hint('THE DOOR IS CLOSING BY ITSELF', 3);
        break;
      case 'HallwaySilhouetteCross':
        // 横切るだけ。追ってこない
        this.requestGhost('CROSS', behind);
        this.d.footage('SOMETHING CROSSED THE HALL', 3);
        this.d.hint('IT CROSSED AND KEPT GOING', 3);
        break;
      case 'SofaPostureChange':
        this.d.ghostSeatPosture();
        this.d.footage('IT IS SITTING DIFFERENTLY', 3);
        this.d.hint('THAT IS NOT HOW IT WAS SITTING', 3);
        break;
      case 'FakeRush':
        this.requestGhost('FAKE_RUSH', behind);
        this.d.hint('IT MOVED AT YOU', 2.2);
        this.d.addDanger(6);
        break;
    }

    // 背後で起きたことは TURN AROUND 系のお膳立てになる
    if (def.tags?.includes('behind') || def.family === 'GHOST_SPATIAL') this.markBehindEvent();
    if (def.family === 'PHONE') this.markPhoneEvent();
    if (def.intensity !== 'subtle') this.horrorAt = this.elapsed;
    const tags = def.requiredMemories?.length ? `memory=${def.requiredMemories[0]}` : '';
    this.d.chat(def.intensity === 'subtle' ? 'idle' : 'anomaly', def.intensity === 'subtle' ? 1 : 2);
    this.markEvent('anomaly');
    this.d.log(
      'horror_event_triggered',
      [
        `event_id=${def.id}`,
        `family=${def.family}`,
        `intensity=${def.intensity}`,
        `haunted=${this.d.haunting().toFixed(0)}`,
        `tension=${this.horror.tension.toFixed(0)}`,
        `room=${this.room()}`,
        `ghost=${this.ghost}`,
        tags,
      ].filter(Boolean).join(' '),
    );
    if (def.requiredMemories?.length) {
      this.d.log('world_memory_used', `memory=${def.requiredMemories[0]} event=${def.id}`);
    }
  }

  /** Ghost へは行動要求だけ出す。どう動くかは Ghost 側 */
  private requestGhost(action: GhostAction, spot: { x: number; z: number }) {
    if (action === 'STAND') {
      this.d.setGhostSeatVisible(false);
      this.d.wakeGhost(SOFA.x, SOFA.z);
      this.d.hint('IT STOOD UP', 2.4);
      this.d.chat('danger', 3);
      this.memory.remember('ghost_stood');
      return;
    }
    if (this.ghost === 'seated') return;
    if (action === 'FAKE_RUSH') {
      this.d.addDanger(4);
      this.d.sfxWhisper(2);
      return;
    }
    // 画面内では絶対に動かさない
    const pos = this.d.ghostPos();
    if (this.d.isVisible(pos.x, pos.z, 1.5)) return;
    this.d.wakeGhost(spot.x, spot.z);
  }

  // ---------------------------------------------------------------- //
  // Request Director
  // ---------------------------------------------------------------- //

  private context(): Floor1Context {
    return {
      room: this.room(),
      distances: this.distances(),
      states: this.objects.states(),
      discovered: this.objects.discoveredSet(),
      memory: this.memory.all(),
      completed: new Set([...this.uniqueRequests].filter((id) => this.completedIds.has(id))),
      haunted: this.d.haunting(),
      ghost: this.ghost,
      ghostDistance: this.objDistance('ghost'),
      ghostOnScreen: (() => {
        const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
        return this.d.isVisible(g.x, g.z, 1.3);
      })(),
      selfie: this.d.selfie(),
      lightOn: this.d.lightOn(),
      focusObject: this.focusObject(),
      goalReached: this.goal,
      returning: this.returningTime > 1.5 && this.d.distanceToEntrance() < 14,
      sinceEvent: this.sinceEvent,
      attention: this.objects.attentionMap(),
      reengaged: this.objects.reengagedSet(),
      objectRequestNeed: this.objectRequestNeed(),
      situationRequestNeed: this.situationRequestNeed(),
      setups: this.currentSetups(),
      lastCompleted: this.lastCompleted,
      coreOpportunities: this.cores,
      coreMisses: this.coreMisses,
      lastObject: this.lastObject,
      sinceObject: this.sinceObject,
    };
  }

  private completedIds = new Set<string>();
  /** 直前に触った / 達成したオブジェクト */
  private lastObject: string | null = null;
  private sinceObject = 999;
  private lastRiskTier = 0;
  private finalTaken = false;

  /** オブジェクトに関わる出来事があった */
  private touchedObject(id: string) {
    this.lastObject = id;
    this.sinceObject = 0;
  }

  private markEvent(kind: string) {
    this.sinceEvent = 0;
    this.horror.markMeaningful();
    this.d.markEvent(kind);
  }

  /**
   * 提示するかどうか。
   * 候補があっても、直前に何か起きていたら間を置く。Silence も正解。
   */
  private updateDirector(dt: number) {
    const pace = CONFIG.floor1.pacing;
    this.director.update(dt);

    if (this.active) return;

    // 予約済みの提示を待つ（§31-37）
    if (this.pendingDef) {
      this.pendingDelay -= dt;
      this.pendingAge += dt;
      const def = this.pendingDef;
      const ctx = this.context();

      // 待っている間に出来事があったら少しだけ譲る。
      // ただし v1.3 までは毎フレーム引き直していたので、Horror Event が
      // 10秒おきに出るだけで候補が 55秒 Pending し続けていた。
      // 譲るのは合計 pace.candidate.maxDefer 秒まで。
      if (this.sinceEvent < pace.afterEvent && this.pendingDeferred < pace.candidate.maxDefer) {
        const add = Math.min(dt * 2, pace.candidate.maxDefer - this.pendingDeferred);
        this.pendingDeferred += add;
        this.pendingDelay += add;
      }

      // 対象の近くにいる間は少し粘る。離れたら早めに諦める
      const near =
        !def.object ||
        (def.object === 'ghost' ? ctx.ghostDistance : ctx.distances[def.object] ?? 999) <=
          (def.maxDistance ?? CONFIG.floor1.interactRange) * 1.6;
      const limit = near ? pace.candidate.graceNear : pace.candidate.graceAway;
      if (this.pendingAge > limit || this.pendingAge > pace.candidate.staleTimeout) {
        this.pendingDef = null;
        this.d.log(
          'request_candidate_rejected',
          `id=${def.id} reason=${this.pendingAge > pace.candidate.staleTimeout ? 'stale_timeout' : near ? 'grace_expired' : 'left_object'} age=${this.pendingAge.toFixed(1)}`,
        );
        this.quiet = randRange(2, 5);
        return;
      }

      if (this.pendingDelay <= 0) {
        this.pendingDef = null;
        // 出す直前にもう一度文脈を確認する（§36）
        // §48-50。距離と Chase だけでなく、最初と同じ条件を全部やり直す
        const why = this.director.revalidate(def, ctx);
        if (!why) this.offer(def);
        else {
          this.d.log(
            'request_candidate_cancelled',
            `id=${def.id} category=${def.object ? 'object' : 'situation'} reason=${why} age=${this.pendingAge.toFixed(1)}`,
          );
          this.cancelled += 1;
          this.funnel.cancelled[def.object ? 'object' : 'situation'] += 1;
          this.quiet = randRange(2, 5);
        }
      }
      return;
    }

    this.quiet -= dt;
    if (this.quiet > 0) return;
    if (this.sinceEvent < pace.afterEvent) return;

    const ctx = this.context();
    const def = this.director.select(ctx);
    // --- ファネル計測（§72-77）---
    this.funnel.checked += FLOOR1_POOL.length;
    for (const r of this.director.lastRejections) {
      this.funnel.rejections.set(r.reason, (this.funnel.rejections.get(r.reason) ?? 0) + 1);
    }
    const eligibleNow = FLOOR1_POOL.length - this.director.lastRejections.length;
    this.funnel.eligible += eligibleNow;
    this.funnel.candidateCounts.push(eligibleNow);
    for (const c of this.director.lastCandidates) {
      const cat = c.def.object ? 'object' : 'situation';
      this.funnel.scored[cat] += 1;
      if (c.score > 0) this.funnel.positive[cat] += 1;
      for (const e of c.eligibleBy) {
        this.funnel.eligibleBy.set(e, (this.funnel.eligibleBy.get(e) ?? 0) + 1);
      }
      this.d.log(
        'request_candidate_scored',
        `id=${c.def.id} category=${cat} eligible_by=${c.eligibleBy.join('+') || '-'} ` +
          `room=${this.room()} score=${c.score.toFixed(1)} ${c.reasons.join(',')}`,
      );
    }
    if (this.director.lastCoreSelection) {
      const cs = this.director.lastCoreSelection;
      this.d.log(
        'core_selection_evaluated',
        `bestCore=${cs.bestCore} bestOther=${cs.bestOther} dominance=${cs.dominance} coreProbability=${cs.prob}`,
      );
    }
    // 電話が鳴っているのに Phone Request が落ちた理由は必ず残す（§44, §67-68）
    for (const id of ['altar_beat', 'phone_answer', 'phone_return', 'bath_sip']) {
      const r = this.director.lastRejections.find((x) => x.id === id);
      if (r && this.cores.length) {
        this.d.log('core_request_rejected', `id=${id} reason=${r.reason} room=${this.room()}`);
      }
    }
    this.d.log(
      'request_eligibility_checked',
      `checked=${FLOOR1_POOL.length} eligible=${FLOOR1_POOL.length - this.director.lastRejections.length} ` +
        `top=${this.director.lastCandidates.map((c) => `${c.def.id}:${c.score.toFixed(0)}`).join('|') || '-'}`,
    );
    if (!def) {
      // 候補が無いだけ。すぐ見直す
      this.quiet = randRange(2, 4.5);
      return;
    }
    // 近くにいることは条件であってトリガーではない。ここから更に間を置く
    this.pendingDef = def;
    this.pendingDelay = randRange(pace.offerDelay.min, pace.offerDelay.max);
    this.pendingAge = 0;
    this.pendingDeferred = 0;
    const cat = def.object ? 'object' : 'situation';
    this.funnel.warmup[cat] += 1;
    this.d.log(
      'request_candidate_warmup',
      `id=${def.id} category=${cat} warmup=${this.pendingDelay.toFixed(1)} object=${def.object ?? '-'}`,
    );

    // 少し前に視聴者が匂わせる（毎回はやらない）
    if (Math.random() < 0.45) {
      const lines = def.object ? DISCOVERY_CHAT[def.object] : null;
      if (lines) this.d.chatLine(pick(lines));
    }
  }

  /**
   * 今どんな「お膳立て」が成立しているか（§10-13）。
   * 状況Requestは、これが1つでも立っていれば候補になれる。
   */
  private currentSetups(): Record<SituationSetup, number> {
    const cfg = CONFIG.floor1.setup;
    const ghostVisible = (() => {
      const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
      return this.d.isVisible(g.x, g.z, 1.3);
    })();
    if (ghostVisible) this.ghostSeenAt = this.elapsed;

    // 寿命つきで、時間が経つほど弱くなる（§28）
    const decay = (at: number, life: number) => {
      const age = this.elapsed - at;
      if (age < 0 || age > life) return 0;
      return 1 - age / life;
    };

    const room = this.room();
    const sinceGhost = this.elapsed - this.ghostSeenAt;
    return {
      object:
        this.lastObject && this.sinceObject <= CONFIG.floor1.pacing.situationWindow
          ? 1 - this.sinceObject / CONFIG.floor1.pacing.situationWindow
          : 0,
      behind: decay(this.behindAt, cfg.behindLife),
      ghostLost:
        this.objects.get('ghost')?.discovered && !ghostVisible && sinceGhost > 1.5
          ? decay(this.ghostSeenAt + 1.5, cfg.ghostLostLife)
          : 0,
      afterPhone: decay(this.phoneEventAt, cfg.afterPhoneLife),
      afterHorror: decay(this.horrorAt, cfg.afterHorrorLife),
      roomTransition: decay(this.roomChangedAt, cfg.roomTransitionLife),
      hallway: room === 'hallway' || room === 'entrance' ? 1 : 0,
      returning: this.returningTime > 1.5 && this.d.distanceToEntrance() < 20 ? 1 : 0,
      lingering: this.stillTime > cfg.lingeringFor ? Math.min(1, this.stillTime / (cfg.lingeringFor * 2)) : 0,
      moving: this.movingTime > cfg.movingFor ? Math.min(1, this.movingTime / (cfg.movingFor * 2)) : 0,
      // 何も起きていないが、家は既におかしい
      quietSuspense:
        this.sinceEvent > cfg.quietFrom && this.d.haunting() > cfg.quietHaunted
          ? Math.min(1, (this.sinceEvent - cfg.quietFrom) / cfg.quietSpan)
          : 0,
    };
  }

  /** 背後で何かが起きた。TURN AROUND 系のお膳立てになる（§27, §29） */
  markBehindEvent() {
    this.behindAt = this.elapsed;
    this.opportunities.behindSetups += 1;
    this.d.log('situation_setup_created', `setup=behind at=${this.elapsed.toFixed(1)}`);
  }

  /**
   * Viewer の関心が一点に向く瞬間を作る（§52-54）。
   *
   * 対象の前に立っている間だけ有効、ではなく **窓** として持つ。
   * 仏壇を調べて一歩下がっただけで PLAY A BEAT が消えるのが、
   * 人間プレイで一度も出なかった原因だった。
   */
  private openCore(source: CoreSource, preferred: string[]) {
    const cfg = CONFIG.floor1.coreOpportunity;
    const existing = this.cores.find((c) => c.source === source && c.state !== 'expired');
    if (existing) return;
    // Session が終わった直後の連打を防ぐ（§19-20）
    if ((this.reopenBlock[source] ?? 0) > this.elapsed) return;
    this.sessionSeq += 1;
    this.sessionStats.started += 1;
    const timeSensitive = source === 'phone';
    this.cores.push({
      source,
      kind: timeSensitive ? 'timeSensitive' : 'persistent',
      state: 'active',
      startedAt: this.elapsed,
      wallTime: 0,
      eligibleActiveTime: 0,
      pausedTime: 0,
      budget: cfg.budget[source] ?? 14,
      strength: 1,
      urgency: 0,
      preferred,
      sessionId: this.sessionSeq,
      lastRelevantAt: this.elapsed,
      suspendedAt: 0,
      softLosts: 0,
      resumes: 0,
    });
    this.opportunityCounts[source] += 1;
    this.d.log(
      'core_session_started',
      `source=${source} kind=${timeSensitive ? 'timeSensitive' : 'persistent'} budget=${cfg.budget[source]} preferred=${preferred.join('|')}`,
    );
    this.interruptForOpportunity(`core_${source}`);
    this.coreReservation = { source, until: this.elapsed + cfg.reservation };
  }

  /**
   * まだ意味があるか。無ければ理由つきで期限切れにする（§9, §16, §56-60）。
   * Pause から戻ったときも必ずここを通す。
   */
  private coreContextLost(c: CoreOpportunity): { level: 'ok' | 'soft' | 'hard'; reason: string } {
    const ok = { level: 'ok' as const, reason: '' };
    const area = CORE_AREAS[c.source] ?? [];
    const room = this.room();
    const inArea = area.includes(room);

    switch (c.source) {
      case 'phone': {
        const st = this.objects.get('phone')?.state;
        if (st === 'answered') return { level: 'hard', reason: 'already_completed' };
        // 鳴っている限り、部屋を出ても機会は生きている（§30）
        if (st !== 'ringing') return { level: 'hard', reason: 'phone_stopped_ringing' };
        return ok;
      }
      case 'bath': {
        if (this.bathSips > 0) return { level: 'hard', reason: 'already_completed' };
        if (inArea) return ok;
        // 風呂・洗面所エリアの外。遠ければ本当に離れた
        if (this.objDistance('bath') > CONFIG.floor1.coreOpportunity.hardDistance) {
          return { level: 'hard', reason: 'left_area' };
        }
        return { level: 'soft', reason: 'left_room' };
      }
      case 'altar': {
        if (this.completedIds.has('altar_beat')) return { level: 'hard', reason: 'already_completed' };
        if (inArea) return ok;
        if (this.objDistance('altar') > CONFIG.floor1.coreOpportunity.hardDistance) {
          return { level: 'hard', reason: 'left_area' };
        }
        return { level: 'soft', reason: 'left_room' };
      }
      case 'ghost': {
        if (this.ghost === 'chasing') return { level: 'hard', reason: 'run_phase_changed' };
        const d = this.objDistance('ghost');
        if (d > 30) return { level: 'hard', reason: 'target_lost' };
        // 一瞬視界から外れただけなら中断
        const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
        if (!this.d.isVisible(g.x, g.z, 1.3) || d > 18) return { level: 'soft', reason: 'out_of_sight' };
        return ok;
      }
    }
    return ok;
  }

  /**
   * 機会の寿命管理（§3-16）。
   *
   * **壁時計では数えない。** Offer できた累計時間で数える。
   * 別のリクエストを処理していただけで機会を失うのは、Viewer の都合ではなく内部都合。
   */
  private updateCores(dt: number) {
    const cfg = CONFIG.floor1.coreOpportunity;
    const blocked = this.active
      ? 'active_request'
      : this.pendingDef
        ? 'pending_request'
        : this.ghost === 'chasing'
          ? 'chase'
          : null;

    for (const c of this.cores) {
      if (c.state === 'expired' || c.state === 'resolved') continue;
      c.wallTime += dt;

      const ctx = this.coreContextLost(c);

      // --- HARD LOST。ここで初めて「逃した」と数える（§10-11）---
      if (ctx.level === 'hard') {
        this.endSession(c, ctx.reason);
        continue;
      }

      // --- SOFT LOST。隣の部屋へ出ただけ。予算は減らさない（§6-8）---
      if (ctx.level === 'soft') {
        if (c.state !== 'suspended') {
          c.state = 'suspended';
          c.suspendedAt = this.elapsed;
          c.softLosts += 1;
          this.sessionStats.softLost += 1;
          this.d.log(
            'core_session_suspended',
            `source=${c.source} session=${c.sessionId} reason=${ctx.reason}`,
          );
        }
        // 戻ってこないまま猶予を過ぎたら、そこで初めて終わり
        if (this.elapsed - c.suspendedAt > cfg.suspendGrace) {
          this.endSession(c, 'not_returning');
        }
        continue;
      }

      // --- 戻ってきた。同じ Session を続ける（§9）---
      if (c.state === 'suspended') {
        c.resumes += 1;
        this.sessionStats.resumed += 1;
        c.state = 'active';
        this.d.log(
          'core_session_resumed',
          `source=${c.source} session=${c.sessionId} away=${(this.elapsed - c.suspendedAt).toFixed(1)}s resumes=${c.resumes}`,
        );
        this.d.log('core_opportunity_revalidated', `source=${c.source} ok=true`);
      }
      c.lastRelevantAt = this.elapsed;

      if (c.kind === 'timeSensitive') {
        c.state = 'active';
        c.eligibleActiveTime += dt;
        const left = this.phoneRingLeft;
        c.urgency = left > 10 ? cfg.urgency.phoneFar : left > 5 ? cfg.urgency.phoneMid : cfg.urgency.phoneNear;
        if (blocked) c.urgency += cfg.urgency.blockedBoost;
        c.strength = 1;
        continue;
      }

      // --- persistent。別Request中は Pause（予算を消費しない）---
      if (blocked) {
        if (c.state !== 'paused') {
          c.state = 'paused';
          c.pauseReason = blocked;
          this.d.log('core_opportunity_paused', `source=${c.source} reason=${blocked}`);
        }
        c.pausedTime += dt;
        continue;
      }
      if (c.state === 'paused') {
        c.state = 'active';
        this.d.log(
          'core_opportunity_resumed',
          `source=${c.source} eligible_active_time=${c.eligibleActiveTime.toFixed(1)} paused=${c.pausedTime.toFixed(1)}`,
        );
      }
      c.eligibleActiveTime += dt;
      c.strength = Math.max(0, 1 - c.eligibleActiveTime / c.budget);
      c.urgency = c.strength < 0.35 ? cfg.urgency.fading : 0;
      if (c.eligibleActiveTime >= c.budget) this.endSession(c, 'timeout');
    }

    this.cores = this.cores.filter((c) => c.state !== 'expired' && c.state !== 'resolved');
    if (this.coreReservation && this.coreReservation.until <= this.elapsed) this.coreReservation = null;
  }

  /** Session を終える。Soft Lost の往復はここに来ない */
  private endSession(c: CoreOpportunity, reason: string) {
    const resolved = c.preferred.some((id) => this.offeredHistory.includes(id));
    c.state = resolved ? 'resolved' : 'expired';
    this.reopenBlock[c.source] = this.elapsed + CONFIG.floor1.coreOpportunity.reopenCooldown;
    this.d.log(
      resolved ? 'core_session_resolved' : 'core_session_ended',
      `source=${c.source} session=${c.sessionId} reason=${reason} ` +
        `wall=${c.wallTime.toFixed(1)} eligible=${c.eligibleActiveTime.toFixed(1)} paused=${c.pausedTime.toFixed(1)} ` +
        `soft_lost=${c.softLosts} resumes=${c.resumes}`,
    );
    if (resolved) {
      this.sessionStats.resolved += 1;
      return;
    }
    this.sessionStats.hardLost += 1;
    this.coreMisses += 1;
    const bucket =
      reason === 'timeout'
        ? c.pausedTime > c.eligibleActiveTime
          ? 'miss_due_to_active_request'
          : 'miss_due_to_selection'
        : reason === 'phone_stopped_ringing'
          ? 'miss_due_to_time_sensitive_expiry'
          : 'miss_due_to_hard_context_loss';
    this.coreMissReasons[bucket] = (this.coreMissReasons[bucket] ?? 0) + 1;
  }

  /**
   * 世界で今まさに何かが起きた。待機中の候補を捨てて考え直す（§39-42）。
   * 電話が鳴っているのに、その前から並んでいた「動くな」が先に出るのは不自然。
   */
  private interruptForOpportunity(what: string) {
    // 同じ機会で何度も割り込まない。E連打で候補が永久に温まらなくなる
    if (this.interrupted.has(what)) return;
    this.interrupted.add(what);
    if (this.pendingDef) {
      this.d.log(
        'request_candidate_cancelled',
        `id=${this.pendingDef.id} reason=core_opportunity:${what} age=${this.pendingAge.toFixed(1)}`,
      );
      this.pendingDef = null;
    }
    this.quiet = Math.min(this.quiet, randRange(0.8, 2.5));
  }

  /** 電話まわりで何かがあった */
  markPhoneEvent() {
    this.phoneEventAt = this.elapsed;
    this.opportunities.phoneRinging += 1;
    if (this.objects.get('phone')?.state === 'ringing') {
      // 近ければ「取れ」、遠ければ「戻って取れ」（§30-33）
      this.openCore('phone', ['phone_answer', 'phone_return', 'phone_listen']);
    }
    this.d.log('situation_setup_created', `setup=afterPhone at=${this.elapsed.toFixed(1)}`);
  }

  /**
   * 0..1。Situation Request がどれだけ足りていないか。
   * Object と取り合いにしない。
   */
  situationRequestNeed() {
    const cfg = CONFIG.floor1.objectNeed;
    const since = this.elapsed - this.lastSituationRequestAt;
    return clamp01((since - cfg.situationFrom) / (cfg.situationTo - cfg.situationFrom));
  }

  /**
   * 0..1。Object Request がどれだけ足りていないか。
   * 9個見つけて Object Request 0件、のような Run を防ぐための加点であって、
   * 「N個調べたら必ず出す」ではない（§42）。
   */
  objectRequestNeed() {
    const cfg = CONFIG.floor1.objectNeed;
    if (this.objectRequestsOffered > 0) {
      // 一度でも出ていれば、間隔だけを見る
      const since = this.elapsed - this.lastObjectRequestAt;
      return clamp01((since - cfg.sinceFrom) / (cfg.sinceTo - cfg.sinceFrom));
    }
    // 調べた数を主に見るが、見つけただけでも弱く効かせる。
    // 実プレイで「9個見つけて Object Request 0件」が出ていたため。
    const eff = Math.max(this.inspectedObjects.size, this.discoveries * 0.5);
    return clamp01((eff - cfg.inspectedFrom) / (cfg.inspectedTo - cfg.inspectedFrom));
  }



  private offer(def: Floor1RequestDef) {
    // §7。ログより先に権威ある状態を作る。順序を逆にすると
    // 「request_offered なのに request_active=0」が発生しうる。
    this.active = {
      def,
      state: 'offered',
      timeLeft: def.time,
      progress: 0,
      engaged: false,
      hold: 0,
      tier: 0,
      earned: 0,
      held: 0,
      offeredAt: this.elapsed,
      startRoom: this.room(),
      startEntranceDistance: this.d.distanceToEntrance(),
      actionUnlocked: false,
      uiShown: false,
      unlockLogged: false,
      pausedLogged: false,
      loggedStep: -1,
    };
    this.offered += 1;
    if (def.object) this.objectRequestsOffered += 1;
    else this.situationRequestsOffered += 1;
    if (def.object) this.lastObjectRequestAt = this.elapsed;
    else this.lastSituationRequestAt = this.elapsed;
    this.funnel.offered[def.object ? 'object' : 'situation'] += 1;
    this.offerTimes.push(this.elapsed);
    if (def.id === 'phone_answer') this.opportunities.phonePickupOffered += 1;
    if (def.id === 'altar_beat') this.opportunities.altarBeatOffered += 1;
    if (def.object === 'bath') this.opportunities.bathOffered += 1;
    if (def.object === 'ghost') this.opportunities.ghostOffered += 1;
    if (TURN_FAMILY.has(def.id)) this.opportunities.turnFamilyOffered += 1;
    if (this.uniqueRequests.has(def.id)) this.repeatedRequests += 1;
    this.uniqueRequests.add(def.id);
    this.offeredHistory.push(def.id);
    this.director.markOffered(def.id);
    this.d.markDecision();
    this.d.sfxSpike();
    this.d.chat(def.lastTemptation ? 'temptation' : 'request', 3);
    this.d.log('request_selected', `id=${def.id} type=${def.type} reward=${def.reward} tier=${def.riskTier}`);
    this.d.log(
      'request_offered',
      `${def.id}:${def.reward} type=${def.type} object=${def.object ?? '-'} category=${def.object ? 'object' : 'situation'}`,
    );
    if (def.lastTemptation) this.lastTemptationDone = true;
  }

  dismiss() {
    const a = this.active;
    if (!a) return false;
    this.dismissed += 1;
    this.d.log('request_dismissed', [
      `request_type=${a.def.id}`,
      `reward=${a.def.reward}`,
      `risk_tier=${a.def.riskTier}`,
      `time_since_offered=${(this.elapsed - a.offeredAt).toFixed(1)}`,
    ].join(' '));
    this.endRequest('dismissed');
    return true;
  }

  private endRequest(why: 'ignored' | 'dismissed' | 'done') {
    const pace = CONFIG.floor1.pacing;
    if (this.active && why === 'ignored') {
      // 何も出さずにカードが消えるのは禁止（§46）
      this.d.toast('REQUEST MISSED', 1.4);
      this.ignored += 1;
      this.d.log('request_ignored', `${this.active.def.id}:${this.active.def.reward}`);
    }
    if (this.active) {
      this.active.state = why === 'done' ? 'completed' : why === 'dismissed' ? 'dismissed' : 'ignored';
      if (this.active.actionUnlocked) {
        this.d.log('request_action_locked', `id=${this.active.def.id} reason=${why}`);
      }
      this.active.actionUnlocked = false;
    }
    this.active = null;
    // 終わった直後に溜まっていたものを出さない。改めて文脈を見る
    this.pendingDef = null;
    // 毎回同じ秒数にしない（§7）
    this.quiet = randRange(pace.afterRequest.min, pace.afterRequest.max);
    if (Math.random() < 0.3) this.quiet *= randRange(1.4, 2.2);
  }

  private finish(a: ActiveRequest, reward: number) {
    a.state = 'completed';
    this.lastCompleted = a.def.id;
    this.d.footage(`REQUEST COMPLETE   +¥${reward.toLocaleString()}`, 1.4);
    this.completed += 1;
    this.completedIds.add(a.def.id);
    if (a.def.object) this.touchedObject(a.def.object);
    // 自分から危険を選んだ。世界はこれを見てから返事を決める
    this.lastRiskTier = a.def.riskTier;
    this.horror.markGreed(a.def.riskTier);
    if (a.def.lastTemptation) {
      this.finalTaken = true;
      // §22-24。スコア加点だけでは保証にならないので、返事そのものを予約する。
      // 何が返ってくるかは Director が Utility で選ぶので、毎回違う。
      const tags = a.def.object === 'phone'
        ? ['phone', 'behind']
        : a.def.object === 'ghost'
          ? ['ghost']
          : ['ghost', 'behind'];
      this.horror.requireConsequence('LAST_TEMPTATION', tags, a.def.object);
      this.d.log(
        'pending_consequence_created',
        `source=LAST_TEMPTATION request=${a.def.id} tags=${tags.join('/')}`,
      );
    }
    this.d.log(
      'request_completed_event',
      `requestId=${a.def.id} riskTier=${a.def.riskTier} object=${a.def.object ?? '-'}`,
    );
    if (a.def.type !== 'hold') {
      this.d.addEarnings(reward);
      this.d.sfxCash();
      this.d.toast(`+¥${reward.toLocaleString()}`, 2.2);
    }
    this.d.spikeViewers(1.2);
    this.d.addBoost(1.4, 12);
    this.d.addHaunting(a.def.haunting);
    this.d.addDanger(a.def.danger);
    this.d.chat('request', 3);
    this.markEvent('request_complete');
    this.d.log('request_completed', `${a.def.id}:${reward}`);
    this.endRequest('done');

    // 段が続くかどうか
    const chances = CONFIG.floor1.continueChances;
    const idx = Math.min(a.def.riskTier - 1, chances.length - 1);
    if (Math.random() > chances[Math.max(0, idx)]) {
      this.quiet = randRange(10, 18);
    }
  }

  // ---------------------------------------------------------------- //

  private evaluate(dt: number, opts: { moved: boolean; turned: number }) {
    const a = this.active;
    if (!a) return;
    a.timeLeft -= dt;
    const def = a.def;

    if (def.type === 'action') {
      let done = false;
      switch (def.id) {
        case 'portrait_look':
          done = this.objects.get('portraits')!.interactions > 0;
          break;
        case 'portrait_pick':
          done = this.objects.get('portraits')!.state === 'held';
          break;
        case 'portrait_back':
          done = this.objects.get('portraits')!.state === 'restored';
          break;
        case 'phone_answer':
        case 'phone_return':
          // 近づくだけでは終わらない。受話器を取って初めて完了（§36）
          a.progress = clamp01((26 - this.objDistance('phone')) / 24);
          done = this.objects.get('phone')!.state === 'answered';
          break;
        case 'bath_sip':
          done = this.bathSips >= 1;
          break;
        case 'bath_sip2':
          done = this.bathSips >= 2;
          break;
        case 'bath_finish':
          done = this.bathSips >= 3;
          break;
        case 'sit_go_back':
          a.progress = clamp01((a.startEntranceDistance - this.d.distanceToEntrance()) / 8);
          done = a.progress >= 1;
          break;
        case 'ghost_closer':
          a.progress = clamp01((16 - this.objDistance('ghost')) / 10);
          done = this.objDistance('ghost') <= 6;
          break;
        case 'ghost_selfie':
        case 'ghost_selfie_close':
        case 'ghost_last_selfie': {
          const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
          const near = def.id === 'ghost_selfie_close' ? 4.5 : 12;
          const ok = this.d.selfie() && this.d.isVisible(g.x, g.z, 1.3) && this.objDistance('ghost') <= near;
          a.held = ok ? a.held + dt : Math.max(0, a.held - dt);
          a.progress = clamp01(a.held / 1.2);
          done = a.held >= 1.2;
          if (done) {
            this.ghostSelfies += 1;
            this.memory.remember('ghost_selfie_taken');
            if (def.id === 'ghost_selfie_close') {
              this.memory.remember('ghost_close_selfie');
              this.horror.addIntent('ghost_close_selfie');
            }
            this.d.log('ghost_selfie', `count=${this.ghostSelfies} distance=${this.objDistance('ghost').toFixed(1)}`);
          }
          break;
        }
        case 'sit_look_behind':
        case 'sit_now_turn':
        case 'sit_turn':
        case 'sit_turn_last':
          a.progress = clamp01(Math.abs(opts.turned) / Math.PI);
          done = Math.abs(opts.turned) > 2.4;
          if (done) this.turnAroundConsequence();
          break;
      }
      if (a.progress < 0.5 && done) a.progress = 1;
      if (a.progress >= 0.5) a.engaged = true;
      if (done) {
        this.finish(a, def.reward);
        return;
      }
    }

    if (def.type === 'constraint' || def.type === 'target_constraint') {
      const need = def.constraintSeconds ?? 5;
      let ok = false;
      switch (def.id) {
        case 'mirror_dark':
        case 'sit_lights_off':
          ok = !this.d.lightOn();
          break;
        case 'mirror_stare': {
          const spec = FLOOR1_OBJECTS.find((o) => o.id === 'mirror')!;
          ok = this.d.centerOf(spec.x, spec.z, spec.height) > 0.35;
          break;
        }
        case 'ghost_frame':
        case 'ghost_refind':
        case 'chase_film': {
          const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
          const visible = this.d.isVisible(g.x, g.z, 1.3);
          const far = this.objDistance('ghost') > (def.maxDistance ?? 18);
          ok = visible && !far;
          this.setTargetLock(ok, far);
          break;
        }
        case 'sit_dont_turn':
          if (Math.abs(opts.turned) > 2.0) {
            this.d.toast('YOU LOOKED', 1.4);
            this.endRequest('ignored');
            return;
          }
          ok = true;
          break;
        case 'sit_dont_move':
          if (opts.moved) {
            this.d.toast('YOU MOVED', 1.4);
            this.endRequest('ignored');
            return;
          }
          ok = true;
          break;
        case 'sit_stay_here':
          if (this.room() !== a.startRoom) {
            this.d.toast('YOU LEFT', 1.4);
            this.endRequest('ignored');
            return;
          }
          ok = true;
          break;
        case 'sit_keep_walking':
          ok = opts.moved;
          break;
        case 'sit_stop':
          ok = !opts.moved;
          break;
      }
      // 対象を見失っても即0にはしない。ゆっくり減らす（§41）
      const decay = def.type === 'target_constraint' ? dt * 0.35 : dt * 0.6;
      const was = a.held;
      a.held = ok ? a.held + dt : Math.max(0, a.held - decay);
      this.progressing = ok;
      if (ok && was === 0) this.logProgress(a, 'request_progress_started');
      else if (!ok && was > 0 && !a.pausedLogged) {
        a.pausedLogged = true;
        this.logProgress(a, 'request_progress_paused');
      }
      if (ok) a.pausedLogged = false;
      a.progress = clamp01(a.held / need);
      this.logProgressStep(a, a.progress);
      if (a.progress >= 0.5) a.engaged = true;
      if (a.held >= need) {
        this.logProgress(a, 'request_progress_completed');
        this.finish(a, def.reward);
        return;
      }
    }

    // 鳴り止んだら電話のリクエストも終わる（§37）
    if (
      (def.id === 'phone_answer' || def.id === 'phone_return') &&
      this.objects.get('phone')?.state !== 'ringing' &&
      this.objects.get('phone')?.state !== 'answered'
    ) {
      this.d.toast('IT STOPPED RINGING', 1.4);
      this.endRequest('ignored');
      return;
    }
    if (a.timeLeft <= 0) {
      if (a.def.type === 'hold' && a.tier > 0) this.finish(a, a.earned);
      else this.endRequest('ignored');
    }
  }

  /** TURN AROUND の結果。毎回びっくりさせない */
  private turnAroundConsequence() {
    const roll = Math.random();
    if (roll < 0.35) {
      this.d.hint('NOTHING', 2);
      return;
    }
    if (roll < 0.65) {
      this.d.hint('SOMETHING, FAR DOWN THE HALL', 2.6);
      this.d.chat('discovered', 2);
      return;
    }
    if (roll < 0.88) {
      this.maybeGhostStir();
      this.d.hint('IT IS NOT WHERE IT WAS', 2.6);
      this.d.chat('danger', 3);
      return;
    }
    this.d.addDanger(14);
    this.d.chat('danger', 4);
    this.d.hint('IT IS RIGHT THERE', 2.4);
  }

  // ---------------------------------------------------------------- //

  update(dt: number, input: { holdingE: boolean; moved: boolean; turned: number }) {
    this.elapsed += dt;
    this.sinceEvent += dt;
    this.sinceObject += dt;
    this.memory.update(dt);
    this.updateDiscovery(dt);
    this.updateGhost(dt);
    if (input.moved) {
      this.movingTime += dt;
      this.stillTime = 0;
    } else {
      this.stillTime += dt;
      this.movingTime = 0;
    }
    const room = this.room();
    if (room !== this.lastRoom) {
      this.lastRoom = room;
      this.roomChangedAt = this.elapsed;
      this.roomVisits[room] = (this.roomVisits[room] ?? 0) + 1;
    }
    this.updateCores(dt);
    this.updateActionUnlock();
    this.updateHold(dt, input.holdingE);
    this.evaluate(dt, input);
    this.updateDirector(dt);

    // 帰ろうとしているか
    const dEnt = this.d.distanceToEntrance();
    if (dEnt < this.lastEntranceDistance - 0.01) this.returningTime += dt;
    else if (dEnt > this.lastEntranceDistance + 0.05) this.returningTime = 0;
    this.lastEntranceDistance = dEnt;

    // 配信目標
    if (!this.goal && goalReached({ elapsed: this.elapsed, discoveries: this.discoveries, earnings: this.d.earnings() })) {
      this.goal = true;
      this.d.footage('STREAM GOAL REACHED', 3.4);
      this.d.hint("YOU'VE GOT ENOUGH. RETURN WHEN YOU'RE READY.", 4);
      this.d.sfxCash();
      this.d.addBoost(1.2, 10);
      this.d.chat('escape', 3);
      this.markEvent('discovery');
      this.d.log('stream_goal_reached', `earnings=${Math.round(this.d.earnings())}`);
    }

    // --- HorrorDirector。世界側の反応と「間」はこちらが決める ---
    const evalsBefore = this.horror.evaluations;
    const fired = this.horror.update(dt, this.horrorContext());
    if (this.horror.evaluations > evalsBefore) {
      const dbg = this.horror.debug();
      this.d.log(
        'horror_evaluation',
        `selected=${dbg.selected || 'Nothing'} tension=${dbg.tension} pressure=${dbg.pressure} ` +
          `band=${dbg.pressureBand} recent_ghost_count=${dbg.ghost30s} recent_strong_count=${dbg.strong30s} ` +
          `candidates=${dbg.candidates.slice(0, 3).join('|') || '-'}`,
      );
    }
    if (fired) this.runHorror(fired);
    // Pressure の変化。Run B のような密度上昇を後から追えるようにする
    while (this.pressureLogged < this.horror.pressureLog.length) {
      const e = this.horror.pressureLog[this.pressureLogged++];
      this.d.log(
        'horror_pressure_changed',
        `before=${e.before} after=${e.after} source_event=${e.source} decay=${CONFIG.horror.pressure.decay}`,
      );
    }
    while (this.pendingLogged < this.horror.pendingLog.length) {
      const e = this.horror.pendingLog[this.pendingLogged++];
      this.d.log(e.kind, e.detail);
    }
    while (this.pendingFailLogged < this.horror.pendingFailReasons.length) {
      const e = this.horror.pendingFailReasons[this.pendingFailLogged++];
      this.d.log(
        'pending_consequence_failed',
        `source=${e.source} elapsed=${e.elapsed} candidate_rejections=${e.rejections.join('|')}`,
      );
    }

    // 電話を鳴らす条件
    this.maybeRingPhone(dt);
    this.maybeGuideToButsuma(dt);
  }

  private phoneTimer = 20;
  /**
   * 電話を鳴らす。
   * 近づいた瞬間に鳴らさない。条件が揃うまで待ち、揃わなければ短い間隔で見直す。
   * （長いタイマーを毎回引き直すと、条件が揃う瞬間を逃し続けて一度も鳴らなくなる）
   */
  private maybeRingPhone(dt: number) {
    const st = this.objects.get('phone');
    if (!st || !st.discovered) return;
    if (st.state === 'ringing') {
      this.phoneRingLeft -= dt;
      if (this.phoneRingLeft <= 0) {
        this.objects.setState('phone', 'idle');
        this.d.log('subject_state_changed', 'subject=phone old=ringing new=idle');
      }
      return;
    }
    if (st.state !== 'idle' && st.state !== 'normal') return;
    this.phoneTimer -= dt;
    if (this.phoneTimer > 0) return;
    const ready =
      this.d.haunting() >= 12 && this.sinceEvent >= 5 && this.objDistance('phone') <= 26 && !this.active;
    if (!ready) {
      // 条件が揃っていないだけ。すぐ見直す
      this.phoneTimer = 3;
      return;
    }
    this.phoneTimer = randRange(45, 80);
    // 鳴り続けはしない。鳴っている間だけが機会（§34, §82）
    this.phoneRingLeft = randRange(CONFIG.floor1.phoneRing.min, CONFIG.floor1.phoneRing.max);
    this.objects.setState('phone', 'ringing');
    this.markPhoneEvent();
    this.d.sfxPhone(this.objDistance('phone'));
    this.d.addLikes(80);
    this.d.footage('THE PHONE IS RINGING   +80 Likes', 2.4);
    this.d.chat('anomaly', 3);
    this.markEvent('anomaly');
    this.d.log('subject_state_changed', 'subject=phone old=idle new=ringing');
  }


  /** HorrorDirector へ渡す文脈 */
  private horrorContext() {
    const dists: Record<string, number> = {};
    const rooms: Record<string, string> = {};
    for (const o of FLOOR1_OBJECTS) {
      dists[o.id] = this.objDistance(o.id);
      rooms[o.id] = o.room;
    }
    dists.ghost = this.objDistance('ghost');
    rooms.ghost = 'ldk';
    const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
    return {
      haunted: this.d.haunting(),
      danger: this.d.danger(),
      room: this.room(),
      phase: this.phase(),
      chaseActive: this.d.ghostChasing(),
      ghostState: this.ghost,
      ghostDistance: dists.ghost,
      ghostOnScreen: this.d.isVisible(g.x, g.z, 1.3),
      objectDistances: dists,
      objectStates: this.objects.states(),
      objectRoom: rooms,
      memories: this.memory.all(),
      memoryAge: this.memory.ages(),
      focusObject: this.focusObject(),
      focusCenter: this.focusCenter(),
      activeRequestId: this.active?.def.id ?? null,
      activeRequestType: this.active?.def.type ?? null,
      lastRiskTier: this.lastRiskTier,
      discoveries: this.discoveries,
      goalReached: this.goal,
      returning: this.returningTime > 1.5 && this.d.distanceToEntrance() < 14,
      finalTemptationTaken: this.finalTaken,
    };
  }

  private phase(): RunPhase {
    if (this.d.ghostChasing()) return 'CHASE';
    if (this.returningTime > 1.5 && this.d.distanceToEntrance() < 14) return 'RETURNING';
    if (this.goal) return 'OVERTIME';
    if (this.elapsed < 35) return 'INTRO';
    if (this.completed > 0 || this.lastObject) return 'ENGAGEMENT';
    return 'EXPLORATION';
  }

  /** 今カメラを向けている対象 */
  private focusObject(): string | null {
    let best: string | null = null;
    let bestC = 0.25;
    for (const o of FLOOR1_OBJECTS) {
      const c = this.d.centerOf(o.x, o.z, o.height);
      if (c > bestC) {
        bestC = c;
        best = o.id;
      }
    }
    const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
    if (this.d.centerOf(g.x, g.z, 1.3) > bestC) return 'ghost';
    return best;
  }

  /** 今見ている対象がどれくらい画面中央にあるか 0..1 */
  private focusCenter(): number {
    const id = this.focusObject();
    if (!id) return 0;
    if (id === 'ghost') {
      const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
      return this.d.centerOf(g.x, g.z, 1.3);
    }
    const o = FLOOR1_OBJECTS.find((x) => x.id === id);
    return o ? this.d.centerOf(o.x, o.z, o.height) : 0;
  }

  /** UIへ渡す */
  view(): RequestView | null {
    // §48-49。UI に出た瞬間を記録する。request_offered から 250ms 以内に来ること。
    if (this.active && !this.active.uiShown) {
      this.active.uiShown = true;
      this.requestUiShown += 1;
      this.d.log(
        'request_ui_visible',
        `id=${this.active.def.id} delay=${((this.elapsed - this.active.offeredAt) * 1000).toFixed(0)}ms`,
      );
    }
    const a = this.active;
    if (!a) return null;
    const def = a.def;
    let reward = def.reward;
    let nextTitle: string | null = null;
    let nextReward = 0;
    if (def.type === 'hold' && def.holdTiers) {
      reward = a.earned;
      const nt = def.holdTiers[a.tier];
      if (nt) {
        nextTitle = nt.label;
        nextReward = nt.reward;
      }
    }
    const risk: RequestView['risk'] =
      def.riskTier >= 5 ? 'extreme' : def.riskTier >= 4 ? 'high' : def.riskTier >= 2 ? 'medium' : 'low';
    return {
      id: this.offered,
      title: def.label,
      description: def.desc,
      reward,
      timeLeft: a.timeLeft,
      progress: a.progress,
      temptation: !!def.lastTemptation,
      risk,
      stage: 1,
      options: [],
      nextTitle,
      nextReward,
      engaged: a.engaged,
      constraint: def.type === 'constraint' || def.type === 'target_constraint',
      constraintLeft: Math.max(0, (def.constraintSeconds ?? 0) - a.held),
      ...this.progressView(a),
    };
  }

  /**
   * 進捗の単一情報源（§51）。UI はここを表示するだけで、自分では何も計算しない。
   */
  private progressView(a: ActiveRequest) {
    const def = a.def;
    const kind: RequestView['kind'] =
      def.type === 'target_constraint'
        ? 'target_constraint'
        : def.type === 'constraint'
          ? 'constraint'
          : def.type === 'hold'
            ? 'hold'
            : 'action';

    const required =
      def.type === 'hold'
        ? (def.holdTiers?.[a.tier]?.at ?? def.holdTiers?.[def.holdTiers.length - 1]?.at ?? 0)
        : (def.constraintSeconds ?? 0);
    const seconds = def.type === 'hold' ? a.hold : a.held;

    // 何が進行を止めているのか。0% のまま黙らない（§33, §43）
    let failureReason: string | null = null;
    let progressState = 'offered' as RequestView['progressState'];
    if (a.state === 'completed') progressState = 'completed';
    else if (seconds > 0.05) progressState = 'progress';
    else if (a.actionUnlocked || def.type === 'constraint' || def.type === 'target_constraint') {
      progressState = 'ready';
    }
    if (progressState === 'progress' && !this.progressing) {
      progressState = 'paused' as RequestView['progressState'];
    }

    if (progressState === 'paused') failureReason = this.blockReason(a) ?? 'PROGRESS PAUSED';
    else if (progressState !== 'completed' && progressState !== 'progress') {
      failureReason = this.blockReason(a);
    }

    return {
      kind,
      progressState,
      progressSeconds: Math.round(seconds * 10) / 10,
      requiredSeconds: Math.round(required * 10) / 10,
      failureReason,
      targetName: def.targetName ?? null,
      // 対象追跡は target_constraint だけの概念。他で誤解を招く表示をしない
      targetLocked: def.type === 'target_constraint' ? this.targetLocked : false,
      earned: a.earned,
      inputHint:
        def.type === 'hold'
          ? a.actionUnlocked
            ? '[HOLD E]'
            : null
          : def.type === 'action'
            ? a.actionUnlocked
              ? `[E] ${ACTION_VERB[def.id] ?? def.label}`
              : null
            : null,
    };
  }

  /** 対象を捉えているかを更新し、変化したときだけログする（§54） */
  private setTargetLock(locked: boolean, tooFar: boolean) {
    this.targetTooFar = tooFar;
    if (locked === this.targetLocked) return;
    this.targetLocked = locked;
    const a = this.active;
    this.d.log(
      locked ? (this.targetEverLocked ? 'target_reacquired' : 'target_in_frame') : 'target_lost',
      `request=${a?.def.id ?? '-'} target=${a?.def.targetName ?? '-'} distance=${this.objDistance('ghost').toFixed(1)}`,
    );
    if (locked) this.targetEverLocked = true;
  }

  private logProgress(a: ActiveRequest, event: string) {
    this.d.log(
      event,
      `id=${a.def.id} type=${a.def.type} seconds=${(a.def.type === 'hold' ? a.hold : a.held).toFixed(1)}`,
    );
  }

  /** 毎フレーム書かない。25%刻みだけ（§53） */
  private logProgressStep(a: ActiveRequest, progress: number) {
    const step = Math.floor(progress * 4);
    if (step <= a.loggedStep) return;
    a.loggedStep = step;
    this.d.log('request_progress_updated', `id=${a.def.id} progress=${step * 25}%`);
  }

  /** なぜ進んでいないのか。プレイヤーに見せる文言 */
  private blockReason(a: ActiveRequest): string | null {
    const def = a.def;
    if (def.type === 'target_constraint') {
      if (!this.targetLocked) return this.targetTooFar ? 'TOO FAR' : 'TARGET NOT IN FRAME';
      return null;
    }
    if (def.type === 'constraint') return null;
    if (!def.object) return null;
    if (!a.actionUnlocked) {
      const d = this.objDistance(def.object);
      const range = def.maxDistance ?? CONFIG.floor1.interactRange;
      return d > range ? 'MOVE CLOSER' : null;
    }
    if (def.type === 'hold') return 'HOLD E';
    return null;
  }

  /**
   * §35。Last Temptation は通常の Run では到達を待つしかなく検証できないので、
   * 強制的にそこまで持っていくデバッグ操作を用意する。
   *
   *   const f1 = game.dev.floor1();
   *   f1.forceGoal(); f1.forceReturning(); f1.forceLastTemptation(); f1.forceTake();
   */
  forceGoal() {
    this.goal = true;
    this.d.log('debug_force', 'FORCE_STREAM_GOAL');
  }

  forceReturning() {
    this.returningTime = 99;
    this.d.log('debug_force', 'FORCE_RETURNING');
  }

  /** Last Temptation を今すぐ提示する。返り値は提示できたか */
  forceLastTemptation() {
    const def = FLOOR1_POOL.find((d) => d.lastTemptation);
    if (!def) return false;
    if (this.active) this.endRequest('dismissed');
    this.forceGoal();
    this.forceReturning();
    this.offer(def);
    this.d.log('debug_force', `FORCE_LAST_TEMPTATION id=${def.id}`);
    return true;
  }

  /**
   * 重要な Greed を実ゲーム上で起こす（§78 の C/D/E を実プレイで確かめるため）。
   * ボットは風呂の2口目や至近距離セルフィーまで自然には到達しにくい。
   */
  forceGreed(kind: 'bath_sip_2' | 'altar_overplayed' | 'phone_listened_long' | 'ghost_close_selfie') {
    if (kind === 'bath_sip_2') {
      this.bathSips = 2;
      this.memory.remember('bath_sip_1');
      this.memory.remember('bath_sip_2');
      this.memory.remember('bath_overdone');
    } else if (kind === 'ghost_close_selfie') {
      this.memory.remember('ghost_selfie_taken');
      this.memory.remember('ghost_close_selfie');
    } else {
      this.memory.remember(kind);
    }
    this.horror.addIntent(kind);
    this.horror.markGreed(4);
    this.d.log('debug_force', `FORCE_GREED ${kind}`);
  }

  /**
   * 仏間への導線（Task B §48-51）。
   *
   * これは Request ではない。UI 誘導でもマーカーでもない。
   * 「入ってすぐ左に何かある」に気づく機会を、コメント欄で薄く作るだけ。
   * 毎 Run 同じ台詞にはしないし、100% では出さない。
   */
  private maybeGuideToButsuma(dt: number) {
    if (this.butsumaSeen) return;
    if (this.objects.get('altar')?.discovered) {
      this.butsumaSeen = true;
      return;
    }
    const room = this.room();
    if (room !== 'entrance' && room !== 'hallway') return;
    // 仏間の入口（x -2.5, z 19〜22）の近くにいるか
    const p = this.d.playerPos();
    const near = Math.hypot(p.x + 2.5, p.z - 20.5) < 12;
    if (!near) return;
    this.guideTimer -= dt;
    if (this.guideTimer > 0) return;
    this.guideTimer = randRange(14, 26);
    if (Math.random() > CONFIG.floor1.guidanceChance) return;
    this.guideShown += 1;
    if (this.guideShown > 2) {
      this.butsumaSeen = true;
      return;
    }
    this.d.chatLine(pick(BUTSUMA_HINTS));
    this.d.log('guidance_comment', `target=butsuma count=${this.guideShown}`);
  }

  /** テスト用。電話を実際の経路と同じように鳴らす */
  debugRingPhone(seconds = 20) {
    this.objects.get('phone')!.discovered = true;
    this.objects.setState('phone', 'ringing');
    this.phoneRingLeft = seconds;
    this.phoneTimer = 999;
    this.markPhoneEvent();
  }

  /** テスト用。鳴り止ませる */
  debugStopPhone() {
    this.objects.setState('phone', 'idle');
    this.phoneRingLeft = 0;
    this.butsumaSeen = false;
    this.guideTimer = 8;
    this.guideShown = 0;
    this.phoneTimer = 999;
  }

  /** UI 確認とテスト用。指定のリクエストをその場で提示する */
  debugOffer(id: string) {
    const def = FLOOR1_POOL.find((x) => x.id === id);
    if (!def) return false;
    if (this.active) this.endRequest('dismissed');
    this.pendingDef = null;
    this.offer(def);
    return true;
  }

  /** 提示中のリクエストを即完了させる（Last Temptation を「乗った」ことにする） */
  forceTake() {
    const a = this.active;
    if (!a) return false;
    this.finish(a, a.def.reward);
    this.endRequest('done');
    return true;
  }

  /**
   * 未解決の返事を、その場で返す（§37）。
   * Run 終了の直前に呼ぶ。プレイヤーを足止めするより、出際に一発返す方が自然。
   */
  flushPendingConsequence() {
    const def = this.horror.forceResolvePending();
    if (def) this.runHorror(def);
  }

  /**
   * 唯一の公開 Request 状態（§6, §8, §9）。
   * ログ行も UI も Debug HUD もこれを使う。別に bool を持たない。
   */
  requestRuntime() {
    const a = this.active;
    const live = !!a && (a.state === 'offered' || a.state === 'active');
    return {
      active: live ? 1 : (0 as 0 | 1),
      id: live ? a!.def.id : '',
      type: live ? a!.def.type : '',
      reward: live ? a!.def.reward : 0,
      temptation: live && a!.def.lastTemptation ? 1 : (0 as 0 | 1),
      state: a ? a.state : 'none',
      relatedObject: live ? a!.def.object ?? '' : '',
      actionUnlocked: live ? a!.actionUnlocked : false,
    };
  }

  /** デバッグ表示 */
  debug() {
    const rr = this.requestRuntime();
    return {
      room: this.room(),
      request: `${rr.state} ${rr.id || '-'} active=${rr.active} type=${rr.type || '-'} ¥${rr.reward} unlocked=${rr.actionUnlocked}`,
      requestCounts: `object ${this.objectRequestsOffered} / situation ${this.situationRequestsOffered} / need ${this.objectRequestNeed().toFixed(2)}`,
      candidate: this.pendingDef
        ? `${this.pendingDef.id} age=${this.pendingAge.toFixed(1)}s in=${this.pendingDelay.toFixed(1)}s`
        : '-',
      invalidActions: this.invalidSpecialActions,
      ghost: this.ghost,
      goal: this.goal,
      director: this.active ? 'ACTIVE' : this.pendingDef ? 'PENDING' : this.quiet > 0 ? 'QUIET' : 'IDLE',
      candidates: this.director.lastCandidates.map((c) => `${c.def.id} ${c.score.toFixed(0)}`),
      rejected: this.director.lastRejections.slice(0, 6).map((r) => `${r.id}:${r.reason}`),
      memory: [...this.memory.all()],
      horror: this.horror.debug(),
    };
  }

  kpi() {
    const holds = this.holdDurations;
    const median = (xs: number[]) => {
      if (!xs.length) return 0;
      const a = [...xs].sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)];
    };
    const byId = (id: string) => holds.filter((h) => h.id.startsWith(id));
    const altar = byId('altar');
    const phone = byId('phone');
    return {
      discoveries: this.discoveries,
      offered: this.offered,
      completed: this.completed,
      dismissed: this.dismissed,
      ignored: this.ignored,
      uniqueRequests: this.uniqueRequests.size,
      repeatedRequests: this.repeatedRequests,
      bathSips: this.bathSips,
      ghostSelfies: this.ghostSelfies,
      voluntaryContinuations: this.voluntaryContinuations,
      medianAltarHold: median(altar.map((h) => h.seconds)),
      altarTier2: altar.filter((h) => h.tier >= 2).length,
      medianPhoneHold: median(phone.map((h) => h.seconds)),
      phoneTier2: phone.filter((h) => h.tier >= 2).length,
      goal: this.goal,
      funnel: {
        checked: this.funnel.checked,
        eligible: this.funnel.eligible,
        scored: this.funnel.scored,
        positive: this.funnel.positive,
        warmup: this.funnel.warmup,
        cancelled: this.funnel.cancelled,
        offered: this.funnel.offered,
        rejections: [...this.funnel.rejections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        eligibleBy: [...this.funnel.eligibleBy.entries()].sort((a, b) => b[1] - a[1]),
        avgCandidates: this.funnel.candidateCounts.length
          ? Math.round(
              (this.funnel.candidateCounts.reduce((a, b) => a + b, 0) /
                this.funnel.candidateCounts.length) * 10,
            ) / 10
          : 0,
        minCandidates: this.funnel.candidateCounts.length ? Math.min(...this.funnel.candidateCounts) : 0,
        maxCandidates: this.funnel.candidateCounts.length ? Math.max(...this.funnel.candidateCounts) : 0,
      },
      opportunities: { ...this.opportunities },
      coreOpportunities: { ...this.opportunityCounts },
      coreMisses: this.coreMisses,
      coreMissReasons: { ...this.coreMissReasons },
      sessions: { ...this.sessionStats },
      reengagementRate: this.sessionStats.softLost
        ? Math.round((this.sessionStats.resumed / this.sessionStats.softLost) * 100)
        : -1,
      /** Director の成績は Run 数ではなく「機会が何回成立したか」を分母にする（§44-48） */
      coreOfferRates: {
        altar: this.opportunityCounts.altar
          ? Math.round((this.offeredHistory.filter((x) => x.startsWith('altar_')).length ? 1 : 0) * 100)
          : -1,
        bath: this.opportunityCounts.bath
          ? Math.round((this.offeredHistory.some((x) => x.startsWith('bath_')) ? 1 : 0) * 100)
          : -1,
        phone: this.opportunityCounts.phone
          ? Math.round((this.offeredHistory.some((x) => x.startsWith('phone_')) ? 1 : 0) * 100)
          : -1,
        ghost: this.opportunityCounts.ghost
          ? Math.round((this.offeredHistory.some((x) => x.startsWith('ghost_')) ? 1 : 0) * 100)
          : -1,
      },
      /** Level Design 側の指標。Director とは分けて見る（§46-47） */
      visits: { ...this.roomVisits },
      offerTimes: [...this.offerTimes],
      objectRequestsOffered: this.objectRequestsOffered,
      situationRequestsOffered: this.situationRequestsOffered,
      invalidSpecialActions: this.invalidSpecialActions,
      requestUiShown: this.requestUiShown,
      inspected: [...this.inspectedObjects],
      lastTemptation: this.lastTemptationDone,
      memory: [...this.memory.all()],
      horror: this.horror.kpi(this.elapsed),
    };
  }
}
