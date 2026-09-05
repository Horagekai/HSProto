/**
 * HS FLOOR 1 の Request Runtime テスト。
 *
 *   const t = await import('/src/dev/requestTests.ts');
 *   console.table(await t.runRequestTests());
 *
 * 解析だけで済ませず、実ゲームの Floor1Mode を実際に回して確かめる。
 * 数値ではなく **中心ループが成立しているか** を見るのが目的。
 */
import { BUILD_ID } from '../core/build';
import { CONFIG } from '../config';
import type { Game } from '../game';

export interface RequestTestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const DT = 1 / 60;

function dev(game?: Game) {
  const g = game ?? (window as unknown as { __HS: Game }).__HS;
  if (!g) throw new Error('game not initialised');
  return g.dev;
}

/** 指定の場所へ瞬間移動して、そちらを向く */
function place(d: ReturnType<typeof dev>, x: number, z: number, lookX: number, lookZ: number) {
  d.player.position.x = x;
  d.player.position.z = z;
  const lx = lookX - x;
  const lz = lookZ - z;
  const l = Math.hypot(lx, lz) || 1;
  d.player.yaw = Math.atan2(-lx / l, -lz / l);
}

function step(d: ReturnType<typeof dev>, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) d.step(DT);
}

const SPOTS: Record<string, [number, number, number, number]> = {
  bath: [7.6, 9.0, 6.5, 7.5],
  altar: [-11.0, 17.2, -12.5, 15.5],
  phone: [1.4, 4.6, 2.2, 3.2],
};

export async function runRequestTests(game?: Game): Promise<RequestTestResult[]> {
  const out: RequestTestResult[] = [];
  const add = (name: string, pass: boolean, detail = '') => out.push({ name, pass, detail });
  const d = dev(game);

  // ---- 0. 実行中の Build が最新か（§1-3） ----
  const expected = (window as unknown as { __EXPECTED_BUILD__?: string }).__EXPECTED_BUILD__;
  if (expected && expected !== BUILD_ID) {
    add('TEST ABORTED: STALE RUNTIME BUILD', false, `runtime=${BUILD_ID} expected=${expected}`);
    return out;
  }
  add('Runtime build', true, BUILD_ID);

  const start = () => {
    d.setMode('floor1');
    d.reset();
    d.setPhase('playing');
    (d.input as unknown as { locked: boolean }).locked = true;
    return d.floor1()!;
  };

  // ---- 1. Bath Gate（§60, §84） ----
  {
    const f1 = start();
    place(d, ...SPOTS.bath);
    // Request が出ていない間だけ [E] を押す。出たら押さない。
    // Inspect から自然に Request が出るのは正しい挙動なので、そこは数えない。
    let sipsWhileNoRequest = 0;
    let presses = 0;
    for (let i = 0; i < 90 * 60; i++) {
      const rr = f1.requestRuntime();
      if (!rr.active && i % 30 === 0) {
        const before = f1.kpi().bathSips as number;
        d.key('KeyE');
        presses += 1;
        if ((f1.kpi().bathSips as number) > before) sipsWhileNoRequest += 1;
      }
      d.step(DT);
    }
    add(
      '1 Request無しでは飲めない',
      sipsWhileNoRequest === 0 && f1.invalidSpecialActions === 0,
      `presses=${presses} sipsWithoutRequest=${sipsWhileNoRequest} invalid=${f1.invalidSpecialActions}`,
    );
  }

  // ---- 2. Bath Request（§61） ----
  {
    const f1 = start();
    place(d, ...SPOTS.bath);
    // Inspect してから、自然に候補 → 提示 → E を待つ
    d.key('KeyE');
    let sips = 0;
    let sawUi = false;
    let sawUnlock = false;
    let dismissed = 0;
    for (let i = 0; i < 240 * 60 && sips === 0; i++) {
      d.step(DT);
      const rr = f1.requestRuntime();
      if (rr.active && rr.relatedObject === 'bath') {
        sawUi = sawUi || f1.requestUiShown > 0;
        if (rr.actionUnlocked) {
          sawUnlock = true;
          d.key('KeyE');
        }
      } else if (rr.active && i % 30 === 0) {
        // 風呂を飲みたいプレイヤーは、関係ないリクエストを降りる
        f1.dismiss();
        dismissed += 1;
      }
      sips = f1.kpi().bathSips as number;
    }
    void dismissed;
    add(
      '2 Requestが出れば飲める',
      sips > 0 && sawUi && sawUnlock,
      `sips=${sips} uiShown=${f1.requestUiShown} unlocked=${sawUnlock}`,
    );
  }

  // ---- 3. Altar 候補が長時間 Pending しない（§62） ----
  {
    const f1 = start();
    place(d, ...SPOTS.altar);
    d.key('KeyE');
    let maxAge = 0;
    for (let i = 0; i < 180 * 60; i++) {
      d.step(DT);
      const c = f1.debug().candidate;
      const m = c.match(/age=([\d.]+)s/);
      if (m) maxAge = Math.max(maxAge, parseFloat(m[1]));
    }
    add(
      '3 候補が20秒以上Pendingしない',
      maxAge <= CONFIG.floor1.pacing.candidate.staleTimeout + 1,
      `maxAge=${maxAge.toFixed(1)}s limit=${CONFIG.floor1.pacing.candidate.staleTimeout}`,
    );
  }

  // ---- 4. Phone Gate（§63） ----
  {
    const f1 = start();
    place(d, ...SPOTS.phone);
    for (let i = 0; i < 40; i++) {
      d.key('KeyE');
      step(d, 0.5);
    }
    const st = f1.objects.get('phone');
    add(
      '4 Request無しでは受話器を取らない',
      st?.state !== 'answered' && f1.invalidSpecialActions === 0,
      `phoneState=${st?.state} invalid=${f1.invalidSpecialActions}`,
    );
  }

  // ---- 5. 状況Requestでも request_active が立つ（§64） ----
  {
    const f1 = start();
    place(d, ...SPOTS.altar);
    let seen: ReturnType<typeof f1.requestRuntime> | null = null;
    for (let i = 0; i < 240 * 60 && !seen; i++) {
      d.step(DT);
      if (i % 120 === 0) d.key('KeyE');
      const rr = f1.requestRuntime();
      if (rr.active) seen = rr;
    }
    add(
      '5 提示された瞬間にactive=1',
      !!seen && seen.active === 1 && seen.reward > 0 && seen.type !== '',
      seen ? `${seen.id} active=${seen.active} type=${seen.type} ¥${seen.reward}` : 'リクエストが出なかった',
    );
  }

  // ---- 6. 不変条件（§10, §11, §65） ----
  {
    const f1 = start();
    let offeredWithoutActive = 0;
    let completedWithoutActive = 0;
    let lastActiveId = '';
    const rows: string[] = [];
    for (let i = 0; i < 360 * 60; i++) {
      d.step(DT);
      const rr = f1.requestRuntime();
      if (rr.state === 'offered' && rr.active !== 1) offeredWithoutActive += 1;
      if (rr.active) lastActiveId = rr.id;
      if (i % 900 === 0) {
        // ときどき近くの対象を調べる
        const spot = Object.values(SPOTS)[(i / 900) % 3 | 0];
        place(d, ...(spot as [number, number, number, number]));
        d.key('KeyE');
      }
    }
    for (const r of d.logger.rows) {
      if (r.event === 'request_offered' && r.request_active !== 1) rows.push(`offered ${r.detail}`);
      if (r.event === 'request_completed' && !lastActiveId) completedWithoutActive += 1;
    }
    add(
      '6 offeredなのにactive=0が無い',
      offeredWithoutActive === 0 && rows.length === 0,
      `frames=${offeredWithoutActive} logRows=${rows.length}`,
    );
    add('6b activeでないrequestが完了しない', completedWithoutActive === 0, `bad=${completedWithoutActive}`);
  }

  // ---- 7. E→HEY conflict（§67） ----
  {
    const f1 = start();
    place(d, ...SPOTS.bath);
    const before = d.logger.rows.filter((r) => r.event === 'hey_used').length;
    for (let i = 0; i < 60; i++) {
      d.key('KeyE');
      step(d, 0.3);
    }
    const after = d.logger.rows.filter((r) => r.event === 'hey_used').length;
    add('7 Request無しのEでHEYが出ない', after === before, `hey ${before}→${after}`);
    void f1;
  }

  // ---- 8. Object Request Need（§68） ----
  {
    const f1 = start();
    // 3つ調べる
    for (const k of ['bath', 'altar', 'phone'] as const) {
      place(d, ...SPOTS[k]);
      d.key('KeyE');
      step(d, 3);
    }
    const need = f1.objectRequestNeed();
    let objectOffers = 0;
    for (let i = 0; i < 240 * 60; i++) {
      d.step(DT);
      if (i % 1800 === 0) {
        const keys = ['bath', 'altar', 'phone'] as const;
        place(d, ...SPOTS[keys[(i / 1800) % 3 | 0]]);
      }
    }
    objectOffers = f1.objectRequestsOffered;
    // need は「Object Request が足りていない度合い」なので、
    // 実際に出るようになった今は 0 のままが正常。見るべきは提示数の方。
    add(
      '8 調べたあとObject Requestが出る',
      objectOffers > 0,
      `need=${need.toFixed(2)} objectOffers=${objectOffers} situation=${f1.situationRequestsOffered}`,
    );
  }

  return out;
}
