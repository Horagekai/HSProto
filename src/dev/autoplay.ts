/**
 * バランス検証用のオートプレイ。
 * v1のように別実装のシミュレータを持つと本体と数値がずれるため、
 * v2では「実物のGameを操作するボット」として実装している。
 *
 * 使い方（開発サーバ起動中のブラウザコンソール）:
 *   const bot = await import('/src/dev/autoplay.ts');
 *   console.table(bot.runAll());
 */
import { CONFIG } from '../config';
import { createNavGrid } from '../world/level';
import type { Game } from '../game';

export type Style =
  | 'cashout_early' // 少し撮ってすぐ帰る
  | 'thorough' // 調査地点を回ってから帰る
  | 'greedy' // 誘惑にも全部乗る
  | 'reckless'; // 挑発・Selfieまでやる

export interface RunResult {
  style: Style;
  outcome: 'left' | 'died' | 'timeout';
  minutes: number;
  discoveries: number;
  requestsOffered: number;
  requestsCompleted: number;
  requestsEngaged: number;
  requestsIgnored: number;
  temptations: number;
  turnBacks: number;
  timeToChase: number | null;
  peakViewers: number;
  gross: number;
  final: number;
  maxDanger: number;
  maxHaunting: number;
}

const DT = 1 / 60;
const MAX_SECONDS = 12 * 60;

/** 目的地へ向かうためのフローフィールド（本体の経路とは別インスタンス） */
const nav = createNavGrid();

type Dev = Game['dev'];

/** 世界座標の進行方向を、今の視線基準のWASDに変換して押す */
function pressToward(dev: Dev, dirX: number, dirZ: number, run: boolean) {
  const yaw = dev.player.yaw;
  const f = dirX * -Math.sin(yaw) + dirZ * -Math.cos(yaw);
  const r = dirX * Math.cos(yaw) + dirZ * -Math.sin(yaw);
  const keys = (dev.input as unknown as { keys: Set<string> }).keys;
  keys.clear();
  if (run) keys.add('ShiftLeft');
  if (f > 0.25) keys.add('KeyW');
  if (f < -0.25) keys.add('KeyS');
  if (r > 0.25) keys.add('KeyD');
  if (r < -0.25) keys.add('KeyA');
}

export function run(game: Game, style: Style): RunResult {
  const dev = game.dev;
  // ONE GHOST MODE のボットを先に回していても、必ず通常モードで検証する
  dev.setMode('standard');
  dev.reset();
  dev.setPhase('playing');
  (dev.input as unknown as { locked: boolean }).locked = true;

  const points = dev.inspectPoints();
  const plan = points.map((p) => ({ x: p.x, z: p.z, type: p.type }));
  const targetCount = style === 'cashout_early' ? 2 : plan.length;

  let t = 0;
  let visited = 0;
  let maxDanger = 0;
  let maxHaunting = 0;
  let timeToChase: number | null = null;
  let inspectTimer = 0;
  let navTarget = { x: Infinity, z: Infinity };
  let dwell = 0;

  while (t < MAX_SECONDS && dev.phase() === 'playing') {
    t += DT;
    const p = dev.player;
    const monster = dev.monster;
    const req = dev.requests.active;
    const wantsHome = visited >= targetCount;

    maxDanger = Math.max(maxDanger, monster.danger);
    maxHaunting = Math.max(maxHaunting, dev.haunting.level);
    if (monster.chasing && timeToChase === null) timeToChase = t;

    // --- リクエストへの態度（[F]は無いので、目的地へ向かうかどうかで表現する） ---
    // 報酬とリスクを見て「やる価値があるか」を判断する。安いものは普通に断る。
    const riskCost = { low: 400, medium: 1500, high: 4000, extreme: 9000 } as Record<string, number>;
    const worthIt = req
      ? style === 'reckless'
        ? true
        : style === 'greedy'
          ? req.reward >= riskCost[req.risk] * 0.6
          : style === 'thorough'
            ? !req.temptation && req.reward >= riskCost[req.risk]
            : !req.temptation && req.risk === 'low'
      : false;

    // --- 目的地 ---
    let heading = { x: CONFIG.entrance.x, z: CONFIG.entrance.z };
    let kind: 'point' | 'anomaly' | 'monster' | 'home' = 'home';
    if (monster.chasing) {
      kind = 'home';
    } else if (req && worthIt && req.targetType) {
      const point = points.find((q) => q.type === req.targetType);
      if (point) {
        heading = { x: point.x, z: point.z };
        kind = 'point';
      }
    } else if (req && worthIt && (req.kind === 'get_closer' || req.kind === 'provoke')) {
      heading = { x: monster.position.x, z: monster.position.z };
      kind = 'monster';
    } else if (dev.anomalies.active.length && !wantsHome && style !== 'cashout_early') {
      const a = dev.anomalies.active[0];
      heading = { x: a.x, z: a.z };
      kind = 'anomaly';
    } else if (!wantsHome) {
      heading = plan[visited % plan.length];
      kind = 'point';
    }

    const dist = Math.hypot(heading.x - p.position.x, heading.z - p.position.z);
    const stopAt = kind === 'monster' ? 4.5 : 2.0;
    const arrived = dist <= stopAt;

    if (Math.hypot(heading.x - navTarget.x, heading.z - navTarget.z) > 1.5) {
      navTarget = { x: heading.x, z: heading.z };
      nav.computeFlow(heading.x, heading.z);
    }
    const flow = nav.flowDir(p.position.x, p.position.z);
    const dirX = flow ? flow.x : (heading.x - p.position.x) / (dist || 1);
    const dirZ = flow ? flow.z : (heading.z - p.position.z) / (dist || 1);

    // --- 視線：撮れるものがあれば撮る。移動は視線と独立に行う ---
    let lookX = dirX;
    let lookZ = dirZ;
    const monsterDist = dev.distance();
    const filmMonster =
      monster.discovered &&
      !monster.hidden &&
      monsterDist < 20 &&
      style !== 'cashout_early' &&
      !monster.chasing;
    if (filmMonster) {
      lookX = monster.position.x - p.position.x;
      lookZ = monster.position.z - p.position.z;
    } else if (arrived) {
      lookX = heading.x - p.position.x;
      lookZ = heading.z - p.position.z;
    }
    if (monster.chasing && style === 'reckless' && Math.floor(t) % 5 === 4) {
      lookX = monster.position.x - p.position.x;
      lookZ = monster.position.z - p.position.z;
    }
    const lookLen = Math.hypot(lookX, lookZ) || 1;
    p.yaw = Math.atan2(-lookX / lookLen, -lookZ / lookLen);

    // --- 移動 ---
    if (arrived) {
      (dev.input as unknown as { keys: Set<string> }).keys.clear();
      dwell += DT;
    } else {
      dwell = 0;
      pressToward(dev, dirX, dirZ, monster.chasing || dist > 8);
    }

    // --- 到着地点での行動 ---
    if (arrived && !monster.chasing) {
      inspectTimer -= DT;
      if (inspectTimer <= 0 && dwell > 0.8) {
        inspectTimer = 1.5;
        dev.key('KeyE');
        if (kind === 'point') visited += 1;
      }
    }

    // --- Selfie / 挑発 ---
    if (req && worthIt && req.kind.startsWith('selfie') && !p.selfie) dev.key('KeyC');
    if ((!req || !worthIt) && p.selfie && !monster.chasing) dev.key('KeyC');
    if (style === 'reckless' && !monster.chasing) {
      if (monsterDist < 12 && Math.random() < 0.006) dev.key('KeyE');
      if (monsterDist < 10 && !p.selfie && Math.random() < 0.004) dev.key('KeyC');
    }

    dev.step(DT);
  }

  if (dev.phase() === 'dying') {
    for (let i = 0; i < 60 * 6 && dev.phase() === 'dying'; i++) dev.stepDying(DT);
  }

  const r = dev.result();
  return {
    style,
    outcome: r ? (r.survived ? 'left' : 'died') : 'timeout',
    minutes: Math.round((t / 60) * 100) / 100,
    discoveries: r?.discoveries ?? 0,
    requestsOffered: dev.requests.offeredCount,
    requestsCompleted: dev.requests.completedCount,
    requestsEngaged: dev.requests.engagedCount,
    requestsIgnored: dev.requests.ignoredCount,
    temptations: dev.requests.temptationCount,
    turnBacks: r?.turnBacks ?? 0,
    timeToChase: timeToChase === null ? null : Math.round(timeToChase * 10) / 10,
    peakViewers: Math.floor(dev.stream.peakViewers),
    gross: Math.floor(dev.stream.earnings),
    final: r?.final ?? 0,
    maxDanger: Math.round(maxDanger),
    maxHaunting: Math.round(maxHaunting),
  };
}

export function runAll(game?: Game): RunResult[] {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  const styles: Style[] = ['cashout_early', 'thorough', 'greedy', 'reckless'];
  return styles.map((s) => run(g, s));
}
