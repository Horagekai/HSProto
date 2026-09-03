import * as THREE from 'three';
import { CONFIG, type MonsterBehavior, type MonsterState } from '../config';
import { clamp, damp, pick, randRange } from '../core/util';
import type { Grid } from './grid';
import { MONSTER_ANCHORS, PEEK_ANCHORS } from './level';

const ORDER: MonsterState[] = ['dormant', 'observed', 'aware', 'aggressive', 'hunting', 'chasing'];

export interface MonsterContext {
  playerPos: THREE.Vector3;
  grid: Grid;
  /** 今プレイヤーの画面に映っているか */
  visibleToPlayer: boolean;
  /** 画面中央に捉えられているか 0..1 */
  centerScore: number;
  /** Hauntingによる行動頻度の倍率 */
  activity: number;
  /** 入口まで戻れている（ONE GHOST MODEの追跡解除条件） */
  playerSafe?: boolean;
}

/**
 * 人型怪異。
 * v2では「追跡してくる敵」ではなく「撮れ高のある被写体」でいる時間を長くするため、
 * Danger段階(state)とは別に、行動(behavior)のレイヤーを持つ。
 */
export class Monster {
  group = new THREE.Group();
  position = new THREE.Vector3(CONFIG.monster.spawn.x, 0, CONFIG.monster.spawn.z);
  yaw = 0;
  danger = 0;
  state: MonsterState = 'dormant';
  behavior: MonsterBehavior = 'idle';
  discovered = false;
  chasing = false;
  speedNow = 0;
  windup = 0;
  frozen = false;
  /** 短時間追跡の残り時間（Hunting段階の非致死的な追跡） */
  shortChaseLeft = 0;
  /** 掴まれた直後の硬直 */
  stunned = 0;
  /** 追跡中、プレイヤーが欲張った分だけ上がる追加速度 */
  chaseUrgency = 0;

  /**
   * ONE GHOST MODE。
   *  - Stalkingが中心状態になる（見られている間は止まり、見ていない間に詰める）
   *  - 追跡は10〜15秒の撤退戦で、逃げ切ればSTALKINGへ戻る（ゲームは終わらない）
   */
  oneGhost = false;
  /** Danger → 段階のしきい値。モードごとに差し替える */
  thresholds: { observed: number; aware: number; aggressive: number; hunting: number; chasing: number } =
    CONFIG.danger.thresholds;
  /** 現在の追跡の経過時間と、離れ続けている時間 */
  chaseTime = 0;
  private farTime = 0;
  /** 逃げ切った直後の再追跡禁止時間 */
  private chaseLockout = 0;
  /** 追跡を諦めた（逃げ切り） */
  onChaseEnd: ((reason: 'distance' | 'entrance' | 'timeout') => void) | null = null;

  /**
   * 移動先・覗き見地点。ステージごとに差し替える。
   * （ONE GHOST MODE は一部屋なので、外周を回るための別セットを使う）
   */
  anchors: ReadonlyArray<{ x: number; z: number }> = MONSTER_ANCHORS;
  peekAnchors: ReadonlyArray<{ x: number; z: number }> = PEEK_ANCHORS;

  /** 声のした場所（HEYで誘導される） */
  lureTarget: { x: number; z: number } | null = null;
  private lureTimer = 0;
  /** 呼ばれてこちらを見ている残り時間 */
  private lookTimer = 0;

  /** 非致死の「掴み」が成立した */
  onGrab: (() => void) | null = null;
  /** 突進フェイントを開始した */
  onLunge: (() => void) | null = null;

  onStateChange: ((next: MonsterState, prev: MonsterState) => void) | null = null;
  onBehaviorChange: ((next: MonsterBehavior, prev: MonsterBehavior) => void) | null = null;

  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private head = new THREE.Group();
  private body = new THREE.Group();
  private disposables: Array<{ dispose(): void }> = [];
  private headWorldCache = new THREE.Vector3();
  private chestWorldCache = new THREE.Vector3();
  private forward = new THREE.Vector3();

  private behaviorTimer = 5;
  private target: { x: number; z: number } | null = null;
  private seenWhilePeeking = 0;
  /** 最後にプレイヤーの画面に映ってからの時間 */
  private unseenTime = 0;
  private lungeCooldown = 0;
  private lungeLeft = 0;

  constructor(scene: THREE.Scene) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, metalness: 0 });
    // 手足はわずかに明るくして、光が当たったときシルエットから分離して見えるようにする
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x121218, roughness: 1, metalness: 0 });
    const pale = new THREE.MeshBasicMaterial({ color: 0xe8e6df, side: THREE.DoubleSide });
    this.disposables.push(dark, limbMat, pale);

    const box = (w: number, h: number, d: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.disposables.push(g);
      return g;
    };

    const torso = new THREE.Mesh(box(0.42, 1.15, 0.24), dark);
    torso.position.y = 1.45;
    this.body.add(torso);

    const hips = new THREE.Mesh(box(0.32, 0.3, 0.22), dark);
    hips.position.y = 0.92;
    this.body.add(hips);

    const neck = new THREE.Mesh(box(0.1, 0.28, 0.1), dark);
    neck.position.y = 2.06;
    this.body.add(neck);

    const skullGeo = new THREE.SphereGeometry(0.21, 12, 10);
    this.disposables.push(skullGeo);
    const skull = new THREE.Mesh(skullGeo, dark);
    this.head.add(skull);
    const faceGeo = new THREE.PlaneGeometry(0.33, 0.42);
    this.disposables.push(faceGeo);
    const face = new THREE.Mesh(faceGeo, pale);
    face.position.set(0, 0, 0.215);
    this.head.add(face);
    this.head.position.y = 2.24;
    this.body.add(this.head);

    // 不自然に長い手足
    const armGeo = box(0.08, 1.55, 0.08);
    const arms: Array<[THREE.Group, number]> = [
      [this.armL, -0.36],
      [this.armR, 0.36],
    ];
    for (const [g, x] of arms) {
      const limb = new THREE.Mesh(armGeo, limbMat);
      limb.position.y = -0.75;
      g.add(limb);
      const hand = new THREE.Mesh(box(0.1, 0.22, 0.06), pale);
      hand.position.y = -1.56;
      g.add(hand);
      g.position.set(x, 1.95, 0);
      this.body.add(g);
    }

    const legGeo = box(0.095, 1.0, 0.095);
    const legs: Array<[THREE.Group, number]> = [
      [this.legL, -0.13],
      [this.legR, 0.13],
    ];
    for (const [g, x] of legs) {
      const limb = new THREE.Mesh(legGeo, limbMat);
      limb.position.y = -0.5;
      g.add(limb);
      g.position.set(x, 0.95, 0);
      this.body.add(g);
    }

    this.group.add(this.body);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.group.position.copy(this.position);
    scene.add(this.group);
  }

  reset(spawn: { x: number; z: number } = CONFIG.monster.spawn) {
    this.position.set(spawn.x, 0, spawn.z);
    this.group.position.copy(this.position);
    this.group.visible = true;
    this.yaw = 0;
    this.danger = 0;
    this.state = 'dormant';
    this.behavior = 'idle';
    this.discovered = false;
    this.chasing = false;
    this.speedNow = 0;
    this.windup = 0;
    this.frozen = false;
    this.shortChaseLeft = 0;
    this.stunned = 0;
    this.chaseUrgency = 0;
    this.chaseTime = 0;
    this.farTime = 0;
    this.chaseLockout = 0;
    this.lungeCooldown = 0;
    this.lureTarget = null;
    this.lureTimer = 0;
    this.lookTimer = 0;
    this.behaviorTimer = 5;
    this.target = null;
    this.seenWhilePeeking = 0;
    this.unseenTime = 0;
  }

  /**
   * HEYを聞いた。声のした場所へ引き寄せられ、しばらくそちらを見る。
   * 何をするか（behavior）は呼び出し側が決める。
   */
  hearShout(x: number, z: number, look: boolean) {
    this.lureTarget = { x, z };
    this.lureTimer = CONFIG.hey.lureDuration;
    if (look) this.lookTimer = CONFIG.hey.lookDuration;
  }

  /** 呼ばれてこちらを見ている最中か */
  get isLookingBecauseCalled() {
    return this.lookTimer > 0;
  }

  /** 外から行動を指示する（HEYの反応など） */
  forceBehavior(next: MonsterBehavior, duration: number) {
    this.setBehavior(next);
    this.behaviorTimer = duration;
    if (next === 'lunging') {
      this.lungeLeft = CONFIG.monster.lunge.duration;
      this.lungeCooldown = CONFIG.monster.lunge.cooldown;
      this.onLunge?.();
    }
    if (next === 'chasing' && !this.chasing) {
      this.shortChaseLeft = randRange(
        CONFIG.monster.shortChase.duration.min,
        CONFIG.monster.shortChase.duration.max,
      );
      this.windup = CONFIG.monster.chaseWindup * 0.6;
    }
  }

  /** 追跡を打ち切る。死なずに終わることで「また戻れる」が成立する */
  endChase(reason: 'distance' | 'entrance' | 'timeout') {
    if (!this.chasing) return;
    this.chasing = false;
    this.chaseTime = 0;
    this.farTime = 0;
    this.chaseUrgency = 0;
    this.windup = 0;
    this.danger = Math.min(this.danger, CONFIG.oneGhost.chase.dangerAfter);
    this.chaseLockout = CONFIG.oneGhost.chase.lockout;
    this.state = 'aware';
    this.setBehavior('stalking');
    this.behaviorTimer = randRange(6, 10);
    this.onChaseEnd?.(reason);
  }

  addDanger(v: number) {
    this.danger = clamp(this.danger + v, 0, CONFIG.danger.max);
  }

  /** 短時間追跡中（Hunting段階の非致死な追跡） */
  get inShortChase() {
    return this.behavior === 'chasing' && !this.chasing;
  }

  /** Vanish中は撮影対象にもならない */
  get hidden() {
    return this.behavior === 'vanished';
  }

  get headWorld() {
    return this.headWorldCache.set(this.position.x, 2.24, this.position.z);
  }

  get chestWorld() {
    return this.chestWorldCache.set(this.position.x, 1.45, this.position.z);
  }

  get isMoving() {
    return this.speedNow > 0.15;
  }

  looksAt(target: THREE.Vector3) {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    return (this.forward.x * dx + this.forward.z * dz) / len > 0.72;
  }

  stateRank() {
    return ORDER.indexOf(this.state);
  }

  /**
   * 追跡開始時に、プレイヤーから一定距離まで引き離す。
   * 目の前で追跡が始まると「逃げる判断」の余地が消えるため。
   */
  private repositionForChase(playerPos: THREE.Vector3) {
    const { chaseStartMinDistance: min, chaseStartMaxDistance: max } = CONFIG.monster;
    const current = Math.hypot(playerPos.x - this.position.x, playerPos.z - this.position.z);
    if (current >= min) return;
    let best: { x: number; z: number } | null = null;
    let bestScore = Infinity;
    for (const a of this.anchors) {
      const d = Math.hypot(playerPos.x - a.x, playerPos.z - a.z);
      if (d < min || d > max) continue;
      const move = Math.hypot(this.position.x - a.x, this.position.z - a.z);
      if (move < bestScore) {
        bestScore = move;
        best = a;
      }
    }
    if (best) {
      this.position.set(best.x, 0, best.z);
      this.group.position.copy(this.position);
    }
  }

  private setBehavior(next: MonsterBehavior) {
    if (next === this.behavior) return;
    const prev = this.behavior;
    this.behavior = next;
    this.seenWhilePeeking = 0;
    this.group.visible = next !== 'vanished';
    this.onBehaviorChange?.(next, prev);
  }

  private updateState(playerPos: THREE.Vector3) {
    const t = this.thresholds;
    const prev = this.state;
    let next: MonsterState;
    // 逃げ切った直後は、Dangerが高くてもすぐには追ってこない
    if (!this.chasing && this.chaseLockout > 0 && this.danger >= t.chasing) {
      this.danger = t.chasing - 1;
    }
    if (this.chasing || this.danger >= t.chasing) {
      next = 'chasing';
    } else if (this.danger >= t.hunting) {
      next = 'hunting';
    } else if (this.danger >= t.aggressive) {
      next = 'aggressive';
    } else if (this.danger >= t.aware) {
      next = 'aware';
    } else if (this.danger >= t.observed || this.discovered) {
      next = 'observed';
    } else {
      next = 'dormant';
    }
    if (next !== prev) {
      this.state = next;
      if (next === 'chasing' && !this.chasing) {
        this.chasing = true;
        this.chaseTime = 0;
        this.farTime = 0;
        if (this.oneGhost) {
          // 目の前で瞬間移動させない。溜めの分だけ逃げる時間を渡す
          this.windup = CONFIG.oneGhost.chase.windup;
        } else {
          this.windup = CONFIG.monster.chaseWindup;
          this.repositionForChase(playerPos);
        }
        this.setBehavior('chasing');
      }
      this.onStateChange?.(next, prev);
    }
  }

  /** 状態に応じた行動を選び直す */
  private chooseBehavior(ctx: MonsterContext, distance: number) {
    if (this.chasing) {
      this.setBehavior('chasing');
      return;
    }
    const options: MonsterBehavior[] = [];
    switch (this.state) {
      case 'dormant':
        // ONE GHOST MODE：開幕は「そこに立っている」。探させない（§12）
        if (this.oneGhost) options.push('idle', 'idle', 'idle', 'watching');
        else options.push('idle', 'idle', 'watching', 'relocating');
        break;
      case 'observed':
        // 「そこに居る」時間を長くしたいので watching / peeking を厚くする
        options.push(
          'watching', 'watching', 'watching',
          'peeking', 'peeking',
          'relocating', 'relocating',
          'idle', 'idle',
          'stalking',
        );
        break;
      case 'aware':
        options.push(
          'stalking', 'stalking', 'stalking',
          'peeking', 'peeking', 'peeking',
          'watching', 'watching',
          'relocating', 'relocating',
        );
        // 一部屋のONE GHOST MODEで目の前から消えるのは不自然なので使わない（§31）
        if (!this.oneGhost) options.push('vanished');
        break;
      case 'aggressive':
        // 突進フェイントを混ぜる。当たらないが「次は来る」と体で分からせる
        options.push('stalking', 'approaching', 'approaching', 'lunging', 'peeking');
        // ONE GHOST MODE ではこの帯が STALKING。追われる時間より「詰められる時間」を長くする（§15）
        if (this.oneGhost) options.push('stalking', 'stalking', 'stalking', 'peeking');
        break;
      case 'hunting':
        // 短時間の追跡。捕まっても死なない
        options.push('stalking', 'lunging', 'chasing', 'approaching');
        break;
      default:
        options.push('idle');
    }

    let next = pick(options);
    // 遠すぎる、あるいは長く姿を見せていないときは、まず近くへ移動する
    const tooFar = distance > 30;
    const forgotten = this.unseenTime > CONFIG.monster.unseenLimit;
    if ((tooFar || forgotten) && next !== 'relocating') next = 'relocating';
    // 画面に映っている最中に消えたり瞬間移動したりはしない
    if ((next === 'vanished' || next === 'relocating') && ctx.visibleToPlayer) next = 'watching';
    this.setBehavior(next);

    if (next === 'relocating') {
      // 長く見られていないときほど、プレイヤーの近くへ寄る
      const near = this.unseenTime > CONFIG.monster.unseenLimit;
      const lo = near ? 7 : 9;
      const hi = near ? 16 : 24;
      const spots = this.anchors.filter((a) => {
        const d = Math.hypot(a.x - ctx.playerPos.x, a.z - ctx.playerPos.z);
        return d > lo && d < hi;
      });
      this.target = spots.length ? pick(spots) : null;
      if (!this.target) this.setBehavior('watching');
    } else if (next === 'peeking') {
      const spots = this.peekAnchors.map((a) => ({
        a,
        d: Math.hypot(a.x - ctx.playerPos.x, a.z - ctx.playerPos.z),
      }))
        .filter((s) => s.d > 5 && s.d < 26)
        .sort((p, q) => p.d - q.d);
      this.target = spots.length ? spots[0].a : null;
      if (!this.target) this.setBehavior('watching');
    } else {
      this.target = null;
    }

    if (this.behavior === 'lunging') {
      if (this.lungeCooldown > 0 || distance > 16) {
        this.setBehavior('stalking');
      } else {
        this.lungeLeft = CONFIG.monster.lunge.duration;
        this.lungeCooldown = CONFIG.monster.lunge.cooldown;
        this.onLunge?.();
      }
    }
    if (this.behavior === 'chasing' && !this.chasing) {
      // Hunting段階の短時間追跡
      this.shortChaseLeft = randRange(
        CONFIG.monster.shortChase.duration.min,
        CONFIG.monster.shortChase.duration.max,
      );
      this.windup = CONFIG.monster.chaseWindup * 0.6;
    }

    const base = randRange(CONFIG.monster.behaviorInterval.min, CONFIG.monster.behaviorInterval.max);
    this.behaviorTimer = base / Math.max(0.3, ctx.activity);
    if (this.behavior === 'peeking') this.behaviorTimer = CONFIG.monster.peekDuration;
    if (this.behavior === 'vanished') {
      this.behaviorTimer = randRange(
        CONFIG.monster.vanishDuration.min,
        CONFIG.monster.vanishDuration.max,
      );
      this.target = null;
    }
  }

  /** @returns プレイヤーとの距離 */
  update(dt: number, time: number, ctx: MonsterContext): number {
    const playerPos = ctx.playerPos;
    const toPlayerX = playerPos.x - this.position.x;
    const toPlayerZ = playerPos.z - this.position.z;
    const distance = Math.hypot(toPlayerX, toPlayerZ);

    if (this.frozen) {
      this.speedNow = damp(this.speedNow, 0, 6, dt);
      this.animate(dt, time);
      return distance;
    }

    this.updateState(playerPos);
    this.unseenTime = ctx.visibleToPlayer ? 0 : this.unseenTime + dt;
    this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);
    this.chaseLockout = Math.max(0, this.chaseLockout - dt);
    this.chaseUrgency = Math.max(0, this.chaseUrgency - CONFIG.monster.chaseUrgency.decay * dt);
    this.lureTimer = Math.max(0, this.lureTimer - dt);
    this.lookTimer = Math.max(0, this.lookTimer - dt);
    if (this.lureTimer <= 0) this.lureTarget = null;
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.speedNow = 0;
      this.animate(dt, time);
      return distance;
    }

    // 短時間追跡は時間切れで諦める（本追跡ではないので死なない）
    if (this.behavior === 'chasing' && !this.chasing) {
      this.shortChaseLeft -= dt;
      if (distance <= CONFIG.monster.killDistance + 0.3) {
        this.danger = Math.min(this.danger, CONFIG.monster.grab.dangerTo);
        this.stunned = CONFIG.monster.grab.stunTime;
        this.shortChaseLeft = 0;
        this.setBehavior('watching');
        this.behaviorTimer = 4;
        this.onGrab?.();
        this.animate(dt, time);
        return distance;
      }
      if (this.shortChaseLeft <= 0) {
        this.setBehavior('stalking');
        this.behaviorTimer = randRange(5, 9);
        this.danger = Math.max(0, this.danger - CONFIG.monster.shortChase.dangerDrop);
      }
    }

    // 本追跡は「撤退戦」。逃げ切れば怪異はSTALKINGへ戻り、ゲームは続く（§17/§19）
    if (this.chasing && this.oneGhost) {
      const c = CONFIG.oneGhost.chase;
      this.chaseTime += dt;
      this.farTime = distance >= c.escapeDistance ? this.farTime + dt : 0;
      let reason: 'distance' | 'entrance' | 'timeout' | null = null;
      // 始まった瞬間に解除されると「追われた」感触が残らないので、最低2秒は走らせる
      // 開始から minDuration の間は、どれだけ離しても諦めない（撤退戦の時間を作る）
      if (c.entranceSafe > 0 && ctx.playerSafe && this.chaseTime >= c.entranceSafeAfter) {
        reason = 'entrance';
      }
      else if (this.chaseTime >= c.minDuration && this.farTime >= c.escapeTime) reason = 'distance';
      else if (this.chaseTime >= c.maxDuration && distance > c.giveUpDistance) reason = 'timeout';
      if (reason) {
        this.endChase(reason);
        this.animate(dt, time);
        return distance;
      }
    }

    const wasVanished = this.behavior === 'vanished';
    this.behaviorTimer -= dt;
    if (this.behaviorTimer <= 0) {
      // Vanishが明けたら遠くへ再配置してから次の行動を選ぶ
      if (wasVanished) {
        const spots = this.anchors.filter((a) => {
          const d = Math.hypot(a.x - playerPos.x, a.z - playerPos.z);
          return d > 12 && d < 34;
        });
        if (spots.length) {
          const spot = pick(spots);
          this.position.set(spot.x, 0, spot.z);
          this.group.position.copy(this.position);
        }
      }
      this.chooseBehavior(ctx, distance);
    }

    // Peeking中に見つかったら引っ込む
    if (this.behavior === 'peeking' && ctx.visibleToPlayer && ctx.centerScore > 0.45) {
      this.seenWhilePeeking += dt;
      if (this.seenWhilePeeking > 0.7) {
        this.setBehavior('vanished');
        this.behaviorTimer = randRange(3, 6);
      }
    }

    let desiredSpeed = 0;
    let dirX = 0;
    let dirZ = 0;
    let faceX = toPlayerX;
    let faceZ = toPlayerZ;

    if (this.windup > 0) this.windup -= dt;

    const steerTo = (tx: number, tz: number, speed: number, stopAt: number) => {
      const dx = tx - this.position.x;
      const dz = tz - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= stopAt) return;
      const straight = ctx.grid.losClear(this.position.x, this.position.z, tx, tz);
      const flow = straight ? null : ctx.grid.flowDir(this.position.x, this.position.z);
      if (flow) {
        dirX = flow.x;
        dirZ = flow.z;
      } else {
        dirX = dx / (d || 1);
        dirZ = dz / (d || 1);
      }
      desiredSpeed = speed;
    };

    switch (this.behavior) {
      case 'idle':
        faceX = Math.sin(time * 0.15);
        faceZ = Math.cos(time * 0.15) * 0.2;
        break;
      case 'watching':
      case 'vanished':
        // じっとこちらを見ている / 消えている
        break;
      case 'peeking':
        if (this.target) steerTo(this.target.x, this.target.z, CONFIG.monster.speed.stalking, 0.5);
        break;
      case 'relocating':
        if (this.target) {
          // フローフィールドはプレイヤー向きなので、移動先へは直線で向かう
          const dx = this.target.x - this.position.x;
          const dz = this.target.z - this.position.z;
          const d = Math.hypot(dx, dz);
          // 着いたら「そこに立っている」状態へ。移動しっぱなしだと姿を見せる時間が減る
          if (d <= 1.5) {
            this.setBehavior('watching');
            this.behaviorTimer = randRange(4, 9);
            this.target = null;
          } else if (d > 1) {
            dirX = dx / d;
            dirZ = dz / d;
            desiredSpeed = CONFIG.monster.speed.relocating;
            faceX = dirX;
            faceZ = dirZ;
          }
        }
        break;
      case 'stalking': {
        // ONE GHOST MODE：見られている間は止まる。見ていない間に距離を詰める（§15）
        if (this.oneGhost && ctx.visibleToPlayer && ctx.centerScore > CONFIG.oneGhost.stalkFreezeCenter) {
          break;
        }
        const keep =
          this.oneGhost && !ctx.visibleToPlayer
            ? CONFIG.oneGhost.stalkDistanceHidden
            : CONFIG.monster.stalkDistance;
        if (distance > keep + 2) {
          steerTo(playerPos.x, playerPos.z, CONFIG.monster.speed.stalking, keep);
        } else if (this.oneGhost) {
          // ONE GHOST MODE では怪異は逃げない。
          // 近づけないと「距離を自分で詰める」というゲームそのものが成立しない（§7）
          break;
        } else if (distance < keep - 4) {
          dirX = -toPlayerX / (distance || 1);
          dirZ = -toPlayerZ / (distance || 1);
          desiredSpeed = CONFIG.monster.speed.stalking * 0.6;
        }
        break;
      }
      case 'lunging': {
        this.lungeLeft -= dt;
        if (this.lungeLeft <= 0 || distance <= CONFIG.monster.lunge.stopAt) {
          this.setBehavior('watching');
          this.behaviorTimer = randRange(3, 6);
          break;
        }
        steerTo(playerPos.x, playerPos.z, CONFIG.monster.lunge.speed, CONFIG.monster.lunge.stopAt);
        faceX = dirX || toPlayerX;
        faceZ = dirZ || toPlayerZ;
        break;
      }
      case 'approaching': {
        // 声を聞いていれば、そちらへ向かう（＝HEYで誘導できる）
        const t = this.lureTarget ?? playerPos;
        steerTo(t.x, t.z, CONFIG.monster.speed.approaching, CONFIG.monster.approachStandoff);
        break;
      }
      case 'chasing': {
        const base = this.oneGhost ? CONFIG.oneGhost.chase.speed : CONFIG.monster.speed.chasing;
        steerTo(playerPos.x, playerPos.z, base + this.chaseUrgency, 0);
        if (this.windup > 0) desiredSpeed = 0;
        faceX = dirX || toPlayerX;
        faceZ = dirZ || toPlayerZ;
        break;
      }
    }

    // 追跡中以外は自分からは踏み込まない（危険はプレイヤー側の行動から生まれるべき）
    if (
      this.behavior !== 'chasing' &&
      this.behavior !== 'lunging' &&
      distance < CONFIG.monster.minPlayerDistance
    ) {
      const away = (dirX * toPlayerX + dirZ * toPlayerZ) / (distance || 1);
      if (away > 0) {
        dirX = 0;
        dirZ = 0;
        desiredSpeed = 0;
      }
    }

    this.speedNow = damp(this.speedNow, desiredSpeed, 5, dt);
    if (this.speedNow > 0.02 && (dirX !== 0 || dirZ !== 0)) {
      const l = Math.hypot(dirX, dirZ) || 1;
      const moved = ctx.grid.moveCircle(
        this.position.x,
        this.position.z,
        (dirX / l) * this.speedNow * dt,
        (dirZ / l) * this.speedNow * dt,
        0.36,
      );
      this.position.x = moved.x;
      this.position.z = moved.z;
    }

    if (this.lookTimer > 0) {
      faceX = toPlayerX;
      faceZ = toPlayerZ;
    }
    const targetYaw = Math.atan2(faceX, faceZ);
    let diff = targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = CONFIG.monster.turnSpeed * (this.behavior === 'chasing' ? 2 : 1) * dt;
    this.yaw += clamp(diff, -turn, turn);

    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;
    this.animate(dt, time);

    return distance;
  }

  private animate(dt: number, time: number) {
    const walk = clamp(this.speedNow / CONFIG.monster.speed.chasing, 0, 1);
    const t = time * (2 + walk * 9);
    const swing = 0.15 + walk * 1.1;
    this.legL.rotation.x = Math.sin(t) * swing;
    this.legR.rotation.x = -Math.sin(t) * swing;
    this.armL.rotation.x = -Math.sin(t) * swing * 0.8;
    this.armR.rotation.x = Math.sin(t) * swing * 0.8;
    const flail = this.behavior === 'chasing' ? 0.5 + Math.sin(time * 13) * 0.25 : 0.16;
    this.armL.rotation.z = flail;
    this.armR.rotation.z = -flail;

    this.body.rotation.z =
      Math.sin(time * 0.8) * 0.035 + (this.behavior === 'chasing' ? Math.sin(time * 9) * 0.06 : 0);
    this.head.rotation.z = Math.sin(time * 0.53) * 0.22;
    this.head.rotation.x =
      this.behavior === 'idle' ? 0.35 : Math.sin(time * 0.7) * 0.08 - (walk > 0.5 ? 0.25 : 0);
    this.body.rotation.x = damp(this.body.rotation.x, walk > 0.5 ? 0.18 : 0, 3, dt);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.disposables.forEach((d) => d.dispose());
  }
}
