/**
 * 状況Request の候補化テスト（§51-58）。
 *
 *   const e = await import('/src/dev/eligibilityTests.ts');
 *   console.log(await e.runAll());
 *
 * 見るのは「候補に入っているか」であって、必ず選ばれるかではない。
 * Eligibility は意味が通るかだけを判定し、順位は Score が決める。
 */
import type { Game } from '../game';

const DT = 1 / 60;

function dev(game?: Game) {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  if (!g) throw new Error('game not initialised');
  return g.dev;
}

/** 部屋の代表座標と、そこから見る先 */
const PLACES: Record<string, [number, number, number, number]> = {
  hallway: [0, 4, 0, 0],
  butsuma: [-11.0, 17.2, -12.5, 15.5],
  washroom: [11.4, 20, 12.5, 20],
  bath: [7.6, 9.0, 6.5, 7.5],
  ldk: [-5.0, -8, -9.3, -8],
  phone: [1.4, 4.6, 2.2, 3.2],
};

function start(d: ReturnType<typeof dev>) {
  d.setMode('floor1');
  d.reset();
  d.setPhase('playing');
  (d.input as unknown as { locked: boolean }).locked = true;
  return d.floor1()!;
}

function place(d: ReturnType<typeof dev>, key: string) {
  const [x, z, lx, lz] = PLACES[key];
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

export interface EligResult {
  name: string;
  pass: boolean;
  detail: string;
}

/** その状況で候補になっているものを、スコア順に返す */
function candidates(d: ReturnType<typeof dev>, f1: ReturnType<typeof dev>['floor1'] extends () => infer T ? NonNullable<T> : never) {
  // 評価が1回走るまで進める
  for (let i = 0; i < 20 * 60; i++) {
    hold(d, 1);
    if (f1.director.lastCandidates.length) break;
  }
  return f1.director.lastCandidates.map(
    (c) => `${c.def.id}:${c.score.toFixed(0)}${c.eligibleBy.length ? `(${c.eligibleBy.join('+')})` : ''}`,
  );
}

export function runAll(game?: Game): EligResult[] {
  const d = dev(game);
  const out: EligResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });

  // A: 廊下に立っているだけ。オブジェクト履歴なし
  {
    const f1 = start(d);
    place(d, 'hallway');
    const c = candidates(d, f1);
    const sit = c.filter((x) => x.startsWith('sit_'));
    add('A 廊下に立つだけで状況候補がある', sit.length > 0, `候補 ${c.length}: ${c.join('  ')}`);
  }

  // B: 廊下 + 直前に電話を触った
  {
    const f1 = start(d);
    place(d, 'phone');
    hold(d, 40);
    d.key('KeyE');
    hold(d, 60);
    place(d, 'hallway');
    hold(d, 60);
    const c = candidates(d, f1);
    add('B 直前の電話が状況候補を押し上げる', c.some((x) => /recent_object/.test(x)), `候補: ${c.join('  ')}`);
  }

  // C: 廊下 + 背後の足音
  {
    const f1 = start(d);
    place(d, 'hallway');
    hold(d, 60);
    f1.markBehindEvent();
    const c = candidates(d, f1);
    const turn = c.filter((x) => /sit_(turn|dont_turn|look_behind)/.test(x));
    add('C 背後の足音で TURN 系が上位に来る', turn.length > 0, `候補: ${c.join('  ')}`);
  }

  // D: 仏間。仏壇は未 Inspect
  {
    const f1 = start(d);
    place(d, 'butsuma');
    hold(d, 60);
    const c = candidates(d, f1);
    add('D 仏間に立つだけで候補がある', c.length > 0, `候補 ${c.length}: ${c.join('  ')}`);
  }

  // E: 仏壇を Inspect
  {
    const f1 = start(d);
    place(d, 'butsuma');
    hold(d, 40);
    d.key('KeyE');
    hold(d, 60);
    const c = candidates(d, f1);
    const top = c[0] ?? '';
    add(
      'E 仏壇 Inspect 後は PLAY A BEAT が最上位付近、状況も残る',
      top.startsWith('altar_beat') && c.some((x) => x.startsWith('sit_')),
      `候補: ${c.join('  ')}`,
    );
  }

  // F: 電話が鳴っている
  {
    const f1 = start(d);
    place(d, 'phone');
    hold(d, 40);
    d.key('KeyE');
    hold(d, 40);
    f1.objects.setState('phone', 'ringing');
    f1.markPhoneEvent();
    const c = candidates(d, f1);
    add(
      'F 電話が鳴ったら PICK IT UP が高い。状況も候補に残る',
      c.some((x) => x.startsWith('phone_answer')) && c.some((x) => x.startsWith('sit_')),
      `候補: ${c.join('  ')}`,
    );
  }

  // G: 風呂を Inspect
  {
    const f1 = start(d);
    place(d, 'bath');
    hold(d, 40);
    d.key('KeyE');
    hold(d, 60);
    const c = candidates(d, f1);
    add(
      'G 風呂 Inspect 後は TAKE A SIP が強く、状況も候補',
      c.some((x) => x.startsWith('bath_sip')) && c.some((x) => x.startsWith('sit_')),
      `候補: ${c.join('  ')}`,
    );
  }

  // H: LDK で幽霊を見つけた
  {
    const f1 = start(d);
    place(d, 'ldk');
    hold(d, 5 * 60);
    const c = candidates(d, f1);
    add(
      'H 幽霊発見後は Object と状況が共存',
      c.some((x) => x.startsWith('ghost_')) && c.some((x) => x.startsWith('sit_')),
      `候補: ${c.join('  ')}`,
    );
  }

  return out;
}
