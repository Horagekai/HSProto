import type { MonsterState } from '../config';
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

export function DebugPanel() {
  const s = useHud();
  if (!s.debug) return null;
  return (
    <div className="debug">
      <div className="debug-head">DEBUG [P]</div>
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
      <Row k="Clip (effective)" v={s.clip.toFixed(1)} />
      <Row k="Chase Mult" v={`x${s.chaseFilmMultiplier}`} />
      <Row k="Selfie Mult" v={`x${s.selfieMultiplier.toFixed(2)}`} />
      <Row k="Engagement" v={`x${s.engagement.toFixed(2)}`} />
      <Row k="Viewers" v={Math.floor(s.viewers).toString()} />
      <Row k="Earnings" v={`Y${Math.floor(s.earnings)}`} />
      <Row k="Discoveries" v={String(s.discoveries)} />
      <Row k="Leaving" v={s.leaving ? 'YES' : 'no'} />
      <Row k="Player" v={`${s.playerPos.x.toFixed(1)}, ${s.playerPos.z.toFixed(1)}`} />
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
