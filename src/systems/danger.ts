import { CONFIG } from '../config';
import type { Framing } from './framing';

export interface DangerInput {
  framing: Framing;
  distance: number;
  /** Selfieで背後に怪異を入れている */
  selfieWithMonster: boolean;
  /**
   * ONE GHOST MODE。
   * 距離そのものがゲームなので、近づくこと自体をもっと強く効かせる。
   */
  oneGhost?: boolean;
}

/**
 * 毎秒のDanger上昇量。
 * ゲーム本体とバランス検証シミュレータで同じ式を使うためにここへ切り出している。
 *
 * v2の方針:
 *   「普通に撮っているだけ」ではほとんど上がらない。
 *   至近距離まで踏み込む・触れる・背中を向ける、といった能動的な行動だけが強く効く。
 */
export function dangerGainPerSecond(input: DangerInput): number {
  const d = CONFIG.danger;
  const { framing, distance } = input;
  let gain = 0;
  if (framing.visible) {
    gain += d.visiblePerSec;
    gain += d.centeredPerSec * framing.center;
    if (framing.center > 0.25 && distance < 20) gain += d.lightPerSec;
  }
  const prox = input.oneGhost ? CONFIG.oneGhost.proximity : d;
  if (distance < prox.proximityRange && framing.los) {
    const t = 1 - distance / prox.proximityRange;
    gain += prox.proximityPerSec * t * t;
  }
  if (distance < d.touchDistance) gain += d.touchPerSec;
  if (input.selfieWithMonster) gain += d.selfiePerSec;
  return gain;
}
