/**
 * Core Opportunity のライフサイクル試験（§66-71）。
 *
 *   const c = await import('/src/dev/coreLifecycleTests.ts');
 *   console.log(c.runAll());
 *
 * 見たいのは「壁時計で腐っていないか」。
 * 別のリクエストを処理していただけで機会を失うのは、Viewer の都合ではなく内部都合。
 */
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
  ldk: [-5.0, -8, -9.3, -8],
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

export interface LifeResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runAll(game?: Game): LifeResult[] {
  const d = dev(game);
  const out: LifeResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail });
  const coresOf = (f1: ReturnType<typeof dev>['floor1'] extends () => infer T ? NonNullable<T> : never) =>
    (f1 as unknown as { cores: Array<{ source: string; state: string; wallTime: number; eligibleActiveTime: number; pausedTime: number }> }).cores;

  // A: 別Request実行中は Bath の機会が減らない（§66）
  {
    const f1 = start(d);
    place(d, SPOTS.bath);
    hold(d, 30);
    d.key('KeyE');           // 風呂を調べる → 機会が開く
    hold(d, 30);
    // 枠を長く塞ぐ。制約系は数秒で終わってしまうので HOLD 系を使う
    f1.debugOffer('altar_beat');
    hold(d, 20 * 60);        // 20秒待つ
    const bath = coresOf(f1).find((c) => c.source === 'bath');
    add(
      'A 別Request中は風呂の機会が減らない',
      !!bath && bath.wallTime > 15 && bath.eligibleActiveTime < bath.wallTime * 0.5,
      bath
        ? `state=${bath.state} wall=${bath.wallTime.toFixed(1)}s eligible=${bath.eligibleActiveTime.toFixed(1)}s paused=${bath.pausedTime.toFixed(1)}s`
        : '機会が消えている',
    );
  }

  // B: 風呂から離れたら期限切れ（§67）
  {
    const f1 = start(d);
    place(d, SPOTS.bath);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('sit_dont_move');
    place(d, SPOTS.ldk);     // 別の部屋へ行ってしまう
    hold(d, 6 * 60);
    const bath = coresOf(f1).find((c) => c.source === 'bath');
    add('B 風呂を離れたら機会が消える', !bath, bath ? `まだ残っている state=${bath.state}` : '期限切れ（left_room）');
  }

  // C: 別Request中に電話が鳴っても、既存Requestは続く（§68）
  {
    const f1 = start(d);
    place(d, SPOTS.phone);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('sit_dont_move');
    const before = f1.requestRuntime().id;
    f1.debugRingPhone(20);
    hold(d, 3 * 60);
    const after = f1.requestRuntime().id;
    const phone = coresOf(f1).find((c) => c.source === 'phone');
    add(
      'C 電話が鳴っても実行中のRequestは中断しない',
      before === after && !!phone,
      `${before} → ${after}   電話の機会=${phone ? 'あり' : 'なし'}`,
    );
  }

  // D: 枠が空く前に鳴り止んだら、後出ししない（§69）
  {
    const f1 = start(d);
    place(d, SPOTS.phone);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('sit_dont_move');
    f1.debugRingPhone(20);
    hold(d, 2 * 60);
    f1.debugStopPhone(); // 鳴り止む
    hold(d, 30 * 60);
    const late = f1.requestRuntime().id.startsWith('phone_');
    add(
      'D 鳴り止んだ電話のRequestを後出ししない',
      !late,
      `今のRequest=${f1.requestRuntime().id || 'なし'}`,
    );
  }

  // E: 幽霊と電話が両方あるとき、どちらも勝つ（§70）
  {
    let phoneWins = 0;
    let ghostWins = 0;
    const seeds = 20;
    for (let n = 0; n < seeds; n++) {
      const f1 = start(d);
      place(d, SPOTS.phone);
      hold(d, 30);
      d.key('KeyE');
      hold(d, 20);
      place(d, SPOTS.ldk);
      hold(d, 4 * 60);       // 幽霊を発見
      f1.debugRingPhone(20);
      for (let i = 0; i < 25 * 60; i++) {
        hold(d, 1);
        const rr = f1.requestRuntime();
        if (rr.active) {
          if (rr.id.startsWith('phone_')) phoneWins += 1;
          else if (rr.id.startsWith('ghost_')) ghostWins += 1;
          break;
        }
      }
    }
    add(
      'E 幽霊と電話はどちらも勝つ',
      phoneWins > 0 && ghostWins > 0,
      `電話 ${phoneWins} / 幽霊 ${ghostWins} / その他 ${seeds - phoneWins - ghostWins}（20シード）`,
    );
  }

  // F: 風呂と洗面所を往復してもチャタリングしない（§26, A1）
  {
    const f1 = start(d);
    place(d, SPOTS.bath);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('altar_beat');      // 枠を塞いで Offer させない
    for (let i = 0; i < 4; i++) {
      place(d, [11.4, 20, 12.5, 20]); // 洗面所へ
      hold(d, 2 * 60);
      place(d, SPOTS.bath);           // 風呂へ戻る
      hold(d, 2 * 60);
    }
    const st = f1.kpi().sessions as { started: number; softLost: number; resumed: number; hardLost: number };
    add(
      'F 風呂と洗面所の往復でチャタリングしない',
      st.started === 1 && st.hardLost === 0,
      `started=${st.started} soft_lost=${st.softLost} resumed=${st.resumed} hard_lost=${st.hardLost}` +
        `（風呂と洗面所は同一エリアなので中断すら起きない）`,
    );
  }

  // F2: エリアの外へ一瞬出て戻る。中断して再開する（§9, A3）
  {
    const f1 = start(d);
    place(d, SPOTS.bath);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('altar_beat');
    place(d, [0, 4, 0, 0]);           // 廊下へ一瞬出る（エリア外・でも近い）
    hold(d, 3 * 60);
    place(d, SPOTS.bath);             // 戻る
    hold(d, 2 * 60);
    const st = f1.kpi().sessions as { started: number; softLost: number; resumed: number; hardLost: number };
    add(
      'F2 一瞬エリアを出て戻れば同じSessionが続く',
      st.started === 1 && st.softLost > 0 && st.resumed > 0 && st.hardLost === 0,
      `started=${st.started} soft_lost=${st.softLost} resumed=${st.resumed} hard_lost=${st.hardLost}`,
    );
  }

  // G: 完全にエリアを離れたら1回だけ Hard Lost（§27, A2）
  {
    const f1 = start(d);
    place(d, SPOTS.bath);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('altar_beat');
    place(d, [11.4, 20, 12.5, 20]);   // 洗面所
    hold(d, 60);
    place(d, [0, 4, 0, 0]);           // 廊下
    hold(d, 60);
    place(d, SPOTS.ldk);              // LDK
    hold(d, 4 * 60);
    const st = f1.kpi().sessions as { started: number; hardLost: number };
    const reasons = f1.kpi().coreMissReasons as Record<string, number>;
    add(
      'G エリアを離れたら Hard Lost は1回だけ',
      st.hardLost === 1,
      `hard_lost=${st.hardLost}  内訳=${JSON.stringify(reasons)}`,
    );
  }

  // H: 仏間の中で移動しても Session が続く（§29, A4）
  {
    const f1 = start(d);
    place(d, SPOTS.altar);
    hold(d, 30);
    d.key('KeyE');
    hold(d, 30);
    f1.debugOffer('sit_dont_move');
    place(d, [-13.0, 21, -14.4, 21]); // 遺影の前へ
    hold(d, 3 * 60);
    place(d, SPOTS.altar);
    hold(d, 2 * 60);
    const st = f1.kpi().sessions as { started: number; hardLost: number };
    add('H 仏間の中の移動では切れない', st.hardLost === 0, `started=${st.started} hard_lost=${st.hardLost}`);
  }

  return out;
}
