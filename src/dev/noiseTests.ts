/**
 * ViewerActivityNoise の試験（§75-91, §111-112）。
 *
 *   const n = await import('/src/dev/noiseTests.ts');
 *   console.log(await n.runAll());
 *
 * 見たいのは「波でタイミングが揺れているか」であって、
 * 「波が Request の内容を決めていないか」も同じくらい重要。
 */
import { CONFIG } from '../config';
import { ViewerActivityNoise } from '../systems/viewerActivity';
import type { Game } from '../game';

const DT = 1 / 60;

function dev(game?: Game) {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  if (!g) throw new Error('game not initialised');
  return g.dev;
}

export interface NoiseResult {
  name: string;
  pass: boolean;
  detail: string;
}

/** ノイズだけを回して統計を取る */
function sampleWave(seed: number, seconds = 300, cfg?: Partial<ViewerActivityNoise['cfg']>) {
  const n = new ViewerActivityNoise(seed, cfg);
  const out: number[] = [];
  for (let i = 0; i < seconds; i++) out.push(Math.round(n.sample(i) * 1000) / 1000);
  return out;
}

/** 1本の Run を回して、提示時刻と活動量を集める */
function runOnce(d: ReturnType<typeof dev>, seconds: number, seed?: number) {
  d.setMode('floor1');
  d.reset();
  if (seed !== undefined) d.setSeed(seed);
  d.setPhase('playing');
  (d.input as unknown as { locked: boolean }).locked = true;
  const f1 = d.floor1()!;
  const spots: Array<[number, number, number, number]> = [
    [-11.0, 17.2, -12.5, 15.5],
    [7.6, 9.0, 6.5, 7.5],
    [1.4, 4.6, 2.2, 3.2],
    [-5.0, -8, -9.3, -8],
    [0, 4, 0, 0],
  ];
  const activityAtOffer: number[] = [];
  let lastCount = 0;
  for (let i = 0; i < seconds * 60; i++) {
    (d.input as unknown as { keys: Set<string> }).keys.clear();
    // 30秒ごとに場所を変え、着いたら調べる
    if (i % (30 * 60) === 0) {
      const s = spots[(i / (30 * 60)) % spots.length];
      d.player.position.x = s[0];
      d.player.position.z = s[1];
      const dx = s[2] - s[0];
      const dz = s[3] - s[1];
      const l = Math.hypot(dx, dz) || 1;
      d.player.yaw = Math.atan2(-dx / l, -dz / l);
      d.player.pitch = 0;
    }
    if (i % (30 * 60) === 90) d.key('KeyE');
    d.step(DT);
    if (f1.offerTimes.length > lastCount) {
      lastCount = f1.offerTimes.length;
      activityAtOffer.push(d.viewerNoise().requestActivity);
    }
  }
  const times = [...f1.offerTimes];
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const variance = gaps.length
    ? gaps.reduce((a, b) => a + (b - avg) ** 2, 0) / gaps.length
    : 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    times,
    gaps,
    avg,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    variance,
    longest: gaps.length ? Math.max(...gaps) : 0,
    perMin: times.length / (seconds / 60),
    activityAtOffer,
    order: [...(f1.kpi().memory as string[])],
  };
}

export async function runAll(game?: Game): Promise<NoiseResult[]> {
  const d = dev(game);
  const out: NoiseResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });

  // 1. 同じ種なら同じ波（§75）
  {
    const a = sampleWave(12345);
    const b = sampleWave(12345);
    add('1 同じ種なら同じ波', JSON.stringify(a) === JSON.stringify(b), `${a.length}点が完全一致`);
  }

  // 2. 別の種なら別の波（§76）
  {
    const a = sampleWave(12345);
    const b = sampleWave(999);
    const same = a.filter((v, i) => v === b[i]).length;
    add('2 別の種なら別の波', same < a.length * 0.2, `一致した点 ${same}/${a.length}`);
  }

  // 3. 波の形。天井や床に張り付かない
  {
    const w = sampleWave(777, 600);
    const min = Math.min(...w);
    const max = Math.max(...w);
    const avg = w.reduce((a, b) => a + b, 0) / w.length;
    const high = w.filter((v) => v > 0.62).length / w.length;
    const low = w.filter((v) => v < 0.38).length / w.length;
    add(
      '3 波が偏っていない',
      min < 0.3 && max > 0.7 && avg > 0.35 && avg < 0.65,
      `min ${min.toFixed(2)} max ${max.toFixed(2)} 平均 ${avg.toFixed(2)}  高い時間 ${(high * 100).toFixed(0)}% / 静かな時間 ${(low * 100).toFixed(0)}%`,
    );
  }

  // 4. 周期がひと目で読めない（同じ間隔で山が来ない）
  {
    const w = sampleWave(4242, 600);
    const peaks: number[] = [];
    for (let i = 1; i < w.length - 1; i++) {
      if (w[i] > w[i - 1] && w[i] >= w[i + 1] && w[i] > 0.6) peaks.push(i);
    }
    const gaps: number[] = [];
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const sd = gaps.length
      ? Math.sqrt(gaps.reduce((a, b) => a + (b - avg) ** 2, 0) / gaps.length)
      : 0;
    add(
      '4 山の間隔が一定でない',
      gaps.length > 2 && sd > avg * 0.25,
      `山 ${peaks.length}回  平均間隔 ${avg.toFixed(0)}s  ばらつき ${sd.toFixed(0)}s`,
    );
  }

  // 5. コメント側が先行している（§25, §57）
  {
    const n = new ViewerActivityNoise(31337);
    const react: number[] = [];
    const req: number[] = [];
    for (let i = 0; i < 200; i++) {
      react.push(n.sample(i + n.cfg.reactionOffset));
      req.push(n.sample(i + n.cfg.requestOffset));
    }
    // reaction を offset 分ずらすと request と一致するはず
    const off = Math.round(n.cfg.reactionOffset - n.cfg.requestOffset);
    let match = 0;
    for (let i = 0; i + off < 200; i++) if (Math.abs(react[i] - req[i + off]) < 1e-9) match += 1;
    add('5 コメントがRequestより先行する', off > 0 && match > 150, `offset ${off}s  一致 ${match}点`);
  }

  // 6. Core は波の影響をほとんど受けない（§6, §40）
  {
    const n = new ViewerActivityNoise(5);
    const lo = n.cfg.coreCadence[0];
    const hi = n.cfg.coreCadence[1];
    const slo = n.cfg.situationCadence[0];
    const shi = n.cfg.situationCadence[1];
    add(
      '6 Coreは波にほとんど左右されない',
      hi - lo <= 0.25 && shi - slo >= 0.75,
      `Core ${lo}x〜${hi}x   状況 ${slo}x〜${shi}x`,
    );
  }

  // 7. 実 Run 中でも、同じ種なら波は同一（§75）
  //    Director 自体は重み付き抽選や warmup に乱数を使うので、
  //    Run 全体の再現性は求めない。求めるのは波の再現性。
  {
    const trace = (seed: number) => {
      d.setMode('floor1');
      d.reset();
      d.setSeed(seed);
      d.setPhase('playing');
      const out: number[] = [];
      for (let i = 0; i < 90 * 60; i++) {
        (d.input as unknown as { keys: Set<string> }).keys.clear();
        d.step(DT);
        // Director は重み付き抽選に乱数を使うので出来事の時刻は毎回違う。
        // 再現を求めるのは「自然な波」の方（§75）
        if (i % 60 === 0) out.push(Math.round(d.viewerNoise().naturalActivity * 1000) / 1000);
      }
      return out;
    };
    const a = trace(24680);
    const b = trace(24680);
    const c = trace(13579);
    add(
      '7 実Run中でも同じ種なら波は同一',
      JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c),
      `同種 ${a.length}点一致  別種は不一致=${JSON.stringify(a) !== JSON.stringify(c)}`,
    );
  }

  // 8. 種を変えるとタイミングが揺れる（§77）
  {
    const seeds = [1, 2, 3, 4, 5];
    const runs = seeds.map((sd) => runOnce(d, 150, sd));
    const firsts = runs.map((r) => Math.round(r.times[0] ?? 0));
    const counts = runs.map((r) => r.times.length);
    add(
      '8 種ごとにタイミングが変わる',
      new Set(firsts).size > 1,
      `最初の提示 ${firsts.join(', ')}s   件数 ${counts.join(', ')}`,
    );
  }

  // 9. Hard Minimum Gap を破らない（§10-11）
  {
    const r = runOnce(d, 240, 8888);
    const min = r.gaps.length ? Math.min(...r.gaps) : 99;
    add(
      '9 波が高くても最短間隔を破らない',
      min >= CONFIG.floor1.pacing.hardMinGap - 0.5,
      `最短 ${min.toFixed(1)}s（下限 ${CONFIG.floor1.pacing.hardMinGap}s）  件数 ${r.times.length}`,
    );
  }

  // 10. 波が高いところに寄るが、固定ではない（§68, §96-97）
  {
    const r = runOnce(d, 300, 1357);
    const at = r.activityAtOffer;
    const avgAt = at.length ? at.reduce((a, b) => a + b, 0) / at.length : 0;
    const lowOffers = at.filter((v) => v < 0.4).length;
    add(
      '10 高いところに寄るが固定ではない',
      avgAt > 0.45 && lowOffers > 0,
      `提示時の平均活動量 ${avgAt.toFixed(2)}  静かな時の提示 ${lowOffers}/${at.length}`,
    );
  }

  // 11. 出来事があると跳ねて、ゆっくり戻る（§80）
  {
    const n = new ViewerActivityNoise(2024);
    for (let i = 0; i < 20 * 60; i++) n.update(DT);
    const before = n.effectiveActivity;
    n.impulse('portrait_crash');
    const after = n.effectiveActivity;
    const trace: number[] = [];
    for (let i = 0; i < 20 * 60; i++) {
      n.update(DT);
      if (i % 60 === 0) trace.push(Math.round(n.eventImpulse * 100) / 100);
    }
    add(
      '11 出来事で跳ねて、ゆっくり戻る',
      after > before + 0.15 && trace[trace.length - 1] === 0,
      `${before.toFixed(2)} → ${after.toFixed(2)}  余韻の減り方 ${trace.slice(0, 12).join(' ')}`,
    );
  }

  // 12. 盛り上がり続けると疲れる（§81-82）
  {
    const n = new ViewerActivityNoise(99);
    // 出来事を連発する（誰かが喋っている想定なので無音の借金は溜めない）
    let peak = 0;
    for (let i = 0; i < 90 * 60; i++) {
      if (i % 90 === 0) n.impulse('ghost_reveal');
      n.noteOutput();
      n.update(DT);
      peak = Math.max(peak, n.fatigue);
    }
    const tired = n.fatigue;
    // 静かにすると回復する
    for (let i = 0; i < 90 * 60; i++) {
      n.noteOutput();
      n.update(DT);
    }
    add(
      '12 盛り上がり続けると疲れ、静かになると戻る',
      peak > 0.05 && n.fatigue < peak * 0.5,
      `疲れの最大 ${peak.toFixed(2)}  騒がしい間の終わり ${tired.toFixed(2)}  静かにした後 ${n.fatigue.toFixed(2)}`,
    );
  }

  // 13. 静かすぎると床が上がる（§83-84）
  {
    const n = new ViewerActivityNoise(4321);
    for (let i = 0; i < 40 * 60; i++) n.update(DT);
    const debt = n.silenceDebt;
    n.noteOutput();
    n.update(DT);
    add(
      '13 静かすぎると床が上がり、誰かが喋ると戻る',
      debt > 0.1 && n.silenceDebt === 0,
      `無音40秒での下駄 ${debt.toFixed(2)} → 発言後 ${n.silenceDebt.toFixed(2)}`,
    );
  }

  // 14. 出来事が無ければ自然な波だけで動く（§79）
  {
    const n = new ViewerActivityNoise(606);
    const w: number[] = [];
    for (let i = 0; i < 180 * 60; i++) {
      n.update(DT);
      if (i % 60 === 0) w.push(n.effectiveActivity);
    }
    const min = Math.min(...w);
    const max = Math.max(...w);
    add(
      '14 出来事なしでも波が動く',
      max - min > 0.3 && n.eventImpulse === 0,
      `min ${min.toFixed(2)} max ${max.toFixed(2)}  幅 ${(max - min).toFixed(2)}`,
    );
  }

  return out;
}

/** ノイズ ON / OFF の比較（§111-112） */
export function compareOnOff(game?: Game, seconds = 300) {
  const d = dev(game);
  const measure = (enabled: boolean) => {
    d.setNoise(enabled ? null : { enabled: false });
    const rows = [1, 2, 3].map((sd) => runOnce(d, seconds, sd));
    const all = rows.flatMap((r) => r.gaps);
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
    const variance = all.length ? all.reduce((a, b) => a + (b - avg) ** 2, 0) / all.length : 0;
    const sorted = [...all].sort((a, b) => a - b);
    return {
      requestsPerMin: (rows.reduce((a, r) => a + r.times.length, 0) / 3 / (seconds / 60)).toFixed(2),
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)].toFixed(1) : '0',
      avg: avg.toFixed(1),
      sd: Math.sqrt(variance).toFixed(1),
      longest: all.length ? Math.max(...all).toFixed(1) : '0',
    };
  };
  const off = measure(false);
  const on = measure(true);
  d.setNoise(null);
  return { off, on };
}
