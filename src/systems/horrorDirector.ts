import { CONFIG } from '../config';

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
  | 'CHASE';

export type HorrorIntensity = 'subtle' | 'minor' | 'medium' | 'strong' | 'climax';

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
  tags?: string[];
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

const INTENSITY_RANK: Record<HorrorIntensity, number> = {
  subtle: 0,
  minor: 1,
  medium: 2,
  strong: 3,
  climax: 4,
};

/** イベントごとの Tension 加算 */
const TENSION_GAIN: Record<HorrorIntensity, number> = {
  subtle: 6,
  minor: 12,
  medium: 20,
  strong: 34,
  climax: 62,
};

export class HorrorDirector {
  /** 今この瞬間、演出としてどれくらい圧迫しているかの推定値 0..100 */
  tension = 0;
  elapsed = 0;

  private sinceHorror = 999;
  private sinceStrong = 999;
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

  lastCandidates: Candidate[] = [];
  /** 上位だけでなく全候補。テストと詳細ログ用 */
  lastAllCandidates: Candidate[] = [];
  lastRejections: Rejection[] = [];
  lastSelected = '';

  // --- KPI ---
  fired: Array<{ id: string; family: HorrorFamily; intensity: HorrorIntensity; at: number; memory?: string }> = [];
  silenceChosen = 0;
  evaluations = 0;
  private tensionHighTime = 0;
  private tensionLowTime = 0;

  constructor(private pool: HorrorEventDef[]) {}

  reset() {
    this.tension = 0;
    this.elapsed = 0;
    this.sinceHorror = 999;
    this.sinceStrong = 999;
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
    this.lastCandidates = [];
    this.lastAllCandidates = [];
    this.lastRejections = [];
    this.lastSelected = '';
    this.fired = [];
    this.silenceChosen = 0;
    this.evaluations = 0;
    this.tensionHighTime = 0;
    this.tensionLowTime = 0;
  }

  /** 意味のある出来事があった（発見・リクエスト・異変・幽霊の反応） */
  markMeaningful() {
    this.sinceMeaningful = 0;
  }

  /** プレイヤーが自分から危険な行動をした。少し緊張を上げ、無関係なイベントを抑える */
  markGreed(riskTier: number) {
    const cfg = CONFIG.horror;
    this.tension = clamp(this.tension + (cfg.greedTension[riskTier - 1] ?? 3), 0, 100);
    this.anticipation = rand(cfg.anticipation.min, cfg.anticipation.max);
    this.sinceMeaningful = 0;
  }

  /** Chase が始まった / 終わった */
  markChase(started: boolean) {
    if (started) {
      this.tension = clamp(this.tension + TENSION_GAIN.climax, 0, 100);
      this.relief = 0;
    } else {
      // 逃げ切った、と思わせる時間を長めに取る
      this.relief = rand(CONFIG.horror.relief.chase[0], CONFIG.horror.relief.chase[1]);
    }
  }

  /** 0..1。何も起きていない時間が長いほど大きい。これは強制ではなくスコア加点 */
  get dryness() {
    const t = this.sinceMeaningful;
    if (t < 8) return 0;
    if (t < 20) return (t - 8) / 12 * 0.55;
    if (t < 35) return 0.55 + (t - 20) / 15 * 0.35;
    return Math.min(1, 0.9 + (t - 35) / 30 * 0.1);
  }

  get phaseTargetTension(): [number, number] {
    return [20, 60];
  }

  /* ------------------------------------------------------------------ */

  /** そもそも今、検討してよいか。ここは明確な禁止条件で書く */
  private gate(ctx: HorrorContext): string | null {
    if (ctx.chaseActive) return 'chase_active';
    if (this.relief > 0) return 'relief_window';
    if (this.pending) return 'pending_event';
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
    // 何も起きていない時間が長いほど、黙り続ける理由は減る
    const b = this.dryness * 46;
    s -= b;
    if (b > 0) tags.push(`dry-${b.toFixed(0)}`);
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
    this.elapsed += dt;
    this.sinceHorror += dt;
    this.sinceStrong += dt;
    this.sinceMeaningful += dt;
    this.relief = Math.max(0, this.relief - dt);
    this.anticipation = Math.max(0, this.anticipation - dt);
    this.tension = clamp(this.tension - CONFIG.horror.tensionDecay * dt, 0, 100);
    if (this.tension > 80) this.tensionHighTime += dt;
    if (this.tension < 20) this.tensionLowTime += dt;

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
    const rejections: Rejection[] = [];
    const cands: Candidate[] = [];
    for (const def of this.pool) {
      // 危険な行動の直後は、因果関係のあるものだけを検討する
      if (this.anticipation > 0 && !def.requiredMemories?.length) {
        rejections.push({ id: def.id, reason: 'anticipation_unrelated' });
        continue;
      }
      const why = this.eligible(def, ctx);
      if (why) rejections.push({ id: def.id, reason: why });
      else cands.push(this.score(def, ctx));
    }
    cands.push(this.scoreNothing(ctx));
    cands.sort((a, b) => b.score - a.score);
    this.lastAllCandidates = cands;
    this.lastCandidates = cands.slice(0, 6);
    this.lastRejections = rejections;

    const top = cands.filter((c) => c.score >= CONFIG.horror.minScore).slice(0, 5);
    const pickFrom = top.length ? top : [cands.find((c) => c.def.id === 'Nothing')!];
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
    // 溜めがあるものは予約する
    if (chosen.def.anticipationDelay) {
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

    this.tension = clamp(this.tension + TENSION_GAIN[def.intensity], 0, 100);
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
      pacing: Math.round(this.dryness * 100) / 100,
      sinceHorror: Math.round(this.sinceHorror * 10) / 10,
      sinceStrong: Math.round(this.sinceStrong * 10) / 10,
      relief: Math.round(this.relief * 10) / 10,
      anticipation: Math.round(this.anticipation * 10) / 10,
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
    return {
      events: this.fired.length,
      strongEvents: strong.length,
      avgGap: Math.round(avg(gaps) * 10) / 10,
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
