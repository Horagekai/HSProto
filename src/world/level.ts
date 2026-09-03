import * as THREE from 'three';
import { CONFIG, type InspectType } from '../config';
import { Grid, type Rect } from './grid';

/**
 * v2ステージ：入口＝出口の小規模回遊型。
 *
 *                     ┌──── NORTH CORRIDOR ────┐
 *                     │                        │
 *                DOLL ROOM              MIRROR ROOM
 *                     │                        │
 *                     └──── JUNCTION HALL ─────┘
 *                        │                  │
 *                   WEST CORR.         EAST CORR.
 *                        │                  │
 *                     OFFICE ─ MAIN ─ STORAGE
 *                              CORRIDOR
 *                                 │
 *                          ENTRANCE HALL  ← 開始地点かつ唯一の帰還地点
 */
export const ROOMS: Rect[] = [
  { x0: -6, x1: 6, z0: 26, z1: 36 }, // ENTRANCE HALL
  { x0: -2, x1: 2, z0: 0, z1: 26 }, // MAIN CORRIDOR
  { x0: -14, x1: -2, z0: 8, z1: 16 }, // OFFICE
  { x0: 2, x1: 14, z0: 8, z1: 16 }, // STORAGE
  { x0: -14, x1: -10, z0: -4, z1: 16 }, // WEST CORRIDOR
  { x0: 10, x1: 14, z0: -4, z1: 16 }, // EAST CORRIDOR
  { x0: -14, x1: 14, z0: -4, z1: 0 }, // JUNCTION HALL
  { x0: -16, x1: -6, z0: -16, z1: -4 }, // DOLL ROOM
  { x0: 6, x1: 16, z0: -16, z1: -4 }, // MIRROR ROOM
  { x0: -16, x1: 16, z0: -20, z1: -16 }, // NORTH CORRIDOR
];

/** 部屋の境界に壁を立てて、出入口を絞るための矩形 */
export const BLOCKERS: Rect[] = [
  // OFFICE / MAIN CORRIDOR（出入口 z 10.5-13.5）
  { x0: -2.5, x1: -2, z0: 8, z1: 10.5 },
  { x0: -2.5, x1: -2, z0: 13.5, z1: 16 },
  // STORAGE / MAIN CORRIDOR
  { x0: 2, x1: 2.5, z0: 8, z1: 10.5 },
  { x0: 2, x1: 2.5, z0: 13.5, z1: 16 },
  // DOLL ROOM / JUNCTION（出入口 x -10.5 〜 -7.5）
  { x0: -14, x1: -10.5, z0: -4.5, z1: -4 },
  { x0: -7.5, x1: -6, z0: -4.5, z1: -4 },
  // MIRROR ROOM / JUNCTION（出入口 x 7.5 〜 10.5）
  { x0: 6, x1: 7.5, z0: -4.5, z1: -4 },
  { x0: 10.5, x1: 14, z0: -4.5, z1: -4 },
  // DOLL ROOM / NORTH CORRIDOR（出入口 x -12.5 〜 -9.5）
  { x0: -16, x1: -12.5, z0: -16.5, z1: -16 },
  { x0: -9.5, x1: -6, z0: -16.5, z1: -16 },
  // MIRROR ROOM / NORTH CORRIDOR（出入口 x 9.5 〜 12.5）
  { x0: 6, x1: 9.5, z0: -16.5, z1: -16 },
  { x0: 12.5, x1: 16, z0: -16.5, z1: -16 },
];

export const PLAYER_SPAWN = { x: 0, z: 31 };

/**
 * ステージと同じ形状のグリッドを作る。
 * BLOCKERSを渡し忘れると壁のない地形になってしまうので、経路用グリッドは必ずこれで作ること。
 */
export function createNavGrid() {
  return new Grid(ROOMS, 0.5, 2, BLOCKERS);
}

/** 人型怪異が移動先に選ぶ地点 */
export const MONSTER_ANCHORS: Array<{ x: number; z: number }> = [
  { x: 0, z: -18 },
  { x: -11, z: -12 },
  { x: -11, z: -6 },
  { x: 11, z: -12 },
  { x: 11, z: -6 },
  { x: 0, z: -2 },
  { x: -12, z: 4 },
  { x: 12, z: 4 },
  { x: -11, z: 12 },
  { x: 11, z: 12 },
  { x: 0, z: 14 },
  { x: 0, z: 22 },
];

/** Peeking（物陰から半身を覗かせる）に使う出入口付近の地点 */
export const PEEK_ANCHORS: Array<{ x: number; z: number; yaw: number }> = [
  { x: -2.6, z: 12, yaw: Math.PI / 2 },
  { x: 2.6, z: 12, yaw: -Math.PI / 2 },
  { x: -9, z: -4.8, yaw: 0 },
  { x: 9, z: -4.8, yaw: 0 },
  { x: -11, z: -16.6, yaw: Math.PI },
  { x: 11, z: -16.6, yaw: Math.PI },
  { x: -12, z: -2, yaw: -Math.PI / 2 },
  { x: 12, z: -2, yaw: Math.PI / 2 },
  { x: 0, z: 25, yaw: 0 },
];

export interface InspectPoint {
  type: InspectType;
  label: string;
  /** プレイヤーが立つ位置の目安 */
  x: number;
  z: number;
  /** 撮影対象としての高さ */
  height: number;
  object: THREE.Object3D;
  inspected: number;
  discovered: boolean;
  /** 撮り続けたことによる価値の低下 0..1 */
  freshness: number;
  filmedTotal: number;
  /** 段階的な欲張り（見る / 異変 / 触る / 自撮り）の達成状況 */
  tiers: { see: boolean; anomaly: boolean; touch: boolean; selfie: boolean };
}

export interface DoorObject {
  pivot: THREE.Group;
  x: number;
  z: number;
  openAngle: number;
  closedAngle: number;
  /** 0 = 閉、1 = 開 */
  t: number;
  target: number;
}

export interface Level {
  grid: Grid;
  root: THREE.Group;
  inspectPoints: InspectPoint[];
  doors: DoorObject[];
  lamps: Array<{ light: THREE.PointLight; mesh: THREE.Mesh; base: number; x: number; z: number }>;
  /** 蛍光灯の明滅・ドアの開閉補間・入口サインの脈動 */
  update(dt: number, time: number, playerX: number, playerZ: number): void;
  /** 指定位置に最も近い蛍光灯を数回明滅させる */
  flickerLamp(x: number, z: number, duration: number): void;
  dispose(): void;
}

const WALL_HEIGHT = 3.2;

export function buildLevel(scene: THREE.Scene): Level {
  const grid = new Grid(ROOMS, 0.5, 2, BLOCKERS);
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
  const woodMat = keep(new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 }));

  const planeGeo = keep(new THREE.PlaneGeometry(1, 1));
  for (const r of ROOMS) {
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

  // 壁はグリッドの境界セルをインスタンス描画
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
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0x9fb4c8, transparent: true }));
  const lampGeo = keep(new THREE.BoxGeometry(1.3, 0.07, 0.2));
  const lampSpots: Array<[number, number, number]> = [
    [0, 33, 8],
    [0, 28, 7],
    [0, 22, 8],
    [0, 16, 6],
    [0, 10, 7],
    [0, 4, 8],
    [-8, 12, 8],
    [8, 12, 8],
    [-12, 4, 7],
    [12, 4, 7],
    [-12, -2, 7],
    [12, -2, 7],
    [-11, -8, 8],
    [11, -8, 8],
    [-11, -14, 6],
    [11, -14, 6],
    [0, -18, 7],
    [-10, -18, 6],
    [10, -18, 6],
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

  // --- ドア（見た目のみ。当たり判定は持たない） ---
  const doorGeo = keep(new THREE.BoxGeometry(1.9, 2.3, 0.09));
  const doors: DoorObject[] = [];
  /**
   * [ヒンジ位置x, z, 閉じたときのyaw, 開いたときのyaw]
   * 閉じたときに扉板が壁面（＝出入口）を塞ぐ向きになるようにする。
   */
  const doorSpecs: Array<[number, number, number, number]> = [
    // 事務室 / 廊下（x=-2 の壁、出入口は z 10.5-13.5）
    [-2, 10.5, -Math.PI / 2, -Math.PI / 2 + 1.7],
    // 倉庫 / 廊下（x=2 の壁）
    [2, 10.5, -Math.PI / 2, -Math.PI / 2 - 1.7],
    // 人形部屋 / ホール（z=-4 の壁、出入口は x -10.5〜-7.5）
    [-10.5, -4.2, 0, 1.7],
    // 鏡の部屋 / ホール
    [7.5, -4.2, 0, 1.7],
    // 人形部屋 / 北廊下（z=-16 の壁）
    [-12.5, -16.2, 0, -1.7],
    // 鏡の部屋 / 北廊下
    [9.5, -16.2, 0, -1.7],
  ];
  for (const [x, z, closed, open] of doorSpecs) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, z);
    const mesh = new THREE.Mesh(doorGeo, woodMat);
    mesh.position.set(0.95, 1.15, 0);
    mesh.castShadow = true;
    pivot.add(mesh);
    pivot.rotation.y = open;
    root.add(pivot);
    doors.push({ pivot, x, z, openAngle: open, closedAngle: closed, t: 1, target: 1 });
  }

  // --- 調査地点 ---
  const inspectPoints: InspectPoint[] = [];
  const addPoint = (
    type: InspectType,
    label: string,
    x: number,
    z: number,
    height: number,
    object: THREE.Object3D,
  ) => {
    root.add(object);
    inspectPoints.push({
      type,
      label,
      x,
      z,
      height,
      object,
      inspected: 0,
      discovered: false,
      freshness: 1,
      filmedTotal: 0,
      tiers: { see: false, anomaly: false, touch: false, selfie: false },
    });
  };

  // 鏡（MIRROR ROOM 北壁）
  {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(1.7, 2.4, 0.16)), woodMat);
    frame.position.y = 1.4;
    frame.castShadow = true;
    g.add(frame);
    const glassMat = keep(
      new THREE.MeshStandardMaterial({
        color: 0x2a3440,
        roughness: 0.12,
        metalness: 0.9,
        emissive: 0x0c1218,
      }),
    );
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.4, 2.1)), glassMat);
    glass.position.set(0, 1.4, 0.1);
    g.add(glass);
    g.position.set(11, 0, -15.4);
    addPoint('mirror', 'THE MIRROR', 11, -14.2, 1.5, g);
  }

  // 人形（DOLL ROOM 中央）
  {
    const g = new THREE.Group();
    const bodyMat = keep(new THREE.MeshStandardMaterial({ color: 0x8a6b58, roughness: 0.85 }));
    const dress = new THREE.Mesh(keep(new THREE.ConeGeometry(0.22, 0.42, 8)), bodyMat);
    dress.position.y = 0.21;
    dress.castShadow = true;
    g.add(dress);
    const head = new THREE.Mesh(keep(new THREE.SphereGeometry(0.12, 10, 8)), bodyMat);
    head.position.y = 0.54;
    head.castShadow = true;
    g.add(head);
    g.position.set(-11, 0, -10);
    addPoint('doll', 'THE DOLL', -11, -10, 0.5, g);
  }

  // 電話（OFFICE）
  {
    const g = new THREE.Group();
    const desk = new THREE.Mesh(keep(new THREE.BoxGeometry(1.4, 0.75, 0.7)), propMat);
    desk.position.y = 0.38;
    desk.castShadow = true;
    desk.receiveShadow = true;
    g.add(desk);
    const phone = new THREE.Mesh(
      keep(new THREE.BoxGeometry(0.34, 0.14, 0.24)),
      keep(new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6 })),
    );
    phone.position.y = 0.82;
    phone.castShadow = true;
    g.add(phone);
    g.position.set(-11.5, 0, 12);
    addPoint('phone', 'THE PHONE', -11.5, 11, 0.85, g);
  }

  // ロッカー（STORAGE）
  {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const locker = new THREE.Mesh(
        keep(new THREE.BoxGeometry(0.62, 1.9, 0.5)),
        keep(new THREE.MeshStandardMaterial({ color: 0x2f3a3a, roughness: 0.75 })),
      );
      locker.position.set(i * 0.66 - 0.66, 0.95, 0);
      locker.castShadow = true;
      g.add(locker);
    }
    g.position.set(12, 0, 15.3);
    addPoint('locker', 'THE LOCKERS', 12, 14.2, 1.5, g);
  }

  // 古い写真（ENTRANCE HALL の壁）
  {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(1.1, 0.8, 0.08)), woodMat);
    frame.castShadow = true;
    g.add(frame);
    const photo = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(0.9, 0.6)),
      keep(new THREE.MeshStandardMaterial({ color: 0x6b6455, roughness: 0.9 })),
    );
    photo.position.z = 0.05;
    g.add(photo);
    g.position.set(-5.8, 1.7, 29);
    g.rotation.y = Math.PI / 2;
    addPoint('photo', 'THE OLD PHOTO', -4.6, 29, 1.7, g);
  }

  // 祭壇（NORTH CORRIDOR 中央）
  {
    const g = new THREE.Group();
    const base = new THREE.Mesh(keep(new THREE.BoxGeometry(1.6, 0.9, 0.6)), woodMat);
    base.position.y = 0.45;
    base.castShadow = true;
    g.add(base);
    const candleMat = keep(new THREE.MeshBasicMaterial({ color: 0xffb066 }));
    for (let i = 0; i < 3; i++) {
      const candle = new THREE.Mesh(keep(new THREE.BoxGeometry(0.08, 0.22, 0.08)), candleMat);
      candle.position.set(i * 0.4 - 0.4, 1.0, 0);
      g.add(candle);
    }
    const candleLight = new THREE.PointLight(0xff9a4d, 3, 7, 1.8);
    candleLight.position.set(0, 1.2, 0);
    g.add(candleLight);
    g.position.set(0, 0, -19.3);
    addPoint('altar', 'THE ALTAR', 0, -18, 1.1, g);
  }

  // --- 入口（＝出口）の扉とサイン ---
  const exitMat = keep(new THREE.MeshBasicMaterial({ color: 0x35ff7a }));
  const sign = new THREE.Mesh(keep(new THREE.BoxGeometry(2.0, 0.42, 0.12)), exitMat);
  sign.position.set(CONFIG.entrance.x, 2.75, 35.7);
  root.add(sign);
  const exitLight = new THREE.PointLight(0x35ff7a, 1.4, 18, 2);
  exitLight.position.set(CONFIG.entrance.x, 2.2, 34.6);
  root.add(exitLight);
  const doorMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x1d3a28, emissive: 0x0d3a1e, roughness: 0.8 }),
  );
  const entranceDoor = new THREE.Mesh(keep(new THREE.BoxGeometry(2.6, 2.5, 0.2)), doorMat);
  entranceDoor.position.set(CONFIG.entrance.x, 1.25, 35.85);
  root.add(entranceDoor);

  // --- 雑多な小物 ---
  const bedGeo = keep(new THREE.BoxGeometry(1.0, 0.55, 2.1));
  const props: Array<[number, number, number]> = [
    [-13, 10, 0],
    [-13, 14.5, 0.2],
    [13, 10, 0],
    [4.5, 14.5, 1.4],
    [-14.5, -7, 0],
    [-14.5, -13, 0.3],
    [14.5, -7, 0],
    [14.5, -13, -0.2],
    [-4.5, 30, 0.5],
  ];
  for (const [x, z, rot] of props) {
    const bed = new THREE.Mesh(bedGeo, propMat);
    bed.position.set(x, 0.28, z);
    bed.rotation.y = rot;
    bed.castShadow = true;
    bed.receiveShadow = true;
    root.add(bed);
  }

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

      // 点光源は数が多いと重いので、近い順に一定数だけ有効にする
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

      // ドアの開閉補間
      for (const door of doors) {
        if (Math.abs(door.t - door.target) > 0.001) {
          const speed = door.target < door.t ? 9 : 2.2; // 閉まるのは速く
          door.t += Math.sign(door.target - door.t) * Math.min(Math.abs(door.target - door.t), speed * dt);
          door.pivot.rotation.y = door.closedAngle + (door.openAngle - door.closedAngle) * door.t;
        }
      }

      // 明滅
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
