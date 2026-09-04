import { CONFIG, type GameMode, type MonsterBehavior, type MonsterState } from '../config';

export type LogEvent =
  | 'stream_started'
  | 'anomaly_spawned'
  | 'anomaly_discovered'
  | 'point_inspected'
  | 'monster_discovered'
  | 'monster_behavior'
  | 'monster_aware'
  | 'monster_aggressive'
  | 'request_offered'
  | 'request_accepted'
  | 'request_completed'
  | 'request_expired'
  | 'request_ignored'
  | 'request_failed'
  | 'request_stage2'
  | 'doll_picked_up'
  | 'doll_delivered'
  | 'monster_lunge'
  | 'player_grabbed'
  | 'tier_reward'
  | 'director_forced_event'
  | 'temptation_offered'
  | 'temptation_accepted'
  | 'player_turned_back'
  | 'player_likely_leaving'
  | 'player_provoked'
  | 'hey_used'
  | 'hey_response_delayed'
  | 'phone_answered'
  | 'selfie_started'
  | 'selfie_with_monster'
  | 'chase_started'
  | 'player_looked_back_during_chase'
  | 'player_left_site'
  | 'player_died'
  // --- ONE GHOST MODE（§38） ---
  | 'monster_state_changed'
  | 'player_approached'
  | 'player_retreat_started'
  | 'selfie_ended'
  | 'chase_escaped'
  | 'player_returned_after_escape'
  | 'last_temptation_shown'
  | 'last_temptation_taken'
  | 'player_exited'
  // --- Novelty / Repetition / Risk Reward ---
  | 'footage_rewarded'
  | 'interaction_reward'
  | 'subject_state_changed'
  | 'mirror_interacted'
  | 'stream_goal_reached'
  // --- Request Director v2 ---
  | 'request_chain_started'
  | 'request_chain_continuation_roll'
  | 'request_chain_delay_started'
  | 'request_waiting_for_consequence'
  | 'request_consequence_observed'
  | 'one_last_call_offered'
  | 'one_last_call_taken'
  | 'one_last_call_completed'
  | 'one_last_call_declined_by_exit'
  | 'one_last_call_payoff'
  | 'request_dismissed'
  | 'constraint_completed'
  | 'light_toggled'
  // --- HS FLOOR 1 MODE ---
  | 'room_entered'
  | 'discovery_found'
  | 'object_interacted'
  | 'bath_sip'
  | 'ghost_selfie'
  | 'hold_started'
  | 'hold_tier_reached'
  | 'hold_released'
  | 'request_candidate_generated'
  | 'request_candidate_rejected'
  | 'request_selected'
  | 'object_became_eligible'
  | 'delayed_consequence'
  | 'world_beat'
  // --- Horror Director v1 ---
  | 'horror_director_evaluation'
  | 'horror_event_triggered'
  | 'world_memory_created'
  | 'world_memory_used'
  | 'request_completed_event';

export interface LogRow {
  /** どちらの検証モードか（§38） */
  mode: GameMode;
  timestamp: number;
  event: LogEvent | '';
  detail: string;
  player_x: number;
  player_z: number;
  player_yaw: number;
  selfie: 0 | 1;
  monster_x: number;
  monster_z: number;
  monster_distance: number;
  monster_state: MonsterState;
  monster_behavior: MonsterBehavior;
  danger: number;
  haunting: number;
  viewer_count: number;
  engagement: number;
  clip_value: number;
  clip_effective: number;
  likes: number;
  stream_earnings: number;
  subject: string;
  monster_on_screen: 0 | 1;
  monster_center_score: number;
  discoveries: number;
  request_active: 0 | 1;
  request_type: string;
  request_reward: number;
  request_is_temptation: 0 | 1;
  requests_completed: number;
  // --- v2で追加したKPI ---
  distance_to_entrance: number;
  player_likely_leaving: 0 | 1;
  returning_to_entrance: 0 | 1;
  temptation_request_triggered: 0 | 1;
  temptation_request_reward: number;
  player_turned_back: 0 | 1;
  time_from_request_to_turnback: number;
  distance_traveled_back_after_request: number;
  stream_earnings_at_turnback: number;
  player_provoked: 0 | 1;
  /** HEYを使ったフレーム */
  hey_used: 0 | 1;
  /** 連打回数（プレイヤーには見せていない内部値） */
  provocation_streak: number;
  /** チキンレースの連鎖ID・段数・次段の報酬 */
  chicken_chain_id: number;
  chicken_step: number;
  next_reward: number;
  hey_distance_to_monster: number;
  selfie_with_monster: 0 | 1;
  /** テンポ検証用：最後に「意味のあること」が起きてからの秒数 */
  time_since_last_meaningful_event: number;
  // --- Novelty / Risk（今フレームの撮れ高の内訳） ---
  /** 今撮っている「対象 + 状態」 */
  state_key: string;
  /** その状態を何回目に見ているか */
  repeat_count: number;
  novelty_multiplier: number;
  risk_multiplier: number;
  footage_base_value: number;
  footage_final_value: number;
  chasing: 0 | 1;
  player_alive: 0 | 1;
}

const FIELDS: Array<keyof LogRow> = [
  'mode',
  'timestamp',
  'event',
  'detail',
  'player_x',
  'player_z',
  'player_yaw',
  'selfie',
  'monster_x',
  'monster_z',
  'monster_distance',
  'monster_state',
  'monster_behavior',
  'danger',
  'haunting',
  'viewer_count',
  'engagement',
  'clip_value',
  'clip_effective',
  'likes',
  'stream_earnings',
  'subject',
  'monster_on_screen',
  'monster_center_score',
  'discoveries',
  'request_active',
  'request_type',
  'request_reward',
  'request_is_temptation',
  'requests_completed',
  'distance_to_entrance',
  'player_likely_leaving',
  'returning_to_entrance',
  'temptation_request_triggered',
  'temptation_request_reward',
  'player_turned_back',
  'time_from_request_to_turnback',
  'distance_traveled_back_after_request',
  'stream_earnings_at_turnback',
  'player_provoked',
  'hey_used',
  'provocation_streak',
  'chicken_chain_id',
  'chicken_step',
  'next_reward',
  'hey_distance_to_monster',
  'selfie_with_monster',
  'time_since_last_meaningful_event',
  'state_key',
  'repeat_count',
  'novelty_multiplier',
  'risk_multiplier',
  'footage_base_value',
  'footage_final_value',
  'chasing',
  'player_alive',
];

const ROUND: Array<keyof LogRow> = [
  'timestamp',
  'player_x',
  'player_z',
  'player_yaw',
  'monster_x',
  'monster_z',
  'monster_distance',
  'danger',
  'haunting',
  'viewer_count',
  'engagement',
  'clip_value',
  'clip_effective',
  'likes',
  'stream_earnings',
  'monster_center_score',
  'distance_to_entrance',
  'time_from_request_to_turnback',
  'distance_traveled_back_after_request',
  'stream_earnings_at_turnback',
  'time_since_last_meaningful_event',
  'novelty_multiplier',
  'risk_multiplier',
  'footage_base_value',
  'footage_final_value',
];

/** プレイログ。定期サンプリング + イベント行 */
export class Logger {
  rows: LogRow[] = [];
  private sampleTimer = 0;

  reset() {
    this.rows = [];
    this.sampleTimer = 0;
  }

  sample(dt: number, row: LogRow) {
    this.sampleTimer += dt;
    if (this.sampleTimer < CONFIG.log.sampleInterval) return;
    this.sampleTimer = 0;
    this.rows.push(round(row));
  }

  event(name: LogEvent, row: LogRow, detail = '') {
    this.rows.push(round({ ...row, event: name, detail }));
  }

  /** テンポ分析（Directorから受け取る） */
  tempo: Record<string, number> | null = null;
  /** ONE GHOST MODE のKPI（§39）。通常モードでは null */
  oneGhost: Record<string, number> | null = null;
  /** Novelty / Request Director v2 のKPI */
  economy: Record<string, number> | null = null;
  /** HS FLOOR 1 MODE のKPI */
  floor1: Record<string, number> | null = null;
  mode: GameMode = 'standard';

  /** 検証用の集計。Turn-back Rate / Cash-out Rate / Greed Death Rate の素材 */
  summary() {
    const count = (e: LogEvent) => this.rows.filter((r) => r.event === e).length;
    const temptations = count('temptation_offered');
    const turnBacks = count('player_turned_back');
    return {
      mode: this.mode,
      temptations_offered: temptations,
      temptations_accepted: count('temptation_accepted'),
      turn_backs: turnBacks,
      turn_back_rate: temptations ? turnBacks / temptations : null,
      leaving_flags: count('player_likely_leaving'),
      left_site: count('player_left_site'),
      died: count('player_died'),
      died_after_turn_back: turnBacks > 0 && count('player_died') > 0 ? 1 : 0,
      requests_completed: count('request_completed'),
      requests_ignored: count('request_ignored'),
      hey_used: count('hey_used'),
      hey_second_rate: (() => {
        // 一度HEYした後、報酬や反応を見てもう一度HEYした割合
        const heys = this.rows.filter((r) => r.event === 'hey_used');
        if (heys.length < 1) return null;
        const again = heys.filter((r) => r.provocation_streak >= 2).length;
        return Math.round((again / heys.length) * 100) / 100;
      })(),
      max_provocation_streak: Math.max(0, ...this.rows.map((r) => r.provocation_streak || 0)),
      longest_chicken_chain: Math.max(0, ...this.rows.map((r) => r.chicken_step || 0)),
      /** 1段目を達成した後、次の段へ進んだ割合 */
      continue_rate: (() => {
        const completed = this.rows.filter((r) => r.event === 'request_completed');
        const stepUps = this.rows.filter(
          (r) => r.event === 'request_offered' && (r.chicken_step || 0) > 0,
        );
        return completed.length ? Math.round((stepUps.length / completed.length) * 100) / 100 : null;
      })(),
      discoveries: count('anomaly_discovered'),
      forced_events: count('director_forced_event'),
      chases_started: count('chase_started'),
      chases_escaped: count('chase_escaped'),
      retreats: count('player_retreat_started'),
      returns_after_escape: count('player_returned_after_escape'),
      closest_distance: (() => {
        const alive = this.rows.filter((r) => r.player_alive === 1 && r.monster_distance > 0);
        return alive.length
          ? Math.round(Math.min(...alive.map((r) => r.monster_distance)) * 10) / 10
          : null;
      })(),
      tempo: this.tempo,
      one_ghost: this.oneGhost,
      economy: this.economy,
      floor1: this.floor1,
      request_ignore_viewer_penalty: CONFIG.request.ignorePenalty.viewerMult,
      mirror_interactions: this.rows
        .filter((r) => r.event === 'mirror_interacted')
        .map((r) => r.detail),
    };
  }

  toJSON() {
    return JSON.stringify(
      { version: 3, mode: this.mode, summary: this.summary(), rows: this.rows },
      null,
      2,
    );
  }

  toCSV() {
    const head = FIELDS.join(',');
    const body = this.rows
      .map((r) =>
        FIELDS.map((f) => {
          const v = r[f];
          const s = String(v ?? '');
          return s.includes(',') ? `"${s}"` : s;
        }).join(','),
      )
      .join('\n');
    return `${head}\n${body}\n`;
  }

  download(kind: 'json' | 'csv') {
    const isJson = kind === 'json';
    const blob = new Blob([isJson ? this.toJSON() : this.toCSV()], {
      type: isJson ? 'application/json' : 'text/csv',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `haunted-streamer-${this.mode}-log-${stamp}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function round(row: LogRow): LogRow {
  const out = { ...row };
  for (const k of ROUND) {
    const v = out[k];
    if (typeof v === 'number') (out[k] as number) = Math.round(v * 1000) / 1000;
  }
  return out;
}
