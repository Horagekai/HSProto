/**
 * Horror Director v1.1 のシナリオテスト（§57-58）。
 *
 *   const s = await import('/src/dev/horrorScenarios.ts');
 *   console.table(s.runScenarios());
 *
 * 不変条件テストは「やってはいけないこと」を見る。
 * こちらは **Run タイプごとの出方** を見る。
 * とくに Scenario D は今回のバグ（環境イベントが枯れた枠を Ghost が埋める）の再現ケース。
 *
 * ただしこれで完成扱いにはしない。実プレイ 5 Run が必須（§59）。
 */
import { HorrorDirector, type HorrorContext } from '../systems/horrorDirector';
import { FLOOR1_HORROR } from '../systems/horrorEvents';

export interface ScenarioResult {
  scenario: string;
  pass: boolean;
  detail: string;
}

const GHOST_FAMILIES = new Set(['GHOST_VISUAL', 'GHOST_SPATIAL', 'FAKE_THREAT', 'CHASE']);

function ctxOf(over: Partial<HorrorContext> = {}): HorrorContext {
  const dists: Record<string, number> = {
    altar: 10, portraits: 12, oshiire: 14, phone: 8, mirror: 9,
    washer: 12, bath: 11, fridge: 13, photo: 10, tv: 15, sofa: 12, ghost: 12,
  };
  const rooms: Record<string, string> = {
    altar: 'butsuma', portraits: 'butsuma', oshiire: 'butsuma', phone: 'hallway',
    mirror: 'washroom', washer: 'washroom', bath: 'bath', fridge: 'ldk',
    photo: 'ldk', tv: 'ldk', sofa: 'ldk', ghost: 'ldk',
  };
  return {
    haunted: 50,
    danger: 20,
    room: 'hallway',
    phase: 'ENGAGEMENT',
    chaseActive: false,
    ghostState: 'standing',
    ghostDistance: 12,
    ghostOnScreen: false,
    objectDistances: dists,
    objectStates: {},
    objectRoom: rooms,
    memories: new Set<string>(),
    memoryAge: {},
    focusObject: null,
    activeRequestId: null,
    activeRequestType: null,
    lastRiskTier: 0,
    goalReached: false,
    returning: false,
    finalTemptationTaken: false,
    ...over,
  };
}

interface Shot {
  id: string;
  family: string;
  at: number;
}

function simulate(d: HorrorDirector, seconds: number, ctx: HorrorContext) {
  const out: Shot[] = [];
  const dt = 1 / 30;
  let t = 0;
  for (let i = 0; i < seconds * 30; i++) {
    t += dt;
    const e = d.update(dt, ctx);
    if (e) out.push({ id: e.id, family: e.family, at: t });
  }
  return out;
}

function gaps(shots: Shot[]) {
  const g: number[] = [];
  for (let i = 1; i < shots.length; i++) g.push(shots[i].at - shots[i - 1].at);
  return g;
}

const AMBIENT_IDS = FLOOR1_HORROR.filter((e) => e.family.startsWith('AMBIENT')).map((e) => e.id);

export function runScenarios(): ScenarioResult[] {
  const out: ScenarioResult[] = [];
  const add = (scenario: string, pass: boolean, detail: string) => out.push({ scenario, pass, detail });

  // ---- A: Safe。低 Haunted で語彙が足りているか ----
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const shots = simulate(d, 420, ctxOf({ haunted: 22, danger: 6, ghostState: 'seated' }));
    const ids = new Set(shots.map((s) => s.id));
    const fams = new Set(shots.map((s) => s.family));
    // v1 は LightFlicker / HouseSettle / DoorCreak の 3 種しか出なかった
    add(
      'A Safe: 低Hauntedの語彙',
      ids.size >= 6 && fams.size >= 4,
      `unique=${ids.size} families=${fams.size} [${[...ids].join(',')}]`,
    );
  }

  // ---- B: Greedy。高 Haunted で密度が制御されているか ----
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const shots = simulate(d, 420, ctxOf({ haunted: 100, danger: 60, ghostState: 'stalking' }));
    const g = gaps(shots);
    const avg = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    const short = g.filter((x) => x < 6).length;
    add(
      'B Greedy: 密度制御',
      avg >= 12 && short <= g.length * 0.1,
      `avgGap=${avg.toFixed(1)}s short(<6s)=${short}/${g.length} maxPressure=${d.kpi(420).maxPressure}`,
    );
  }

  // ---- C: Ghost 候補が多い状況で連発しないか ----
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const shots = simulate(d, 420, ctxOf({ haunted: 100, danger: 70, ghostState: 'stalking' }));
    const ghost = shots.filter((s) => GHOST_FAMILIES.has(s.family));
    let chained = 0;
    for (let i = 1; i < ghost.length; i++) if (ghost[i].at - ghost[i - 1].at < 10) chained += 1;
    const share = shots.length ? ghost.length / shots.length : 0;
    add(
      'C Ghost-heavy: Ghost連発なし',
      chained === 0 && share < 0.5,
      `ghost=${ghost.length}/${shots.length} (${(share * 100).toFixed(0)}%) within10s=${chained}`,
    );
  }

  // ---- D: 環境イベント枯渇。今回のバグ再現ケース ----
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    // LightFlicker / HouseSettle / DoorCreak / 環境系をすべて使い切った状態を作る
    d.debugExhaust(['LightFlicker', 'HouseSettle', 'DoorCreak', 'DistantFootstep', ...AMBIENT_IDS]);
    const shots = simulate(d, 90, ctxOf({ haunted: 100, danger: 70, ghostState: 'stalking' }));
    const ghost = shots.filter((s) => GHOST_FAMILIES.has(s.family));
    const k = d.kpi(90);
    let chained = 0;
    for (let i = 1; i < ghost.length; i++) if (ghost[i].at - ghost[i - 1].at < 12) chained += 1;
    // 枠が空いたから Ghost で埋める、になっていないこと。沈黙が増えること
    add(
      'D 枯渇: Ghostで埋めない',
      chained === 0 && k.silenceRate >= 60,
      `events=${shots.length}/90s ghost=${ghost.length} chained=${chained} silence=${k.silenceRate}%`,
    );
  }

  // ---- E: Last Temptation。必ず意味のある返事が返るか ----
  {
    let ok = 0;
    let nothingInWindow = 0;
    const latencies: number[] = [];
    const picked: string[] = [];
    for (let trial = 0; trial < 30; trial++) {
      const d = new HorrorDirector(FLOOR1_HORROR);
      d.reset();
      // Run 途中の状態を作る。刺激過多でも返事は返さなければならない
      simulate(d, 200, ctxOf({ haunted: 90, danger: 55, ghostState: 'stalking' }));
      d.requireConsequence('LAST_TEMPTATION', ['ghost', 'behind'], 'ghost');
      const dt = 1 / 30;
      // 予約が解決されるまで回す。earliest までの通常イベントは「返事」ではない
      for (let i = 0; i < 12 * 30 && !d.lastResolvedBy; i++) {
        d.update(dt, ctxOf({ haunted: 90, danger: 55, ghostState: 'stalking', returning: true, finalTemptationTaken: true }));
      }
      const r = d.lastResolvedBy;
      if (r) {
        ok += 1;
        latencies.push(r.latency);
        picked.push(r.id);
        if (r.intensity === 'subtle') nothingInWindow += 1;
      }
    }
    const avgLat = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const unique = new Set(picked).size;
    add(
      'E LastTemptation: 必ず返事',
      ok === 30 && nothingInWindow === 0 && unique >= 3,
      `fired=${ok}/30 avgLatency=${avgLat.toFixed(1)}s unique=${unique} [${[...new Set(picked)].join(',')}]`,
    );
  }

  // ---- Consequence Intent: 重要な Greed に返事が返るか ----
  const intentScenario = (
    label: string,
    source: string,
    setup: Partial<HorrorContext>,
    trials = 20,
  ) => {
    let resolved = 0;
    const picked: string[] = [];
    const lats: number[] = [];
    for (let n = 0; n < trials; n++) {
      const d = new HorrorDirector(FLOOR1_HORROR);
      d.reset();
      // Greed するまでの助走
      simulate(d, 60, ctxOf(setup));
      d.addIntent(source);
      d.markGreed(4);
      // 現場を離れて別の部屋へ移動した想定で回す
      const after = ctxOf({ ...setup, room: 'hallway' });
      const dt = 1 / 30;
      const before = d.intentResolved;
      const firedBefore = d.kpi(1).sequence.length;
      for (let i = 0; i < 100 * 30 && d.intentResolved === before; i++) d.update(dt, after);
      if (d.intentResolved > before) {
        resolved += 1;
        const seq = d.kpi(1).sequence;
        const line = d.intentLog.find((l) => l.kind === 'consequence_intent_resolved');
        const m = line?.detail.match(/event=(\w+)/);
        picked.push(m ? m[1] : seq[firedBefore] ?? '?');
        const lm = line?.detail.match(/latency=([\d.]+)/);
        if (lm) lats.push(parseFloat(lm[1]));
      }
    }
    const rate = Math.round((resolved / trials) * 100);
    const avgLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    add(
      label,
      rate >= 60,
      `resolved=${rate}% (${resolved}/${trials}) avgLatency=${avgLat.toFixed(1)}s unique=${new Set(picked).size} [${[...new Set(picked)].join(',')}]`,
    );
  };

  intentScenario('C bath_sip_2 の返事', 'bath_sip_2', {
    haunted: 45,
    room: 'bath',
    memories: new Set(['bath_sip_2']),
    memoryAge: { bath_sip_2: 0 },
  });
  intentScenario('D phone_listened_long の返事', 'phone_listened_long', {
    haunted: 50,
    room: 'hallway',
    memories: new Set(['phone_listened_long']),
    memoryAge: { phone_listened_long: 0 },
  });
  intentScenario('E ghost_close_selfie の返事', 'ghost_close_selfie', {
    haunted: 70,
    room: 'ldk',
    ghostState: 'standing',
    memories: new Set(['ghost_selfie_taken', 'ghost_close_selfie']),
    memoryAge: { ghost_selfie_taken: 0, ghost_close_selfie: 0 },
  });

  // ---- F: Safe Run に山があり、危険は増えていないか ----
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const shots = simulate(d, 300, ctxOf({ haunted: 20, danger: 5, ghostState: 'seated' }));
    const k = d.kpi(300);
    const dangerous = d.peaks.filter((p) => p.threat === 'high' || p.threat === 'lethal');
    add(
      'F Safe Run: 山はあるが危険にならない',
      k.peaks >= 1 && dangerous.length === 0,
      `peaks=${k.peaks} [${k.peakList.join(', ')}] dangerous=${dangerous.length} events=${shots.length}`,
    );
  }

  return out;
}
