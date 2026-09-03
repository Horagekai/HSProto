import { CONFIG } from '../config';

/**
 * ONE GHOST MODE のKPI（§39）。
 *
 * このモードで見たいのは「コンテンツ量」ではなく、
 * プレイヤーが**自分から**どこまで踏み込んだかだけ。
 *   - どこまで近づいたか
 *   - 何回自分から刺激したか
 *   - 一度離れたのに、また撮りに戻ったか  ← 最重要
 *   - 追われている最中に振り返って撮ったか
 *   - 帰れる状態になったのに、もう一度関わったか
 */
export interface OneGhostKpi {
  closestDistance: number;
  heyCount: number;
  secondHeyRate: number;
  retreats: number;
  returns: number;
  returnRate: number;
  chases: number;
  chaseGreed: number;
  chaseGreedRate: number;
  exitOpportunities: number;
  exitOpportunitiesIgnored: number;
  exitIgnoredRate: number;
  escapes: number;
  returnedAfterEscape: number;
}

type Phase = 'far' | 'near';

export class OneGhostStats {
  closestDistance = 999;
  retreats = 0;
  returns = 0;
  chases = 0;
  chaseGreed = 0;
  escapes = 0;
  returnedAfterEscape = 0;
  exitOpportunities = 0;
  exitOpportunitiesIgnored = 0;

  onEvent:
    | ((
        name: 'player_approached' | 'player_retreat_started' | 'player_returned_after_escape',
        detail: string,
      ) => void)
    | null = null;

  /** 怪異との距離の履歴。近い↔遠いの往復を数えるためのヒステリシス */
  private phase: Phase = 'far';
  /** 一度でも近づいたか（近づいていない離脱は「引き返し」に数えない） */
  private everNear = false;
  /** 追跡から逃げ切った直後か */
  private escaped = false;
  /** 入口に立っているか */
  private atExit = false;
  /** 入口に立ったあと、まだ中へ戻っていない */
  private exitPending = false;

  reset() {
    this.closestDistance = 999;
    this.retreats = 0;
    this.returns = 0;
    this.chases = 0;
    this.chaseGreed = 0;
    this.escapes = 0;
    this.returnedAfterEscape = 0;
    this.exitOpportunities = 0;
    this.exitOpportunitiesIgnored = 0;
    this.phase = 'far';
    this.everNear = false;
    this.escaped = false;
    this.atExit = false;
    this.exitPending = false;
  }

  markChase() {
    this.chases += 1;
  }

  /** 追跡中に振り返って撮った */
  markChaseGreed() {
    this.chaseGreed += 1;
  }

  markEscape() {
    this.escapes += 1;
    this.escaped = true;
  }

  update(opts: {
    monsterKnown: boolean;
    distance: number;
    distanceToEntrance: number;
    atEntrance: boolean;
  }) {
    const kpi = CONFIG.oneGhost.kpi;
    if (!opts.monsterKnown) return;

    if (opts.distance < this.closestDistance) this.closestDistance = opts.distance;

    // 近い ↔ 遠い の往復。戻ってきた回数が Retreat → Return Rate になる
    if (this.phase === 'far' && opts.distance <= kpi.approachDistance) {
      this.phase = 'near';
      if (this.everNear) {
        this.returns += 1;
        this.onEvent?.('player_approached', `return #${this.returns}`);
      }
      this.everNear = true;
      if (this.escaped) {
        this.escaped = false;
        this.returnedAfterEscape += 1;
        this.onEvent?.('player_returned_after_escape', `d=${opts.distance.toFixed(1)}`);
      }
    } else if (this.phase === 'near' && opts.distance >= kpi.retreatDistance) {
      this.phase = 'far';
      this.retreats += 1;
      this.onEvent?.('player_retreat_started', `d=${opts.distance.toFixed(1)}`);
    }

    // 帰れる状態になったのに、もう一度中へ入っていった回数
    if (opts.atEntrance && !this.atExit) {
      this.atExit = true;
      this.exitOpportunities += 1;
      this.exitPending = true;
    } else if (!opts.atEntrance && this.atExit) {
      this.atExit = false;
    }
    if (this.exitPending && opts.distanceToEntrance > kpi.reenterDistance) {
      this.exitPending = false;
      this.exitOpportunitiesIgnored += 1;
    }
  }

  kpi(heyCount: number, secondHeyRate: number): OneGhostKpi {
    const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
    return {
      closestDistance: this.closestDistance === 999 ? 0 : Math.round(this.closestDistance * 10) / 10,
      heyCount,
      secondHeyRate,
      retreats: this.retreats,
      returns: this.returns,
      returnRate: rate(this.returns, this.retreats),
      chases: this.chases,
      chaseGreed: this.chaseGreed,
      chaseGreedRate: rate(this.chaseGreed, this.chases),
      exitOpportunities: this.exitOpportunities,
      exitOpportunitiesIgnored: this.exitOpportunitiesIgnored,
      exitIgnoredRate: rate(this.exitOpportunitiesIgnored, this.exitOpportunities),
      escapes: this.escapes,
      returnedAfterEscape: this.returnedAfterEscape,
    };
  }
}
