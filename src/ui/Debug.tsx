import type { MonsterState } from '../config';
import { BUILD_ID } from '../core/build';
import { useHud } from './useHud';

/**
 * ONE GHOST MODE の段階表示（§11）。
 * 内部の 'aggressive' 帯がこのモードの STALKING、'hunting' 帯が AGGRESSIVE にあたる。
 */
const GHOST_STATE: Record<MonsterState, string> = {
  dormant: 'DORMANT',
  observed: 'OBSERVED',
  aware: 'AWARE',
  aggressive: 'STALKING',
  hunting: 'AGGRESSIVE',
  chasing: 'CHASING',
};

/**
 * 直近の視聴者活動量を線で見る。丸は Request が出た瞬間。
 * 波の高いところに寄っているが固定ではない、を目で確かめるためのもの。
 */
function NoiseGraph({ trace, offers }: { trace: number[]; offers: number[] }) {
  if (trace.length < 2) return null;
  const w = 200;
  const h = 40;
  const step = w / Math.max(1, trace.length - 1);
  const pts = trace.map((v, i) => `${(i * step).toFixed(1)},${(h - v * h).toFixed(1)}`).join(' ');
  return (
    <svg className="noise-graph" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke="rgba(255,214,120,0.9)" strokeWidth="1.5" />
      {offers.map((i) => (
        <circle
          key={i}
          cx={(i * step).toFixed(1)}
          cy={(h - (trace[i] ?? 0) * h).toFixed(1)}
          r="2.5"
          fill="rgba(255,120,120,0.95)"
        />
      ))}
    </svg>
  );
}

export function DebugPanel() {
  const s = useHud();
  if (!s.debug) return null;
  return (
    <div className="debug">
      <div className="debug-head">DEBUG [P] &middot; build {BUILD_ID}</div>
      <Row k="Mode" v={s.mode === 'one_ghost' ? 'ONE GHOST' : 'STANDARD'} />
      <Row
        k="Monster State"
        v={s.mode === 'one_ghost' ? GHOST_STATE[s.monsterState] : s.monsterState}
      />
      <Row k="Behavior" v={s.monsterBehavior} />
      <Row k="Danger" v={s.danger.toFixed(1)} />
      <Row k="Haunting" v={s.haunting.toFixed(1)} />
      <Row k="Distance" v={`${s.distance.toFixed(2)}m`} />
      <Row k="On Screen" v={s.onScreen ? 'YES' : 'no'} />
      <Row k="Center Score" v={s.centerScore.toFixed(3)} />
      <Row k="Subject" v={s.subject ?? '-'} />
      <Row k="State Key" v={s.stateKey || '-'} />
      <Row k="Repeat Count" v={String(s.repeatCount)} />
      <Row k="Novelty" v={`x${s.novelty.toFixed(2)}`} />
      <Row k="Risk" v={`x${s.risk.toFixed(2)}`} />
      <Row k="Footage Value" v={s.footageValue.toFixed(1)} />
      <Row k="Stream Goal" v={s.goalReached ? 'REACHED' : 'not yet'} />
      <Row k="Clip (effective)" v={s.clip.toFixed(1)} />
      <Row k="Chase Mult" v={`x${s.chaseFilmMultiplier}`} />
      <Row k="Selfie Mult" v={`x${s.selfieMultiplier.toFixed(2)}`} />
      <Row k="Engagement" v={`x${s.engagement.toFixed(2)}`} />
      <Row k="Viewers" v={Math.floor(s.viewers).toString()} />
      <Row k="Earnings" v={`Y${Math.floor(s.earnings)}`} />
      <Row k="Discoveries" v={String(s.discoveries)} />
      <Row k="Leaving" v={s.leaving ? 'YES' : 'no'} />
      <Row k="Player" v={`${s.playerPos.x.toFixed(1)}, ${s.playerPos.z.toFixed(1)}`} />
      {s.f1Debug && (
        <>
          <div className="debug-head">FLOOR 1</div>
          <Row k="Room" v={s.f1Debug.room} />
          <Row k="Ghost" v={s.f1Debug.ghost} />
          <Row k="Director" v={s.f1Debug.director} />
          <Row k="Candidates" v={s.f1Debug.candidates.join(' / ') || '-'} />
          <Row k="Rejected" v={s.f1Debug.rejected.join(' ') || '-'} />
          <Row k="Memory" v={s.f1Debug.memory.join(' ') || '-'} />
          <div className="debug-head">HORROR DIRECTOR</div>
          <Row
            k="Tension"
            v={`${s.f1Debug.horror.tension} → ${s.f1Debug.horror.desired} (desired)`}
          />
          <Row
            k="Tension内訳"
            v={Object.entries(s.f1Debug.horror.components)
              .filter(([, v]) => v > 0.5)
              .map(([k, v]) => `${k} ${Math.round(v)}`)
              .join(' / ') || '-'}
          />
          <Row
            k="Peak Need / Opportunity"
            v={`${s.f1Debug.horror.peakNeed} / ${s.f1Debug.horror.peakOpportunity}  [${s.f1Debug.horror.peaks.join(', ') || '山なし'}]`}
          />
          <Row k="Consequence Intents" v={s.f1Debug.horror.intents.join(' / ') || '-'} />
          <Row k="Pacing Need" v={s.f1Debug.horror.pacing.toFixed(2)} />
          <Row k="Last Horror" v={`${s.f1Debug.horror.sinceHorror.toFixed(1)}s ago`} />
          <Row k="Last Strong" v={`${s.f1Debug.horror.sinceStrong.toFixed(1)}s ago`} />
          <Row
            k="Relief / Anticip."
            v={`${s.f1Debug.horror.relief.toFixed(1)} / ${s.f1Debug.horror.anticipation.toFixed(1)}`}
          />
          <Row
            k="Horror Pressure"
            v={`${s.f1Debug.horror.pressure.toFixed(1)} ${s.f1Debug.horror.pressureBand}`}
          />
          <Row
            k="Last 30s"
            v={`${s.f1Debug.horror.events30s} events / ${s.f1Debug.horror.strong30s} strong / ${s.f1Debug.horror.ghost30s} ghost`}
          />
          <Row
            k="Nothing / MinScore"
            v={`${s.f1Debug.horror.nothingScore} / ${s.f1Debug.horror.minScore}`}
          />
          {s.f1Debug.horror.pending && (
            <Row
              k="Pending Consequence"
              v={`${s.f1Debug.horror.pending.source} req=${s.f1Debug.horror.pending.required} ` +
                `win ${s.f1Debug.horror.pending.earliest}..${s.f1Debug.horror.pending.latest} ` +
                `elapsed ${s.f1Debug.horror.pending.elapsed}`}
            />
          )}
          <Row k="Request" v={s.f1Debug.request} />
          {s.viewerNoise && (
            <>
              <Row k="Run Seed" v={String(s.viewerNoise.seed)} />
              <Row
                k="Viewer Activity"
                v={`${s.viewerNoise.activity.toFixed(2)} ${s.viewerNoise.phase}  (long ${s.viewerNoise.long.toFixed(2)} / short ${s.viewerNoise.short.toFixed(2)})`}
              />
              <Row
                k="Pulse 内訳"
                v={`natural ${s.viewerNoise.natural.toFixed(2)}  impulse +${s.viewerNoise.impulse.toFixed(2)}  debt +${s.viewerNoise.debt.toFixed(2)}  fatigue -${s.viewerNoise.fatigue.toFixed(2)}`}
              />
              <Row
                k="Reaction / Request"
                v={`${s.viewerNoise.reaction.toFixed(2)} / ${s.viewerNoise.request.toFixed(2)}`}
              />
              <NoiseGraph trace={s.viewerNoise.trace} offers={s.viewerNoise.offers} />
            </>
          )}
          <Row k="Request Counts" v={s.f1Debug.requestCounts} />
          <Row k="Request Candidate" v={s.f1Debug.candidate} />
          <Row k="Invalid Special Actions" v={String(s.f1Debug.invalidActions)} />
          <Row k="Top Candidates" v={s.f1Debug.horror.candidates.join(' / ') || '-'} />
          <Row k="Rejected" v={s.f1Debug.horror.rejected.join(' ') || '-'} />
          <Row k="Selected" v={s.f1Debug.horror.selected || '-'} />
        </>
      )}
      <Row k="FPS" v={String(s.fps)} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="debug-row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
