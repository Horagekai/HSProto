/**
 * Core Opportunity のシード試験（§81-86）。
 *
 *   const o = await import('/src/dev/opportunityTests.ts');
 *   console.log(await o.runAll());
 *
 * 「電話が鳴ったのに Viewer が何も言わない」を潰すのが目的。
 * ただし 100% 固定にはしない — Utility の結果として高い率になることを確認する。
 */
import { BUILD_ID } from '../core/build';
import type { Game } from '../game';

const DT = 1 / 60;

function dev(game?: Game) {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  if (!g) throw new Error('game not initialised');
  return g.dev;
}

const SPOTS: Record<string, [number, number, number, number]> = {
  bath: [7.6, 9.0, 6.5, 7.5],
  altar: [-11.0, 17.2, -12.5, 15.5],
  phone: [1.4, 4.6, 2.2, 3.2],
  portraits: [-13.0, 21, -14.4, 21],
};

function place(d: ReturnType<typeof dev>, spot: [number, number, number, number]) {
  const [x, z, lx, lz] = spot;
  d.player.position.x = x;
  d.player.position.z = z;
  const dx = lx - x;
  const dz = lz - z;
  const l = Math.hypot(dx, dz) || 1;
  d.player.yaw = Math.atan2(-dx / l, -dz / l);
  d.player.pitch = 0;
}

function hold(d: ReturnType<typeof dev>, frames: number) {
  for (let i = 0; i < frames; i++) {
    (d.input as unknown as { keys: Set<string> }).keys.clear();
    d.step(DT);
  }
}

function start(d: ReturnType<typeof dev>) {
  d.setMode('floor1');
  d.reset();
  d.setPhase('playing');
  (d.input as unknown as { locked: boolean }).locked = true;
  return d.floor1()!;
}

export interface SeedResult {
  name: string;
  pass: boolean;
  detail: string;
}

/** A: 電話が鳴った状況で PICK IT UP が来るか（§81） */
export function testPhone(seeds = 20, game?: Game): SeedResult {
  const d = dev(game);
  let offered = 0;
  const others: string[] = [];
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    place(d, SPOTS.phone);
    hold(d, 30);
    d.key('KeyE'); // 発見しておく
    hold(d, 30);
    f1.objects.setState('phone', 'ringing');
    f1.markPhoneEvent();
    let got = false;
    for (let i = 0; i < 40 * 60 && !got; i++) {
      hold(d, 1);
      const rr = f1.requestRuntime();
      if (rr.active) {
        if (rr.id === 'phone_answer') got = true;
        else {
          others.push(rr.id);
          break;
        }
      }
    }
    if (got) offered += 1;
  }
  const rate = Math.round((offered / seeds) * 100);
  return {
    name: 'A 電話が鳴ったら PICK IT UP',
    // 60〜85% を目安に、100% 固定でないこと（§11）
    pass: rate >= 60 && rate <= 95,
    detail: `${offered}/${seeds} (${rate}%)  他に出たもの: ${[...new Set(others)].join(',') || 'なし'}`,
  };
}

/** B: 仏壇を調べたら PLAY A BEAT が来るか（§82） */
export function testAltar(seeds = 20, game?: Game): SeedResult {
  const d = dev(game);
  let offered = 0;
  const others: string[] = [];
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    place(d, SPOTS.altar);
    hold(d, 30);
    d.key('KeyE');
    let got = false;
    for (let i = 0; i < 45 * 60 && !got; i++) {
      hold(d, 1);
      const rr = f1.requestRuntime();
      if (rr.active) {
        if (rr.id === 'altar_beat') got = true;
        else {
          others.push(rr.id);
          break;
        }
      }
    }
    if (got) offered += 1;
  }
  const rate = Math.round((offered / seeds) * 100);
  return {
    name: 'B 仏壇を調べたら PLAY A BEAT',
    pass: rate >= 55 && rate <= 95,
    detail: `${offered}/${seeds} (${rate}%)  他に出たもの: ${[...new Set(others)].join(',') || 'なし'}`,
  };
}

/** C: 背後の足音から TURN AROUND 系が来るか（§83） */
export function testBehind(seeds = 20, game?: Game): SeedResult {
  const d = dev(game);
  const picked: string[] = [];
  let any = 0;
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    place(d, SPOTS.phone);
    hold(d, 60);
    d.key('KeyE');
    hold(d, 60);
    f1.markBehindEvent();
    for (let i = 0; i < 25 * 60; i++) {
      hold(d, 1);
      const rr = f1.requestRuntime();
      if (rr.active) {
        picked.push(rr.id);
        if (rr.id.startsWith('sit_')) any += 1;
        break;
      }
    }
  }
  const kinds = new Set(picked.filter((p) => p.startsWith('sit_')));
  return {
    name: 'C 背後の足音から状況Requestが来る',
    pass: any >= seeds * 0.4 && kinds.size >= 2,
    detail: `状況 ${any}/${seeds}  種類 ${[...kinds].join(',') || 'なし'}  全体 ${[...new Set(picked)].join(',')}`,
  };
}

/** D: DON'T TURN AROUND → NOW TURN AROUND が fatigue で消えないか（§84） */
export function testChain(seeds = 12, game?: Game): SeedResult {
  const d = dev(game);
  let scored = 0;
  let best = 0;
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    place(d, SPOTS.phone);
    hold(d, 60);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('sit_dont_turn');
    // 制約を守り切る
    hold(d, 8 * 60);
    f1.markBehindEvent();
    let found = 0;
    for (let i = 0; i < 30 * 60 && !found; i++) {
      hold(d, 1);
      const c = f1.director.lastCandidates.find((x) => x.def.id === 'sit_now_turn');
      if (c) {
        found = c.score;
        best = Math.max(best, c.score);
      }
    }
    if (found > 0) scored += 1;
  }
  return {
    name: 'D 連鎖の続きが fatigue で消えない',
    pass: scored >= seeds * 0.5,
    detail: `NOW TURN AROUND が正のスコアで候補入り ${scored}/${seeds}  最高 ${best.toFixed(0)}`,
  };
}

/** E: 見えなくなった幽霊に KEEP IN FRAME を出さない（§85） */
export function testKeepFrame(seeds = 15, game?: Game): SeedResult {
  const d = dev(game);
  let badOffers = 0;
  let cancels = 0;
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    // 幽霊を見て発見させる
    d.player.position.x = -5.0;
    d.player.position.z = -8;
    const dx = -4.3;
    const l = Math.hypot(dx, 0) || 1;
    d.player.yaw = Math.atan2(-dx / l, 0);
    d.player.pitch = 0;
    hold(d, 5 * 60);
    // 目を逸らす
    d.player.yaw += Math.PI;
    for (let i = 0; i < 30 * 60; i++) {
      hold(d, 1);
      const rr = f1.requestRuntime();
      if (rr.active && rr.id === 'ghost_frame') {
        const v = f1.view();
        if (!v?.targetLocked) badOffers += 1;
        break;
      }
    }
    cancels += f1.cancelled;
  }
  return {
    name: 'E 見えていない幽霊に KEEP IN FRAME を出さない',
    pass: badOffers === 0,
    detail: `不正な提示 ${badOffers}/${seeds}  Offer直前の取り消し ${cancels}`,
  };
}

/** F: 遺影は見ている時に落ちるのが本命（§86） */
export function testPortrait(seeds = 15, game?: Game): SeedResult {
  const d = dev(game);
  let onScreen = 0;
  let offScreen = 0;
  let byInteract = 0;
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    place(d, SPOTS.portraits);
    hold(d, 60);
    d.key('KeyE');
    // Inspect だけで落ちてはいけない（§54）
    hold(d, 3 * 60);
    if (f1.objects.get('portraits')?.state === 'fallen') byInteract += 1;
    for (let i = 0; i < 150 * 60; i++) {
      hold(d, 1);
      const st = f1.objects.get('portraits')?.state;
      if (st === 'fallen') {
        const seq = (f1.kpi().horror as { sequence: string[] }).sequence;
        if (seq.includes('PortraitCrash')) onScreen += 1;
        else if (seq.includes('PortraitFellUnseen')) offScreen += 1;
        break;
      }
    }
  }
  return {
    name: 'F 遺影は見ている時に落ちる',
    pass: byInteract === 0 && onScreen > offScreen,
    detail: `Inspectで落ちた ${byInteract}（0であること）  見ている時 ${onScreen} / 見ていない時 ${offScreen}`,
  };
}

/** 電話が遠い（LDK にいる）ときに GO BACK AND ANSWER IT が来るか（§79） */
export function testPhoneFar(seeds = 30, game?: Game): SeedResult {
  const d = dev(game);
  let offered = 0;
  let nothing = 0;
  const others: string[] = [];
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    // まず電話を見つけてから、LDK へ移動する
    place(d, SPOTS.phone);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    d.player.position.x = -5.0;
    d.player.position.z = -8;
    hold(d, 60);
    f1.objects.setState('phone', 'ringing');
    f1.markPhoneEvent();
    let got = false;
    let sawAny = false;
    for (let i = 0; i < 30 * 60 && !got; i++) {
      hold(d, 1);
      const rr = f1.requestRuntime();
      if (rr.active) {
        sawAny = true;
        if (rr.id === 'phone_return') got = true;
        else {
          others.push(rr.id);
          break;
        }
      }
    }
    if (got) offered += 1;
    if (!sawAny) nothing += 1;
  }
  const rate = Math.round((offered / seeds) * 100);
  return {
    name: 'A2 電話が遠いと GO BACK AND ANSWER IT',
    pass: rate >= 45,
    detail: `${offered}/${seeds} (${rate}%)  無反応 ${nothing}  他: ${[...new Set(others)].join(',') || 'なし'}`,
  };
}

/** 風呂を調べたら TAKE A SIP。Filler に横取りされないか（§76-77） */
export function testBath(seeds = 30, game?: Game): SeedResult {
  const d = dev(game);
  let offered = 0;
  const others: string[] = [];
  for (let n = 0; n < seeds; n++) {
    const f1 = start(d);
    place(d, SPOTS.bath);
    hold(d, 30);
    d.key('KeyE');
    let got = false;
    for (let i = 0; i < 40 * 60 && !got; i++) {
      hold(d, 1);
      const rr = f1.requestRuntime();
      if (rr.active) {
        if (rr.id.startsWith('bath_')) got = true;
        else {
          others.push(rr.id);
          break;
        }
      }
    }
    if (got) offered += 1;
  }
  const rate = Math.round((offered / seeds) * 100);
  return {
    name: 'B2 風呂を調べたら TAKE A SIP',
    pass: rate >= 60 && rate <= 95,
    detail: `${offered}/${seeds} (${rate}%)  他: ${[...new Set(others)].join(',') || 'なし'}`,
  };
}

export async function runAll(game?: Game): Promise<SeedResult[]> {
  const out: SeedResult[] = [];
  out.push({ name: 'Runtime build', pass: true, detail: BUILD_ID });
  out.push(testPhone(30, game));
  out.push(testPhoneFar(30, game));
  out.push(testAltar(30, game));
  out.push(testBath(30, game));
  out.push(testBehind(20, game));
  out.push(testChain(12, game));
  out.push(testKeepFrame(15, game));
  out.push(testPortrait(15, game));
  return out;
}
