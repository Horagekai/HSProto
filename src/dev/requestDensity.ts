/**
 * Viewer Request の密度と多様性を測る（§56-58）。
 *
 *   const d = await import('/src/dev/requestDensity.ts');
 *   console.log(d.report());
 *
 * 「10件出すために weight を全部倍にする」ような合わせ方をしないため、
 * 件数だけでなく **間隔の分布・最長の無音・種類** を並べて見る。
 */
import type { Game } from '../game';
import { runFloor1, type Floor1Style } from './floor1Bot';

export interface DensityRun {
  style: Floor1Style;
  minutes: number;
  object: number;
  situation: number;
  total: number;
  unique: number;
  avgInterval: number;
  medianInterval: number;
  longestGap: number;
  repeatRate: number;
  firstSafePeak: number;
  order: string[];
}

const STYLES: Floor1Style[] = [
  'safe', 'safe', 'moderate', 'moderate', 'greedy_targeted',
  'greedy_targeted', 'max_greed', 'max_greed', 'tourist', 'curious',
];

export function runDensity(game?: Game, styles = STYLES): DensityRun[] {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  const out: DensityRun[] = [];
  for (const style of styles) {
    const r = runFloor1(g, style);
    // 提示時刻はログから拾う
    const rows = g.dev.logger.rows;
    const offers = rows.filter((x) => x.event === 'request_offered');
    const times = offers.map((x) => x.timestamp ?? 0);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    // 最初の提示までと、最後の提示から終わりまでも「無音」として見る
    const runSeconds = r.minutes * 60;
    const allGaps = [...gaps];
    if (times.length) {
      allGaps.push(times[0]);
      allGaps.push(runSeconds - times[times.length - 1]);
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    const peak = rows.find((x) => x.event === 'horror_event_triggered' && /intensity=strong/.test(x.detail ?? ''));
    let repeats = 0;
    for (let i = 1; i < r.requestOrder.length; i++) {
      if (r.requestOrder[i] === r.requestOrder[i - 1]) repeats += 1;
    }
    out.push({
      style,
      minutes: Math.round(r.minutes * 10) / 10,
      object: r.objectRequests,
      situation: r.situationRequests,
      total: r.offered,
      unique: r.unique,
      avgInterval: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : 0,
      medianInterval: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : 0,
      longestGap: allGaps.length ? Math.round(Math.max(...allGaps) * 10) / 10 : 0,
      repeatRate: r.requestOrder.length ? Math.round((repeats / r.requestOrder.length) * 100) : 0,
      firstSafePeak: peak ? Math.round((peak.timestamp ?? 0) * 10) / 10 : 0,
      order: r.requestOrder,
    });
  }
  return out;
}

export function report(game?: Game) {
  const runs = runDensity(game);
  const counts = new Map<string, number>();
  for (const r of runs) for (const id of r.order) counts.set(id, (counts.get(id) ?? 0) + 1);
  const sit = [...counts.entries()].filter(([k]) => k.startsWith('sit_')).sort((a, b) => b[1] - a[1]);
  const obj = [...counts.entries()].filter(([k]) => !k.startsWith('sit_')).sort((a, b) => b[1] - a[1]);
  const sum = (f: (r: DensityRun) => number) => runs.reduce((a, r) => a + f(r), 0);
  const lines = runs.map(
    (r, i) =>
      `${String(i + 1).padStart(2)} ${r.style.padEnd(16)} ${r.minutes.toFixed(1)}min  ` +
      `object ${String(r.object).padStart(2)} / situation ${String(r.situation).padStart(2)} / total ${String(r.total).padStart(2)} / unique ${String(r.unique).padStart(2)}  ` +
      `avg ${String(r.avgInterval).padStart(5)}s med ${String(r.medianInterval).padStart(5)}s maxGap ${String(r.longestGap).padStart(5)}s repeat ${r.repeatRate}%  peak1 ${r.firstSafePeak}s`,
  );
  return [
    lines.join('\n'),
    '',
    `合計  object ${sum((r) => r.object)} / situation ${sum((r) => r.situation)} / total ${sum((r) => r.total)}`,
    `平均間隔 ${(sum((r) => r.avgInterval) / runs.length).toFixed(1)}s   最長の無音 ${Math.max(...runs.map((r) => r.longestGap))}s`,
    '',
    `Situation: ${sit.map(([k, v]) => `${k} ${v}`).join(' / ') || 'なし'}`,
    `Object:    ${obj.map(([k, v]) => `${k} ${v}`).join(' / ') || 'なし'}`,
    `Safe Peak 初回: ${runs.map((r) => r.firstSafePeak).join(', ')}`,
  ].join('\n');
}
