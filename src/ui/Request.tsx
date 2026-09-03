import { formatNumber } from '../core/util';
import { useHud } from './useHud';

const RISK_LABEL: Record<string, string> = {
  low: 'RISK ▁',
  medium: 'RISK ▃',
  high: 'RISK ▅',
  extreme: 'RISK █',
};

/**
 * 視聴者リクエスト。
 * [F]ACCEPT は無い。**やれば達成、やらなければ時間切れ**。
 * クエストUIではなく「投げ銭が飛んできている」表示にする。
 */
export function RequestCard() {
  const s = useHud();
  const r = s.request;
  if (!r || (s.phase !== 'playing' && s.phase !== 'dying')) return null;

  const cls = ['challenge'];
  if (r.engaged) cls.push('accepted');
  if (r.temptation) cls.push('temptation');
  if (r.stage === 2) cls.push('stage2');

  const time = Math.max(0, r.timeLeft);
  const clock = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(
    Math.floor(time % 60),
  ).padStart(2, '0')}`;

  return (
    <div className={cls.join(' ')}>
      <div className="challenge-head">
        {r.temptation ? '💰 ONE LAST REQUEST' : '💰 VIEWER REQUEST'}
        <span className={`risk risk-${r.risk}`}>{RISK_LABEL[r.risk]}</span>
      </div>

      {r.stage === 1 ? (
        <>
          <div className="challenge-reward">+¥{formatNumber(r.reward)}</div>
          <div className="challenge-title">{r.title}</div>
          <div className="challenge-desc">{r.description}</div>
        </>
      ) : (
        <>
          <div className="challenge-title small">{r.title}</div>
          <div className="challenge-desc">{r.description}</div>
          <div className="options">
            {r.options.map((o) => (
              <div key={o.id} className="option">
                <span>{o.label}</span>
                <b>+¥{formatNumber(o.reward)}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {r.nextTitle && (
        <div className="next-reward">
          NEXT +¥{formatNumber(r.nextReward)} — {r.nextTitle}
        </div>
      )}

      <div className="challenge-bar">
        <div className="challenge-bar-fill" style={{ width: `${r.progress * 100}%` }} />
      </div>
      <div className="challenge-timer">{clock}</div>
    </div>
  );
}
