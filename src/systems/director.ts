import { CONFIG } from '../config';

export type EventKind =
  | 'anomaly'
  | 'discovery'
  | 'inspect'
  | 'request_offer'
  | 'request_complete'
  | 'temptation'
  | 'monster_appear'
  | 'phone'
  | 'selfie_bonus'
  | 'chase'
  | 'forced';

/** プレイヤーに「やる / やらない」を突きつけた瞬間 */
export type DecisionKind = 'request' | 'temptation' | 'phone' | 'cashout';

export interface TempoStats {
  playTime: number;
  events: number;
  decisions: number;
  avgEventGap: number;
  avgDecisionGap: number;
  longestQuiet: number;
  forcedEvents: number;
}

/**
 * テンポの監視役。
 *
 * このゲームの敵は「怖くないこと」ではなく「何も起きない時間」。
 * 一定時間なにも起きなければ、ディレクターが強制的にイベントを要求する。
 * 同時に、リザルトで見せるテンポ分析の材料も集める。
 */
export class Director {
  /** 最後に意味のあることが起きてからの秒数 */
  sinceEvent = 0;
  /** 最後に意思決定を迫ってからの秒数 */
  sinceDecision = 0;
  elapsed = 0;

  private eventGaps: number[] = [];
  private decisionGaps: number[] = [];
  private longestQuiet = 0;
  private forceCooldown = 0;
  private forced = 0;
  private log: Array<{ t: number; kind: EventKind }> = [];

  reset() {
    this.sinceEvent = 0;
    this.sinceDecision = 0;
    this.elapsed = 0;
    this.eventGaps = [];
    this.decisionGaps = [];
    this.longestQuiet = 0;
    this.forceCooldown = 0;
    this.forced = 0;
    this.log = [];
  }

  markEvent(kind: EventKind) {
    this.eventGaps.push(this.sinceEvent);
    this.longestQuiet = Math.max(this.longestQuiet, this.sinceEvent);
    this.sinceEvent = 0;
    if (kind === 'forced') this.forced += 1;
    this.log.push({ t: Math.round(this.elapsed * 10) / 10, kind });
  }

  markDecision(_kind: DecisionKind) {
    this.decisionGaps.push(this.sinceDecision);
    this.sinceDecision = 0;
  }

  update(dt: number) {
    this.elapsed += dt;
    this.sinceEvent += dt;
    this.sinceDecision += dt;
    this.forceCooldown = Math.max(0, this.forceCooldown - dt);
  }

  /** 静かすぎるので何か起こすべきか */
  get needsEvent() {
    return this.sinceEvent > CONFIG.tempo.quietLimit && this.forceCooldown <= 0;
  }

  /** 意思決定が途切れているので、リクエストを前倒しすべきか */
  get needsDecision() {
    return this.sinceDecision > CONFIG.tempo.decisionLimit;
  }

  consumeForce() {
    this.forceCooldown = CONFIG.tempo.forceCooldown;
  }

  stats(): TempoStats {
    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;
    return {
      playTime: Math.round(this.elapsed * 10) / 10,
      events: this.eventGaps.length,
      decisions: this.decisionGaps.length,
      avgEventGap: avg(this.eventGaps),
      avgDecisionGap: avg(this.decisionGaps),
      longestQuiet: Math.round(Math.max(this.longestQuiet, this.sinceEvent) * 10) / 10,
      forcedEvents: this.forced,
    };
  }

  timeline() {
    return this.log;
  }
}
