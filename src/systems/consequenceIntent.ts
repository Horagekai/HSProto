/**
 * Consequence Intent。
 *
 * World Memory とは役割が違う。
 *
 *   World Memory      = 世界が覚えていること（portrait_fallen, fridge_opened …）
 *   ConsequenceIntent = Director がいつか返事をしたい、未回収の因果
 *
 * v1.1 までは重要な Greed（風呂の2口目など）も「関連イベントのスコア +50」だけで、
 * 他候補・Gate・Pressure・部屋条件に負け続けて 5Run中1回しか成立しなかった。
 * 「欲張った → 世界は覚えている → でも結局何も返ってこない」は
 * HAUNTED STREAMER のコア体験を弱くする。
 *
 * ここでは「返事をしたい」という意図そのものを持たせ、
 * **いつ・何を返すかだけ** を Director が Utility で決める。
 */

export type IntentSource =
  | 'bath_sip_2'
  | 'altar_overplayed'
  | 'phone_listened_long'
  | 'ghost_close_selfie'
  | 'call_it_again'
  | 'LAST_TEMPTATION';

export interface ConsequenceIntent {
  source: string;
  createdAt: number;
  earliest: number;
  /** この帯で返すのが一番自然 */
  preferredStart: number;
  preferredEnd: number;
  latest: number;
  /** true なら必ず返す。Nothing 不可 */
  required: boolean;
  /** 返事になりうるイベント */
  candidates: string[];
  /** 候補が全滅したときの保険 */
  fallback: string[];
  /** この対象から離れているほど「まだ続いている」感が出る */
  sourceObject?: string;
  contextTags: string[];
  resolved: boolean;
}

export interface IntentSpec {
  earliest: number;
  preferred: [number, number];
  latest: number;
  required?: boolean;
  candidates: string[];
  fallback: string[];
  sourceObject?: string;
  contextTags: string[];
}

/**
 * どの Greed に、どんな返事がありうるか。
 * 候補は複数持たせて、毎回同じ結果にならないようにする（§44）。
 */
export const INTENT_SPECS: Record<string, IntentSpec> = {
  bath_sip_2: {
    earliest: 8,
    preferred: [15, 45],
    latest: 70,
    candidates: ['WaterRunning', 'DistantWaterDrop', 'PipeKnock', 'BathroomDoorMove', 'MirrorAnomaly'],
    fallback: ['DistantWaterDrop'],
    sourceObject: 'bath',
    contextTags: ['water'],
  },
  altar_overplayed: {
    earliest: 8,
    preferred: [15, 45],
    latest: 75,
    candidates: ['DistantBell', 'PortraitTilt', 'LightCordSway', 'PortraitCrash'],
    fallback: ['DistantBell'],
    sourceObject: 'altar',
    contextTags: ['altar'],
  },
  phone_listened_long: {
    earliest: 8,
    preferred: [15, 50],
    latest: 80,
    candidates: ['DistantPhone', 'OwnVoice', 'PhoneClick', 'BehindFootstep', 'PhoneSuddenRing'],
    fallback: ['PhoneClick'],
    sourceObject: 'phone',
    contextTags: ['phone'],
  },
  ghost_close_selfie: {
    earliest: 6,
    preferred: [12, 40],
    latest: 70,
    candidates: ['SofaEmpty', 'GhostReposition', 'GhostCrossing', 'GhostPeek', 'BehindFootstep'],
    fallback: ['BehindFootstep', 'DistantFootstep'],
    sourceObject: 'ghost',
    contextTags: ['ghost'],
  },
  call_it_again: {
    earliest: 5,
    preferred: [10, 35],
    latest: 60,
    candidates: ['BehindFootstep', 'GhostPeek', 'GhostReposition', 'DistantFootstep'],
    fallback: ['BehindFootstep'],
    contextTags: ['ghost', 'behind'],
  },
  LAST_TEMPTATION: {
    earliest: 2,
    preferred: [2, 5],
    latest: 6,
    required: true,
    candidates: [],
    fallback: ['BehindFootstep', 'DoorCreak', 'DistantFootstep'],
    contextTags: ['ghost', 'behind'],
  },
};

export function createIntent(source: string, now: number, spec: IntentSpec): ConsequenceIntent {
  return {
    source,
    createdAt: now,
    earliest: now + spec.earliest,
    preferredStart: now + spec.preferred[0],
    preferredEnd: now + spec.preferred[1],
    latest: now + spec.latest,
    required: !!spec.required,
    candidates: spec.candidates,
    fallback: spec.fallback,
    sourceObject: spec.sourceObject,
    contextTags: spec.contextTags,
    resolved: false,
  };
}

/**
 * 0..1。時間が経つほど「そろそろ返さないと忘れられる」。
 * preferred 帯の中が最も高く、その前は低い。
 */
export function urgency(intent: ConsequenceIntent, now: number) {
  if (now < intent.earliest) return 0;
  if (now < intent.preferredStart) {
    const span = Math.max(0.1, intent.preferredStart - intent.earliest);
    return 0.25 * ((now - intent.earliest) / span);
  }
  if (now <= intent.preferredEnd) {
    const span = Math.max(0.1, intent.preferredEnd - intent.preferredStart);
    return 0.45 + 0.35 * ((now - intent.preferredStart) / span);
  }
  const span = Math.max(0.1, intent.latest - intent.preferredEnd);
  return Math.min(1, 0.8 + 0.2 * ((now - intent.preferredEnd) / span));
}
