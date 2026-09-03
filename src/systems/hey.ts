import { CONFIG } from '../config';
import { clamp01, pick, randRange } from '../core/util';
import type { MonsterState } from '../config';

export type HeyResponse =
  /** 何も返ってこない（遠すぎる / 気づかれていない） */
  | 'silence'
  /** 姿は見えないが、音で位置が分かる */
  | 'reveal'
  /** こちらを見た */
  | 'look'
  /** 数歩近づいた */
  | 'step'
  /** 近づき始めた */
  | 'approach'
  /** 別の場所へ移動した */
  | 'relocate'
  /** 距離を保って付いてくるようになった */
  | 'stalk'
  /** 突進フェイント */
  | 'lunge'
  /** 短時間の追跡 */
  | 'rush'
  /** 今は返事がない。数秒後に返ってくる */
  | 'delayed';

export interface HeyContext {
  distance: number;
  monsterVisible: boolean;
  monsterKnown: boolean;
  monsterState: MonsterState;
  haunting: number;
  selfie: boolean;
  lightsOff: boolean;
}

export interface HeyResult {
  response: HeyResponse;
  /** Dangerの上昇量 */
  danger: number;
  likes: number;
  viewerSpike: number;
  streak: number;
  /** 遅延反応のときの待ち時間 */
  delay: number;
}

/**
 * HEY（呼びかけ）。
 *
 * 設計方針:
 *  - 「Danger+25のボタン」にしない。情報・誘導・撮れ高という明確な利益がある
 *  - 押した結果がどうなるかは、距離・Haunting・連打回数で変わる
 *  - 「4回目で必ず追跡」のような固定パターンにはしない
 */
export class HeySystem {
  /**
   * ONE GHOST MODE。
   * 怪異が一体しかいないので、HEYは「関係を変える基本操作」になる。
   * 1回目=見る / 2回目=近づく / 3回目=Stalking を保証し、4回目以降だけ幅を持たせる（§22-25）。
   */
  oneGhost = false;
  /** 連打回数。プレイヤーには数字を見せない */
  streak = 0;
  total = 0;
  cooldown = 0;
  /** 遅延反応の残り時間 */
  pending = 0;
  pendingResponse: HeyResponse = 'silence';

  private streakTimer = 0;

  reset() {
    this.streak = 0;
    this.total = 0;
    this.cooldown = 0;
    this.pending = 0;
    this.streakTimer = 0;
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.streak > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) this.streak = 0;
    }
    if (this.pending > 0) {
      this.pending -= dt;
      if (this.pending <= 0) return this.pendingResponse;
    }
    return null;
  }

  get ready() {
    return this.cooldown <= 0;
  }

  use(ctx: HeyContext): HeyResult {
    const cfg = CONFIG.hey;
    this.cooldown = cfg.cooldown;
    this.total += 1;
    this.streak += 1;
    this.streakTimer = cfg.streakWindow;

    const inRange = ctx.distance <= cfg.range;
    const proximity = clamp01(1 - ctx.distance / cfg.range);
    const haunt = clamp01(ctx.haunting / CONFIG.haunting.max);

    // --- Danger ---
    // ONE GHOST MODE は「押した回数がそのまま関係の段階」なので、上がり方を緩くする
    const dangerCfg = this.oneGhost ? CONFIG.oneGhost.hey : cfg;
    const tier =
      dangerCfg.streakDanger[Math.min(this.streak - 1, dangerCfg.streakDanger.length - 1)];
    const distanceMult =
      dangerCfg.distanceScale.far +
      (dangerCfg.distanceScale.near - dangerCfg.distanceScale.far) * proximity;
    const danger = inRange ? tier * distanceMult : 0;

    // --- 報酬 ---
    const likes = ctx.selfie && ctx.monsterVisible
      ? cfg.likes.selfie
      : ctx.monsterVisible
        ? cfg.likes.onScreen
        : cfg.likes.base;
    const viewerSpike = ctx.monsterVisible ? cfg.viewerSpike.onScreen : cfg.viewerSpike.base;

    // --- 反応の決定 ---
    let response: HeyResponse = 'silence';
    let delay = 0;

    if (!inRange) {
      response = 'silence';
    } else if (Math.random() < cfg.delayedChance * (0.4 + haunt)) {
      // Hauntingが高いほど「今は返事がない」が増える。数秒後に返ってくる
      response = 'delayed';
      delay = randRange(cfg.delay.min, cfg.delay.max);
      this.pending = delay;
      this.pendingResponse = this.pickReaction(ctx, proximity, haunt, true);
    } else {
      response = this.pickReaction(ctx, proximity, haunt, false);
    }

    return { response, danger, likes, viewerSpike, streak: this.streak, delay };
  }

  /** 実際の反応を選ぶ。同じ入力でも状態次第で強さが変わる */
  private pickReaction(
    ctx: HeyContext,
    proximity: number,
    haunt: number,
    afterDelay: boolean,
  ): HeyResponse {
    const pool: HeyResponse[] = [];

    // ONE GHOST MODE：3回目までは「押した回数がそのまま関係の段階になる」
    if (this.oneGhost && ctx.monsterVisible) {
      if (this.streak === 1) return 'look';
      if (this.streak === 2) return 'approach';
      if (this.streak === 3) return proximity > 0.6 ? 'lunge' : 'stalk';
    }

    if (!ctx.monsterVisible) {
      // 姿が見えないときは「位置が分かる」返しを厚くする（情報としての価値）
      pool.push('reveal', 'reveal', 'step');
      if (haunt > 0.35) pool.push('approach', 'relocate');
      if (haunt > 0.6 || afterDelay) pool.push('stalk');
    } else {
      pool.push('look', 'look', 'step');
      if (this.streak >= 2) pool.push('approach', 'step');
      if (this.streak >= 3 || haunt > 0.45) pool.push('stalk', 'approach');
      if ((this.streak >= 4 || haunt > 0.7) && proximity > 0.35) pool.push('lunge');
      if (this.streak >= 4 && haunt > 0.55 && ctx.monsterState !== 'dormant') pool.push('rush');
    }
    // 至近距離で連打すれば、当然もっと強い反応が返る
    if (proximity > 0.7 && this.streak >= 3) pool.push('lunge');

    return pick(pool);
  }
}
