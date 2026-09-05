/**
 * HorrorDirector の不変条件テスト（§86）。
 *
 *   const t = await import('/src/dev/horrorTests.ts');
 *   console.table(t.runHorrorTests());
 *
 * 数式上正しくても実プレイで壊れることがあるので、これは最低ラインの確認であって
 * 実プレイテストの代わりにはならない。
 */
import { CONFIG } from '../config';
import { HorrorDirector, type HorrorContext } from '../systems/horrorDirector';
import { FLOOR1_HORROR } from '../systems/horrorEvents';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function baseCtx(over: Partial<HorrorContext> = {}): HorrorContext {
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
    discoveries: 6,
    goalReached: false,
    returning: false,
    finalTemptationTaken: false,
    ...over,
  };
}

/** dt を刻んで n 秒回し、発火したイベントIDを集める */
function run(d: HorrorDirector, seconds: number, ctx: HorrorContext | (() => HorrorContext)) {
  const out: string[] = [];
  const dt = 1 / 30;
  for (let i = 0; i < seconds * 30; i++) {
    const c = typeof ctx === 'function' ? ctx() : ctx;
    const e = d.update(dt, c);
    if (e) out.push(e.id);
  }
  return out;
}

export function runHorrorTests(): TestResult[] {
  const results: TestResult[] = [];
  const add = (name: string, pass: boolean, detail = '') => results.push({ name, pass, detail });

  // 1. Chase 中は通常の恐怖イベントを出さない
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const fired = run(d, 120, baseCtx({ chaseActive: true, haunted: 100 }));
    add('chase中は通常イベントを出さない', fired.length === 0, `fired=${fired.length}`);
  }

  // 2. Ghost が画面内なら空間移動系を出さない
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const fired = run(d, 300, baseCtx({ ghostOnScreen: true, haunted: 100 }));
    const bad = fired.filter((id) => id === 'GhostReposition' || id === 'GhostPeek' || id === 'GhostCrossing' || id === 'SofaEmpty');
    add('画面内では幽霊を瞬間移動させない', bad.length === 0, `bad=${bad.join(',') || 'none'}`);
  }

  // 3. Cooldown が守られる
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const times: Record<string, number[]> = {};
    const dt = 1 / 30;
    let t = 0;
    for (let i = 0; i < 600 * 30; i++) {
      t += dt;
      const e = d.update(dt, baseCtx({ haunted: 100 }));
      if (e) (times[e.id] ??= []).push(t);
    }
    let ok = true;
    let detail = '';
    for (const [id, ts] of Object.entries(times)) {
      const def = FLOOR1_HORROR.find((x) => x.id === id)!;
      for (let i = 1; i < ts.length; i++) {
        if (ts[i] - ts[i - 1] < def.cooldown - 0.5) {
          ok = false;
          detail = `${id} gap=${(ts[i] - ts[i - 1]).toFixed(1)} < ${def.cooldown}`;
        }
      }
    }
    add('cooldownが守られる', ok, detail);
  }

  // 4. 強いイベントが連続しない
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const strongIds = new Set(FLOOR1_HORROR.filter((e) => e.intensity === 'strong' || e.intensity === 'climax').map((e) => e.id));
    const fired = run(d, 600, baseCtx({ haunted: 100, memories: new Set(['phone_listened_long']) }));
    let backToBack = 0;
    for (let i = 1; i < fired.length; i++) {
      if (strongIds.has(fired[i]) && strongIds.has(fired[i - 1])) backToBack += 1;
    }
    add('強いイベントが連続しない', backToBack === 0, `backToBack=${backToBack}`);
  }

  // 5. requiredMemory の無いイベントは候補にならない
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const fired = run(d, 600, baseCtx({ haunted: 100, memories: new Set() }));
    const memIds = new Set(FLOOR1_HORROR.filter((e) => e.requiredMemories?.length).map((e) => e.id));
    const bad = fired.filter((id) => memIds.has(id));
    add('記憶が無ければ記憶イベントは出ない', bad.length === 0, `bad=${[...new Set(bad)].join(',') || 'none'}`);
  }

  // 6. oncePerRun が複数回発火しない
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const fired = run(d, 900, baseCtx({
      haunted: 100,
      ghostState: 'aware',
      memories: new Set(['phone_listened_long', 'portrait_restored', 'ghost_selfie_taken']),
      memoryAge: { phone_listened_long: 60, portrait_restored: 60, ghost_selfie_taken: 60 },
    }));
    const once = FLOOR1_HORROR.filter((e) => e.oncePerRun).map((e) => e.id);
    const bad = once.filter((id) => fired.filter((f) => f === id).length > 1);
    add('oncePerRunが複数回出ない', bad.length === 0, `bad=${bad.join(',') || 'none'}`);
  }

  // 7. Nothing が候補に入る
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    run(d, 120, baseCtx());
    // 候補が増えたので上位6件ではなく全候補を見る
    const hasNothing = d.lastAllCandidates.some((c) => c.def.id === 'Nothing');
    const nothing = d.lastAllCandidates.find((c) => c.def.id === 'Nothing');
    add(
      'Nothingが候補に入る',
      hasNothing,
      `nothing=${nothing?.score.toFixed(0)} of ${d.lastAllCandidates.length} candidates`,
    );
  }

  // 8. Tension が 0..100 に収まる
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    let min = 999;
    let max = -999;
    const dt = 1 / 30;
    for (let i = 0; i < 600 * 30; i++) {
      d.update(dt, baseCtx({ haunted: 100 }));
      if (i % 17 === 0) d.markGreed(5);
      min = Math.min(min, d.tension);
      max = Math.max(max, d.tension);
    }
    add('Tensionが0-100に収まる', min >= 0 && max <= 100, `min=${min.toFixed(1)} max=${max.toFixed(1)}`);
  }

  // 9. 高Tensionで強いイベントのスコアが下がる
  {
    // 評価は一定間隔でしか走らないので、候補が出るまで少し回す
    // 前の評価結果が残っていると、そのときの Tension でのスコアを見てしまう
    const evaluate = (d: HorrorDirector, ctx = baseCtx({ haunted: 100 })) => {
      d.lastAllCandidates = [];
      for (let i = 0; i < 600 && d.lastAllCandidates.length === 0; i++) {
        d.update(1 / 30, ctx);
      }
      return d.lastAllCandidates;
    };
    const low = new HorrorDirector(FLOOR1_HORROR);
    low.reset();
    const lowScores = evaluate(low);

    // Tension Envelope では「+20 して減衰」ではなく状況から緊張が決まるので、
    // 追われている状況を作って上げる
    const high = new HorrorDirector(FLOOR1_HORROR);
    high.reset();
    high.markChase(true);
    const tense = baseCtx({ haunted: 100, ghostState: 'stalking', phase: 'OVERTIME' });
    for (let i = 0; i < 8 * 30; i++) high.update(1 / 30, tense);
    const highScores = evaluate(high, tense);

    const pickStrong = (cs: typeof lowScores) =>
      cs.find((c) => c.def.intensity === 'strong' || c.def.intensity === 'medium');
    const a = pickStrong(lowScores);
    const b = pickStrong(highScores);
    const nothingHigh = highScores.find((c) => c.def.id === 'Nothing');
    const nothingLow = lowScores.find((c) => c.def.id === 'Nothing');
    const ok =
      (!a || !b || b.score < a.score) &&
      !!nothingHigh && !!nothingLow && nothingHigh.score > nothingLow.score;
    add(
      '高Tensionで強いイベントが下がり、Nothingが上がる',
      ok,
      `tension=${high.tension.toFixed(0)} nothing ${nothingLow?.score.toFixed(0)}→${nothingHigh?.score.toFixed(0)}`,
    );
  }

  // 10. 強いイベントの直後は間が空く
  {
    const d = new HorrorDirector(FLOOR1_HORROR);
    d.reset();
    const dt = 1 / 30;
    let t = 0;
    const strongIds = new Set(FLOOR1_HORROR.filter((e) => e.intensity === 'strong').map((e) => e.id));
    let lastStrongAt = -999;
    let minGapAfterStrong = 999;
    for (let i = 0; i < 900 * 30; i++) {
      t += dt;
      const e = d.update(dt, baseCtx({ haunted: 100, ghostState: 'standing' }));
      if (!e) continue;
      if (lastStrongAt > 0 && t - lastStrongAt < minGapAfterStrong) {
        minGapAfterStrong = t - lastStrongAt;
      }
      if (strongIds.has(e.id)) lastStrongAt = t;
      else if (lastStrongAt > 0) lastStrongAt = -999;
    }
    const need = CONFIG.horror.relief.strong[0];
    add(
      '強いイベントの直後に間が入る',
      minGapAfterStrong >= need - 0.5 || minGapAfterStrong === 999,
      `minGap=${minGapAfterStrong === 999 ? 'n/a' : minGapAfterStrong.toFixed(1)}s need>=${need}`,
    );
  }

  return results;
}
