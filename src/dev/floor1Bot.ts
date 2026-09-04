/**
 * HS FLOOR 1 MODE の検証ボット。
 *
 * 使い方（開発サーバ起動中のブラウザコンソール）:
 *   const bot = await import('/src/dev/floor1Bot.ts');
 *   console.table(bot.runAllFloor1());
 *
 * 1Runでは RequestPool の多様性が確認できないので、必ず複数回まわす。
 */
import { CONFIG } from '../config';
import { createFloor1NavGrid, roomAt } from '../world/floor1Level';
import type { Game } from '../game';

export type Floor1Style =
  /** A: 安全寄り。見て回るだけ */
  | 'tourist'
  /** B: Requestをかなり受ける */
  | 'curious'
  /** C: 挑発多め。HOLDを長く押す */
  | 'provoker'
  /** D: 途中で逃げて、また戻る */
  | 'flighty'
  /** E: かなり欲張る */
  | 'greedy';

export interface Floor1Run {
  style: Floor1Style;
  outcome: 'left' | 'died' | 'timeout';
  minutes: number;
  gross: number;
  discoveries: number;
  offered: number;
  completed: number;
  dismissed: number;
  ignored: number;
  unique: number;
  repeated: number;
  requestOrder: string[];
  bathSips: number;
  ghostSelfies: number;
  altarHold: number;
  phoneHold: number;
  goal: boolean;
  ghost: string;
  memory: string[];
  maxDanger: number;
  maxHaunted: number;
  horror: Record<string, unknown>;
}

const DT = 1 / 60;
const nav = createFloor1NavGrid();

/** 見て回る順路。オブジェクトの手前に立てる位置 */
const ROUTE: Array<{ name: string; x: number; z: number; look: [number, number]; dwell: number }> = [
  { name: 'altar', x: -11.0, z: 17.2, look: [-12.5, 15.5], dwell: 9 },
  { name: 'portraits', x: -13.0, z: 21, look: [-14.4, 21], dwell: 8 },
  { name: 'oshiire', x: -13.0, z: 25, look: [-14.4, 25.5], dwell: 4 },
  { name: 'phone', x: 1.4, z: 4.6, look: [2.2, 3.2], dwell: 10 },
  { name: 'mirror', x: 11.4, z: 20, look: [12.5, 20], dwell: 9 },
  { name: 'bath', x: 7.6, z: 9.0, look: [6.5, 7.5], dwell: 10 },
  { name: 'fridge', x: 12.0, z: -5.6, look: [13.4, -6], dwell: 9 },
  { name: 'photo', x: 0, z: -6.2, look: [0, -7.4], dwell: 5 },
  { name: 'ghost', x: -5.5, z: -8, look: [-9.3, -8], dwell: 12 },
];

export function runFloor1(game: Game, style: Floor1Style, seconds = 7 * 60): Floor1Run {
  const dev = game.dev;
  dev.setMode('floor1');
  dev.reset();
  dev.setPhase('playing');
  (dev.input as unknown as { locked: boolean }).locked = true;
  const keys = dev.input as unknown as { keys: Set<string> };

  const f1 = dev.floor1() as unknown as {
    active: { def: { id: string; type: string; riskTier: number; object?: string } } | null;
    kpi: () => Record<string, unknown>;
    ghost: string;
  };
  if (!f1) throw new Error('floor1 mode not initialised');

  const p = dev.player;
  let t = 0;
  let leg = 0;
  let dwell = 0;
  let navTarget = { x: Infinity, z: Infinity };
  let maxDanger = 0;
  let maxHaunted = 0;
  const requestOrder: string[] = [];
  let lastRequestId = '';
  let holdBudget = 0;
  let pressCd = 0;
  let goingHome = false;

  // どこまで欲張るか
  const holdTarget =
    style === 'tourist' ? 0
    : style === 'curious' ? 5.5
    : style === 'provoker' ? 9
    : style === 'flighty' ? 3
    : 14;
  const riskCeiling =
    style === 'tourist' ? 1 : style === 'curious' ? 3 : style === 'flighty' ? 2 : 5;
  const leaveAt =
    style === 'tourist' ? 200
    : style === 'curious' ? 300
    : style === 'flighty' ? 150
    : seconds - 30;

  while (t < seconds && dev.phase() === 'playing') {
    t += DT;
    pressCd -= DT;
    maxDanger = Math.max(maxDanger, dev.monster.danger);
    maxHaunted = Math.max(maxHaunted, dev.haunting.level);

    const active = f1.active;
    if (active && active.def.id !== lastRequestId) {
      lastRequestId = active.def.id;
      requestOrder.push(active.def.id);
      holdBudget = holdTarget;
    }
    if (!active) lastRequestId = '';

    const takeIt = !!active && active.def.riskTier <= riskCeiling;

    // --- 目的地 ---
    // flighty は途中で一度帰りかけ、また戻る
    goingHome = style === 'flighty' ? (t > leaveAt && t < leaveAt + 45) || t > seconds - 60 : t > leaveAt;
    let target = { x: CONFIG.entrance.x, z: CONFIG.entrance.z };
    let lookAt: [number, number] | null = null;
    if (!goingHome) {
      // リクエストの対象があるなら、そこへ寄る
      const objId = takeIt ? active!.def.object : undefined;
      const spot = objId ? ROUTE.find((r) => r.name === objId) : undefined;
      const wp = spot ?? ROUTE[Math.min(leg, ROUTE.length - 1)];
      target = { x: wp.x, z: wp.z };
      lookAt = wp.look;
    }

    const dist = Math.hypot(target.x - p.position.x, target.z - p.position.z);
    if (Math.hypot(target.x - navTarget.x, target.z - navTarget.z) > 1.2) {
      navTarget = { x: target.x, z: target.z };
      nav.computeFlow(target.x, target.z);
    }
    const flow = nav.flowDir(p.position.x, p.position.z);
    const dirX = flow ? flow.x : (target.x - p.position.x) / (dist || 1);
    const dirZ = flow ? flow.z : (target.z - p.position.z) / (dist || 1);

    const arrived = dist <= 1.3;
    // --- 視線 ---
    let lx = dirX;
    let lz = dirZ;
    if (arrived && lookAt) {
      lx = lookAt[0] - p.position.x;
      lz = lookAt[1] - p.position.z;
    }
    const l = Math.hypot(lx, lz) || 1;
    p.yaw = Math.atan2(-lx / l, -lz / l);

    // --- 入力 ---
    keys.keys.clear();
    if (!arrived) {
      const yaw = p.yaw;
      const f = dirX * -Math.sin(yaw) + dirZ * -Math.cos(yaw);
      const r = dirX * Math.cos(yaw) + dirZ * -Math.sin(yaw);
      if (f > 0.25) keys.keys.add('KeyW');
      if (f < -0.25) keys.keys.add('KeyS');
      if (r > 0.25) keys.keys.add('KeyD');
      if (r < -0.25) keys.keys.add('KeyA');
      if (dist > 6) keys.keys.add('ShiftLeft');
    } else {
      dwell += DT;
    }

    // --- リクエストへの対応 ---
    if (active && takeIt) {
      const def = active.def;
      if (def.type === 'hold') {
        // 押しっぱなし。予算を使い切ったら離す
        if (holdBudget > 0) {
          keys.keys.add('KeyE');
          holdBudget -= DT;
        }
      } else if (def.type === 'action') {
        if (def.id.startsWith('ghost_selfie') || def.id === 'ghost_last_selfie') {
          if (!p.selfie) dev.key('KeyC');
        } else if (def.id === 'sit_turn' || def.id === 'sit_turn_last') {
          p.yaw += Math.PI * 0.9;
        } else if (arrived && pressCd <= 0) {
          pressCd = 0.8;
          dev.key('KeyE');
        }
      } else if (def.type === 'constraint') {
        if (def.id === 'mirror_dark' || def.id === 'sit_lights_off') {
          if (dev.lightOn()) dev.key('KeyF');
        }
        // DON'T MOVE / DON'T TURN AROUND は何もしない＝守る
        if (def.id === 'sit_dont_move') keys.keys.clear();
      }
    } else if (active && !takeIt && style !== 'greedy') {
      // 見合わなければ明確に降りる
      keys.keys.add('KeyX');
    }
    if (!active && p.selfie) dev.key('KeyC');

    // --- 発見したら次の地点へ ---
    if (arrived && dwell > (ROUTE[Math.min(leg, ROUTE.length - 1)]?.dwell ?? 3)) {
      if (!active) {
        dwell = 0;
        leg = Math.min(leg + 1, ROUTE.length - 1);
        // 一通り見たら少し戻る（re-engage の検証）
        if (leg === ROUTE.length - 1 && Math.random() < 0.5) leg = 3;
      }
    }

    // --- 帰る ---
    if (goingHome && dev.distanceToEntrance() <= CONFIG.entrance.range && !active) {
      // flighty は最初の帰宅では出ずに引き返す
      if (!(style === 'flighty' && t < seconds - 60)) dev.key('KeyE');
    }

    dev.step(DT);
  }

  if (dev.phase() === 'dying') {
    for (let i = 0; i < 60 * 6 && dev.phase() === 'dying'; i++) dev.stepDying(DT);
  }

  const r = dev.result();
  const k = (r?.floor1 ?? f1.kpi()) as Record<string, number | boolean | string[]>;
  return {
    style,
    outcome: r ? (r.survived ? 'left' : 'died') : 'timeout',
    minutes: Math.round((t / 60) * 100) / 100,
    gross: Math.floor(dev.stream.earnings),
    discoveries: k.discoveries as number,
    offered: k.offered as number,
    completed: k.completed as number,
    dismissed: k.dismissed as number,
    ignored: k.ignored as number,
    unique: k.uniqueRequests as number,
    repeated: k.repeatedRequests as number,
    requestOrder,
    bathSips: k.bathSips as number,
    ghostSelfies: k.ghostSelfies as number,
    altarHold: k.medianAltarHold as number,
    phoneHold: k.medianPhoneHold as number,
    goal: k.goal as boolean,
    ghost: f1.ghost,
    memory: (k.memory as string[]) ?? [],
    maxDanger: Math.round(maxDanger),
    maxHaunted: Math.round(maxHaunted),
    horror: (k.horror ?? {}) as unknown as Record<string, unknown>,
  };
}

export function runAllFloor1(game?: Game): Floor1Run[] {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  return (['tourist', 'curious', 'provoker', 'flighty', 'greedy'] as Floor1Style[]).map((s) =>
    runFloor1(g, s),
  );
}

/** 同じスタイルで3回まわして、Requestの並びが毎回同じでないかを見る */
export function varietyCheck(game?: Game, style: Floor1Style = 'curious') {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  const runs = [runFloor1(g, style), runFloor1(g, style), runFloor1(g, style)];
  return runs.map((r) => ({
    order: r.requestOrder.join(' → '),
    unique: r.unique,
    discoveries: r.discoveries,
    room: roomAt(0, 31),
  }));
}
