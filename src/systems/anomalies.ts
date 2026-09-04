import * as THREE from 'three';
import { CONFIG, type AnomalyType, type InspectType } from '../config';
import { clamp01, pick, randRange } from '../core/util';
import type { Level } from '../world/level';
import type { Grid } from '../world/grid';

export interface ActiveAnomaly {
  id: number;
  type: AnomalyType;
  label: string;
  x: number;
  z: number;
  height: number;
  timeLeft: number;
  /** Clip Valueの基礎値 */
  value: number;
  /** 撮り続けたことによる価値低下 0..1 */
  freshness: number;
  filmed: number;
  witnessed: boolean;
  /** 電話のように操作できるもの */
  interactive: boolean;
  /** 紐づく調査地点（リクエスト生成に使う） */
  pointType?: InspectType;
  object?: THREE.Object3D;
  onEnd?: () => void;
}

const LABEL: Record<AnomalyType, string> = {
  door_slam: 'THE DOOR CLOSED',
  light_flicker: 'SOMETHING IN THE HALL',
  doll_moved: 'THE DOLL MOVED',
  mirror_figure: 'SOMETHING IN THE MIRROR',
  phone_ring: 'THE PHONE IS RINGING',
  noise: 'SOMETHING FELL',
  shadow_figure: 'SOMETHING IN THE HALL',
};

export interface AnomalyContext {
  playerPos: THREE.Vector3;
  playerYaw: number;
  grid: Grid;
  haunting: number;
  /** その位置が今プレイヤーの画面に映っているか */
  isVisible(x: number, z: number, height: number): boolean;
}

/**
 * 「プレイヤーを殺さない異変」を管理する。
 * v2ではこれがコンテンツの主役で、人型怪異は数ある被写体のひとつになる。
 */
export class AnomalySystem {
  /**
   * 自動発生。ONE GHOST MODE では false にして、環境怪異を止める（§32）。
   * 主役は一体の怪異なので、静かな時間はディレクターが怪異自身を動かして埋める。
   */
  autoSpawn = true;
  active: ActiveAnomaly[] = [];
  /** 種類ごとの初回発見 */
  discovered = new Set<AnomalyType>();
  /** 電話が鳴っている間だけtrue */
  phoneRinging = false;

  onSpawn: ((a: ActiveAnomaly) => void) | null = null;
  onDiscovered: ((a: ActiveAnomaly) => void) | null = null;
  onSound: ((type: AnomalyType, x: number, z: number, distance: number) => void) | null = null;

  private nextId = 1;
  private timer = CONFIG.anomaly.firstDelay;
  /** 調査によって予約された異変 */
  private scheduled: Array<{ type: AnomalyType; delay: number }> = [];
  private lastType: AnomalyType | null = null;
  private apparitions: THREE.Group[] = [];
  private debris: THREE.Mesh[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private dollHome = { x: -11, z: -10 };
  /** 直近の異変の位置（「音を確かめろ」「追え」の目的地） */
  lastSpot: { x: number; z: number } | null = null;

  constructor(
    private scene: THREE.Scene,
    private level: Level,
  ) {
    // 使い回す人影と落下物をあらかじめ作っておく
    const dark = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 });
    const pale = new THREE.MeshBasicMaterial({ color: 0xd9d6cd, side: THREE.DoubleSide });
    const bodyGeo = new THREE.BoxGeometry(0.46, 1.7, 0.24);
    const headGeo = new THREE.SphereGeometry(0.2, 10, 8);
    const faceGeo = new THREE.PlaneGeometry(0.3, 0.38);
    this.disposables.push(dark, pale, bodyGeo, headGeo, faceGeo);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, dark);
      body.position.y = 1.0;
      g.add(body);
      const head = new THREE.Mesh(headGeo, dark);
      head.position.y = 2.05;
      g.add(head);
      const face = new THREE.Mesh(faceGeo, pale);
      face.position.set(0, 2.05, 0.19);
      g.add(face);
      g.visible = false;
      this.scene.add(g);
      this.apparitions.push(g);
    }
    const debrisGeo = new THREE.BoxGeometry(0.42, 0.34, 0.5);
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.95 });
    this.disposables.push(debrisGeo, debrisMat);
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(debrisGeo, debrisMat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.debris.push(mesh);
    }

    const doll = level.inspectPoints.find((p) => p.type === 'doll');
    if (doll) this.dollHome = { x: doll.x, z: doll.z };
  }

  /** ステージを差し替える（モード切り替えでレベルを作り直したとき） */
  setLevel(level: Level) {
    this.level = level;
    const doll = level.inspectPoints.find((p) => p.type === 'doll');
    if (doll) this.dollHome = { x: doll.x, z: doll.z };
  }

  reset() {
    for (const a of this.active) a.onEnd?.();
    this.active = [];
    this.discovered.clear();
    this.phoneRinging = false;
    this.timer = CONFIG.anomaly.firstDelay;
    this.lastType = null;
    this.scheduled = [];
    this.lastSpot = null;
    this.apparitions.forEach((a) => (a.visible = false));
    this.debris.forEach((d) => (d.visible = false));
    const doll = this.level.inspectPoints.find((p) => p.type === 'doll');
    if (doll) {
      doll.object.position.set(this.dollHome.x, 0, this.dollHome.z);
      doll.x = this.dollHome.x;
      doll.z = this.dollHome.z;
    }
    for (const door of this.level.doors) {
      door.t = 1;
      door.target = 1;
      door.pivot.rotation.y = door.openAngle;
    }
  }

  /**
   * 調査地点を調べたときに、関連する異変を少し後に予約する。
   * 「調べても何も起きない」ではなく「後から効いてくる」ための仕掛け。
   */
  scheduleFromInspect(type: InspectType, first: boolean) {
    const chance = first ? CONFIG.inspect.anomalyChance : CONFIG.inspect.anomalyChanceRepeat;
    if (Math.random() > chance) return;
    const table: Record<InspectType, AnomalyType[]> = {
      mirror: ['mirror_figure', 'light_flicker'],
      doll: ['doll_moved', 'noise'],
      phone: ['phone_ring', 'noise'],
      locker: ['noise', 'door_slam'],
      photo: ['light_flicker', 'noise'],
      altar: ['light_flicker', 'door_slam', 'noise'],
    };
    this.scheduled.push({
      type: pick(table[type]),
      delay: randRange(CONFIG.inspect.anomalyDelay.min, CONFIG.inspect.anomalyDelay.max),
    });
  }

  /** リクエストで「電話に出ろ」と言われたときに鳴らす */
  forcePhoneRing() {
    if (this.phoneRinging) return;
    this.scheduled.push({ type: 'phone_ring', delay: 0.6 });
  }

  /** 電話に出る。出られたらtrue */
  answerPhone(): boolean {
    const phone = this.active.find((a) => a.type === 'phone_ring');
    if (!phone) return false;
    this.endAnomaly(phone);
    this.phoneRinging = false;
    return true;
  }

  update(dt: number, ctx: AnomalyContext) {
    const clip = CONFIG.stream.clip;

    for (const a of [...this.active]) {
      a.timeLeft -= dt;

      const visible = ctx.isVisible(a.x, a.z, a.height);
      if (visible) {
        a.filmed += dt;
        a.freshness = Math.max(
          clip.freshnessMin,
          a.freshness - clip.freshnessDecayPerSec * dt,
        );
        if (!a.witnessed) {
          a.witnessed = true;
          if (!this.discovered.has(a.type)) {
            this.discovered.add(a.type);
            this.onDiscovered?.(a);
          }
        }
      } else {
        a.freshness = Math.min(1, a.freshness + clip.freshnessRecoverPerSec * dt);
      }

      if (a.timeLeft <= 0) this.endAnomaly(a);
    }

    // 調査で予約された異変
    for (const item of [...this.scheduled]) {
      item.delay -= dt;
      if (item.delay > 0) continue;
      this.scheduled = this.scheduled.filter((x) => x !== item);
      if (this.active.length < CONFIG.anomaly.maxActive + 1) this.spawnType(item.type, ctx);
    }

    // 発生スケジュール。Hauntingが高いほど頻繁になる
    const h = clamp01(ctx.haunting / CONFIG.haunting.max);
    const interval =
      CONFIG.haunting.anomalyInterval.calm +
      (CONFIG.haunting.anomalyInterval.active - CONFIG.haunting.anomalyInterval.calm) * h;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = interval * randRange(0.75, 1.25);
      if (this.autoSpawn && this.active.length < CONFIG.anomaly.maxActive) this.spawn(ctx);
    }
  }

  private endAnomaly(a: ActiveAnomaly) {
    a.onEnd?.();
    this.active = this.active.filter((x) => x !== a);
    if (a.type === 'phone_ring') this.phoneRinging = false;
  }

  private spawn(ctx: AnomalyContext) {
    const candidates: AnomalyType[] = [];
    const px = ctx.playerPos.x;
    const pz = ctx.playerPos.z;

    // ドアが近くにあるか
    const door = this.level.doors.find((d) => {
      const dist = Math.hypot(d.x - px, d.z - pz);
      return dist > 6 && dist < 26 && d.target > 0.5;
    });
    if (door) candidates.push('door_slam');

    candidates.push('light_flicker', 'noise', 'shadow_figure');

    const doll = this.level.inspectPoints.find((p) => p.type === 'doll');
    if (doll && doll.discovered && !ctx.isVisible(doll.x, doll.z, doll.height)) {
      candidates.push('doll_moved');
    }
    const mirror = this.level.inspectPoints.find((p) => p.type === 'mirror');
    if (mirror && Math.hypot(mirror.x - px, mirror.z - pz) < 20) candidates.push('mirror_figure');

    const phone = this.level.inspectPoints.find((p) => p.type === 'phone');
    if (phone && !this.phoneRinging) candidates.push('phone_ring');

    // Hauntingが上がるまで解禁されない種類がある（静かな配信が徐々に壊れる順番）
    const unlocked = candidates.filter(
      (t) => ctx.haunting >= (CONFIG.anomaly.unlockHaunting[t] ?? 0),
    );
    const pool = unlocked.length ? unlocked : candidates;
    const usable = pool.filter((t) => t !== this.lastType);
    this.spawnType(pick(usable.length ? usable : pool), ctx);
  }

  /** ディレクターからの強制発生。プレイヤーの近くで、必ず何かを起こす */
  forceSpawn(ctx: AnomalyContext) {
    if (this.active.length >= CONFIG.anomaly.maxActive + 1) return false;
    this.spawn(ctx);
    return true;
  }

  private spawnType(type: AnomalyType, ctx: AnomalyContext) {
    const px = ctx.playerPos.x;
    const pz = ctx.playerPos.z;
    const door = this.level.doors.find((d) => {
      const dist = Math.hypot(d.x - px, d.z - pz);
      return dist > 4 && dist < 26 && d.target > 0.5;
    });
    this.lastType = type;

    switch (type) {
      case 'door_slam':
        if (door) this.spawnDoorSlam(door.x, door.z, ctx);
        break;
      case 'light_flicker':
        this.spawnFlicker(ctx);
        break;
      case 'doll_moved':
        this.spawnDollMove(ctx);
        break;
      case 'mirror_figure':
        this.spawnMirrorFigure(ctx);
        break;
      case 'phone_ring':
        this.spawnPhoneRing(ctx);
        break;
      case 'noise':
        this.spawnNoise(ctx);
        break;
      case 'shadow_figure':
        this.spawnShadowFigure(ctx);
        break;
    }
  }

  /**
   * 廊下の奥に一瞬だけ人影。すぐ消える。
   * 「追いかけるか、無視して帰るか」を短時間で突きつけるためのイベント。
   */
  private spawnShadowFigure(ctx: AnomalyContext) {
    const spot = this.findSpot(ctx, 12, 26, true);
    const g = this.apparitions[0];
    const a = this.push(this.make('shadow_figure', spot.x, spot.z, 2.0));
    this.lastSpot = spot;
    if (!g) return;
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = Math.atan2(ctx.playerPos.x - spot.x, ctx.playerPos.z - spot.z);
    g.visible = true;
    a.object = g;
    a.onEnd = () => {
      g.visible = false;
    };
    this.onSound?.('shadow_figure', spot.x, spot.z, 0);
  }

  private push(a: Omit<ActiveAnomaly, 'id' | 'freshness' | 'filmed' | 'witnessed'>) {
    const full: ActiveAnomaly = {
      ...a,
      id: this.nextId++,
      freshness: 1,
      filmed: 0,
      witnessed: false,
    };
    this.active.push(full);
    this.onSpawn?.(full);
    return full;
  }

  private make(type: AnomalyType, x: number, z: number, height: number) {
    return {
      type,
      label: LABEL[type],
      x,
      z,
      height,
      timeLeft: CONFIG.anomaly.duration[type],
      value: CONFIG.anomaly.value[type],
      interactive: type === 'phone_ring',
    };
  }

  private spawnDoorSlam(x: number, z: number, ctx: AnomalyContext) {
    const door = this.level.doors.find((d) => d.x === x && d.z === z);
    if (!door) return;
    door.target = 0;
    this.lastSpot = { x, z };
    this.onSound?.('door_slam', x, z, Math.hypot(x - ctx.playerPos.x, z - ctx.playerPos.z));
    this.push(this.make('door_slam', x, z, 1.3));
  }

  private spawnFlicker(ctx: AnomalyContext) {
    this.level.flickerLamp(ctx.playerPos.x, ctx.playerPos.z, CONFIG.anomaly.duration.light_flicker);
    this.onSound?.('light_flicker', ctx.playerPos.x, ctx.playerPos.z, 0);

    // 明滅の最後に、少し離れた通路へ人影を立たせる
    const spot = this.findSpot(ctx, 9, 22);
    this.lastSpot = spot;
    const g = this.apparitions[0];
    const anomaly = this.push(this.make('light_flicker', spot.x, spot.z, 2.0));
    if (!g) return;
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = Math.atan2(ctx.playerPos.x - spot.x, ctx.playerPos.z - spot.z);
    g.visible = true;
    anomaly.object = g;
    anomaly.onEnd = () => {
      g.visible = false;
    };
  }

  private spawnDollMove(ctx: AnomalyContext) {
    const doll = this.level.inspectPoints.find((p) => p.type === 'doll');
    if (!doll) return;
    // 部屋の中で、今映っていない場所へ動かす
    const spots = [
      { x: -8, z: -6 },
      { x: -14, z: -14 },
      { x: -8, z: -14 },
      { x: -14, z: -6 },
      { x: -11, z: -15 },
    ].filter((s) => !ctx.isVisible(s.x, s.z, 0.5));
    const spot = spots.length ? pick(spots) : { x: this.dollHome.x, z: this.dollHome.z };
    doll.object.position.set(spot.x, 0, spot.z);
    doll.object.rotation.y = randRange(0, Math.PI * 2);
    doll.x = spot.x;
    doll.z = spot.z;
    const moved = this.push(this.make('doll_moved', spot.x, spot.z, 0.5));
    moved.pointType = 'doll';
    this.lastSpot = spot;
  }

  private spawnMirrorFigure(ctx: AnomalyContext) {
    const mirror = this.level.inspectPoints.find((p) => p.type === 'mirror');
    const g = this.apparitions[1];
    if (!mirror || !g) return;
    // 鏡の「中」に立っているように見せる
    g.position.set(mirror.x, 0, mirror.z - 2.4);
    g.rotation.y = Math.PI;
    g.visible = true;
    const anomaly = this.push(this.make('mirror_figure', g.position.x, g.position.z, 2.0));
    anomaly.pointType = 'mirror';
    this.lastSpot = { x: mirror.x, z: mirror.z };
    anomaly.object = g;
    anomaly.onEnd = () => {
      g.visible = false;
    };
    this.onSound?.(
      'mirror_figure',
      g.position.x,
      g.position.z,
      Math.hypot(g.position.x - ctx.playerPos.x, g.position.z - ctx.playerPos.z),
    );
  }

  private spawnPhoneRing(ctx: AnomalyContext) {
    const phone = this.level.inspectPoints.find((p) => p.type === 'phone');
    if (!phone) return;
    this.phoneRinging = true;
    const a = this.push(this.make('phone_ring', phone.x, phone.z, phone.height));
    a.pointType = 'phone';
    this.lastSpot = { x: phone.x, z: phone.z };
    a.onEnd = () => {
      this.phoneRinging = false;
    };
    this.onSound?.(
      'phone_ring',
      phone.x,
      phone.z,
      Math.hypot(phone.x - ctx.playerPos.x, phone.z - ctx.playerPos.z),
    );
  }

  private spawnNoise(ctx: AnomalyContext) {
    const spot = this.findSpot(ctx, 8, 24);
    this.lastSpot = spot;
    const mesh = this.debris.find((d) => !d.visible);
    const a = this.push(this.make('noise', spot.x, spot.z, 0.4));
    if (mesh) {
      mesh.position.set(spot.x, 0.18, spot.z);
      mesh.rotation.set(randRange(-0.4, 0.4), randRange(0, 3), randRange(-0.4, 0.4));
      mesh.visible = true;
      a.object = mesh;
      a.onEnd = () => {
        mesh.visible = false;
      };
    }
    this.onSound?.(
      'noise',
      spot.x,
      spot.z,
      Math.hypot(spot.x - ctx.playerPos.x, spot.z - ctx.playerPos.z),
    );
  }

  /**
   * プレイヤーから min〜max の距離にある開いたセルを探す。
   * requireLos = true なら、その場から見える位置だけを選ぶ（人影用）。
   */
  private findSpot(ctx: AnomalyContext, min: number, max: number, requireLos = false) {
    const grid = ctx.grid;
    let fallback: { x: number; z: number } | null = null;
    for (let i = 0; i < 160; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = randRange(min, max);
      const x = ctx.playerPos.x + Math.cos(angle) * dist;
      const z = ctx.playerPos.z + Math.sin(angle) * dist;
      if (!grid.isOpenWorld(x, z)) continue;
      if (!fallback) fallback = { x, z };
      if (!requireLos || grid.losClear(ctx.playerPos.x, ctx.playerPos.z, x, z)) return { x, z };
    }
    return fallback ?? { x: ctx.playerPos.x, z: ctx.playerPos.z };
  }

  dispose() {
    this.apparitions.forEach((a) => this.scene.remove(a));
    this.debris.forEach((d) => this.scene.remove(d));
    this.disposables.forEach((d) => d.dispose());
  }
}
