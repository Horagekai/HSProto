import { CONFIG } from '../config';
import { formatNumber } from '../core/util';
import { useHud } from './useHud';

interface Props {
  onRestart: () => void;
  onMenu: () => void;
  onDownload: (kind: 'json' | 'csv') => void;
}

export function ResultScreen({ onRestart, onMenu, onDownload }: Props) {
  const s = useHud();
  if (s.phase !== 'ended' || !s.result) return null;
  const r = s.result;
  const totalStars = CONFIG.stream.clip.starThresholds.length;

  return (
    <div className="result">
      <div className="result-card">
        <div className="result-head">
          STREAM ENDED
          <span className="result-mode">
            {r.mode === 'one_ghost' ? 'ONE GHOST MODE' : 'STANDARD MVP'}
          </span>
        </div>
        <div className={r.survived ? 'result-verdict survived' : 'result-verdict died'}>
          {r.survived ? 'YOU MADE IT OUT' : 'YOU DIED'}
        </div>

        <div className="money">
          <div className="money-row">
            <span>Gross Earnings</span>
            <b>¥{formatNumber(r.gross)}</b>
          </div>
          {r.lost > 0 && (
            <div className="money-row lost">
              <span>Lost on Death</span>
              <b>-¥{formatNumber(r.lost)}</b>
            </div>
          )}
          {r.bonus > 0 && (
            <div className="money-row bonus">
              <span>Safe Return Bonus</span>
              <b>+¥{formatNumber(r.bonus)}</b>
            </div>
          )}
          <div className="money-row final">
            <span>Final Earnings</span>
            <b>¥{formatNumber(r.final)}</b>
          </div>
        </div>

        <dl className="result-stats">
          <div>
            <dt>Peak Viewers</dt>
            <dd>{formatNumber(r.peakViewers)}</dd>
          </div>
          <div>
            <dt>Likes</dt>
            <dd>{formatNumber(r.likes)}</dd>
          </div>
          <div>
            {/* ONE GHOST MODE には集める footage が無い。代わりに「どこまで近づいたか」を出す */}
            {r.oneGhost ? (
              <>
                <dt>Closest Distance</dt>
                <dd>{r.oneGhost.closestDistance.toFixed(1)}m</dd>
              </>
            ) : (
              <>
                <dt>Footage Found</dt>
                <dd>{r.discoveries}</dd>
              </>
            )}
          </div>
          <div>
            <dt>Requests</dt>
            <dd>
              {r.requestsCompleted} / {r.requestsOffered}
            </dd>
          </div>
          <div>
            <dt>Turned Back</dt>
            <dd>
              {r.turnBacks} / {r.temptations}
            </dd>
          </div>
          <div>
            <dt>Highest Clip Value</dt>
            <dd>
              {'★'.repeat(r.maxStars)}
              {'☆'.repeat(Math.max(0, totalStars - r.maxStars))}
            </dd>
          </div>
          <div>
            <dt>Max Engagement</dt>
            <dd>×{r.maxEngagement.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Stream Time</dt>
            <dd>
              {Math.floor(r.duration / 60)}:{String(Math.floor(r.duration % 60)).padStart(2, '0')}
            </dd>
          </div>
        </dl>

        {!r.survived && <div className="result-viral">FINAL MOMENT WENT VIRAL</div>}
        {r.survived && r.turnBacks > 0 && (
          <div className="result-note">…you went back in {r.turnBacks} time(s) and still made it.</div>
        )}
        {r.survived && r.turnBacks === 0 && r.temptations > 0 && (
          <div className="result-note">…you ignored them and walked out. Good call.</div>
        )}

        {r.oneGhost && (
          <details className="tempo" open>
            <summary>ONE GHOST</summary>
            <div className="tempo-grid">
              <span>Closest distance</span>
              <b className={r.oneGhost.closestDistance <= 6 ? 'good' : 'bad'}>
                {r.oneGhost.closestDistance.toFixed(1)}m
              </b>
              <span>HEY count</span>
              <b>{r.oneGhost.heyCount}</b>
              <span>Second HEY rate</span>
              <b className={r.oneGhost.secondHeyRate >= 30 ? 'good' : 'bad'}>
                {r.oneGhost.secondHeyRate}%
              </b>
              <span>Retreat → Return rate</span>
              <b className={r.oneGhost.returns > 0 ? 'good' : 'bad'}>
                {r.oneGhost.returns} / {r.oneGhost.retreats} ({r.oneGhost.returnRate}%)
              </b>
              <span>Chase greed rate</span>
              <b className={r.oneGhost.chaseGreedRate >= 50 ? 'good' : ''}>
                {r.oneGhost.chaseGreed} / {r.oneGhost.chases} ({r.oneGhost.chaseGreedRate}%)
              </b>
              <span>Escaped a chase, then went back</span>
              <b className={r.oneGhost.returnedAfterEscape > 0 ? 'good' : ''}>
                {r.oneGhost.returnedAfterEscape} / {r.oneGhost.escapes}
              </b>
              <span>Exit opportunities ignored</span>
              <b className={r.oneGhost.exitOpportunitiesIgnored > 0 ? 'good' : ''}>
                {r.oneGhost.exitOpportunitiesIgnored} / {r.oneGhost.exitOpportunities} (
                {r.oneGhost.exitIgnoredRate}%)
              </b>
            </div>
          </details>
        )}

        {r.floor1 && (
          <details className="tempo" open>
            <summary>HS FLOOR 1</summary>
            <div className="tempo-grid">
              <span>Discoveries</span>
              <b className={r.floor1.discoveries >= 5 ? 'good' : 'bad'}>{r.floor1.discoveries}</b>
              <span>Requests offered / done / dismissed / ignored</span>
              <b>
                {r.floor1.offered} / {r.floor1.completed} / {r.floor1.dismissed} /{' '}
                {r.floor1.ignored}
              </b>
              <span>Request variety (unique / repeated)</span>
              <b className={r.floor1.uniqueRequests >= 5 ? 'good' : 'bad'}>
                {r.floor1.uniqueRequests} / {r.floor1.repeatedRequests}
              </b>
              <span>Altar hold (median / reached tier2)</span>
              <b>
                {r.floor1.medianAltarHold.toFixed(1)}s / {r.floor1.altarTier2}
              </b>
              <span>Phone listen (median / reached tier2)</span>
              <b>
                {r.floor1.medianPhoneHold.toFixed(1)}s / {r.floor1.phoneTier2}
              </b>
              <span>Bath sips</span>
              <b className={r.floor1.bathSips >= 2 ? 'good' : ''}>{r.floor1.bathSips}</b>
              <span>Ghost selfies</span>
              <b className={r.floor1.ghostSelfies > 0 ? 'good' : ''}>{r.floor1.ghostSelfies}</b>
              <span>Voluntary continuations</span>
              <b className={r.floor1.voluntaryContinuations > 0 ? 'good' : 'bad'}>
                {r.floor1.voluntaryContinuations}
              </b>
              <span>Stream goal / last temptation</span>
              <b>
                {r.floor1.goal ? 'REACHED' : 'no'} / {r.floor1.lastTemptation ? 'SHOWN' : 'no'}
              </b>
              <span>World memory</span>
              <b>{r.floor1.memory.join(' ') || '-'}</b>
            </div>
          </details>
        )}

        <details className="tempo" open>
          <summary>ECONOMY — NOVELTY / RISK</summary>
          <div className="tempo-grid">
            <span>Stream goal</span>
            <b className={r.economy.goalReached ? 'good' : ''}>
              {r.economy.goalReached ? 'REACHED' : 'not reached'}
            </b>
            <span>States filmed</span>
            <b>{r.economy.trackedStates}</b>
            <span>Repeat farming (3+ times)</span>
            <b className={r.economy.repeatFarmed <= 2 ? 'good' : 'bad'}>
              {r.economy.repeatFarmed}
            </b>
            <span>Novelty seeking rate</span>
            <b className={r.economy.noveltySeekRate >= 50 ? 'good' : 'bad'}>
              {r.economy.noveltySeekRate}%
            </b>
            <span>Risk reignite rate</span>
            <b className={r.economy.riskReigniteRate >= 30 ? 'good' : 'bad'}>
              {r.economy.riskReigniteRate}%
            </b>
            <span>Safe farming earnings share</span>
            <b className={r.economy.safeFarmShare <= 40 ? 'good' : 'bad'}>
              {r.economy.safeFarmShare}%
            </b>
          </div>
        </details>

        <details className="tempo">
          <summary>REQUEST DIRECTOR</summary>
          <div className="tempo-grid">
            <span>Voluntary continuation rate</span>
            <b>{r.director.voluntaryContinuationRate}%</b>
            <span>High-tier (¥6,000+) continuation</span>
            <b>{r.director.highTierContinuationRate}%</b>
            <span>Dismissed (明確に降りた)</span>
            <b className={r.director.dismissed > 0 ? 'good' : 'bad'}>{r.director.dismissed}</b>
            <span>Dismiss rate by reward tier</span>
            <b>
              {r.director.offeredByTier
                .map((n, i) =>
                  n > 0
                    ? `${['¥0', '¥1.5k', '¥3k', '¥6k', '¥10k', '¥15k'][i]} ${Math.round(
                        ((r.director.dismissByTier[i] ?? 0) / n) * 100,
                      )}%`
                    : null,
                )
                .filter(Boolean)
                .join('  ') || '-'}
            </b>
            <span>Walk away rate</span>
            <b className={r.director.walkAwayRate > 5 ? 'good' : 'bad'}>
              {r.director.walkAwayRate}%
            </b>
            <span>Full ladders</span>
            <b>{r.director.fullLadders}</b>
            <span>Hesitation by tier (s)</span>
            <b>{r.director.hesitationByTier.map((h) => h.toFixed(1)).join(' / ')}</b>
            <span>ONE LAST CALL</span>
            <b className={r.director.lastCallTaken ? 'good' : ''}>
              {!r.director.lastCallOffered
                ? 'not offered'
                : r.director.lastCallCompleted
                  ? 'TAKEN'
                  : r.director.lastCallTaken
                    ? 'started'
                    : 'WALKED AWAY'}
            </b>
          </div>
        </details>

        <details className="tempo">
          <summary>CHICKEN RACE</summary>
          <div className="tempo-grid">
            <span>Requests offered / completed / ignored</span>
            <b>
              {r.tempo.requestsShown} / {r.requestsCompleted} / {r.tempo.requestsIgnored}
            </b>
            <span>Longest chicken chain</span>
            <b className={r.chicken.longestChain >= 2 ? 'good' : 'bad'}>
              {r.chicken.longestChain + 1} steps
            </b>
            <span>Continued / abandoned</span>
            <b>
              {r.chicken.continued} / {r.chicken.abandoned}
            </b>
            <span>HEY uses</span>
            <b>{r.chicken.heyUses}</b>
            <span>HEY again rate</span>
            <b>{r.chicken.heyAgainRate}%</b>
            <span>Avg hesitation before acting</span>
            <b className={r.chicken.avgHesitation >= 2 ? 'good' : 'bad'}>
              {r.chicken.avgHesitation.toFixed(1)}s
            </b>
            <span>Turned back after deciding to leave</span>
            <b className={r.turnBacks > 0 ? 'good' : ''}>{r.turnBacks > 0 ? 'YES' : 'NO'}</b>
            <span>Highest haunted level</span>
            <b>{r.chicken.highestHaunting}</b>
            <span>Chases / outcome</span>
            <b>
              {r.tempo.chases} / {r.survived ? 'ESCAPED' : 'DIED'}
            </b>
          </div>
        </details>

        <details className="tempo">
          <summary>TEMPO ANALYSIS</summary>
          <div className="tempo-grid">
            <span>Meaningful events</span>
            <b>{r.tempo.events}</b>
            <span>Avg gap between events</span>
            <b className={r.tempo.avgEventGap > 30 ? 'bad' : 'good'}>
              {r.tempo.avgEventGap.toFixed(1)}s
            </b>
            <span>Avg gap between decisions</span>
            <b className={r.tempo.avgDecisionGap > 60 ? 'bad' : 'good'}>
              {r.tempo.avgDecisionGap.toFixed(1)}s
            </b>
            <span>Longest quiet period</span>
            <b className={r.tempo.longestQuiet > 40 ? 'bad' : 'good'}>
              {r.tempo.longestQuiet.toFixed(1)}s
            </b>
            <span>Requests shown / accepted / ignored</span>
            <b>
              {r.tempo.requestsShown} / {r.tempo.requestsAccepted} / {r.tempo.requestsIgnored}
            </b>
            <span>Turn-backs</span>
            <b>{r.turnBacks}</b>
            <span>Chases</span>
            <b>{r.tempo.chases}</b>
            <span>Director-forced events</span>
            <b>{r.tempo.forcedEvents}</b>
          </div>
        </details>

        <div className="result-actions">
          <button type="button" onClick={onRestart}>
            GO LIVE AGAIN [R]
          </button>
          <button type="button" className="ghost" onClick={onMenu}>
            CHANGE MODE
          </button>
          <button type="button" className="ghost" onClick={() => onDownload('json')}>
            LOG (JSON)
          </button>
          <button type="button" className="ghost" onClick={() => onDownload('csv')}>
            LOG (CSV)
          </button>
        </div>
      </div>
    </div>
  );
}
