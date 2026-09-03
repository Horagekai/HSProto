import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, lerp } from '../core/util';
import type { Input } from '../core/input';
import type { Grid } from './grid';
import { PLAYER_SPAWN } from './level';

/**
 * 進行方向の前方成分(-1..1)から速度倍率を返す。
 * 前進=1.0 / 横移動=strafeSpeedMult / 後退=backwardSpeedMult
 */
export function facingSpeedMultiplier(forward: number): number {
  const { strafeSpeedMult, backwardSpeedMult } = CONFIG.player;
  return forward >= 0
    ? lerp(strafeSpeedMult, 1, forward)
    : lerp(strafeSpeedMult, backwardSpeedMult, -forward);
}

export class Player {
  position = new THREE.Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z);
  velocity = new THREE.Vector3();
  yaw = 0; // -Z（廊下の奥）を向いて開始
  pitch = 0;
  running = false;
  moving = false;
  /** 自撮りモード。カメラが自分側を向く */
  selfie = false;
  bob = 0;

  private stepTimer = 0;
  private avatar: THREE.Group | null = null;
  private disposables: Array<{ dispose(): void }> = [];

  /** 足音イベント */
  onStep: (() => void) | null = null;

  /** Selfieのときだけ映る自分のモデルを作る */
  buildAvatar(scene: THREE.Scene) {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xbfa48c, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
    this.disposables.push(skin, cloth, dark);

    const headGeo = new THREE.SphereGeometry(0.15, 14, 12);
    const torsoGeo = new THREE.BoxGeometry(0.42, 0.62, 0.24);
    const armGeo = new THREE.BoxGeometry(0.11, 0.5, 0.11);
    const hairGeo = new THREE.SphereGeometry(0.157, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.disposables.push(headGeo, torsoGeo, armGeo, hairGeo);

    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 1.6;
    g.add(head);
    // 目と口（ないと白い球にしか見えない）
    const eyeGeo = new THREE.BoxGeometry(0.032, 0.02, 0.02);
    const mouthGeo = new THREE.BoxGeometry(0.06, 0.014, 0.02);
    this.disposables.push(eyeGeo, mouthGeo);
    for (const x of [-0.052, 0.052]) {
      const eye = new THREE.Mesh(eyeGeo, dark);
      eye.position.set(x, 1.63, -0.142);
      g.add(eye);
    }
    const mouth = new THREE.Mesh(mouthGeo, dark);
    mouth.position.set(0, 1.55, -0.14);
    g.add(mouth);
    const hair = new THREE.Mesh(hairGeo, dark);
    hair.position.y = 1.61;
    g.add(hair);
    const torso = new THREE.Mesh(torsoGeo, cloth);
    torso.position.y = 1.14;
    g.add(torso);
    // カメラを持っている腕
    const arm = new THREE.Mesh(armGeo, cloth);
    arm.position.set(0.17, 1.34, -0.3);
    arm.rotation.set(-1.15, 0, -0.3);
    g.add(arm);

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    g.visible = false;
    scene.add(g);
    this.avatar = g;
  }

  reset() {
    this.position.set(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.selfie = false;
    this.stepTimer = 0;
    if (this.avatar) this.avatar.visible = false;
  }

  toggleSelfie() {
    this.selfie = !this.selfie;
    return this.selfie;
  }

  /** 体の正面方向（Selfieでもこちらは変わらない） */
  get forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(dt: number, input: Input, grid: Grid, camera: THREE.PerspectiveCamera) {
    const mouse = input.consumeMouse();
    this.yaw -= mouse.x * CONFIG.player.mouseSensitivity;
    this.pitch = clamp(
      this.pitch - mouse.y * CONFIG.player.mouseSensitivity,
      -CONFIG.player.maxPitch,
      CONFIG.player.maxPitch,
    );

    let ix = 0;
    let iz = 0;
    if (input.down('KeyW')) iz -= 1;
    if (input.down('KeyS')) iz += 1;
    if (input.down('KeyA')) ix -= 1;
    if (input.down('KeyD')) ix += 1;
    const len = Math.hypot(ix, iz);
    if (len > 0) {
      ix /= len;
      iz /= len;
    }
    this.running = input.down('ShiftLeft') || input.down('ShiftRight');
    // 視線と進行方向がずれるほど遅くなる。
    // 逃げながら振り返って撮る = 後ろ歩き = 怪異に追いつかれる、という操作レベルのリスク。
    const speed =
      (this.running ? CONFIG.player.runSpeed : CONFIG.player.walkSpeed) *
      facingSpeedMultiplier(-iz) *
      (this.selfie ? CONFIG.player.selfieSpeedMult : 1);

    // yaw基準のローカル入力をワールド方向へ。
    // カメラ前方 = (-sin yaw, -cos yaw) / 右 = (cos yaw, -sin yaw)
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wantX = ix * cos + iz * sin;
    const wantZ = iz * cos - ix * sin;

    const targetVX = wantX * speed;
    const targetVZ = wantZ * speed;
    const a = CONFIG.player.accel * dt;
    this.velocity.x += clamp(targetVX - this.velocity.x, -a, a);
    this.velocity.z += clamp(targetVZ - this.velocity.z, -a, a);

    const moved = grid.moveCircle(
      this.position.x,
      this.position.z,
      this.velocity.x * dt,
      this.velocity.z * dt,
      CONFIG.player.radius,
    );
    if (Math.abs(moved.x - (this.position.x + this.velocity.x * dt)) > 1e-4) this.velocity.x = 0;
    if (Math.abs(moved.z - (this.position.z + this.velocity.z * dt)) > 1e-4) this.velocity.z = 0;
    this.position.x = moved.x;
    this.position.z = moved.z;

    const speedNow = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving = speedNow > 0.5;

    if (this.moving) {
      const interval = this.running
        ? CONFIG.player.stepInterval.run
        : CONFIG.player.stepInterval.walk;
      this.stepTimer += dt * (speedNow / CONFIG.player.walkSpeed);
      this.bob += dt * (this.running ? 11 : 7);
      if (this.stepTimer >= interval) {
        this.stepTimer = 0;
        this.onStep?.();
      }
    } else {
      this.stepTimer = 0.4;
    }

    const eyeY = CONFIG.player.eyeHeight + (this.moving ? Math.sin(this.bob) * 0.045 : 0);

    if (this.selfie) {
      // 自分の前方にカメラを出して、自分と「背後」を映す
      let d = CONFIG.render.selfieCameraDistance;
      const f = this.forward;
      while (d > 0.2 && !grid.isOpenWorld(this.position.x + f.x * d, this.position.z + f.z * d)) {
        d -= 0.15;
      }
      camera.position.set(this.position.x + f.x * d, eyeY + 0.04, this.position.z + f.z * d);
      camera.rotation.set(this.pitch, this.yaw + Math.PI, 0, 'YXZ');
    } else {
      camera.position.set(this.position.x, eyeY, this.position.z);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    if (this.avatar) {
      this.avatar.visible = this.selfie;
      this.avatar.position.set(this.position.x, this.moving ? Math.sin(this.bob) * 0.03 : 0, this.position.z);
      this.avatar.rotation.y = this.yaw;
    }
  }

  dispose(scene: THREE.Scene) {
    if (this.avatar) scene.remove(this.avatar);
    this.disposables.forEach((d) => d.dispose());
  }
}
