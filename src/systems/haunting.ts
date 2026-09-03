import { CONFIG } from '../config';
import { clamp, clamp01, lerp } from '../core/util';

/**
 * Haunting = 廃墟全体の活性度。
 * Danger（人型怪異個体の敵意）とは別物で、こちらは「異変の起きやすさ」を司る。
 * 高くても即追跡にはならない。
 */
export class HauntingSystem {
  level = CONFIG.haunting.start;
  /** 直近で上がった量（HUDの脈動用） */
  pulse = 0;

  reset() {
    this.level = CONFIG.haunting.start;
    this.pulse = 0;
  }

  add(amount: number) {
    if (amount <= 0) return;
    this.level = clamp(this.level + amount, 0, CONFIG.haunting.max);
    this.pulse = Math.min(1, this.pulse + amount / 20);
  }

  get normalized() {
    return clamp01(this.level / CONFIG.haunting.max);
  }

  /** 人型怪異が行動を起こす頻度の倍率 */
  get monsterActivity() {
    const a = CONFIG.haunting.monsterActivity;
    return lerp(a.calm, a.active, this.normalized);
  }

  update(dt: number, monsterDistance: number) {
    this.level = clamp(this.level + CONFIG.haunting.perSec * dt, 0, CONFIG.haunting.max);
    if (monsterDistance < 12) {
      this.add(CONFIG.haunting.nearMonsterPerSec * dt * (1 - monsterDistance / 12));
    }
    this.pulse = Math.max(0, this.pulse - dt * 0.8);
  }
}
