import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp01 } from '../core/util';
import type { Grid } from '../world/grid';

export interface Framing {
  /** 怪異が画面内にあり、かつ壁に遮られていない */
  visible: boolean;
  /** 画面中央からの近さ 0..1（1 = 中央） */
  center: number;
  /** プレイヤーとの距離 */
  distance: number;
  /** 視線が通っているか（画面外でも真になりうる） */
  los: boolean;
  ndc: { x: number; y: number };
}

const _p = new THREE.Vector3();

/** 画面中央からこの半径（NDC）まで離れるとcenter=0 */
const CENTER_FALLOFF = 0.75;

/**
 * 怪異が「今、配信に映っているか」を判定する。
 * 厳密な撮影採点はしない。頭と胴の2点だけを見る。
 */
export function computeFraming(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
  eye: THREE.Vector3,
  target: THREE.Vector3,
  grid: Grid,
): Framing {
  const distance = Math.hypot(target.x - eye.x, target.z - eye.z);
  const los =
    distance <= CONFIG.render.maxFilmDistance && grid.losClear(eye.x, eye.z, target.x, target.z);

  // レンダラのrender()前に呼ばれても正しく投影できるよう、ここで行列を更新しておく
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  let visible = false;
  let center = 0;
  let ndcX = 0;
  let ndcY = 0;

  for (const point of points) {
    _p.copy(point).project(camera);
    if (_p.z > 1) continue; // カメラ後方
    const inside = Math.abs(_p.x) <= 1 && Math.abs(_p.y) <= 1;
    const r = Math.hypot(_p.x, _p.y);
    const score = clamp01(1 - r / CENTER_FALLOFF);
    if (inside && los) {
      visible = true;
      if (score >= center) {
        center = score;
        ndcX = _p.x;
        ndcY = _p.y;
      }
    }
  }

  return { visible, center, distance, los, ndc: { x: ndcX, y: ndcY } };
}
