import { CONFIG, type MonsterState } from '../config';
import { clamp, clamp01, damp, randRange } from '../core/util';
import type { Framing } from './framing';

/** 今フレームの撮影候補（人型怪異・異変・調査地点） */
export interface FilmCandidate {
  key: string;
  label: string;
  framing: Framing;
  /** 基礎価値 */
  base: number;
  /** 同じものを撮り続けたことによる価値低下 0..1 */
  freshness: number;
  isMonster: boolean;
  monsterState?: MonsterState;
  monsterMoving?: boolean;
  monsterLooking?: boolean;
}

export interface StreamInput {
  candidates: FilmCandidate[];
  chasing: boolean;
  /** Selfieに怪異が入っているか、その距離 */
  selfieActive: boolean;
  selfieMonsterInFrame: boolean;
  selfieMonsterDistance: number;
}

interface Boost {
  amount: number;
  timeLeft: number;
}

/**
 * 配信の数値（Viewer / Engagement / Clip Value / Likes / 収益）。
 *
 * 設計の核心:
 *   安全な映像 = 退屈 = 数字が伸びない
 *   危険な映像 = 面白い = 数字が伸びる
 * v2では被写体が複数になったので、「今いちばん価値のある被写体」を毎フレーム選ぶ。
 */
export class StreamSystem {
  viewers = 0;
  likes = 0;
  /** 円。Likesから積み上がる分とリクエスト報酬の合計 */
  earnings = 0;
  engagement = 1;
  clipRaw = 0;
  clipEffective = 0;
  chaseMultiplier = 1;
  selfieMultiplier = 1;
  stars = 0;
  /** 今撮っているもの */
  subject: string | null = null;

  peakViewers = 0;
  maxEngagement = 1;
  maxStars = 0;
  /** 良い映像が撮れていない時間 */
  idleTime = 0;

  private boosts: Boost[] = [];
  private surge = 0;

  reset() {
    this.viewers = Math.round(
      randRange(CONFIG.stream.startViewers[0], CONFIG.stream.startViewers[1]),
    );
    this.likes = 0;
    this.earnings = 0;
    this.engagement = 1;
    this.clipRaw = 0;
    this.clipEffective = 0;
    this.chaseMultiplier = 1;
    this.selfieMultiplier = 1;
    this.stars = 0;
    this.subject = null;
    this.peakViewers = this.viewers;
    this.maxEngagement = 1;
    this.maxStars = 0;
    this.idleTime = 0;
    this.boosts = [];
    this.surge = 0;
  }

  addBoost(amount: number, duration: number) {
    this.boosts.push({ amount, timeLeft: duration });
  }

  spikeViewers(factor: number) {
    this.viewers = Math.min(CONFIG.stream.maxViewers, this.viewers * factor);
  }

  addLikes(n: number) {
    this.likes += n;
    this.earnings += n * CONFIG.stream.yenPerLike;
  }

  /** リクエスト報酬など、円で直接入る収益 */
  addEarnings(yen: number) {
    this.earnings += yen;
  }

  setSurge(strength: number) {
    this.surge = strength;
  }

  private valueOf(c: FilmCandidate): number {
    const clip = CONFIG.stream.clip;
    const f = c.framing;
    if (!f.visible) return 0;
    const prox = clamp01((clip.maxDistance - f.distance) / (clip.maxDistance - clip.minDistance));
    let raw = c.base + clip.centerWeight * f.center + clip.proximityWeight * prox;
    if (c.isMonster) {
      raw += clip.monsterStateBonus[c.monsterState ?? 'dormant'];
      if (c.monsterMoving) raw += clip.movingBonus;
      if (c.monsterLooking) raw += clip.lookingAtYouBonus;
    }
    return raw * c.freshness;
  }

  update(dt: number, input: StreamInput) {
    const clip = CONFIG.stream.clip;

    // --- Clip Value：いちばん価値の高い被写体を選ぶ ---
    let best: FilmCandidate | null = null;
    let bestValue = 0;
    for (const c of input.candidates) {
      const v = this.valueOf(c);
      if (v > bestValue) {
        bestValue = v;
        best = c;
      }
    }
    this.subject = best ? best.label : null;
    this.clipRaw = damp(this.clipRaw, bestValue, clip.smooth, dt);

    // 逃走中に振り返って撮る = 最大の価値
    let mult = 1;
    if (input.chasing && best?.isMonster && best.framing.visible) {
      mult =
        best.framing.center >= clip.chaseCenterThreshold
          ? clip.chaseCenteredMultiplier
          : clip.chaseFilmMultiplier;
    }
    this.chaseMultiplier = mult;

    // Selfieに怪異が入っているとさらに倍率がかかる（近いほど高い）
    let selfie = 1;
    if (input.selfieActive && input.selfieMonsterInFrame) {
      const s = clip.selfieMultiplier;
      const t = clamp01(
        (s.farDistance - input.selfieMonsterDistance) / (s.farDistance - s.nearDistance),
      );
      selfie = s.far + (s.near - s.far) * t;
    }
    this.selfieMultiplier = selfie;

    this.clipEffective = this.clipRaw * mult * selfie;

    this.stars = clip.starThresholds.reduce(
      (n, threshold) => (this.clipEffective >= threshold ? n + 1 : n),
      0,
    );
    this.maxStars = Math.max(this.maxStars, this.stars);

    // --- Engagement ---
    const e = CONFIG.stream.engagement;
    let boostSum = 0;
    for (const b of this.boosts) {
      b.timeLeft -= dt;
      if (b.timeLeft > 0) boostSum += b.amount;
    }
    this.boosts = this.boosts.filter((b) => b.timeLeft > 0);

    const engTarget =
      e.min +
      clamp01(this.clipRaw / 100) * e.clipGain +
      (input.chasing && best?.isMonster && best.framing.visible ? e.chaseFilmBonus : 0) +
      boostSum +
      this.surge * 2;
    const engSpeed = engTarget > this.engagement ? e.riseSpeed : e.fallSpeed;
    this.engagement = clamp(damp(this.engagement, engTarget, engSpeed, dt), e.min, e.max);
    this.maxEngagement = Math.max(this.maxEngagement, this.engagement);

    // --- Viewers ---
    const st = CONFIG.stream;
    const x = clamp01(this.clipEffective / st.viewerClipRef);
    const target =
      st.viewerBase *
      Math.pow(10, st.viewerExponent * Math.sqrt(x)) *
      (1 + (this.engagement - 1) * st.viewerEngInfluence);
    if (this.clipEffective > 5) this.idleTime = 0;
    else this.idleTime += dt;
    const speed = target > this.viewers ? st.viewerRiseSpeed : st.viewerDecaySpeed;
    this.viewers = clamp(damp(this.viewers, target, speed, dt), st.minViewers, st.maxViewers);
    if (this.surge > 0) {
      this.viewers = Math.min(st.maxViewers, this.viewers * (1 + st.surgeGrowth * this.surge * dt));
    }
    this.peakViewers = Math.max(this.peakViewers, this.viewers);

    // --- Likes / 収益 ---
    const viewerFactor = clamp(
      st.likeViewerFloor + this.viewers / st.likeViewerScale,
      st.likeViewerFloor,
      st.likeViewerCap,
    );
    const likeRate =
      (this.clipEffective / 100) *
      (1 + (this.engagement - 1) * st.likeEngInfluence) *
      st.likesPerSec *
      viewerFactor;
    const gained = likeRate * dt * (1 + this.surge * 6);
    this.likes += gained;
    this.earnings += gained * st.yenPerLike;
  }
}
