import { CONFIG } from '../config';
import {
  INTENT_SPECS,
  createIntent,
  urgency,
  type ConsequenceIntent,
} from './consequenceIntent';

/**
 * HorrorDirector。
 *
 * 仕事は「怖いイベントを出すこと」ではない。
 * **「今は何か起こすべきか、それとも何も起こさないべきか。
 *   起こすなら、今の状況に最も自然な恐怖は何か」を判断すること。**
 *
 * したがって NOTHING は正式な候補として同じ土俵でスコアを競う。
 * 常時100%怖い状態にはせず、緊張には必ず波を作る。
 *
 * RequestDirector とは責務を分ける。
 *   RequestDirector : 今プレイヤーに何をやらせたら誘惑として面白いか
 *   HorrorDirector  : 今、世界側が何を返したら怖い／自然か
 * こちらは Viewer Request を作らないし、Ghost の経路も決めない
 * （Ghost へは「立て」「覗け」といった行動要求だけを出す）。
 */

export type HorrorFamily =
  | 'SILENCE'
  | 'AUDIO'
  | 'LIGHT'
  | 'OBJECT'
  | 'PHONE'
  | 'MIRROR'
  | 'PORTRAIT'
  | 'GHOST_VISUAL'
  | 'GHOST_SPATIAL'
  | 'FAKE_THREAT'
  | 'CHASE'
  // 低 Haunted 用の「気のせいかもしれない」語彙
  | 'AMBIENT_HOUSE'
  | 'AMBIENT_WATER'
  | 'AMBIENT_ELECTRIC'
  | 'AMBIENT_OBJECT'
  | 'AMBIENT_LIVING';

/** 音の出どころ。全部を背後から出すとすぐ読まれる */
export type SoundSource = 'ahead' | 'side' | 'behind' | 'same_room' | 'distant_room';

export type HorrorIntensity = 'subtle' | 'minor' | 'medium' | 'strong' | 'climax';

/**
 * プレイヤーに対する実際の危険度。Intensity（演出の強さ）とは別軸。
 *
 * v1.1 までは「強い演出 = 高 Haunted = 高危険」が暗黙の前提になっていて、
 * 安全に遊ぶプレイヤーには山が一度も来なかった。ここを分ける。
 */
export type HorrorThreat = 'safe' | 'low' | 'medium' | 'high' | 'lethal';

export type RunPhase =
  | 'INTRO'
  | 'EXPLORATION'
  | 'ENGAGEMENT'
  | 'OVERTIME'
  | 'RETURNING'
  | 'CHASE';

/** Ghost へ出す行動要求。どう動くかは Ghost 側の担当 */
export type GhostAction = 'STAND' | 'PEEK' | 'REPOSITION' | 'CROSS' | 'FAKE_RUSH' | 'CHASE';

export interface HorrorEventDef {
  id: string;
  family: HorrorFamily;
  intensity: HorrorIntensity;
  /** 危険度。省略時は intensity から推測せず 'low' 扱い */
  threat?: HorrorThreat;
  baseWeight: number;

  minHaunted?: number;
  maxHaunted?: number;
  /** この緊張帯にいるとき最も自然 */
  preferredTension?: [number, number];
  allowedPhases?: RunPhase[];
  allowedRooms?: string[];
  forbiddenRooms?: string[];

  /** 関連するオブジェクト。距離とWorld Memoryの判定に使う */
  relatedObject?: string;
  requiredObjectState?: string;
  forbiddenObjectState?: string;

  requiredMemories?: string[];
  forbiddenMemories?: string[];

  requiredGhostState?: string[];
  requiresGhostOffscreen?: boolean;
  requiresGhostOnscreen?: boolean;

  minPlayerDistance?: number;
  maxPlayerDistance?: number;

  cooldown: number;
  familyCooldown?: number;
  oncePerRun?: boolean;
  maxPerRun?: number;
  repeatPenalty?: number;

  /** 発火までの溜め */
  anticipationDelay?: [number, number];
  /** Ghost へ出す行動要求 */
  ghostAction?: GhostAction;
  /**
   * この出来事が「まだ解決していない」状態として何秒残るか。
   * 音そのものは1秒でも「さっきの足音なんだった？」は10秒続く。省略時は intensity から。
   */
  unresolvedFor?: number;
  /** 音の出どころ候補。毎回同じ方向から鳴らさない */
  sources?: SoundSource[];
  /** 同じイベントでも聞こえ方を変えるための variant 数 */
  variants?: number;
  tags?: string[];
}

/** 最後の誘惑など、必ず返事をしなければならない予約 */
export interface PendingConsequence {
  source: string;
  required: boolean;
  earliest: number;
  latest: number;
  /** この tag を持つイベントを優先する */
  contextTags: string[];
  relatedObject?: string;
}

export interface HorrorContext {
  haunted: number;
  danger: number;
  room: string;
  phase: RunPhase;
  chaseActive: boolean;

  ghostState: string;
  ghostDistance: number;
  ghostOnScreen: boolean;

  /** id → プレイヤーからの距離 */
  objectDistances: Record<string, number>;
  objectStates: Record<string, string>;
  /** id → その部屋にいるか（離れた場所で鳴る方が怖い） */
  objectRoom: Record<string, string>;

  memories: Set<string>;
  /** memory → 記録されてからの秒数 */
  memoryAge: Record<string, number>;

  /** 今カメラを向けている対象 */
  focusObject: string | null;
  /** 進行中のリクエスト */
  activeRequestId: string | null;
  activeRequestType: string | null;
  /** 直前に達成したリクエストの Risk Tier */
  lastRiskTier: number;

  goalReached: boolean;
  returning: boolean;
  finalTemptationTaken: boolean;
}

export interface Candidate {
  def: HorrorEventDef;
  score: number;
  tags: string[];
}

export interface Rejection {
  id: string;
  reason: string;
}

/** 何も起こさない、も正式なイベント */
export const NOTHING: HorrorEventDef = {
  id: 'Nothing',
  family: 'SILENCE',
  intensity: 'subtle',
  baseWeight: 40,
  cooldown: 0,
};

const GHOST_FAMILIES = new Set<HorrorFamily>(['GHOST_VISUAL', 'GHOST_SPATIAL', 'FAKE_THREAT', 'CHASE']);

const THREAT_RANK: Record<HorrorThreat, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  lethal: 4,
};

const INTENSITY_RANK: Record<HorrorIntensity, number> = {
  subtle: 0,
  minor: 1,
  medium: 2,
  strong: 3,
  climax: 4,
};

/** イベントごとの Pressure 加算。Ghost系にはさらに上乗せする */
const PRESSURE_GAIN: Record<HorrorIntensity, number> = {
  subtle: 5,
  minor: 7,
  medium: 11,
  strong: 16,
  climax: 22,
};

/**
 * 出来事が残す「未解決の何かがいる」の強さと、その持続時間。
 *
 * v1.1 までは Tension = イベントで +20 して毎秒減衰、だった。
 * これは緊張ではなく RecentShock で、Run の 75〜100% が T<20 になっていた。
 * ここでは出来事そのものではなく、出来事が残す状態を持つ。
 */
const UNRESOLVED: Record<HorrorIntensity, { amount: number; seconds: number }> = {
  subtle: { amount: 6, seconds: 9 },
  minor: { amount: 12, seconds: 14 },
  medium: { amount: 20, seconds: 20 },
  strong: { amount: 30, seconds: 28 },
  climax: { amount: 45, seconds: 34 },
};

/** 出来事の直後だけ乗る余韻。数秒〜十数秒で消える */
const RESIDUE: Record<HorrorIntensity, number> = {
  subtle: 4,
  minor: 8,
  medium: 14,
  strong: 22,
  climax: 34,
};

const PHASE_BASELINE: Record<RunPhase, number> = {
  INTRO: 10,
  EXPLORATION: 15,
  ENGAGEMENT: 25,
  OVERTIME: 35,
  RETURNING: 40,
  CHASE: 85,
};

const GHOST_AWARENESS: Record<string, number> = {
  seated: 0,
  aware: 8,
  standing: 15,
  stalking: 25,
  chasing: 50,
};

export class HorrorDirector {
  /**
   * 実際の緊張度 0..100。DesiredTension へゆっくり追従する。
   * 上がるのは比較的速く、下がるのは遅い（安全になっても余韻が残る）。
   */
  tension = 0;
  /** 状況から計算した「本来こうあるべき」緊張度 */
  desired = 0;
  /** DesiredTension の内訳（デバッグ表示用） */
  lastComponents: Record<string, number> = {};
  /** まだ解決していない出来事 */
  private unresolved: Array<{ amount: number; until: number; source: string }> = [];
  /** 危険な行動をした直後の、結果待ち */
  private anticipationTension = 0;
  /** 強い出来事の直後の余韻 */
  private residue = 0;
  elapsed = 0;

  private sinceHorror = 999;
  private sinceStrong = 999;
  /** 最後に「印象的な山」が起きてからの秒数 */
  private sincePeak = 0;
  peaks: Array<{ id: string; threat: HorrorThreat; at: number }> = [];
  private sinceMeaningful = 0;
  /** 大きな出来事のあとの「間」 */
  private relief = 0;
  /** 危険な行動の直後、無関係なイベントを抑える窓 */
  private anticipation = 0;
  /** 予約された発火 */
  private pending: { def: HorrorEventDef; delay: number } | null = null;
  private evalTimer = 0;

  private lastAt = new Map<string, number>();
  private familyAt = new Map<string, number>();
  private counts = new Map<string, number>();
  private recentIds: string[] = [];
  private recentFamilies: HorrorFamily[] = [];
  /** 直近20秒のStrong以上の数 */
  private strongTimes: number[] = [];
  /**
   * Director 自身の出力密度。Tension（プレイヤーの緊張推定）とは別物。
   * 「最近どれだけ刺激を投下したか」を監視して、出せるからといって出し続けないようにする。
   */
  pressure = 0;
  /** 発火時刻。Ghost系と Family の短期予算に使う */
  private ghostTimes: number[] = [];
  private familyTimes = new Map<HorrorFamily, number[]>();
  /** 必ず返事をしなければならない予約 */
  pending2: PendingConsequence | null = null;
  private pendingResolved = 0;
  private pendingFailed = 0;
  private pendingLatency: number[] = [];
  private pendingCreatedAt = 0;
  /** 0件が目標。出たら理由を必ず残す */
  pendingFailReasons: Array<{ source: string; elapsed: number; rejections: string[] }> = [];
  pendingLog: Array<{ at: number; kind: string; detail: string }> = [];

  /** 未回収の因果。World Memory とは別で、Director が返事をしたいもの */
  intents: ConsequenceIntent[] = [];
  intentLog: Array<{ at: number; kind: string; detail: string }> = [];
  intentCreated = 0;
  intentResolved = 0;
  intentExpired = 0;
  private intentLatency: number[] = [];
  /** 未回収が溜まっているぶんの緊張 */
  get intentPressure() {
    const live = this.intents.filter((i) => !i.resolved && this.elapsed >= i.earliest);
    if (!live.length) return 0;
    return Math.min(
      CONFIG.horror.envelope.intentCap,
      live.reduce((a, i) => a + urgency(i, this.elapsed) * CONFIG.horror.envelope.intentWeight, 0),
    );
  }
  /** 直近の評価で Nothing 以外の候補が何件あったか */
  private scarcity = 9;
  private lastCtx: HorrorContext | null = null;
  /** 期限切れ間際の Intent が指定した強制発火 */
  private forced: HorrorEventDef | null = null;
  /** 直前に実際に鳴らしたイベントの強さ */
  private lastFiredRank = -1;
  lastCandidates: Candidate[] = [];
  /** 上位だけでなく全候補。テストと詳細ログ用 */
  lastAllCandidates: Candidate[] = [];
  lastRejections: Rejection[] = [];
  lastSelected = '';

  // --- KPI ---
  fired: Array<{ id: string; family: HorrorFamily; intensity: HorrorIntensity; at: number; memory?: string }> = [];
  silenceChosen = 0;
  evaluations = 0;
  ambientFired: string[] = [];
  pressureLog: Array<{ at: number; before: number; after: number; source: string }> = [];
  private pressureSum = 0;
  private pressureSamples = 0;
  private pressureMax = 0;
  private pressureHighTime = 0;
  private tensionHighTime = 0;
  private tensionLowTime = 0;
  /** <20 / 20-40 / 40-70 / 70-85 / 85+ の滞在時間 */
  private bandTime = [0, 0, 0, 0, 0];
  /** 30秒ごとの Tension。推移をそのまま報告できるようにする */
  trace: Array<{ at: number; desired: number; actual: number }> = [];
  private traceTimer = 0;

  constructor(private pool: HorrorEventDef[]) {}

  reset() {
    this.tension = 0;
    this.desired = 0;
    this.unresolved = [];
    this.anticipationTension = 0;
    this.residue = 0;
    this.elapsed = 0;
    this.sinceHorror = 999;
    this.sinceStrong = 999;
    this.sincePeak = 0;
    this.peaks = [];
    this.sinceMeaningful = 0;
    this.relief = 0;
    this.anticipation = 0;
    this.pending = null;
    this.evalTimer = 0;
    this.lastAt.clear();
    this.familyAt.clear();
    this.counts.clear();
    this.recentIds = [];
    this.recentFamilies = [];
    this.strongTimes = [];
    this.pressure = 0;
    this.ghostTimes = [];
    this.familyTimes.clear();
    this.pending2 = null;
    this.pendingResolved = 0;
    this.pendingFailed = 0;
    this.pendingLatency = [];
    this.pendingCreatedAt = 0;
    this.pendingFailReasons = [];
    this.pendingLog = [];
    this.intents = [];
    this.intentLog = [];
    this.intentCreated = 0;
    this.intentResolved = 0;
    this.intentExpired = 0;
    this.intentLatency = [];
    this.lastResolvedBy = null;
    this.pressureSum = 0;
    this.pressureSamples = 0;
    this.pressureMax = 0;
    this.pressureHighTime = 0;
    this.scarcity = 9;
    this.lastFiredRank = -1;
    this.ambientFired = [];
    this.pressureLog = [];
    this.lastCandidates = [];
    this.lastAllCandidates = [];
    this.lastRejections = [];
    this.lastSelected = '';
    this.fired = [];
    this.silenceChosen = 0;
    this.evaluations = 0;
    this.tensionHighTime = 0;
    this.tensionLowTime = 0;
    this.bandTime = [0, 0, 0, 0, 0];
    this.trace = [];
    this.traceTimer = 0;
  }

  /** 意味のある出来事があった（発見・リクエスト・異変・幽霊の反応） */
  markMeaningful() {
    this.sinceMeaningful = 0;
  }

  /** プレイヤーが自分から危険な行動をした。少し緊張を上げ、無関係なイベントを抑える */
  markGreed(riskTier: number) {
    const cfg = CONFIG.horror;
    // 「+20して減衰」ではなく「結果待ちの状態」を作る。何か返ってくるまで落ち着かない
    this.anticipationTension = Math.max(
      this.anticipationTension,
      cfg.greedTension[riskTier - 1] ?? 3,
    );
    this.anticipation = rand(cfg.anticipation.min, cfg.anticipation.max);
    this.sinceMeaningful = 0;
  }

  /** まだ説明のついていない出来事を積む */
  private addUnresolved(source: string, amount: number, seconds: number) {
    this.unresolved.push({ amount, until: this.elapsed + seconds, source });
  }

  /** DesiredTension の内訳。デバッグにそのまま出す */
  tensionComponents(ctx: HorrorContext) {
    const cfg = CONFIG.horror.envelope;
    this.unresolved = this.unresolved.filter((u) => u.until > this.elapsed);
    // 未解決が重なっても青天井にしない。一番強いものを主、残りを従とする
    const sorted = [...this.unresolved].sort((a, b) => b.amount - a.amount);
    let threat = 0;
    sorted.forEach((u, i) => {
      // 時間が経つほど薄れる
      const life = Math.max(0, u.until - this.elapsed);
      const fade = Math.min(1, life / 6);
      threat += u.amount * fade * (i === 0 ? 1 : cfg.stackFalloff ** i);
    });
    const constraint =
      ctx.activeRequestType === 'constraint'
        ? cfg.constraint
        : ctx.activeRequestType === 'hold'
          ? cfg.hold
          : 0;
    return {
      phase: PHASE_BASELINE[ctx.phase] ?? 15,
      unresolvedThreat: Math.min(cfg.unresolvedCap, threat),
      anticipation: this.anticipationTension,
      ghostAwareness: GHOST_AWARENESS[ctx.ghostState] ?? 0,
      constraint,
      pending: this.pending2?.required ? cfg.pendingRequired : this.intentPressure,
      residue: this.residue,
    };
  }

  /**
   * 最後の誘惑に自分から乗った。**必ず意味のある返事を返す。**
   * スコア加点だけでは保証にならないので、予約として持つ。
   */
  /**
   * 重要な Greed に対して「あとで返事をしたい」を作る（§30-34）。
   * 即イベントではない。風呂を出て、別の部屋へ移って、緊張が落ちた頃に返す。
   */
  addIntent(source: string, contextTags?: string[]) {
    const spec = INTENT_SPECS[source];
    if (!spec) return;
    if (this.intents.some((i) => i.source === source && !i.resolved)) return;
    const intent = createIntent(source, this.elapsed, spec);
    if (contextTags) intent.contextTags = contextTags;
    this.intents.push(intent);
    this.intentCreated += 1;
    this.intentLog.push({
      at: Math.round(this.elapsed * 10) / 10,
      kind: 'consequence_intent_created',
      detail:
        `source=${source} required=${intent.required} earliest=${spec.earliest} ` +
        `preferred=${spec.preferred[0]}-${spec.preferred[1]} latest=${spec.latest}`,
    });
  }

  /** その Intent が今この候補にどれだけ乗るか。乗らないなら 0 */
  private intentBonus(def: HorrorEventDef, ctx: HorrorContext, tags: string[]) {
    let best = 0;
    for (const i of this.intents) {
      if (i.resolved || i.required) continue;
      if (this.elapsed < i.earliest) continue;
      if (!i.candidates.includes(def.id)) continue;
      const u = urgency(i, this.elapsed);
      let b = u * CONFIG.horror.intent.urgencyWeight;
      // 現場から離れた場所で返す方が「まだ続いている」感が出る（§50）
      if (i.sourceObject) {
        const room = ctx.objectRoom[i.sourceObject];
        const dist = ctx.objectDistances[i.sourceObject] ?? 0;
        if (room && room !== ctx.room) b += CONFIG.horror.intent.otherRoom;
        else if (dist > 12) b += CONFIG.horror.intent.farInRoom;
      }
      if (ctx.phase === 'RETURNING') b += CONFIG.horror.intent.returning;
      if (b > best) {
        best = b;
        tags.push(`intent:${i.source}+${b.toFixed(0)}`);
      }
    }
    return best;
  }

  /** 発火したイベントが、どれかの Intent への返事になっていたら回収する */
  private consumeIntent(def: HorrorEventDef) {
    for (const i of this.intents) {
      if (i.resolved || i.required) continue;
      if (this.elapsed < i.earliest) continue;
      if (!i.candidates.includes(def.id)) continue;
      i.resolved = true;
      this.intentResolved += 1;
      const latency = this.elapsed - i.createdAt;
      this.intentLatency.push(latency);
      this.intentLog.push({
        at: Math.round(this.elapsed * 10) / 10,
        kind: 'consequence_intent_resolved',
        detail: `source=${i.source} event=${def.id} latency=${latency.toFixed(1)}s`,
      });
      return;
    }
  }

  requireConsequence(source: string, contextTags: string[], relatedObject?: string) {
    const cfg = CONFIG.horror.pendingConsequence;
    this.pending2 = {
      source,
      required: true,
      earliest: this.elapsed + cfg.earliest,
      latest: this.elapsed + cfg.latest,
      contextTags,
      relatedObject,
    };
    this.pendingCreatedAt = this.elapsed;
    this.pendingLog.push({
      at: Math.round(this.elapsed * 10) / 10,
      kind: 'pending_consequence_created',
      detail: source + ' earliest=' + cfg.earliest + ' latest=' + cfg.latest,
    });
  }

  /** 直近の Required Consequence を解決したイベント */
  lastResolvedBy: { id: string; intensity: HorrorIntensity; latency: number } | null = null;

  private resolvePending(def: HorrorEventDef) {
    if (!this.pending2) return;
    this.lastResolvedBy = {
      id: def.id,
      intensity: def.intensity,
      latency: Math.round((this.elapsed - this.pendingCreatedAt) * 10) / 10,
    };
    const latency = this.elapsed - this.pendingCreatedAt;
    this.pendingResolved += 1;
    this.pendingLatency.push(latency);
    this.pendingLog.push({
      at: Math.round(this.elapsed * 10) / 10,
      kind: 'pending_consequence_resolved',
      detail: def.id + ' (' + def.intensity + ') latency=' + latency.toFixed(1) + 's',
    });
    this.pending2 = null;
  }

  /** §33。文脈条件で候補が全滅しても、どこでも成立するものを返す */
  private fallback(): HorrorEventDef | null {
    for (const id of CONFIG.horror.pendingConsequence.fallback) {
      const def = this.pool.find((d) => d.id === id);
      if (def) return def;
    }
    return null;
  }

  get pendingInfo() {
    if (!this.pending2) return null;
    return {
      source: this.pending2.source,
      required: this.pending2.required,
      earliest: Math.round((this.pending2.earliest - this.elapsed) * 10) / 10,
      latest: Math.round((this.pending2.latest - this.elapsed) * 10) / 10,
      elapsed: Math.round((this.elapsed - this.pendingCreatedAt) * 10) / 10,
    };
  }

  /**
   * §28。ほとんど聞こえない環境音や、もう何度も見た明滅は「返事」にならない。
   * minor 以上で、かつ今回の Run でまだ擦っていないものだけを Meaningful とする。
   */
  private isMeaningful(def: HorrorEventDef) {
    if (def.id === 'Nothing') return false;
    if (INTENSITY_RANK[def.intensity] < 1) return false;
    // 「気のせいかもしれない」音は、最後の誘惑への返事にはならない
    if (def.family.startsWith('AMBIENT')) return false;
    if ((this.counts.get(def.id) ?? 0) >= CONFIG.horror.pendingConsequence.maxSeenBefore) return false;
    return true;
  }

  /**
   * 予約が残ったまま Run が終わりそうなときに、その場で返事を決める。
   * Utility は使うが、期限も Relief も待たない。
   */
  forceResolvePending(): HorrorEventDef | null {
    if (!this.pending2?.required) return null;
    const cands = this.pool
      .filter((d) => this.isMeaningful(d) && !this.eligible(d, this.lastCtx ?? ({} as HorrorContext)))
      .map((d) => this.score(d, this.lastCtx!))
      .sort((a, b) => b.score - a.score);
    const def = cands[0]?.def ?? this.fallback();
    if (!def) return null;
    this.resolvePending(def);
    return this.commit(def, this.lastCtx!);
  }

  /**
   * Intent の期限管理。
   * latest を過ぎたら、まず fallback を1つだけ返して、それも無理なら expired にする。
   * 永遠に残しておくと、Run 終盤に古い因果がまとめて返ってきて不自然になる。
   */
  private updateIntents(ctx: HorrorContext) {
    for (const i of this.intents) {
      if (i.resolved || i.required) continue;
      if (this.elapsed < i.latest) continue;
      // Chase 中に無理やり返さない（§45）
      if (ctx.chaseActive) continue;
      // §33。保険なので Haunted 条件は見ない。見ると「低 Haunted だから返事なし」になる。
      // 画面内テレポート等の破ってはいけない条件だけ確認する。
      const fb = i.fallback
        .map((id) => this.pool.find((d) => d.id === id))
        .find((d) => !!d && !this.hardBlocked(d, ctx));
      if (fb && !this.gate(ctx)) {
        i.resolved = true;
        this.intentResolved += 1;
        this.intentLatency.push(this.elapsed - i.createdAt);
        this.intentLog.push({
          at: Math.round(this.elapsed * 10) / 10,
          kind: 'consequence_intent_resolved',
          detail: `source=${i.source} event=${fb.id} latency=${(this.elapsed - i.createdAt).toFixed(1)}s fallback=true`,
        });
        this.forced = fb;
        return;
      }
      if (this.elapsed > i.latest + CONFIG.horror.intent.graceAfterLatest) {
        i.resolved = true;
        this.intentExpired += 1;
        this.intentLog.push({
          at: Math.round(this.elapsed * 10) / 10,
          kind: 'consequence_intent_expired',
          detail:
            `source=${i.source} reason=no_eligible_candidate ` +
            `rejections=${this.lastRejections.slice(0, 4).map((r) => r.id + ':' + r.reason).join('|')}`,
        });
      }
    }
  }

  /** 破ってはいけない条件だけ。Haunted や Tension のような「今ふさわしいか」は見ない */
  private hardBlocked(def: HorrorEventDef, ctx: HorrorContext) {
    if (def.requiresGhostOffscreen && ctx.ghostOnScreen) return true;
    if (def.requiresGhostOnscreen && !ctx.ghostOnScreen) return true;
    if (def.requiredGhostState && !def.requiredGhostState.includes(ctx.ghostState)) return true;
    if (def.requiredMemories && !def.requiredMemories.every((m) => ctx.memories.has(m))) return true;
    const last = this.lastAt.get(def.id);
    if (last !== undefined && this.elapsed - last < def.cooldown) return true;
    if (def.oncePerRun && (this.counts.get(def.id) ?? 0) > 0) return true;
    return false;
  }

  /** テスト用。maxPerRun を使い切った状態を作る */
  debugExhaust(ids: string[]) {
    for (const id of ids) {
      const def = this.pool.find((d) => d.id === id);
      if (def) this.counts.set(id, def.maxPerRun ?? 99);
    }
  }

  /** Chase が始まった / 終わった */
  markChase(started: boolean) {
    if (started) {
      this.addUnresolved('chase', 45, 30);
      this.residue = RESIDUE.climax;
      this.relief = 0;
    } else {
      // 逃げ切った、と思わせる時間を長めに取る。ただし緊張は即座には落ちない
      this.relief = rand(CONFIG.horror.relief.chase[0], CONFIG.horror.relief.chase[1]);
      this.addUnresolved('chase_ended', 22, 40);
    }
  }

  /** 直近 window 秒の Ghost 系イベント数 */
  private ghostCount(window: number) {
    return this.ghostTimes.filter((t) => this.elapsed - t < window).length;
  }

  private familyCount(f: HorrorFamily, window: number) {
    const ts = this.familyTimes.get(f);
    if (!ts) return 0;
    return ts.filter((t) => this.elapsed - t < window).length;
  }

  /** LOW / NORMAL / HIGH / SATURATED */
  get pressureBand() {
    const b = CONFIG.horror.pressure.bands;
    if (this.pressure >= b[2]) return 'SATURATED';
    if (this.pressure >= b[1]) return 'HIGH';
    if (this.pressure >= b[0]) return 'NORMAL';
    return 'LOW';
  }

  /**
   * Pressure が高いほど最低スコアを上げる。
   * ただし Global minScore を一律で上げると低 Haunted の Run まで静かになるので、
   * あくまで「今どれだけ出したか」に応じた動的な値にする。
   */
  private get dynamicMinScore() {
    const cfg = CONFIG.horror;
    const band = this.pressureBand;
    if (band === 'SATURATED') return cfg.minScoreSaturated;
    if (band === 'HIGH') return cfg.minScoreHigh;
    return cfg.minScore;
  }

  /** 0..1。何も起きていない時間が長いほど大きい。これは強制ではなくスコア加点 */
  get dryness() {
    const t = this.sinceMeaningful;
    if (t < 8) return 0;
    if (t < 20) return (t - 8) / 12 * 0.55;
    if (t < 35) return 0.55 + (t - 20) / 15 * 0.35;
    return Math.min(1, 0.9 + (t - 35) / 30 * 0.1);
  }

  /**
   * 0..1。最近「印象に残る山」が無いほど大きい。
   * HorrorPressure（最近イベントが多すぎるか）とは別物で、
   * Ambient が沢山鳴っていて Pressure は高いのに PeakNeed も高い、が同時に起こりうる。
   *
   * これは固定タイマーのトリガーではなく、スコア加点にしか使わない。
   */
  get peakNeed() {
    const t = this.sincePeak;
    const [a, b] = CONFIG.horror.peak.window;
    if (t < a) return 0;
    if (t > b) return 1;
    return (t - a) / (b - a);
  }

  get phaseTargetTension(): [number, number] {
    return [20, 60];
  }

  /* ------------------------------------------------------------------ */

  /** そもそも今、検討してよいか。ここは明確な禁止条件で書く */
  private gate(ctx: HorrorContext): string | null {
    if (ctx.chaseActive) return 'chase_active';
    if (this.pending) return 'pending_event';
    // 返事の予約中。earliest までは短い溜めを作る（即ジャンプスケアにしない）
    if (this.pending2?.required && this.elapsed < this.pending2.earliest) {
      return 'awaiting_consequence';
    }
    // 期限に入っているときは Relief では止めない
    const forced = this.pending2?.required && this.elapsed >= this.pending2.earliest;
    if (this.relief > 0 && !forced) return 'relief_window';
    return null;
  }

  private eligible(def: HorrorEventDef, ctx: HorrorContext): string | null {
    const last = this.lastAt.get(def.id);
    if (last !== undefined && this.elapsed - last < def.cooldown) return 'cooldown';
    if (def.familyCooldown) {
      const f = this.familyAt.get(def.family);
      if (f !== undefined && this.elapsed - f < def.familyCooldown) return 'family_cooldown';
    }
    const n = this.counts.get(def.id) ?? 0;
    if (def.oncePerRun && n > 0) return 'once_per_run';
    if (def.maxPerRun !== undefined && n >= def.maxPerRun) return 'max_per_run';

    // 危険な出来事は、プレイヤーが自分で世界を悪くした場合にだけ起きる。
    // 安全に遊んだのに危険になった、を作らない。
    const threat = def.threat ?? 'low';
    if (ctx.haunted < CONFIG.horror.threatUnlock[threat]) return 'threat_locked';
    if (def.minHaunted !== undefined && ctx.haunted < def.minHaunted) return 'haunted_low';
    if (def.maxHaunted !== undefined && ctx.haunted > def.maxHaunted) return 'haunted_high';
    if (def.allowedPhases && !def.allowedPhases.includes(ctx.phase)) return 'phase';
    if (def.allowedRooms && !def.allowedRooms.includes(ctx.room)) return 'room';
    if (def.forbiddenRooms && def.forbiddenRooms.includes(ctx.room)) return 'room_forbidden';

    if (def.requiredMemories && !def.requiredMemories.every((m) => ctx.memories.has(m))) {
      return 'memory_missing';
    }
    if (def.forbiddenMemories && def.forbiddenMemories.some((m) => ctx.memories.has(m))) {
      return 'memory_present';
    }
    if (def.requiredObjectState) {
      const [id, st] = def.requiredObjectState.split('|');
      if (ctx.objectStates[id] !== st) return 'object_state';
    }
    if (def.forbiddenObjectState) {
      const [id, st] = def.forbiddenObjectState.split('|');
      if (ctx.objectStates[id] === st) return 'object_state_forbidden';
    }

    if (def.requiredGhostState && !def.requiredGhostState.includes(ctx.ghostState)) {
      return 'ghost_state';
    }
    // 画面内でのテレポートは禁止
    if (def.requiresGhostOffscreen && ctx.ghostOnScreen) return 'ghost_onscreen';
    if (def.requiresGhostOnscreen && !ctx.ghostOnScreen) return 'ghost_offscreen';

    if (def.relatedObject) {
      const d = ctx.objectDistances[def.relatedObject];
      if (d === undefined) return 'no_object';
      if (def.minPlayerDistance !== undefined && d < def.minPlayerDistance) return 'too_close';
      if (def.maxPlayerDistance !== undefined && d > def.maxPlayerDistance) return 'too_far';
    }

    // 強いイベントが続かないようにする
    const rank = INTENSITY_RANK[def.intensity];
    if (rank >= 3) {
      // 開幕すぐに山を持ってこない。まず家に慣れさせる
      if (this.elapsed < CONFIG.horror.peak.notBefore) return 'too_early_for_peak';
      // 間が空いていても、強い出来事が2つ並ぶと山が山でなくなる
      if (this.lastFiredRank >= 3) return 'strong_after_strong';
      this.strongTimes = this.strongTimes.filter((t) => this.elapsed - t < CONFIG.horror.strongWindow);
      if (this.strongTimes.length >= CONFIG.horror.strongBudget) return 'strong_budget';
    }
    return null;
  }

  private score(def: HorrorEventDef, ctx: HorrorContext): Candidate {
    const tags: string[] = [];
    let s = def.baseWeight;

    if (def.id === 'Nothing') return this.scoreNothing(ctx);

    // --- Tension との相性。高すぎるときに強いものを重ねない ---
    if (def.preferredTension) {
      const [lo, hi] = def.preferredTension;
      if (this.tension < lo) {
        const d = (lo - this.tension) * 0.5;
        s -= d;
        tags.push(`tension-${d.toFixed(0)}`);
      } else if (this.tension > hi) {
        const d = (this.tension - hi) * 0.9;
        s -= d;
        tags.push(`tension-${d.toFixed(0)}`);
      } else {
        s += 12;
        tags.push('tension+12');
      }
    }
    const rank = INTENSITY_RANK[def.intensity];
    if (this.tension > CONFIG.horror.saturatedTension) {
      // 飽和しているときは、弱いものも含めて黙る方へ寄せる
      const over = this.tension - CONFIG.horror.saturatedTension;
      const p = (rank + 1) * 8 + over * 0.8;
      s -= p;
      tags.push(`saturated-${p.toFixed(0)}`);
    }

    // --- Haunted との相性 ---
    if (def.minHaunted !== undefined) {
      const over = ctx.haunted - def.minHaunted;
      const b = Math.min(14, Math.max(0, over) * 0.35);
      s += b;
      if (b > 0) tags.push(`haunted+${b.toFixed(0)}`);
    }

    // 家が荒れているのに「気のせい」ばかり返すと、世界が反応していないように見える。
    // 低 Haunted 用の語彙は、高 Haunted では自然と後ろに下がる。
    if (rank === 0 && ctx.haunted > CONFIG.horror.ambientFadeHaunted && !def.requiredMemories?.length) {
      // 完全には消さない。高 Haunted でも Ghost の間に環境イベントを挟みたい（§53）
      const p = Math.min(
        CONFIG.horror.ambientFadeMax,
        (ctx.haunted - CONFIG.horror.ambientFadeHaunted) * CONFIG.horror.ambientFadePerPoint,
      );
      s -= p;
      tags.push(`ambientFade-${p.toFixed(0)}`);
    }

    // --- 間延びしていれば弱めのものを押し出す ---
    const dry = this.dryness;
    if (rank <= 2) {
      const b = dry * 26;
      s += b;
      tags.push(`pacing+${b.toFixed(0)}`);
    } else {
      // 退屈防止と強いジャンプスケアを直結させない
      const b = dry * 6;
      s += b;
    }

    // 山が長く来ていないなら、強い出来事を押し出す。
    // Haunted は「どれくらい危険な山か」を決めるだけで、山そのものの有無は決めない。
    if (rank >= 3) {
      const b = this.peakNeed * CONFIG.horror.peak.needWeight;
      s += b;
      if (b > 1) tags.push(`peakNeed+${b.toFixed(0)}`);
      // 一度も山が無いまま Run が進むのが最悪なので、初回だけ強く押す
      if (!this.peaks.length && this.elapsed > CONFIG.horror.peak.firstAfter) {
        s += CONFIG.horror.peak.firstBonus;
        tags.push(`firstPeak+${CONFIG.horror.peak.firstBonus}`);
      }
      // 1Run に山を出しすぎない
      if (this.peaks.length >= CONFIG.horror.peak.maxPerRun) {
        s -= 40;
        tags.push('peakBudget-40');
      }
      // §12。Haunted は山の有無ではなく「山の質」を決める。
      // 荒れているほど、同じ山でも危険な方を選ぶ。
      const tr = THREAT_RANK[def.threat ?? 'low'];
      const want = ctx.haunted / 25;
      const fit = 12 - Math.abs(want - tr) * 7;
      s += fit;
      tags.push(`threatFit${fit >= 0 ? '+' : ''}${fit.toFixed(0)}`);
    }

    // --- 今どこを見ているか ---
    if (def.relatedObject) {
      const d = ctx.objectDistances[def.relatedObject] ?? 99;
      if (ctx.focusObject === def.relatedObject) {
        s += 18;
        tags.push('focus+18');
      }
      // 背後・周辺のイベントは、正面に集中しているときほど効く
      if (def.tags?.includes('behind') && ctx.focusObject && ctx.focusObject !== def.relatedObject) {
        s += 10;
        tags.push('peripheral+10');
      }
      const prox = Math.max(0, 1 - d / 26);
      s += prox * 8;
    }

    // --- World Memory。自分がやったことの結果として意味がある ---
    if (def.requiredMemories?.length) {
      let bonus = 34;
      const m = def.requiredMemories[0];
      const age = ctx.memoryAge[m] ?? 0;
      // 忘れた頃ほど効く
      bonus += Math.min(18, age * 0.35);
      // 現場を離れているほど「まだ続いている」感が出る
      if (def.relatedObject) {
        const d = ctx.objectDistances[def.relatedObject] ?? 0;
        if (d > 14) bonus += 14;
        if (ctx.objectRoom[def.relatedObject] && ctx.objectRoom[def.relatedObject] !== ctx.room) {
          bonus += 12;
        }
      }
      s += bonus;
      tags.push(`memory+${bonus.toFixed(0)}`);
    }

    // --- 未回収の因果。自分がやったことへの返事 ---
    const ib = this.intentBonus(def, ctx, tags);
    if (ib) s += ib;

    // --- 帰路はWorld Memoryを強く ---
    if (ctx.phase === 'RETURNING' && def.requiredMemories?.length) {
      s += 16;
      tags.push('returning+16');
    }
    // 目標達成後、残っているほど世界は反応する
    if (ctx.goalReached && rank >= 2) {
      s += 8;
      tags.push('overtime+8');
    }
    // 最後の誘惑に乗ったなら、必ず何かを返す
    if (ctx.finalTemptationTaken && rank >= 1) {
      s += 26;
      tags.push('final+26');
    }

    // --- Director 自身の出力密度。出せるからといって出し続けない ---
    const pcfg = CONFIG.horror.pressure;
    if (this.pressure > pcfg.bands[0]) {
      const over = this.pressure - pcfg.bands[0];
      const p = over * pcfg.penaltyPerPoint[Math.min(rank, 4)];
      s -= p;
      tags.push(`pressure-${p.toFixed(0)}`);
    }
    // --- Ghost Chain 防止。環境イベントが枯れた枠を Ghost が埋めないようにする ---
    if (GHOST_FAMILIES.has(def.family)) {
      if (this.pressure > pcfg.bands[0]) {
        const gp = (this.pressure - pcfg.bands[0]) * pcfg.ghostExtra;
        s -= gp;
        tags.push(`ghostPressure-${gp.toFixed(0)}`);
      }
      const near = this.ghostCount(pcfg.ghostNearWindow);
      const wide = this.ghostCount(pcfg.ghostWideWindow);
      if (near >= 1) {
        s -= pcfg.ghostNearPenalty;
        tags.push(`recentGhost-${pcfg.ghostNearPenalty}`);
      }
      if (wide >= 2) {
        s -= pcfg.ghostWidePenalty;
        tags.push(`ghostChain-${pcfg.ghostWidePenalty}`);
      }
    }
    // --- Family 単位の短期予算。maxPerRun とは役割が違う ---
    const famRecent = this.familyCount(def.family, pcfg.familyWindow);
    if (famRecent > 0) {
      const p = famRecent * pcfg.familyBudgetPenalty;
      s -= p;
      tags.push(`familyBudget-${p}`);
    }

    // --- 必ず返事をする予約があるとき ---
    if (this.pending2?.required) {
      if (this.isMeaningful(def)) {
        s += 30;
        tags.push('required+30');
        if (def.tags?.some((t) => this.pending2!.contextTags.includes(t))) {
          s += 22;
          tags.push('ctx+22');
        }
        if (this.pending2.relatedObject && def.relatedObject === this.pending2.relatedObject) {
          s += 16;
          tags.push('obj+16');
        }
        // latest が近づいたら押し出す
        const left = this.pending2.latest - this.elapsed;
        if (left < 2.5) {
          const u = (2.5 - left) * 40;
          s += u;
          tags.push(`urgency+${u.toFixed(0)}`);
        }
        // 刺激過多なら Meaningful だが軽いものへ寄せる
        if (this.pressureBand === 'SATURATED' && rank >= 3) {
          s -= 45;
          tags.push('overload-45');
        }
      }
    }

    // --- 繰り返しを避ける ---
    const idHits = this.recentIds.filter((x) => x === def.id).length;
    if (idHits) {
      const p = idHits * (def.repeatPenalty ?? 28);
      s -= p;
      tags.push(`repeat-${p}`);
    }
    const famHits = this.recentFamilies.filter((x) => x === def.family).length;
    if (famHits) {
      const p = famHits * 14;
      s -= p;
      tags.push(`family-${p}`);
    }

    return { def, score: s, tags };
  }

  private scoreNothing(ctx: HorrorContext): Candidate {
    const tags: string[] = [];
    let s = NOTHING.baseWeight;

    // 緊張が高いほど黙る
    if (this.tension > 60) {
      const b = (this.tension - 60) * 1.3;
      s += b;
      tags.push(`tension+${b.toFixed(0)}`);
    }
    // 直前に強い出来事があった
    if (this.sinceStrong < 18) {
      const b = (18 - this.sinceStrong) * 2.2;
      s += b;
      tags.push(`after_strong+${b.toFixed(0)}`);
    }
    if (this.sinceHorror < 8) {
      const b = (8 - this.sinceHorror) * 3;
      s += b;
      tags.push(`recent+${b.toFixed(0)}`);
    }
    // 何も起きていない時間が長いほど、黙り続ける理由は減る。
    // ただし既に緊張しているなら、静けさは退屈ではなく「まだ来ていない」なので効かせない。
    const calm = 1 - clamp((this.tension - 60) / 40, 0, 1) * 0.75;
    const b = this.dryness * 46 * calm;
    s -= b;
    if (b > 0) tags.push(`dry-${b.toFixed(0)}`);
    // Director が最近たくさん出していれば、黙る理由になる
    const pcfg = CONFIG.horror.pressure;
    if (this.pressure > pcfg.bands[0]) {
      const b = (this.pressure - pcfg.bands[0]) * pcfg.nothingPerPoint;
      s += b;
      tags.push(`pressure+${b.toFixed(0)}`);
    }
    // 候補が枯れたから残りものを出す、をしない
    if (this.scarcity === 1) {
      s += pcfg.scarcityBonus[0];
      tags.push(`scarce+${pcfg.scarcityBonus[0]}`);
    } else if (this.scarcity === 2) {
      s += pcfg.scarcityBonus[1];
      tags.push(`scarce+${pcfg.scarcityBonus[1]}`);
    }
    if (ctx.haunted > 55) {
      s -= 10;
      tags.push('haunted-10');
    }
    // リクエスト進行中は、世界が黙っていた方が読みやすい
    if (ctx.activeRequestType === 'constraint' || ctx.activeRequestType === 'hold') {
      s -= 8;
      tags.push('request-8');
    }
    return { def: NOTHING, score: Math.max(0, s), tags };
  }

  /* ------------------------------------------------------------------ */

  /**
   * @returns 実行すべきイベント。null なら今回は何もしない
   */
  update(dt: number, ctx: HorrorContext): HorrorEventDef | null {
    this.lastCtx = ctx;
    this.elapsed += dt;
    this.sinceHorror += dt;
    this.sinceStrong += dt;
    this.sincePeak += dt;
    this.sinceMeaningful += dt;
    this.relief = Math.max(0, this.relief - dt);
    this.anticipation = Math.max(0, this.anticipation - dt);
    // --- Tension Envelope ---
    const env = CONFIG.horror.envelope;
    this.anticipationTension = Math.max(0, this.anticipationTension - env.anticipationDecay * dt);
    this.residue = Math.max(0, this.residue - env.residueDecay * dt);
    const c = this.tensionComponents(ctx);
    this.lastComponents = c;
    this.desired = clamp(
      c.phase + c.unresolvedThreat + c.anticipation + c.ghostAwareness + c.constraint + c.pending + c.residue,
      0,
      100,
    );
    // 上がるのは速く、下がるのは遅い。安全になっても即座に0へ戻らない
    const speed = this.desired > this.tension ? env.riseSpeed : env.fallSpeed;
    this.tension = clamp(this.tension + (this.desired - this.tension) * speed * dt, 0, 100);

    const pcfg = CONFIG.horror.pressure;
    // 指数減衰。Pressure が「直近の刺激密度」そのものを表すようにする
    this.pressure = clamp(this.pressure - this.pressure * pcfg.decay * dt, 0, pcfg.max);
    if (this.tension > 80) this.tensionHighTime += dt;
    if (this.tension < 20) this.tensionLowTime += dt;
    const bi = this.tension < 20 ? 0 : this.tension < 40 ? 1 : this.tension < 70 ? 2 : this.tension < 85 ? 3 : 4;
    this.bandTime[bi] += dt;
    this.traceTimer -= dt;
    if (this.traceTimer <= 0) {
      this.traceTimer = 30;
      this.trace.push({
        at: Math.round(this.elapsed),
        desired: Math.round(this.desired),
        actual: Math.round(this.tension),
      });
    }
    this.pressureSum += this.pressure * dt;
    this.pressureSamples += dt;
    this.pressureMax = Math.max(this.pressureMax, this.pressure);
    if (this.pressure >= pcfg.bands[1]) this.pressureHighTime += dt;

    this.updateIntents(ctx);

    // 返事の期限。ここを過ぎたら失敗として必ず記録する
    if (this.pending2 && this.elapsed > this.pending2.latest + 1.5) {
      this.pendingFailed += 1;
      this.pendingFailReasons.push({
        source: this.pending2.source,
        elapsed: Math.round((this.elapsed - this.pendingCreatedAt) * 10) / 10,
        rejections: this.lastRejections.slice(0, 6).map((r) => r.id + ':' + r.reason),
      });
      this.pending2 = null;
    }

    if (this.forced) {
      const def = this.forced;
      this.forced = null;
      return this.commit(def, ctx);
    }

    // 予約されたイベント
    if (this.pending) {
      this.pending.delay -= dt;
      if (this.pending.delay <= 0) {
        const def = this.pending.def;
        this.pending = null;
        return this.commit(def, ctx);
      }
      return null;
    }

    this.evalTimer -= dt;
    if (this.evalTimer > 0) return null;
    this.evalTimer = rand(CONFIG.horror.evalInterval[0], CONFIG.horror.evalInterval[1]);

    const blocked = this.gate(ctx);
    if (blocked) {
      this.lastRejections = [{ id: '*', reason: blocked }];
      return null;
    }

    this.evaluations += 1;
    // 予約の解決フェーズかどうか
    const resolving = !!this.pending2?.required && this.elapsed >= this.pending2.earliest;

    const rejections: Rejection[] = [];
    const cands: Candidate[] = [];
    for (const def of this.pool) {
      // 危険な行動の直後は、因果関係のあるものだけを検討する
      if (!resolving && this.anticipation > 0 && !def.requiredMemories?.length) {
        rejections.push({ id: def.id, reason: 'anticipation_unrelated' });
        continue;
      }
      if (resolving && !this.isMeaningful(def)) {
        rejections.push({ id: def.id, reason: 'not_meaningful' });
        continue;
      }
      const why = this.eligible(def, ctx);
      if (why) rejections.push({ id: def.id, reason: why });
      else cands.push(this.score(def, ctx));
    }
    this.scarcity = cands.length;
    // Required Consequence の解決中は Nothing を候補に入れない
    if (!resolving) cands.push(this.scoreNothing(ctx));
    cands.sort((a, b) => b.score - a.score);
    this.lastAllCandidates = cands;
    this.lastCandidates = cands.slice(0, 6);
    this.lastRejections = rejections;

    if (resolving && !cands.length) {
      // 候補が全滅した場合の保険。どこでも成立するものを最低1つ用意しておく
      const fb = this.fallback();
      if (fb) {
        this.lastSelected = fb.id;
        this.resolvePending(fb);
        return this.commit(fb, ctx);
      }
    }

    const minScore = resolving ? 0 : this.dynamicMinScore;
    const top = cands.filter((c) => c.score >= minScore).slice(0, 5);
    const pickFrom = top.length
      ? top
      : resolving
        ? cands.slice(0, 1)
        : [cands.find((c) => c.def.id === 'Nothing')!];
    if (!pickFrom.length || !pickFrom[0]) return null;
    const total = pickFrom.reduce((a, c) => a + c.score, 0);
    let r = Math.random() * total;
    let chosen = pickFrom[pickFrom.length - 1];
    for (const c of pickFrom) {
      r -= c.score;
      if (r <= 0) {
        chosen = c;
        break;
      }
    }

    this.lastSelected = chosen.def.id;
    if (chosen.def.id === 'Nothing') {
      this.silenceChosen += 1;
      return null;
    }
    if (resolving) this.resolvePending(chosen.def);
    // 溜めがあるものは予約する。ただし期限があるときは待たせない
    if (chosen.def.anticipationDelay && !resolving) {
      this.pending = {
        def: chosen.def,
        delay: rand(chosen.def.anticipationDelay[0], chosen.def.anticipationDelay[1]),
      };
      return null;
    }
    return this.commit(chosen.def, ctx);
  }

  private commit(def: HorrorEventDef, ctx: HorrorContext): HorrorEventDef {
    const rank = INTENSITY_RANK[def.intensity];
    this.lastAt.set(def.id, this.elapsed);
    this.familyAt.set(def.family, this.elapsed);
    this.counts.set(def.id, (this.counts.get(def.id) ?? 0) + 1);
    this.recentIds.push(def.id);
    if (this.recentIds.length > 6) this.recentIds.shift();
    this.recentFamilies.push(def.family);
    if (this.recentFamilies.length > 4) this.recentFamilies.shift();

    this.lastFiredRank = rank;
    if (rank >= 3) {
      this.sincePeak = 0;
      this.peaks.push({ id: def.id, threat: def.threat ?? 'low', at: Math.round(this.elapsed * 10) / 10 });
    }
    // 出来事そのものではなく、出来事が残す「まだ解決していない」を積む
    const u = UNRESOLVED[def.intensity];
    // 遺影が落ちるのは驚くが「落ちた」で説明がつく。危険度が低いほど尾を引かない
    const tf = CONFIG.horror.envelope.threatFactor[def.threat ?? 'low'];
    this.addUnresolved(def.id, u.amount * tf, (def.unresolvedFor ?? u.seconds) * tf);
    this.residue = Math.max(this.residue, RESIDUE[def.intensity]);
    // 自分の行動への返事が返ったので、結果待ちは解消する
    this.anticipationTension *= CONFIG.horror.envelope.answeredRelief;
    // Director 自身の出力密度。Ghost 系は体感が重いので上乗せする
    const pcfg = CONFIG.horror.pressure;
    let gain = PRESSURE_GAIN[def.intensity];
    if (GHOST_FAMILIES.has(def.family)) {
      gain += def.family === 'FAKE_THREAT' ? 5 : def.family === 'CHASE' ? 7 : 3;
      this.ghostTimes.push(this.elapsed);
    }
    const before = this.pressure;
    this.pressure = clamp(this.pressure + gain, 0, pcfg.max);
    this.pressureLog.push({
      at: Math.round(this.elapsed * 10) / 10,
      before: Math.round(before * 10) / 10,
      after: Math.round(this.pressure * 10) / 10,
      source: def.id,
    });
    const ft = this.familyTimes.get(def.family) ?? [];
    ft.push(this.elapsed);
    this.familyTimes.set(def.family, ft);
    if (def.family.startsWith('AMBIENT')) this.ambientFired.push(def.id);
    this.consumeIntent(def);
    this.sinceHorror = 0;
    this.sinceMeaningful = 0;
    if (rank >= 3) {
      this.sinceStrong = 0;
      this.strongTimes.push(this.elapsed);
    }
    // 大きな出来事のあとは必ず間を置く
    const rel = CONFIG.horror.relief;
    const band = rank >= 3 ? rel.strong : rank === 2 ? rel.medium : rel.minor;
    this.relief = rand(band[0], band[1]);
    this.fired.push({
      id: def.id,
      family: def.family,
      intensity: def.intensity,
      at: Math.round(this.elapsed * 10) / 10,
      memory: def.requiredMemories?.[0],
    });
    void ctx;
    return def;
  }

  /* ------------------------------------------------------------------ */

  debug() {
    return {
      tension: Math.round(this.tension),
      desired: Math.round(this.desired),
      components: this.lastComponents,
      pacing: Math.round(this.dryness * 100) / 100,
      sinceHorror: Math.round(this.sinceHorror * 10) / 10,
      sinceStrong: Math.round(this.sinceStrong * 10) / 10,
      relief: Math.round(this.relief * 10) / 10,
      anticipation: Math.round(this.anticipation * 10) / 10,
      pressure: Math.round(this.pressure * 10) / 10,
      peakNeed: Math.round(this.peakNeed * 100) / 100,
      intents: this.intents
        .filter((i) => !i.resolved)
        .map((i) => `${i.source} age=${(this.elapsed - i.createdAt).toFixed(0)}s u=${urgency(i, this.elapsed).toFixed(2)}`),
      peaks: this.peaks.map((p) => `${p.id}(${p.threat})`),
      pressureBand: this.pressureBand,
      ghost30s: this.ghostCount(30),
      events30s: this.fired.filter((f) => this.elapsed - f.at < 30).length,
      strong30s: this.fired.filter((f) => this.elapsed - f.at < 30 && INTENSITY_RANK[f.intensity] >= 3).length,
      nothingScore: Math.round(this.lastAllCandidates.find((c) => c.def.id === 'Nothing')?.score ?? 0),
      minScore: this.dynamicMinScore,
      pending: this.pendingInfo,
      candidates: this.lastCandidates.map((c) => `${c.def.id} ${c.score.toFixed(0)}`),
      rejected: this.lastRejections.slice(0, 6).map((r) => `${r.id}:${r.reason}`),
      selected: this.lastSelected,
    };
  }

  kpi(runTime: number) {
    const strong = this.fired.filter((f) => INTENSITY_RANK[f.intensity] >= 3);
    const gaps: number[] = [];
    for (let i = 1; i < this.fired.length; i++) gaps.push(this.fired[i].at - this.fired[i - 1].at);
    const strongGaps: number[] = [];
    for (let i = 1; i < strong.length; i++) strongGaps.push(strong[i].at - strong[i - 1].at);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const families = new Set(this.fired.map((f) => f.family));
    // 同じイベントIDが連続した回数
    let repeats = 0;
    for (let i = 1; i < this.fired.length; i++) if (this.fired[i].id === this.fired[i - 1].id) repeats += 1;
    let strongAfterStrong = 0;
    for (let i = 1; i < this.fired.length; i++) {
      if (INTENSITY_RANK[this.fired[i].intensity] >= 3 && INTENSITY_RANK[this.fired[i - 1].intensity] >= 3) {
        strongAfterStrong += 1;
      }
    }
    const median = (a: number[]) => {
      if (!a.length) return 0;
      const b = [...a].sort((x, y) => x - y);
      return b[Math.floor(b.length / 2)];
    };
    const ghost = this.fired.filter((f) => GHOST_FAMILIES.has(f.family));
    const ghostGaps: number[] = [];
    for (let i = 1; i < ghost.length; i++) ghostGaps.push(ghost[i].at - ghost[i - 1].at);
    const ambientFamilies = new Set(
      this.fired.filter((f) => f.family.startsWith('AMBIENT')).map((f) => f.family),
    );
    return {
      events: this.fired.length,
      strongEvents: strong.length,
      avgGap: Math.round(avg(gaps) * 10) / 10,
      medianGap: Math.round(median(gaps) * 10) / 10,
      minGap: gaps.length ? Math.round(Math.min(...gaps) * 10) / 10 : 0,
      maxGap: gaps.length ? Math.round(Math.max(...gaps) * 10) / 10 : 0,
      ghostEvents: ghost.length,
      ghostPerMin: runTime ? Math.round((ghost.length / (runTime / 60)) * 10) / 10 : 0,
      avgGhostGap: Math.round(avg(ghostGaps) * 10) / 10,
      avgPressure: this.pressureSamples ? Math.round((this.pressureSum / this.pressureSamples) * 10) / 10 : 0,
      maxPressure: Math.round(this.pressureMax * 10) / 10,
      pressureHighShare: runTime ? Math.round((this.pressureHighTime / runTime) * 100) : 0,
      peaks: this.peaks.length,
      safePeaks: this.peaks.filter((p) => p.threat === 'safe' || p.threat === 'low').length,
      peakList: this.peaks.map((p) => `${p.at}s ${p.id}[${p.threat}]`),
      ambientUnique: new Set(this.ambientFired).size,
      ambientFamilies: ambientFamilies.size,
      intentCreated: this.intentCreated,
      intentResolved: this.intentResolved,
      intentExpired: this.intentExpired,
      intentRate: this.intentCreated
        ? Math.round((this.intentResolved / this.intentCreated) * 100)
        : 0,
      intentLatency: this.intentLatency.length
        ? Math.round(avg(this.intentLatency) * 10) / 10
        : 0,
      intentEvents: this.intentLog.map((l) => `${l.at}s ${l.kind.replace('consequence_intent_', '')} ${l.detail}`),
      pendingCreated: this.pendingResolved + this.pendingFailed + (this.pending2 ? 1 : 0),
      pendingResolved: this.pendingResolved,
      pendingFailed: this.pendingFailed,
      consequenceLatency: this.pendingLatency.length
        ? Math.round(avg(this.pendingLatency) * 10) / 10
        : 0,
      avgStrongGap: Math.round(avg(strongGaps) * 10) / 10,
      silenceRate: this.evaluations ? Math.round((this.silenceChosen / this.evaluations) * 100) : 0,
      familyDiversity: families.size,
      repeatRate: this.fired.length ? Math.round((repeats / this.fired.length) * 100) : 0,
      memoryLinked: this.fired.filter((f) => f.memory).length,
      memoryLinkedRate: this.fired.length
        ? Math.round((this.fired.filter((f) => f.memory).length / this.fired.length) * 100)
        : 0,
      tensionHighShare: runTime ? Math.round((this.tensionHighTime / runTime) * 100) : 0,
      tensionLowShare: runTime ? Math.round((this.tensionLowTime / runTime) * 100) : 0,
      tensionBands: this.bandTime.map((t) => (runTime ? Math.round((t / runTime) * 100) : 0)),
      tensionTrace: this.trace,
      strongAfterStrong,
      sequence: this.fired.map((f) => f.id),
    };
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
