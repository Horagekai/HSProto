import * as THREE from 'three';
import { CONFIG } from '../config';
import { Grid, type Rect } from './grid';
import type { DoorObject, InspectPoint, Level } from './level';

/**
 * HS FLOOR 1 MODE のステージ。本編1階のレイアウトを再現する。
 *
 * ```text
 *   ┌──────────────────────────────────────────┐  z = -16
 *   │  TV  SOFA        DINING        KITCHEN   │
 *   │        (LDK)                    FRIDGE   │
 *   ├──────────────── LDK DOOR ────────────────┤  z = 0
 *   │  CLOSED ROOM   │ 廊下 │       BATH       │
 *   │  (LOCKED)      │PHONE │                  │  z = 4..13
 *   ├────────────────┤      ├──────────────────┤
 *   │  BUTSUMA       │      │  WASHROOM        │
 *   │  仏壇 遺影 押入 │      │  MIRROR / TOILET │  z = 14..27
 *   ├────────────────┴──────┴──────────────────┤
 *   │              ENTRANCE 玄関                │  z = 27..34
 *   └──────────────────────────────────────────┘
 * ```
 *
 * 玄関(0, 33)は開始地点であり唯一の帰還地点。座標は他モードと共有しているので、
 * 帰宅判定・[E]の距離・プレイヤーの開始位置はそのまま使える。
 */
export const FLOOR1_ROOMS: Rect[] = [
  { x0: -7, x1: 7, z0: 27, z1: 34 }, // ENTRANCE 玄関
  { x0: -2.5, x1: 2.5, z0: 0, z1: 27 }, // HALLWAY 廊下
  { x0: -15, x1: -2.5, z0: 13, z1: 27 }, // BUTSUMA 仏間
  { x0: 2.5, x1: 13, z0: 14, z1: 27 }, // WASHROOM 洗面所
  { x0: 2.5, x1: 13, z0: 4, z1: 14 }, // BATH 風呂
  { x0: -15, x1: 15, z0: -16, z1: 0 }, // LDK
];

/** 出入口を絞る壁。廊下から各部屋へは1か所ずつしか入れない */
export const FLOOR1_BLOCKERS: Rect[] = [
  // 仏間 / 廊下（出入口 z 19〜22）
  { x0: -3, x1: -2.5, z0: 13, z1: 19 },
  { x0: -3, x1: -2.5, z0: 22, z1: 27 },
  // 洗面所 / 廊下（出入口 z 20〜23）
  { x0: 2.5, x1: 3, z0: 14, z1: 20 },
  { x0: 2.5, x1: 3, z0: 23, z1: 27 },
  // 風呂 / 洗面所（出入口 x 8〜11）
  { x0: 2.5, x1: 8, z0: 13.5, z1: 14 },
  { x0: 11, x1: 13, z0: 13.5, z1: 14 },
  // LDK / 廊下（出入口 x -2〜2 ＝ LDKのドア）
  { x0: -15, x1: -2, z0: -0.5, z1: 0 },
  { x0: 2, x1: 15, z0: -0.5, z1: 0 },
  // 玄関 / 廊下（出入口 x -2.5〜2.5）
  { x0: -7, x1: -2.5, z0: 26.5, z1: 27 },
  { x0: 2.5, x1: 7, z0: 26.5, z1: 27 },
];

export function createFloor1NavGrid() {
  return new Grid(FLOOR1_ROOMS, 0.5, 2, FLOOR1_BLOCKERS);
}

/** 部屋。Request Director が「今どこにいるか」を見るのに使う */
export type Floor1Room = 'entrance' | 'hallway' | 'butsuma' | 'washroom' | 'bath' | 'ldk';

const ROOM_RECTS: Array<{ room: Floor1Room; r: Rect }> = [
  { room: 'entrance', r: FLOOR1_ROOMS[0] },
  { room: 'hallway', r: FLOOR1_ROOMS[1] },
  { room: 'butsuma', r: FLOOR1_ROOMS[2] },
  { room: 'washroom', r: FLOOR1_ROOMS[3] },
  { room: 'bath', r: FLOOR1_ROOMS[4] },
  { room: 'ldk', r: FLOOR1_ROOMS[5] },
];

export function roomAt(x: number, z: number): Floor1Room {
  for (const { room, r } of ROOM_RECTS) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return room;
  }
  return 'hallway';
}

/** 幽霊が移動先に選ぶ地点。LDKと廊下を中心に */
export const FLOOR1_GHOST_ANCHORS: Array<{ x: number; z: number }> = [
  { x: -9, z: -8 },
  { x: -13, z: -13 },
  { x: 0, z: -8 },
  { x: 11, z: -12 },
  { x: 12, z: -4 },
  { x: 0, z: -3 },
  { x: 0, z: 6 },
  { x: 0, z: 14 },
  { x: 0, z: 22 },
  { x: -11, z: 20 },
  { x: 8, z: 20 },
  { x: 7, z: 8 },
];

export const FLOOR1_PEEK_ANCHORS: Array<{ x: number; z: number }> = [
  { x: 0, z: -1 },
  { x: -2.8, z: 20.5 },
  { x: 2.8, z: 21.5 },
  { x: 9.5, z: 13.8 },
  { x: 0, z: 26.8 },
  { x: -3, z: -2 },
];

/** ステージ内の注目オブジェクト。Discovery と RequestPool の対象になる */
export interface Floor1ObjectSpec {
  id: string;
  /** Discovery トースト用 */
  label: string;
  room: Floor1Room;
  x: number;
  z: number;
  /** 撮影対象としての高さ */
  height: number;
  /** 初回発見のLikes */
  discoveryLikes: number;
  /** 配信映えする対象か。false は Utility（Likesなし） */
  notable: boolean;
  /** 撮影対象としての基礎価値 */
  filmValue: number;
}

export const FLOOR1_OBJECTS: Floor1ObjectSpec[] = [
  { id: 'altar', label: 'THE ALTAR', room: 'butsuma', x: -12.5, z: 15.5, height: 1.1, discoveryLikes: 30, notable: true, filmValue: 34 },
  { id: 'portraits', label: 'FAMILY PORTRAITS', room: 'butsuma', x: -14.4, z: 21, height: 2.0, discoveryLikes: 20, notable: true, filmValue: 28 },
  { id: 'oshiire', label: 'THE CLOSET', room: 'butsuma', x: -14.4, z: 25.5, height: 1.4, discoveryLikes: 15, notable: true, filmValue: 20 },
  { id: 'phone', label: 'OLD PHONE', room: 'hallway', x: 2.2, z: 3.2, height: 0.9, discoveryLikes: 20, notable: true, filmValue: 26 },
  { id: 'mirror', label: 'MIRROR', room: 'washroom', x: 12.5, z: 20, height: 1.5, discoveryLikes: 10, notable: true, filmValue: 24 },
  { id: 'washer', label: 'WASHING MACHINE', room: 'washroom', x: 6, z: 14.6, height: 0.8, discoveryLikes: 0, notable: false, filmValue: 12 },
  { id: 'bath', label: 'FILTHY BATH', room: 'bath', x: 6.5, z: 7.5, height: 0.6, discoveryLikes: 50, notable: true, filmValue: 40 },
  { id: 'fridge', label: 'THE FRIDGE', room: 'ldk', x: 13.4, z: -6, height: 1.4, discoveryLikes: 20, notable: true, filmValue: 30 },
  { id: 'photo', label: 'FAMILY PHOTO', room: 'ldk', x: 0, z: -7.4, height: 0.9, discoveryLikes: 20, notable: true, filmValue: 22 },
  { id: 'tv', label: 'THE TV', room: 'ldk', x: -14, z: -8, height: 1.0, discoveryLikes: 10, notable: true, filmValue: 18 },
  { id: 'sofa', label: 'THE SOFA', room: 'ldk', x: -9.5, z: -8, height: 0.7, discoveryLikes: 0, notable: false, filmValue: 14 },
];

const WALL_HEIGHT = 2.6;

export interface Floor1Level extends Level {
  /** id → シーン上のオブジェクト。状態変化の見た目に使う */
  objects: Map<string, THREE.Object3D>;
  /** 遺影を落とす */
  dropPortrait(): void;
  /** 遺影を掛け直す */
  restorePortrait(): void;
  /** 冷蔵庫の扉 */
  setFridgeOpen(open: boolean): void;
  /** ソファの人影 */
  ghostSeat: THREE.Group;
}

export function buildFloor1Level(scene: THREE.Scene): Floor1Level {
  const grid = createFloor1NavGrid();
  const root = new THREE.Group();
  scene.add(root);
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(o: T) => {
    disposables.push(o);
    return o;
  };
  const objects = new Map<string, THREE.Object3D>();

  const mat = (color: number, rough = 0.9) =>
    keep(new THREE.MeshStandardMaterial({ color, roughness: rough }));
  const floorMat = mat(0x171310, 0.95);
  const tatamiMat = mat(0x3f412c, 0.95);
  const tileMat = mat(0x2b2f33, 0.6);
  const ceilMat = mat(0x0c0c0e, 1);
  const wallMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 0.9, emissive: 0x0a0908 }),
  );
  const woodMat = mat(0x4a3a2c);
  const darkMat = mat(0x1b1b1f);
  const metalMat = keep(new THREE.MeshStandardMaterial({ color: 0x8e969c, roughness: 0.4, metalness: 0.7 }));
  const paleMat = keep(new THREE.MeshBasicMaterial({ color: 0xd9d6cd, side: THREE.DoubleSide }));

  const box = (w: number, h: number, d: number) => keep(new THREE.BoxGeometry(w, h, d));
  const plane = keep(new THREE.PlaneGeometry(1, 1));

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: THREE.Material,
    parent: THREE.Object3D = root,
  ) => {
    const mesh = new THREE.Mesh(box(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // --- 床と天井 ---
  for (const [i, r] of FLOOR1_ROOMS.entries()) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    // 仏間は畳、洗面所と風呂はタイル
    const fm = i === 2 ? tatamiMat : i === 3 || i === 4 ? tileMat : floorMat;
    const f = new THREE.Mesh(plane, fm);
    f.rotation.x = -Math.PI / 2;
    f.scale.set(w, d, 1);
    f.position.set(cx, 0, cz);
    f.receiveShadow = true;
    root.add(f);
    const c = new THREE.Mesh(plane, ceilMat);
    c.rotation.x = Math.PI / 2;
    c.scale.set(w, d, 1);
    c.position.set(cx, WALL_HEIGHT, cz);
    root.add(c);
  }

  // --- 壁 ---
  const cells = grid.wallCells();
  const wallGeo = keep(new THREE.BoxGeometry(grid.cell, WALL_HEIGHT, grid.cell));
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, cells.length);
  walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 3), 3);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  cells.forEach(([ix, iz], i) => {
    m4.makeTranslation(grid.cellX(ix), WALL_HEIGHT / 2, grid.cellZ(iz));
    walls.setMatrixAt(i, m4);
    const t = 0.82 + Math.random() * 0.4;
    col.setRGB(t, t * 0.99, t * 0.95);
    walls.setColorAt(i, col);
  });
  walls.castShadow = true;
  walls.receiveShadow = true;
  walls.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  root.add(walls);

  // --- 照明 ---
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true }));
  const lampGeo = keep(new THREE.BoxGeometry(0.7, 0.06, 0.7));
  const lampSpots: Array<[number, number, number]> = [
    [0, 31, 6],
    [0, 23, 5],
    [0, 16, 5],
    [0, 8, 5],
    [0, 2, 5],
    [-8, 20, 5], // 仏間の吊り下げ照明
    [-12, 24, 3],
    [7, 21, 5],
    [7, 9, 4],
    [0, -4, 6],
    [-9, -9, 5],
    [10, -8, 5],
    [0, -13, 4],
  ];
  const lamps: Level['lamps'] = [];
  for (const [x, z, intensity] of lampSpots) {
    const mesh = new THREE.Mesh(lampGeo, lampMat.clone());
    disposables.push(mesh.material as THREE.Material);
    mesh.position.set(x, WALL_HEIGHT - 0.12, z);
    root.add(mesh);
    const light = new THREE.PointLight(0xffdca8, intensity, CONFIG.render.lampRange, 1.7);
    light.position.set(x, WALL_HEIGHT - 0.3, z);
    root.add(light);
    lamps.push({ light, mesh, base: intensity, x, z });
  }

  // --- 玄関（＝出口） ---
  const exitMat = keep(new THREE.MeshBasicMaterial({ color: 0x35ff7a }));
  const sign = new THREE.Mesh(keep(new THREE.BoxGeometry(1.6, 0.34, 0.1)), exitMat);
  sign.position.set(CONFIG.entrance.x, 2.3, 33.8);
  root.add(sign);
  const exitLight = new THREE.PointLight(0x35ff7a, 1.2, 14, 2);
  exitLight.position.set(CONFIG.entrance.x, 1.9, 33.4);
  root.add(exitLight);
  addBox(2.4, 2.2, 0.16, CONFIG.entrance.x, 1.1, 33.92, keep(
    new THREE.MeshStandardMaterial({ color: 0x243a2a, emissive: 0x0d3a1e, roughness: 0.8 }),
  ));
  // 靴脱ぎ場
  addBox(4, 0.12, 1.6, 0, 0.06, 31.5, darkMat);

  // --- 仏間 ---
  {
    const g = new THREE.Group();
    // 仏壇：他が汚れている中でここだけきれい
    const cab = addBox(1.5, 1.7, 0.7, 0, 0.85, 0, keep(
      new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.35, metalness: 0.25 }),
    ), g);
    cab.castShadow = true;
    addBox(1.2, 0.06, 0.5, 0, 0.95, 0.15, keep(
      new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.8 }),
    ), g);
    // 鈴
    const bell = addBox(0.22, 0.14, 0.22, -0.4, 1.05, 0.2, metalMat, g);
    bell.name = 'bell';
    // ろうそく
    const flameMat = keep(new THREE.MeshBasicMaterial({ color: 0xffb066 }));
    for (const dx of [-0.45, 0.45]) addBox(0.07, 0.2, 0.07, dx, 1.15, 0.05, flameMat, g);
    const candleLight = new THREE.PointLight(0xff9a4d, 2.4, 6, 1.8);
    candleLight.position.set(0, 1.3, 0.2);
    g.add(candleLight);
    g.position.set(-12.5, 0, 15.2);
    root.add(g);
    objects.set('altar', g);
  }

  // 遺影3枚（中央だけ落ちる）
  const portraitGroup = new THREE.Group();
  const portraits: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const pg = new THREE.Group();
    addBox(0.62, 0.78, 0.06, 0, 0, 0, woodMat, pg);
    const face = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.46, 0.6)), paleMat);
    face.position.z = 0.04;
    pg.add(face);
    pg.position.set(-14.6, 1.85, 18 + i * 3);
    pg.rotation.y = Math.PI / 2;
    portraitGroup.add(pg);
    portraits.push(pg);
  }
  root.add(portraitGroup);
  objects.set('portraits', portraitGroup);

  // 押し入れ / ちゃぶ台 / 吊り下げ照明の紐
  addBox(0.3, 2.0, 3.2, -14.7, 1.0, 25.5, woodMat);
  addBox(1.5, 0.34, 1.5, -8, 0.17, 20, woodMat);
  addBox(0.03, 0.5, 0.03, -8, WALL_HEIGHT - 0.45, 20, darkMat);

  // --- 廊下の電話 ---
  {
    const g = new THREE.Group();
    addBox(0.5, 0.9, 0.4, 0, 0.45, 0, woodMat, g);
    addBox(0.34, 0.16, 0.28, 0, 0.98, 0, darkMat, g);
    addBox(0.28, 0.09, 0.1, 0, 1.09, 0.02, darkMat, g);
    g.position.set(2.15, 0, 3.2);
    root.add(g);
    objects.set('phone', g);
  }

  // --- 洗面所 ---
  {
    const g = new THREE.Group();
    addBox(0.3, 1.0, 1.4, 0, 0.5, 0, keep(new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.5 })), g);
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 1.3)), keep(
      new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.1, metalness: 0.95, emissive: 0x0c1218 }),
    ));
    glass.position.set(-0.17, 1.6, 0);
    glass.rotation.y = -Math.PI / 2;
    g.add(glass);
    g.position.set(12.7, 0, 20);
    root.add(g);
    objects.set('mirror', g);
  }
  addBox(1.1, 1.0, 0.8, 6, 0.5, 14.6, keep(new THREE.MeshStandardMaterial({ color: 0xc4c7ca, roughness: 0.55 })));
  // トイレのドア（開かない）
  addBox(0.14, 2.0, 1.0, 12.9, 1.0, 25.5, woodMat);

  // --- 風呂 ---
  {
    const g = new THREE.Group();
    addBox(2.4, 0.7, 1.6, 0, 0.35, 0, keep(new THREE.MeshStandardMaterial({ color: 0xa9adb0, roughness: 0.6 })), g);
    // 汚れた水
    const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.1, 1.3)), keep(
      new THREE.MeshStandardMaterial({ color: 0x3d4a33, roughness: 0.25, metalness: 0.3 }),
    ));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.62;
    water.name = 'water';
    g.add(water);
    g.position.set(6.5, 0, 7.5);
    root.add(g);
    objects.set('bath', g);
  }
  addBox(0.12, 0.5, 0.12, 10.5, 1.8, 6, metalMat); // シャワー

  // --- LDK ---
  // 冷蔵庫（扉が開く）
  {
    const g = new THREE.Group();
    addBox(0.8, 1.8, 0.8, 0, 0.9, 0, keep(new THREE.MeshStandardMaterial({ color: 0xd6d8da, roughness: 0.45 })), g);
    const pivot = new THREE.Group();
    pivot.position.set(-0.4, 0, 0.4);
    const door = addBox(0.78, 1.7, 0.09, 0.39, 0.9, 0, keep(
      new THREE.MeshStandardMaterial({ color: 0xc9cbcd, roughness: 0.45 }),
    ), pivot);
    door.castShadow = true;
    g.add(pivot);
    // 中身（開けたときだけ見える）
    const inner = addBox(0.66, 1.5, 0.6, 0, 0.9, 0.05, keep(
      new THREE.MeshStandardMaterial({ color: 0x241f16, roughness: 1 }),
    ), g);
    inner.name = 'inner';
    g.position.set(13.4, 0, -6);
    g.rotation.y = -Math.PI / 2;
    root.add(g);
    objects.set('fridge', g);
    objects.set('fridgeDoor', pivot);
  }
  // キッチンカウンタ
  addBox(1.0, 0.9, 6, 13.6, 0.45, -12, keep(new THREE.MeshStandardMaterial({ color: 0x6b6f73, roughness: 0.6 })));
  // ダイニングテーブル + 家族写真
  addBox(2.4, 0.1, 1.4, 0, 0.76, -8, woodMat);
  for (const dx of [-1.0, 1.0]) for (const dz of [-0.5, 0.5]) addBox(0.1, 0.76, 0.1, dx, 0.38, -8 + dz, woodMat);
  {
    const g = new THREE.Group();
    addBox(0.5, 0.36, 0.05, 0, 0.18, 0, woodMat, g);
    const ph = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.4, 0.26)), keep(
      new THREE.MeshStandardMaterial({ color: 0x8a8372, roughness: 0.9 }),
    ));
    ph.position.z = 0.035;
    g.add(ph);
    g.position.set(0, 0.82, -7.4);
    g.rotation.x = -0.35;
    root.add(g);
    objects.set('photo', g);
  }
  // TV
  {
    const g = new THREE.Group();
    addBox(0.2, 1.0, 1.7, 0, 0.9, 0, darkMat, g);
    addBox(0.9, 0.5, 1.4, 0.3, 0.25, 0, woodMat, g);
    g.position.set(-14.3, 0, -8);
    root.add(g);
    objects.set('tv', g);
  }
  // ソファ
  {
    const g = new THREE.Group();
    addBox(1.0, 0.45, 2.6, 0, 0.22, 0, keep(new THREE.MeshStandardMaterial({ color: 0x4d4038, roughness: 0.95 })), g);
    addBox(0.35, 0.7, 2.6, -0.35, 0.6, 0, keep(new THREE.MeshStandardMaterial({ color: 0x453a32, roughness: 0.95 })), g);
    g.position.set(-9.5, 0, -8);
    root.add(g);
    objects.set('sofa', g);
  }
  // ソファに座っている人影
  const ghostSeat = new THREE.Group();
  {
    const dark = keep(new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
    addBox(0.42, 0.7, 0.26, 0, 0.78, 0, dark, ghostSeat);
    addBox(0.16, 0.45, 0.16, 0, 0.28, 0.22, dark, ghostSeat);
    const head = new THREE.Mesh(keep(new THREE.SphereGeometry(0.19, 12, 10)), dark);
    head.position.y = 1.28;
    ghostSeat.add(head);
    const face = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.3, 0.38)), paleMat);
    face.position.set(0, 1.28, 0.2);
    ghostSeat.add(face);
    ghostSeat.position.set(-9.3, 0, -8);
    ghostSeat.rotation.y = Math.PI / 2;
    root.add(ghostSeat);
    objects.set('ghostSeat', ghostSeat);
  }

  // --- LDKのドア（見た目のみ） ---
  const doors: DoorObject[] = [];
  {
    const pivot = new THREE.Group();
    pivot.position.set(-2, 0, -0.25);
    const mesh = addBox(1.9, 2.1, 0.08, 0.95, 1.05, 0, woodMat, pivot);
    mesh.castShadow = true;
    pivot.rotation.y = 1.5;
    root.add(pivot);
    doors.push({ pivot, x: -2, z: -0.25, openAngle: 1.5, closedAngle: 0, t: 1, target: 1 });
  }

  const flickers = new Map<number, number>();
  let cullTimer = 0;
  let fridgeT = 0;
  let fridgeTarget = 0;
  const inspectPoints: InspectPoint[] = [];

  return {
    grid,
    root,
    inspectPoints,
    doors,
    lamps,
    objects,
    ghostSeat,
    dropPortrait() {
      const p = portraits[1];
      p.position.y = 0.12;
      p.position.z += 0.5;
      p.rotation.set(-Math.PI / 2.2, Math.PI / 2, 0.3);
    },
    restorePortrait() {
      const p = portraits[1];
      p.position.set(-14.6, 1.85, 21);
      p.rotation.set(0, Math.PI / 2, 0);
    },
    setFridgeOpen(open: boolean) {
      fridgeTarget = open ? 1 : 0;
    },
    update(dt: number, time: number, playerX: number, playerZ: number) {
      exitLight.intensity = 1.1 + Math.sin(time * 3) * 0.25;

      // 冷蔵庫の扉
      if (Math.abs(fridgeT - fridgeTarget) > 0.001) {
        fridgeT += Math.sign(fridgeTarget - fridgeT) * Math.min(Math.abs(fridgeTarget - fridgeT), dt * 3);
        const pivot = objects.get('fridgeDoor');
        if (pivot) pivot.rotation.y = fridgeT * 2.0;
      }

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

      for (const door of doors) {
        if (Math.abs(door.t - door.target) > 0.001) {
          const speed = door.target < door.t ? 9 : 2.2;
          door.t += Math.sign(door.target - door.t) * Math.min(Math.abs(door.target - door.t), speed * dt);
          door.pivot.rotation.y = door.closedAngle + (door.openAngle - door.closedAngle) * door.t;
        }
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
