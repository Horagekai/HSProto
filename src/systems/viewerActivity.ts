/**
 * ViewerActivityNoise。
 *
 * 配信を見ている視聴者群衆が「今どれくらい口数が多いか」を 0..1 で表すだけのもの。
 *
 * **責務は「いつ口を開きやすいか」だけ。**
 *   何を言うか      → Eligibility / Utility / Persona
 *   いつ言いやすいか → これ
 *
 * したがって以下には絶対に触らない。
 *   Request Eligibility / 内容 / Utility の意味的順位
 *   Core Opportunity の種類 / WorldMemory / ConsequenceIntent
 *   Ghost AI / HorrorDirector / Haunted / Tension / HorrorPressure
 *
 * HorrorDirector がこれを参照しないのは意図的（§46-47）。
 * 参照させると「盛り上がる → Request → Horror → 盛り上がる」が毎回同じ周期になる。
 */
import { CONFIG } from '../config';

export type ActivityPhase = 'LOW' | 'RISING' | 'HIGH' | 'FALLING';

/** 32bit の決定的ハッシュ。RunSeed から各層の位相を作る */
function hash32(str: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 滑らかな値ノイズ。1次元の格子点を補間するだけ。
 * 三角関数を足すだけだと周期がプレイヤーに読まれるので、格子ごとに乱数を置く。
 */
class ValueNoise {
  private a: number[] = [];

  constructor(seed: number, private points = 256) {
    let s = seed >>> 0;
    for (let i = 0; i < points; i++) {
      // xorshift32
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      this.a.push(s / 0xffffffff);
    }
  }

  /** t は「格子いくつぶん進んだか」 */
  at(t: number) {
    const i = Math.floor(t);
    const f = t - i;
    const a = this.a[((i % this.points) + this.points) % this.points];
    const b = this.a[(((i + 1) % this.points) + this.points) % this.points];
    // smoothstep
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
}

export interface ViewerNoiseConfig {
  enabled: boolean;
  longScale: number;
  shortScale: number;
  longWeight: number;
  shortWeight: number;
  /** コメントとリクエストの位相差。コメントが少し先行する */
  reactionOffset: number;
  requestOffset: number;
  situationCadence: [number, number];
  coreCadence: [number, number];

  // --- Event Impulse / Fatigue / Silence Debt ---
  /** 出来事で上がった分が消えるまでの秒数 */
  impulseDecay: number;
  impulseCap: number;
  /** 盛り上がりすぎ防止 */
  fatigueFrom: number;
  fatigueGain: number;
  fatigueRecovery: number;
  fatigueCap: number;
  /** 静かすぎ防止。無音がこの秒数を超えると床が上がる */
  silenceFrom: number;
  silenceSpan: number;
  silenceCap: number;
}

/** 出来事ごとの impulse。視聴者が一時的に喋りやすくなるだけ */
export const IMPULSE: Record<string, number> = {
  discovery: 0.06,
  phone_ring: 0.18,
  portrait_crash: 0.2,
  ghost_reveal: 0.3,
  bath_sip: 0.35,
  altar_overplayed: 0.22,
  ghost_selfie: 0.28,
  risky_request: 0.25,
  chase_start: 0.35,
  chase_end: 0.15,
  horror_event: 0.12,
};

export class ViewerActivityNoise {
  private long: ValueNoise;
  private short: ValueNoise;
  private t = 0;
  private prev = 0.5;
  /** 出来事で一時的に上がる分 */
  eventImpulse = 0;
  /** 盛り上がり疲れ */
  fatigue = 0;
  /** 静かすぎたぶんの下駄 */
  silenceDebt = 0;
  /** 最後に視聴者が意味のある出力をしてからの秒数 */
  private sinceOutput = 0;
  impulseLog: Array<{ at: number; source: string; amount: number; before: number; after: number }> = [];
  cfg: ViewerNoiseConfig;
  runSeed: number;

  constructor(runSeed: number, cfg?: Partial<ViewerNoiseConfig>) {
    this.runSeed = runSeed;
    this.cfg = { ...CONFIG.viewerNoise, ...cfg };
    // 層ごとに別の種にする。同じ種だと2層が同期して1層と変わらない
    this.long = new ValueNoise(hash32('viewer_activity_long', runSeed));
    this.short = new ValueNoise(hash32('viewer_activity_short', runSeed));
  }

  update(dt: number) {
    this.prev = this.effectiveActivity;
    this.t += dt;
    const c = this.cfg;

    // 出来事の余韻は急上昇してゆっくり消える
    if (this.eventImpulse > 0) {
      this.eventImpulse = Math.max(0, this.eventImpulse - dt / Math.max(0.1, c.impulseDecay));
    }

    // 盛り上がりが続いたら疲れる。静かなら回復する（§18-21）。
    // 「誰も喋っていないから床を上げた」分（silenceDebt）で疲れてはいけない。
    // 疲れるのは実際に盛り上がっているときだけ。
    const loud = this.naturalActivity + this.eventImpulse;
    if (loud > c.fatigueFrom) this.fatigue = Math.min(c.fatigueCap, this.fatigue + c.fatigueGain * dt);
    else this.fatigue = Math.max(0, this.fatigue - c.fatigueRecovery * dt);

    // 誰も何も言わない時間が続いたら、そろそろ口を開きやすくする（§23-26）
    this.sinceOutput += dt;
    const over = this.sinceOutput - c.silenceFrom;
    this.silenceDebt = over <= 0 ? 0 : Math.min(c.silenceCap, (over / c.silenceSpan) * c.silenceCap);
  }

  /**
   * 世界で何かが起きた。視聴者が一時的に喋りやすくなる（§12-17）。
   * **何を言うかには関与しない。**
   */
  impulse(source: string, amount = IMPULSE[source] ?? 0.1) {
    if (!this.cfg.enabled) return;
    const before = this.eventImpulse;
    this.eventImpulse = Math.min(this.cfg.impulseCap, this.eventImpulse + amount);
    this.impulseLog.push({
      at: Math.round(this.t * 10) / 10,
      source,
      amount,
      before: Math.round(before * 100) / 100,
      after: Math.round(this.eventImpulse * 100) / 100,
    });
  }

  /** 視聴者が何か言った / リクエストが出た。無音の借金を返す */
  noteOutput() {
    this.sinceOutput = 0;
  }

  /** 自然な波だけ。出来事も疲れも含まない */
  get naturalActivity() {
    return this.sample(this.t);
  }

  /**
   * 実際に使う活動量（§27）。
   *   自然な波 + 出来事の余韻 + 無音の借金 − 盛り上がり疲れ
   */
  get effectiveActivity() {
    if (!this.cfg.enabled) return 0.5;
    return Math.min(
      1,
      Math.max(0, this.naturalActivity + this.eventImpulse + this.silenceDebt - this.fatigue),
    );
  }

  /** 指定時刻の活動量 0..1 */
  sample(time: number) {
    const c = this.cfg;
    if (!c.enabled) return 0.5;
    const l = this.long.at(time / c.longScale);
    const s = this.short.at(time / c.shortScale);
    const v = c.longWeight * l + c.shortWeight * s;
    const total = c.longWeight + c.shortWeight;
    return Math.min(1, Math.max(0, v / (total || 1)));
  }

  get longNoise() {
    return this.cfg.enabled ? this.long.at(this.t / this.cfg.longScale) : 0.5;
  }

  get shortNoise() {
    return this.cfg.enabled ? this.short.at(this.t / this.cfg.shortScale) : 0.5;
  }

  get activity() {
    return this.effectiveActivity;
  }

  /**
   * コメント側。出来事にすぐ反応する。
   * 波は先読みするので、Request より先に温まる。
   */
  get reactionActivity() {
    if (!this.cfg.enabled) return 0.5;
    const base = this.sample(this.t + this.cfg.reactionOffset);
    return Math.min(1, Math.max(0, base + this.eventImpulse + this.silenceDebt - this.fatigue));
  }

  /** リクエスト側。コメントより少し遅れて温まる */
  get requestActivity() {
    if (!this.cfg.enabled) return 0.5;
    const base = this.sample(this.t + this.cfg.requestOffset);
    // 出来事の余韻はコメントほど強く効かせない。Request は文脈で決まるもの
    return Math.min(
      1,
      Math.max(0, base + this.eventImpulse * 0.6 + this.silenceDebt - this.fatigue),
    );
  }

  get phase(): ActivityPhase {
    const a = this.activity;
    const rising = a > this.prev + 0.002;
    const falling = a < this.prev - 0.002;
    if (a > 0.62) return falling ? 'FALLING' : 'HIGH';
    if (a < 0.38) return rising ? 'RISING' : 'LOW';
    return rising ? 'RISING' : falling ? 'FALLING' : 'HIGH';
  }

  /**
   * 状況Requestの間隔倍率。大きいほど「出やすい」。
   * 呼び出し側は待ち時間をこれで割る。
   */
  cadenceFor(core: boolean) {
    const [lo, hi] = core ? this.cfg.coreCadence : this.cfg.situationCadence;
    return lo + (hi - lo) * this.requestActivity;
  }

  /** コメント間隔の倍率。大きいほど密 */
  get commentCadence() {
    const [lo, hi] = this.cfg.situationCadence;
    return lo + (hi - lo) * this.reactionActivity;
  }

  debug() {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      seed: this.runSeed,
      activity: r2(this.effectiveActivity),
      natural: r2(this.naturalActivity),
      long: r2(this.longNoise),
      short: r2(this.shortNoise),
      impulse: r2(this.eventImpulse),
      fatigue: r2(this.fatigue),
      debt: r2(this.silenceDebt),
      reaction: r2(this.reactionActivity),
      request: r2(this.requestActivity),
      phase: this.phase,
    };
  }
}
