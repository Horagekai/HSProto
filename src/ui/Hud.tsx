import { CONFIG } from '../config';
import { formatNumber } from '../core/util';
import { useHud } from './useHud';

function Stars({ n }: { n: number }) {
  const total = CONFIG.stream.clip.starThresholds.length;
  return (
    <span className="stars">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < n ? 'star on' : 'star'}>
          {i < n ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}

export function Hud() {
  const s = useHud();
  if (s.phase === 'menu' || s.phase === 'ended') return null;

  const chaseFilming = s.chasing && s.onScreen;
  const selfieBonus = s.selfie && s.selfieMultiplier > 1.05;

  return (
    <div className="hud">
      <div className="hud-topleft">
        <div className="live">
          <span className="dot" /> LIVE
          {s.selfie && <span className="selfie-tag">SELFIE</span>}
          {s.lightsOff && <span className="selfie-tag danger">LIGHTS OFF</span>}
          {s.carrying && <span className="selfie-tag">CARRYING</span>}
        </div>
        <div className="handle">@abandoned_hospital_night</div>
        {/* ONE GHOST MODE には集める footage が存在しない（被写体は一体だけ） */}
        {s.mode === 'one_ghost' ? (
          <div className="discoveries">ONE GHOST</div>
        ) : (
          <div className="discoveries">FOOTAGE {s.discoveries}</div>
        )}
        {s.mouseHint && <div className="mouse-hint">CLICK TO CAPTURE MOUSE (STILL LIVE)</div>}
      </div>

      <div className="hud-topright">
        <div className="viewers-label">👁 VIEWERS</div>
        <div className="viewers">{formatNumber(s.viewers)}</div>
      </div>

      <div className="hud-chat">
        {s.chat.map((m) => (
          <div key={m.id} className={m.hot ? 'chat-line hot' : 'chat-line'}>
            <span className="chat-user">{m.user}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>

      <div className="hud-bottomleft">
        <div className="earnings-label">STREAM EARNINGS</div>
        <div className="earnings">¥{formatNumber(s.earnings)}</div>
        <div className="likes">❤️ {formatNumber(s.likes)}</div>
      </div>

      <div className="hud-bottomcenter">
        <div className={chaseFilming || selfieBonus ? 'clip chase' : 'clip'}>
          <span className="clip-label">CLIP VALUE</span>
          <Stars n={s.stars} />
          {chaseFilming && <span className="clip-mult">×{s.chaseFilmMultiplier}</span>}
          {selfieBonus && <span className="clip-mult">SELFIE ×{s.selfieMultiplier.toFixed(1)}</span>}
        </div>
        <div className="engagement">
          ENGAGEMENT <b>×{s.engagement.toFixed(1)}</b>
          {s.subject && s.clip > 6 && <span className="subject">FILMING: {s.subject}</span>}
        </div>
      </div>

      <div className={s.onScreen ? 'crosshair on' : 'crosshair'} />

      {s.prompt && <div className="prompt">{s.prompt}</div>}

      {s.atEntrance && s.phase === 'playing' && (
        <div className="cashout">
          <div className="cashout-label">CURRENT STREAM EARNINGS</div>
          <div className="cashout-value">¥{formatNumber(s.earnings)}</div>
          <div className="cashout-hint">[E] LEAVE AND KEEP EARNINGS</div>
        </div>
      )}

      {s.footage && <div className="footage">{s.footage}</div>}
      {s.toast && <div className="toast">{s.toast}</div>}
      {s.hint && <div className="hint">{s.hint}</div>}

      {s.phase === 'dying' && s.connectionLost && (
        <div className="connection-lost">CONNECTION LOST</div>
      )}
    </div>
  );
}
