/**
 * ONE GHOST MODE のバランス検証ボット。
 *
 * 通常モードの autoplay とは分ける。
 * 見たいのは「一体の怪異との距離をどう詰めたか」だけなので、
 * 調査地点も異変も見ず、怪異との距離とリクエストだけで行動を決める。
 *
 * 使い方（開発サーバ起動中のブラウザコンソール）:
 *   const bot = await import('/src/dev/oneGhostBot.ts');
 *   console.table(bot.runAllOneGhost());
 */
import { CONFIG } from '../config';
import { createGhostNavGrid } from '../world/ghostLevel';
import type { Game } from '../game';

export type GhostStyle =
  /** 遠くから撮るだけ。HEYしない */
  | 'timid'
  /** 報酬が見合うリクエストには乗る */
  | 'curious'
  /** 全部やる */
  | 'greedy';

export interface GhostRunResult {
  style: GhostStyle;
  outcome: 'left' | 'died' | 'timeout';
  minutes: number;
  /** 怪異を見つけるまでの秒数（§4：長い探索をさせない） */
  timeToDiscover: number | null;
  closest: number;
  heyUses: number;
  requestsOffered: number;
  requestsCompleted: number;
  requestsIgnored: number;
  longestChain: number;
  chases: number;
  chasesEscaped: number;
  retreats: number;
  returns: number;
  gross: number;
  final: number;
  maxDanger: number;
  longestQuiet: number;
}

const DT = 1 / 60;
const nav = createGhostNavGrid();

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

const RISK_COST: Record<string, number> = { low: 400, medium: 1500, high: 4000, extreme: 9000 };

export function runOneGhost(game: Game, style: GhostStyle, seconds = 6 * 60): GhostRunResult {
  const dev = game.dev;
  dev.setMode('one_ghost');
  dev.reset();
  dev.setPhase('playing');
  (dev.input as unknown as { locked: boolean }).locked = true;

  const home = { x: CONFIG.entrance.x, z: CONFIG.entrance.z };
  // 距離の好み：怖がりほど遠くから撮る
  const preferred = style === 'timid' ? 15 : style === 'curious' ? 9 : 5;
  const leaveAt = style === 'timid' ? 150 : style === 'curious' ? 240 : seconds;

  let t = 0;
  let closest = 999;
  let maxDanger = 0;
  let timeToDiscover: number | null = null;
  let chases = 0;
  let wasChasing = false;
  let heyCooldown = 0;
  let navTarget = { x: Infinity, z: Infinity };

  while (t < seconds && dev.phase() === 'playing') {
    t += DT;
    heyCooldown -= DT;
    const p = dev.player;
    const monster = dev.monster;
    const req = dev.requests.active;
    const d = dev.distance();
    maxDanger = Math.max(maxDanger, monster.danger);
    if (monster.discovered && timeToDiscover === null) timeToDiscover = t;
    if (monster.discovered) closest = Math.min(closest, d);
    if (monster.chasing && !wasChasing) chases += 1;
    wasChasing = monster.chasing;

    const wantsHome = t > leaveAt || monster.chasing;
    // 安いのに危ないものは断る（＝何もしない）。断り方は「やらない」だけ
    const worthIt = req
      ? style === 'greedy'
        ? true
        : style === 'curious'
          ? req.reward >= RISK_COST[req.risk] * 0.7
          : false
      : false;

    // --- 目的地 ---
    let heading = home;
    if (wantsHome) {
      heading = home;
    } else if (monster.discovered) {
      // 怪異の周りで、好みの距離を保つ
      const ang = Math.atan2(p.position.x - monster.position.x, p.position.z - monster.position.z);
      const closeUp = worthIt && req && (req.kind === 'get_closer' || req.kind === 'get_closer2');
      const want = closeUp ? (req.kind === 'get_closer2' ? 4 : 7) : preferred;
      heading = {
        x: monster.position.x + Math.sin(ang) * want,
        z: monster.position.z + Math.cos(ang) * want,
      };
    } else {
      // まだ見つけていないので、廊下をOFFICEの出入口まで進む
      heading = { x: 0, z: CONFIG.oneGhost.monsterSpawn.z };
    }

    const dist = Math.hypot(heading.x - p.position.x, heading.z - p.position.z);
    if (Math.hypot(heading.x - navTarget.x, heading.z - navTarget.z) > 1.5) {
      navTarget = { x: heading.x, z: heading.z };
      nav.computeFlow(heading.x, heading.z);
    }
    const flow = nav.flowDir(p.position.x, p.position.z);
    const dirX = flow ? flow.x : (heading.x - p.position.x) / (dist || 1);
    const dirZ = flow ? flow.z : (heading.z - p.position.z) / (dist || 1);

    // --- 視線：基本は怪異を撮り続ける。追跡中に撮るかどうかが Chase Greed ---
    let lookX = dirX;
    let lookZ = dirZ;
    const filmIt =
      monster.discovered &&
      !monster.hidden &&
      d < 26 &&
      (!monster.chasing || style === 'greedy' || (style === 'curious' && Math.floor(t) % 6 >= 4));
    if (filmIt) {
      lookX = monster.position.x - p.position.x;
      lookZ = monster.position.z - p.position.z;
    }
    const len = Math.hypot(lookX, lookZ) || 1;
    p.yaw = Math.atan2(-lookX / len, -lookZ / len);

    // --- 移動 ---
    const dontMove = !!req && worthIt && req.kind === 'dont_move';
    if (dist <= 1.4 || dontMove) {
      (dev.input as unknown as { keys: Set<string> }).keys.clear();
    } else {
      pressToward(dev, dirX, dirZ, monster.chasing || dist > 8);
    }

    // --- HEY ---
    const askedToCall =
      !!req &&
      worthIt &&
      (req.kind.startsWith('hey') ||
        req.kind === 'one_last_call' ||
        req.kind === 'one_last_call2');
    const wantsHey = askedToCall || (style === 'greedy' && d < 20 && Math.random() < 0.004);
    if (wantsHey && heyCooldown <= 0 && style !== 'timid') {
      heyCooldown = 1.4;
      dev.key('KeyQ');
    }

    // --- Selfie ---
    const wantsSelfie =
      !!req && worthIt && (req.kind.includes('selfie') || req.kind === 'dont_turn_around');
    if (wantsSelfie && !p.selfie) dev.key('KeyC');
    if (!wantsSelfie && p.selfie && !monster.chasing) dev.key('KeyC');

    // --- 帰る。ただし ONE LAST CALL に乗るならまだ帰らない ---
    if (wantsHome && !monster.chasing && dev.distanceToEntrance() <= CONFIG.entrance.range) {
      if (!(req && worthIt && req.temptation)) dev.key('KeyE');
    }

    dev.step(DT);
  }

  if (dev.phase() === 'dying') {
    for (let i = 0; i < 60 * 6 && dev.phase() === 'dying'; i++) dev.stepDying(DT);
  }

  const r = dev.result();
  const rows = dev.logger.rows;
  return {
    style,
    outcome: r ? (r.survived ? 'left' : 'died') : 'timeout',
    minutes: Math.round((t / 60) * 100) / 100,
    timeToDiscover: timeToDiscover === null ? null : Math.round(timeToDiscover * 10) / 10,
    closest: closest === 999 ? 0 : Math.round(closest * 10) / 10,
    heyUses: dev.hey.total,
    requestsOffered: dev.requests.offeredCount,
    requestsCompleted: dev.requests.completedCount,
    requestsIgnored: dev.requests.ignoredCount,
    longestChain: dev.requests.longestChain + 1,
    chases,
    chasesEscaped: rows.filter((x) => x.event === 'chase_escaped').length,
    retreats: dev.ghostStats.retreats,
    returns: dev.ghostStats.returns,
    gross: Math.floor(dev.stream.earnings),
    final: r?.final ?? 0,
    maxDanger: Math.round(maxDanger),
    longestQuiet: r?.tempo.longestQuiet ?? 0,
  };
}

export function runAllOneGhost(game?: Game): GhostRunResult[] {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  const styles: GhostStyle[] = ['timid', 'curious', 'greedy'];
  return styles.map((s) => runOneGhost(g, s));
}
