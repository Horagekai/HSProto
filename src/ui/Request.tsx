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
 *
 * [F]ACCEPT は無い。**やれば達成、やらなければ時間切れ**。
 * ただし「これはやらない」と明確に降りる Dismiss（Xの押しっぱなし）は用意する。
 * クエストUIではなく「投げ銭が飛んできている」表示にする。
 */
export function RequestCard() {
  const s = useHud();
  const r = s.request;
  if (!r || (s.phase !== 'playing' && s.phase !== 'dying')) return null;

  const time = Math.max(0, r.timeLeft);
  const clock = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(
    Math.floor(time % 60),
  ).padStart(2, '0')}`;

  // --- 制約を実行中は、残り時間だけの小さな表示にする（§6 / §7） ---
  // 長い要求が画面を占有し続けると、何を求められているのか分からなくなる。
  if (r.constraint && r.engaged) {
    return (
      <div className="constraint">
        <span className="constraint-title">{r.title}</span>
        <span className="constraint-time">{r.constraintLeft.toFixed(1)}s</span>
        <div className="constraint-bar">
          <div className="constraint-bar-fill" style={{ width: `${r.progress * 100}%` }} />
        </div>
      </div>
    );
  }

  const cls = ['challenge'];
  if (r.engaged) cls.push('accepted');
  if (r.temptation) cls.push('temptation');
  if (r.stage === 2) cls.push('stage2');

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
          <div className="challenge-desc">
            {r.description}
            {r.constraint && r.constraintLeft > 0 && (
              <span className="constraint-tag">{Math.round(r.constraintLeft)} SEC</span>
            )}
          </div>
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

      {/* Dismiss。大きな DECLINE ボタンにするとクエストUIに見えるので、端に小さく置く */}
      <div className={s.dismissHold > 0 ? 'dismiss holding' : 'dismiss'}>
        <span className="dismiss-key">X</span>
        <span className="dismiss-label">hold to dismiss</span>
        {s.dismissHold > 0 && (
          <div className="dismiss-bar" style={{ width: `${Math.min(1, s.dismissHold) * 100}%` }} />
        )}
      </div>
    </div>
  );
}
