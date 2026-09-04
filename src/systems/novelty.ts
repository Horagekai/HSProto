import { CONFIG } from '../config';

/**
 * Novelty（撮れ高の新規性）。
 *
 * このゲームの経済の中心。
 *
 *   安全 + 既知      → 低報酬
 *   新規            → 中報酬
 *   危険 + 新規      → 高報酬
 *   自分から危険を起こした瞬間 → 非常に高報酬
 *
 * 評価単位は **Object そのものではなく Object + State**。
 * 鏡を永久に価値0にはしない。同じ状態を繰り返すと枯れるが、
 * 鏡の中に何かが映れば別の状態として価値が戻る。
 *
 * 重要な制約:
 *   **時間経過だけでは絶対に復活させない。**
 *   「鏡を見る → 30秒待つ → また同じ報酬」を作らないため、
 *   ここには一切のタイマー回復を置いていない。復活は世界の状態が変わったときだけ。
 */

/** 倍率テーブル。index = 同じ状態を見た回数（0 = 初回） */
export type NoveltyTable = readonly number[];

export interface NoveltyResult {
  key: string;
  subject: string;
  state: string;
  /** 0 = 初回 */
  repeat: number;
  multiplier: number;
}

interface Record {
  subject: string;
  state: string;
  /** 報酬を与えた回数 */
  count: number;
  firstSeen: number;
  lastRewarded: number;
}

export class NoveltySystem {
  /** ONE GHOST MODE では使わない（被写体が一体しか無く、枯らすと成立しないため） */
  enabled = true;

  private records = new Map<string, Record>();
  /** subject ごとの現在の状態。変化を検出してイベントを出すため */
  private current = new Map<string, string>();
  private elapsed = 0;

  /** 状態が変わった瞬間に呼ばれる（ログ用） */
  onStateChange: ((subject: string, from: string, to: string) => void) | null = null;

  // --- KPI ---
  /** 3回以上繰り返した (subject,state) の数 */
  repeatFarmed = 0;
  /** 枯れた直後に「別の対象 / 新しい状態」へ移った回数 */
  noveltySeekHits = 0;
  noveltySeekChances = 0;
  /** 枯れた直後に「自分から危険を作った」回数（HEY / 接近 / Selfie / リクエスト達成） */
  riskReigniteHits = 0;
  /** 安全（Risk≒1）かつ既知（Novelty低）で稼いだ Likes */
  safeFarmLikes = 0;
  totalLikes = 0;

  /** 直近で枯れた subject。これを見張って Novelty Seeking / Risk Reignite を判定する */
  private staleSubject: string | null = null;
  private staleAt = 0;

  reset() {
    this.records.clear();
    this.current.clear();
    this.elapsed = 0;
    this.repeatFarmed = 0;
    this.noveltySeekHits = 0;
    this.noveltySeekChances = 0;
    this.riskReigniteHits = 0;
    this.safeFarmLikes = 0;
    this.totalLikes = 0;
    this.staleSubject = null;
    this.staleAt = 0;
  }

  update(dt: number) {
    this.elapsed += dt;
    // 枯れてから一定時間内の行動だけを「反応」とみなす
    if (this.staleSubject && this.elapsed - this.staleAt > CONFIG.novelty.reigniteWindow) {
      this.staleSubject = null;
    }
  }

  private static keyOf(subject: string, state: string) {
    return `${subject}|${state}`;
  }

  private tableFor(subject: string): NoveltyTable {
    return CONFIG.novelty.tables[subject] ?? CONFIG.novelty.table;
  }

  /** 報酬を与えずに、今の倍率だけ見る */
  peek(subject: string, state: string): number {
    if (!this.enabled) return 1;
    const rec = this.records.get(NoveltySystem.keyOf(subject, state));
    const table = this.tableFor(subject);
    const i = rec ? rec.count : 0;
    return i < table.length ? table[i] : table[table.length - 1];
  }

  /**
   * その (subject, state) で報酬を受け取る。
   * 呼ぶたびに回数が増え、次回の倍率が下がる。
   */
  consume(subject: string, state: string): NoveltyResult {
    const key = NoveltySystem.keyOf(subject, state);
    if (!this.enabled) {
      return { key, subject, state, repeat: 0, multiplier: 1 };
    }
    const table = this.tableFor(subject);
    let rec = this.records.get(key);
    if (!rec) {
      rec = { subject, state, count: 0, firstSeen: this.elapsed, lastRewarded: this.elapsed };
      this.records.set(key, rec);
    }
    const repeat = rec.count;
    const multiplier = repeat < table.length ? table[repeat] : table[table.length - 1];
    rec.count += 1;
    rec.lastRewarded = this.elapsed;
    if (rec.count === 3) this.repeatFarmed += 1;

    // 枯れた瞬間を記録しておく（次に何をするかがKPI）
    const next = rec.count < table.length ? table[rec.count] : table[table.length - 1];
    if (next <= CONFIG.novelty.staleThreshold) {
      if (this.staleSubject !== subject) {
        this.staleSubject = subject;
        this.staleAt = this.elapsed;
        this.noveltySeekChances += 1;
      }
    }
    return { key, subject, state, repeat, multiplier };
  }

  /**
   * subject の状態が変わったことを通知する。
   * 新しい状態なら、その状態の Novelty は満額から始まる（＝価値が戻る）。
   */
  setState(subject: string, state: string) {
    const prev = this.current.get(subject);
    if (prev === state) return;
    this.current.set(subject, state);
    if (prev !== undefined) {
      this.onStateChange?.(subject, prev, state);
      // 枯れていた対象の状態が変わったなら、それは「新しいものを見に行った」結果
      if (this.staleSubject === subject) {
        this.noveltySeekHits += 1;
        this.staleSubject = null;
      }
    }
  }

  stateOf(subject: string) {
    return this.current.get(subject) ?? '';
  }

  /** 別の対象へ移った（Novelty Seeking） */
  markSwitchedSubject(subject: string) {
    if (this.staleSubject && this.staleSubject !== subject) {
      this.noveltySeekHits += 1;
      this.staleSubject = null;
    }
  }

  /** 枯れたあとに自分から危険を作った（HEY / 接近 / Selfie / リクエスト達成） */
  markRiskReignite() {
    if (!this.staleSubject) return;
    this.riskReigniteHits += 1;
    this.noveltySeekHits += 1;
    this.staleSubject = null;
  }

  /** Likesを記録する。安全かつ既知で稼いだ分を切り分ける */
  recordLikes(likes: number, risk: number, novelty: number) {
    this.totalLikes += likes;
    if (risk <= CONFIG.novelty.safeRiskCeiling && novelty <= CONFIG.novelty.staleThreshold) {
      this.safeFarmLikes += likes;
    }
  }

  /** 今この対象が「もう飽きられている」か（コメント用） */
  isStale(subject: string, state: string) {
    return this.enabled && this.peek(subject, state) <= CONFIG.novelty.staleThreshold;
  }

  stats() {
    const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
    return {
      trackedStates: this.records.size,
      repeatFarmed: this.repeatFarmed,
      noveltySeekRate: rate(this.noveltySeekHits, this.noveltySeekChances),
      riskReigniteRate: rate(this.riskReigniteHits, this.noveltySeekChances),
      staleChances: this.noveltySeekChances,
      safeFarmShare: rate(this.safeFarmLikes, this.totalLikes),
    };
  }

  /** デバッグパネル用 */
  debugRows(limit = 6) {
    return [...this.records.values()]
      .sort((a, b) => b.lastRewarded - a.lastRewarded)
      .slice(0, limit)
      .map((r) => ({ key: `${r.subject}|${r.state}`, count: r.count }));
  }
}

/**
 * Risk 倍率。
 *
 * 「Danger / 100」のような単一の値では決めない（§22）。
 * 距離・怪異の段階・Selfie・ライト・直前のHEY・背中を向けているか、
 * といった**プレイヤーが自分で選んだ状況**の重ね合わせで決める。
 *
 * 追跡中は既存の chaseFilmMultiplier(×4〜6) が別に掛かるので、ここでは加算しない。
 */
export interface RiskInput {
  monsterVisible: boolean;
  monsterDistance: number;
  monsterState: string;
  monsterBehavior: string;
  selfieWithMonster: boolean;
  lightsOff: boolean;
  /** 直前にHEYを使ってからの秒数 */
  sinceHey: number;
  chasing: boolean;
  /** 怪異が近いのに画面に入れていない（背中を向けている） */
  backTurnedNear: boolean;
}

export function riskMultiplier(input: RiskInput): number {
  const cfg = CONFIG.novelty.risk;
  let r = 1;
  if (input.monsterVisible || input.backTurnedNear) {
    if (input.monsterDistance < cfg.nearDistance) r += cfg.near;
    else if (input.monsterDistance < cfg.midDistance) r += cfg.mid;
    else if (input.monsterDistance < cfg.farDistance) r += cfg.far;
  }
  r += cfg.state[input.monsterState] ?? 0;
  if (input.monsterBehavior === 'stalking') r += cfg.stalking;
  if (input.monsterBehavior === 'lunging') r += cfg.lunging;
  if (input.selfieWithMonster) r += cfg.selfie;
  if (input.lightsOff) r += cfg.lightsOff;
  if (input.sinceHey < cfg.heyWindow) r += cfg.recentHey;
  if (input.backTurnedNear) r += cfg.backTurned;
  return Math.min(cfg.max, r);
}
