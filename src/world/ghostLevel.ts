import * as THREE from 'three';
import { CONFIG } from '../config';
import { Grid, type Rect } from './grid';
import type { DoorObject, InspectPoint, Level } from './level';

/**
 * ONE GHOST MODE のステージ：**一部屋だけ**。
 *
 * ```text
 *   ┌───────────────────────────────┐
 *   │  ▮        ▮        ▮        ▮ │   ← 崩れた柱（視線を切るためだけに置いてある）
 *   │            怪異                │
 *   │  ▮        ▮        ▮        ▮ │
 *   │                               │
 *   │  ▮        ▮        ▮        ▮ │
 *   │            [EXIT]             │   ← 入口＝出口。開始地点でもある
 *   └───────────────────────────────┘
 * ```
 *
 * 廊下も別室も無い。探索する場所が無いので、
 * プレイヤーがやることは「一体との距離をどうするか」だけになる。
 *
 * 入口の座標は通常モードと共有している（CONFIG.entrance = 0, 33）ので、
 * 帰宅判定・[E]の距離・プレイヤーの開始位置はそのまま使える。
 */
export const GHOST_ROOMS: Rect[] = [{ x0: -15, x1: 15, z0: 1, z1: 35 }];

/**
 * 部屋の中に立つ柱。
 * 部屋を分割しない（＝一部屋のまま）が、回り込めば一瞬だけ姿が切れる。
 * 中央の x -3..3 は空けてあり、入口から怪異が見通せる（§4）。
 */
export const GHOST_BLOCKERS: Rect[] = [
  { x0: -11.8, x1: -10.2, z0: 25.2, z1: 26.8 },
  { x0: 10.2, x1: 11.8, z0: 25.2, z1: 26.8 },
  { x0: -6.8, x1: -5.2, z0: 18.2, z1: 19.8 },
  { x0: 5.2, x1: 6.8, z0: 18.2, z1: 19.8 },
  { x0: -11.8, x1: -10.2, z0: 11.2, z1: 12.8 },
  { x0: 10.2, x1: 11.8, z0: 11.2, z1: 12.8 },
  { x0: -6.8, x1: -5.2, z0: 5.2, z1: 6.8 },
  { x0: 5.2, x1: 6.8, z0: 5.2, z1: 6.8 },
];

/** 経路用グリッド。柱を渡し忘れると壁抜けするので必ずこれで作る */
export function createGhostNavGrid() {
  return new Grid(GHOST_ROOMS, 0.5, 2, GHOST_BLOCKERS);
}

/** 怪異が移動先に選ぶ地点。部屋の外周を回るように置く */
export const GHOST_MONSTER_ANCHORS: Array<{ x: number; z: number }> = [
  { x: 0, z: 4 },
  { x: -12, z: 4 },
  { x: 12, z: 4 },
  { x: -13, z: 9 },
  { x: 13, z: 9 },
  { x: 0, z: 13 },
  { x: -13, z: 16 },
  { x: 13, z: 16 },
  { x: -8, z: 22 },
  { x: 8, z: 22 },
  { x: -13, z: 28 },
  { x: 13, z: 28 },
];

/** 柱の陰から半身を出す地点 */
export const GHOST_PEEK_ANCHORS: Array<{ x: number; z: number; yaw: number }> = [
  { x: -6, z: 20.6, yaw: 0 },
  { x: 6, z: 20.6, yaw: 0 },
  { x: -11, z: 27.6, yaw: 0 },
  { x: 11, z: 27.6, yaw: 0 },
  { x: -11, z: 10.2, yaw: Math.PI },
  { x: 11, z: 10.2, yaw: Math.PI },
  { x: -6, z: 4.2, yaw: Math.PI },
  { x: 6, z: 4.2, yaw: Math.PI },
];

const WALL_HEIGHT = 3.2;

export function buildGhostLevel(scene: THREE.Scene): Level {
  const grid = createGhostNavGrid();
  const root = new THREE.Group();
  scene.add(root);
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };

  const floorMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.95, metalness: 0 }),
  );
  const ceilMat = keep(new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 1 }));
  const wallMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.85, emissive: 0x0b0d12 }),
  );
  const propMat = keep(new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.9 }));

  const planeGeo = keep(new THREE.PlaneGeometry(1, 1));
  for (const r of GHOST_ROOMS) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;

    const floor = new THREE.Mesh(planeGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.scale.set(w, d, 1);
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    root.add(floor);

    const ceil = new THREE.Mesh(planeGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.scale.set(w, d, 1);
    ceil.position.set(cx, WALL_HEIGHT, cz);
    root.add(ceil);
  }

  // 外壁と柱はグリッドの境界セルをインスタンス描画
  const cells = grid.wallCells();
  const wallGeo = keep(new THREE.BoxGeometry(grid.cell, WALL_HEIGHT, grid.cell));
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, cells.length);
  walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 3), 3);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  cells.forEach(([ix, iz], i) => {
    m.makeTranslation(grid.cellX(ix), WALL_HEIGHT / 2, grid.cellZ(iz));
    walls.setMatrixAt(i, m);
    // instanceColorはマテリアル色に「乗算」されるので1.0前後で揺らす
    const t = 0.8 + Math.random() * 0.45;
    c.setRGB(t, t * 1.02, t * 1.06);
    walls.setColorAt(i, c);
  });
  walls.castShadow = true;
  walls.receiveShadow = true;
  walls.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  root.add(walls);

  // --- 蛍光灯 ---
  // 部屋の奥ほど暗くして、怪異が「暗がりに立っている」ように見せる
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0x9fb4c8, transparent: true }));
  const lampGeo = keep(new THREE.BoxGeometry(1.3, 0.07, 0.2));
  const lampSpots: Array<[number, number, number]> = [
    [0, 32, 8],
    [-9, 29, 7],
    [9, 29, 7],
    [0, 25, 7],
    [-10, 21, 6],
    [10, 21, 6],
    [0, 17, 6],
    [-10, 13, 6],
    [10, 13, 6],
    [0, 9, 7],
    [-9, 4, 6],
    [9, 4, 6],
  ];
  const lamps: Level['lamps'] = [];
  for (const [x, z, intensity] of lampSpots) {
    const mesh = new THREE.Mesh(lampGeo, lampMat.clone());
    disposables.push(mesh.material as THREE.Material);
    mesh.position.set(x, WALL_HEIGHT - 0.14, z);
    root.add(mesh);
    const light = new THREE.PointLight(0x93b2cf, intensity, CONFIG.render.lampRange, 1.6);
    light.position.set(x, WALL_HEIGHT - 0.35, z);
    root.add(light);
    lamps.push({ light, mesh, base: intensity, x, z });
  }

  // --- 入口（＝出口） ---
  const exitMat = keep(new THREE.MeshBasicMaterial({ color: 0x35ff7a }));
  const sign = new THREE.Mesh(keep(new THREE.BoxGeometry(2.0, 0.42, 0.12)), exitMat);
  sign.position.set(CONFIG.entrance.x, 2.75, 34.7);
  root.add(sign);
  const exitLight = new THREE.PointLight(0x35ff7a, 1.4, 18, 2);
  exitLight.position.set(CONFIG.entrance.x, 2.2, 34.2);
  root.add(exitLight);
  const doorMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x1d3a28, emissive: 0x0d3a1e, roughness: 0.8 }),
  );
  const entranceDoor = new THREE.Mesh(keep(new THREE.BoxGeometry(2.6, 2.5, 0.2)), doorMat);
  entranceDoor.position.set(CONFIG.entrance.x, 1.25, 34.85);
  root.add(entranceDoor);

  // --- 瓦礫（背景。調べられるものは一つも無い） ---
  const bedGeo = keep(new THREE.BoxGeometry(1.0, 0.55, 2.1));
  const props: Array<[number, number, number]> = [
    [-13.6, 31, 0.2],
    [13.6, 31, -0.2],
    [-13.6, 23, 0],
    [13.6, 23, 0.3],
    [-13.6, 15, 0.1],
    [13.6, 15, 0],
    [-13.6, 6, 0.4],
    [13.6, 6, -0.3],
    [-3.4, 2.6, 1.5],
    [3.4, 2.6, 1.5],
  ];
  for (const [x, z, rot] of props) {
    const bed = new THREE.Mesh(bedGeo, propMat);
    bed.position.set(x, 0.28, z);
    bed.rotation.y = rot;
    bed.castShadow = true;
    bed.receiveShadow = true;
    root.add(bed);
  }

  const inspectPoints: InspectPoint[] = [];
  const doors: DoorObject[] = [];
  const flickers = new Map<number, number>();
  let cullTimer = 0;

  return {
    grid,
    root,
    inspectPoints,
    doors,
    lamps,
    update(dt: number, time: number, playerX: number, playerZ: number) {
      exitLight.intensity = 1.3 + Math.sin(time * 3) * 0.3;

      cullTimer -= dt;
      if (cullTimer <= 0) {
        cullTimer = 0.3;
        const sorted = lamps
          .map((lamp, i) => ({ i, d: Math.hypot(lamp.x - playerX, lamp.z - playerZ) }))
          .sort((a, b) => a.d - b.d);
        sorted.forEach((entry, rank) => {
          lamps[entry.i].light.visible = rank < CONFIG.render.maxActiveLamps;
        });
      }

      for (const [index, left] of flickers) {
        const lamp = lamps[index];
        const remain = left - dt;
        if (remain <= 0) {
          flickers.delete(index);
          lamp.light.intensity = lamp.base;
          (lamp.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
          continue;
        }
        flickers.set(index, remain);
        const n = Math.sin(time * 41) * Math.sin(time * 13.7);
        const on = n > -0.35 ? 1 : 0.05 + Math.random() * 0.2;
        lamp.light.intensity = lamp.base * on;
        (lamp.mesh.material as THREE.MeshBasicMaterial).opacity = on;
      }
    },
    flickerLamp(x: number, z: number, duration: number) {
      let best = -1;
      let bestDist = Infinity;
      lamps.forEach((lamp, i) => {
        const d = Math.hypot(lamp.x - x, lamp.z - z);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best >= 0) flickers.set(best, duration);
    },
    dispose() {
      scene.remove(root);
      walls.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
