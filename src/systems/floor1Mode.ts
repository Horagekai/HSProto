import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp01, pick, randRange } from '../core/util';
import type { RequestView } from '../core/store';
import {
  Floor1Director,
  Floor1Objects,
  WorldMemory,
  goalReached,
  type Floor1Context,
  type Floor1RequestDef,
  type GhostState,
} from './floor1';
import { FLOOR1_OBJECTS, roomAt, type Floor1Room } from '../world/floor1Level';
import { HorrorDirector, type GhostAction, type HorrorEventDef, type RunPhase } from './horrorDirector';
import { FLOOR1_HORROR } from './horrorEvents';

/** Floor1Mode が外の世界へ触るための口 */
export interface Floor1Deps {
  playerPos: () => THREE.Vector3;
  playerForward: () => { x: number; z: number };
  selfie: () => boolean;
  lightOn: () => boolean;
  /** その座標が画面に映っているか */
  isVisible: (x: number, z: number, height: number) => boolean;
  /** 画面中央度 0..1（映っていなければ0） */
  centerOf: (x: number, z: number, height: number) => number;

  addLikes: (n: number) => void;
  addEarnings: (yen: number) => void;
  spikeViewers: (f: number) => void;
  addBoost: (amount: number, duration: number) => void;
  addHaunting: (n: number) => void;
  haunting: () => number;
  addDanger: (n: number) => void;
  danger: () => number;
  earnings: () => number;

  toast: (t: string, d: number) => void;
  footage: (t: string, d: number) => void;
  hint: (t: string, d: number) => void;
  chat: (category: string, n: number) => void;
  chatLine: (text: string) => void;

  sfxBell: () => void;
  sfxPhone: (d: number) => void;
  sfxKnock: (d: number) => void;
  sfxWhisper: (d: number) => void;
  sfxDoor: (d: number) => void;
  sfxCash: () => void;
  sfxShutter: () => void;
  sfxSpike: () => void;
  sfxStep: () => void;

  flickerLamp: (x: number, z: number, d: number) => void;
  dropPortrait: () => void;
  restorePortrait: () => void;
  setFridgeOpen: (open: boolean) => void;
  setGhostSeatVisible: (v: boolean) => void;
  /** 幽霊を立たせて動かし始める */
  wakeGhost: (x: number, z: number) => void;
  ghostPos: () => THREE.Vector3;
  ghostChasing: () => boolean;

  markEvent: (kind: string) => void;
  markDecision: () => void;
  log: (event: string, detail: string) => void;
  distanceToEntrance: () => number;
}

interface ActiveRequest {
  def: Floor1RequestDef;
  timeLeft: number;
  progress: number;
  engaged: boolean;
  /** HOLD の累計時間と、到達済みの段 */
  hold: number;
  tier: number;
  earned: number;
  /** constraint の保持時間 */
  held: number;
  offeredAt: number;
}

const SOFA = { x: -9.3, z: -8 };

/** 各オブジェクトの発見コメント */
const DISCOVERY_CHAT: Record<string, string[]> = {
  altar: ["that's surprisingly clean", 'everything else is filthy', 'someone took care of this'],
  portraits: ['three of them', 'who are they', 'the middle one'],
  phone: ['does that still work', 'call someone lol', 'old school'],
  bath: ['ew', 'what is that', "don't drink it", 'drink it', "he won't do it"],
  fridge: ['CLOSE IT', 'free protein', 'oh god', 'look closer'],
  mirror: ['check the mirror', 'anything behind you?'],
  photo: ['thats the family', 'they look happy'],
  ghost: ['is that a person', "that's not normal", 'get closer', 'selfie with it', 'leave'],
};

export class Floor1Mode {
  objects = new Floor1Objects();
  director = new Floor1Director();
  memory = new WorldMemory();
  /** 世界側の恐怖と「間」を決める。Request とは別物 */
  horror = new HorrorDirector(FLOOR1_HORROR);

  active: ActiveRequest | null = null;
  /** 提示待ち。近くにいるだけでは出さず、間を置く */
  private pendingDef: Floor1RequestDef | null = null;
  private pendingDelay = 0;
  /** 次に候補を探すまでの静寂 */
  private quiet = 0;
  private elapsed = 0;
  private sinceEvent = 0;

  ghost: GhostState = 'seated';
  private ghostStandTimer = 0;
  private ghostRelocateCd = 0;

  goal = false;
  private lastTemptationDone = false;
  private returningTime = 0;
  private lastEntranceDistance = 999;

  // --- KPI ---
  discoveries = 0;
  offered = 0;
  completed = 0;
  dismissed = 0;
  ignored = 0;
  holdDurations: Array<{ id: string; seconds: number; tier: number }> = [];
  uniqueRequests = new Set<string>();
  repeatedRequests = 0;
  bathSips = 0;
  ghostSelfies = 0;
  voluntaryContinuations = 0;
  private offeredHistory: string[] = [];

  constructor(private d: Floor1Deps) {}

  reset() {
    this.objects.reset();
    this.director.reset();
    this.memory.reset();
    this.horror.reset();
    this.memory.onCreated = (m) =>
      this.d.log('world_memory_created', `memory=${m} haunted=${this.d.haunting().toFixed(0)}`);
    this.active = null;
    this.pendingDef = null;
    this.pendingDelay = 0;
    this.quiet = randRange(4, 8);
    this.elapsed = 0;
    this.sinceEvent = 0;
    this.ghost = 'seated';
    this.ghostStandTimer = 0;
    this.ghostRelocateCd = 0;
    this.goal = false;
    this.lastTemptationDone = false;
    this.returningTime = 0;
    this.lastEntranceDistance = 999;
    this.lastObject = null;
    this.sinceObject = 999;
    this.lastRiskTier = 0;
    this.finalTaken = false;
    this.completedIds.clear();
    this.discoveries = 0;
    this.offered = 0;
    this.completed = 0;
    this.dismissed = 0;
    this.ignored = 0;
    this.holdDurations = [];
    this.uniqueRequests.clear();
    this.repeatedRequests = 0;
    this.bathSips = 0;
    this.ghostSelfies = 0;
    this.voluntaryContinuations = 0;
    this.offeredHistory = [];
    this.d.setGhostSeatVisible(true);
  }

  // ---------------------------------------------------------------- //

  room(): Floor1Room {
    const p = this.d.playerPos();
    return roomAt(p.x, p.z);
  }

  private objDistance(id: string) {
    const p = this.d.playerPos();
    if (id === 'ghost') {
      const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
      return Math.hypot(g.x - p.x, g.z - p.z);
    }
    const spec = FLOOR1_OBJECTS.find((o) => o.id === id);
    if (!spec) return 999;
    return Math.hypot(spec.x - p.x, spec.z - p.z);
  }

  private distances(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const o of FLOOR1_OBJECTS) out[o.id] = this.objDistance(o.id);
    out.ghost = this.objDistance('ghost');
    return out;
  }

  /** 一番近い、触れるオブジェクト */
  nearestInteractable(): string | null {
    let best: string | null = null;
    let bestD = CONFIG.floor1.interactRange;
    for (const o of FLOOR1_OBJECTS) {
      const d = this.objDistance(o.id);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  /** [E] の表示。遠くからは何も出さない（近づいて初めて出る） */
  prompt(): string | null {
    const a = this.active;
    if (a && a.def.type === 'hold' && this.holdTargetReady()) {
      return `[HOLD E] ${a.def.label}`;
    }
    const id = this.nearestInteractable();
    if (!id) return null;
    const o = this.objects.get(id);
    if (id === 'fridge' && o?.state !== 'bugs') return '[E] OPEN';
    return '[E] EXAMINE';
  }

  private holdTargetReady() {
    const a = this.active;
    if (!a || a.def.type !== 'hold' || !a.def.object) return false;
    return this.objDistance(a.def.object) <= (a.def.maxDistance ?? 3);
  }

  // ---------------------------------------------------------------- //
  // Discovery
  // ---------------------------------------------------------------- //

  private updateDiscovery(dt: number) {
    const cfg = CONFIG.floor1;
    for (const spec of FLOOR1_OBJECTS) {
      const st = this.objects.get(spec.id);
      if (!st) continue;
      const d = this.objDistance(spec.id);
      const center = this.d.centerOf(spec.x, spec.z, spec.height);
      if (center > 0.2 && d < 18) st.attention += dt;
      // 一度離れて戻ってきたか
      if (d > 12) st.wasAway = true;
      else if (d < 5 && st.wasAway && st.discovered) {
        st.wasAway = false;
        st.reengaged = true;
      }
      if (st.discovered || !spec.notable) {
        if (!spec.notable && !st.discovered && d < cfg.discoverDistance) st.discovered = true;
        continue;
      }
      if (d < cfg.discoverDistance && center > 0.15 && st.attention >= cfg.discoverLook) {
        this.discover(spec.id, spec.label, spec.discoveryLikes);
      }
    }

    // 幽霊は遠くからでも見つかる
    const g = this.objects.get('ghost');
    if (g && !g.discovered) {
      const pos = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
      const center = this.d.centerOf(pos.x, pos.z, 1.3);
      const d = this.objDistance('ghost');
      if (center > 0.15 && d < cfg.ghostDiscoverDistance) {
        g.attention += dt;
        if (g.attention >= cfg.ghostDiscoverLook) {
          this.discover('ghost', 'SOMEONE ON THE SOFA', 150);
        }
      }
    }
  }

  private discover(id: string, label: string, likes: number) {
    const st = this.objects.get(id);
    if (!st || st.discovered) return;
    st.discovered = true;
    this.discoveries += 1;
    this.touchedObject(id);
    const amount = Math.round(likes * CONFIG.floor1.discoveryLikesMult);
    if (amount > 0) {
      this.d.addLikes(amount);
      this.d.spikeViewers(1.08);
      this.d.sfxSpike();
      this.d.footage(`FOUND: ${label}   +${amount} Likes`, 2.0);
    }
    this.d.addHaunting(1);
    this.d.addBoost(0.5, 8);
    const lines = DISCOVERY_CHAT[id];
    if (lines) {
      this.d.chatLine(pick(lines));
      if (Math.random() < 0.5) this.d.chatLine(pick(lines));
    }
    this.markEvent('discovery');
    this.d.log('discovery_found', `object=${id} likes=${amount}`);
  }

  // ---------------------------------------------------------------- //
  // Interaction
  // ---------------------------------------------------------------- //

  /** [E] の単押し */
  interact() {
    const id = this.nearestInteractable();
    if (!id) return false;
    const st = this.objects.get(id);
    if (!st) return false;
    st.interactions += 1;
    this.touchedObject(id);
    this.d.log('object_interacted', `object=${id} state=${st.state} count=${st.interactions}`);

    switch (id) {
      case 'altar':
        this.d.sfxBell();
        this.d.toast('...', 1.2);
        return true;
      case 'portraits':
        return this.interactPortrait(st.state);
      case 'phone':
        return this.interactPhone(st.state);
      case 'bath':
        return this.drinkBath();
      case 'fridge':
        return this.openFridge();
      case 'mirror':
        this.d.toast('YOU LOOK TIRED', 1.4);
        return true;
      default:
        this.d.toast('NOTHING HERE', 1.0);
        return true;
    }
  }

  private interactPortrait(state: string) {
    if (state === 'normal') {
      // 少し間を置いて落ちる
      this.d.toast('...', 1.2);
      window.setTimeout(() => {
        if (this.objects.get('portraits')?.state !== 'normal') return;
        this.objects.setState('portraits', 'fallen');
        this.d.dropPortrait();
        this.d.sfxKnock(2);
        this.d.addLikes(100);
        this.d.spikeViewers(1.18);
        this.d.footage('THE PORTRAIT FELL   +100 Likes', 2.4);
        this.d.chat('anomaly', 3);
        this.d.addHaunting(4);
        this.markEvent('anomaly');
        this.d.log('subject_state_changed', 'subject=portraits old=hanging new=fallen');
      }, 1400);
      return true;
    }
    if (state === 'fallen') {
      this.objects.setState('portraits', 'held');
      this.d.toast('YOU PICKED IT UP', 1.6);
      this.d.addHaunting(3);
      return true;
    }
    if (state === 'held') {
      this.objects.setState('portraits', 'restored');
      this.d.restorePortrait();
      this.d.toast('YOU HUNG IT BACK', 1.8);
      this.d.addHaunting(5);
      this.memory.remember('portrait_restored');
      this.d.log('subject_state_changed', 'subject=portraits old=held new=restored');
      return true;
    }
    return true;
  }

  private interactPhone(state: string) {
    if (state === 'ringing') {
      this.objects.setState('phone', 'answered');
      this.d.sfxWhisper(1);
      this.d.toast('...', 1.6);
      this.d.chat('anomaly', 2);
      this.d.addHaunting(4);
      this.d.log('subject_state_changed', 'subject=phone old=ringing new=answered');
      return true;
    }
    this.d.toast('NO DIAL TONE', 1.2);
    return true;
  }

  private drinkBath() {
    this.bathSips += 1;
    this.d.sfxWhisper(1);
    this.d.toast('YOU DRANK IT', 1.8);
    this.d.chat('anomaly', 3);
    this.d.addLikes(60);
    this.d.spikeViewers(1.14);
    this.d.addHaunting(this.bathSips >= 2 ? 7 : 4);
    this.d.addDanger(this.bathSips >= 2 ? 6 : 3);
    this.memory.remember(`bath_sip_${this.bathSips}`);
    if (this.bathSips >= 2) this.memory.remember('bath_overdone');
    this.d.log('bath_sip', `count=${this.bathSips}`);
    // 咳き込む
    window.setTimeout(() => this.d.hint('YOU COUGH', 1.6), 900);
    return true;
  }

  private openFridge() {
    const st = this.objects.get('fridge');
    if (!st) return false;
    if (st.state === 'normal') {
      this.objects.setState('fridge', 'bugs');
      this.d.setFridgeOpen(true);
      this.d.addLikes(120);
      this.d.spikeViewers(1.2);
      this.d.sfxSpike();
      this.d.footage('BUGS EVERYWHERE   +120 Likes', 2.6);
      this.d.chat('anomaly', 3);
      this.d.addHaunting(3);
      this.markEvent('discovery');
      this.d.log('subject_state_changed', 'subject=fridge old=normal new=bugs');
      return true;
    }
    this.d.setFridgeOpen(false);
    this.objects.setState('fridge', 'closed');
    this.d.toast('YOU CLOSED IT', 1.2);
    return true;
  }

  // ---------------------------------------------------------------- //
  // HOLD
  // ---------------------------------------------------------------- //

  /**
   * [E] を押している間だけ続く行為。
   * いつでも指を離せる。離した時点で終了し、すでに得た段の報酬は保持する。
   */
  private updateHold(dt: number, holding: boolean) {
    const a = this.active;
    if (!a || a.def.type !== 'hold' || !a.def.holdTiers) return;
    const ready = this.holdTargetReady();
    if (holding && ready) {
      if (a.hold === 0) {
        this.d.log('hold_started', `object=${a.def.object} request=${a.def.id}`);
        this.startHoldEffect(a.def);
      }
      a.hold += dt;
      a.engaged = true;
      this.holdEffect(a.def, a.hold, dt);
      // 段に到達したら即確定
      while (a.tier < a.def.holdTiers.length && a.hold >= a.def.holdTiers[a.tier].at) {
        const t = a.def.holdTiers[a.tier];
        a.tier += 1;
        a.earned += t.reward;
        this.d.addEarnings(t.reward);
        this.d.sfxCash();
        this.d.spikeViewers(CONFIG.floor1.hold.viewerSpike);
        this.d.addBoost(0.8, 8);
        this.d.addHaunting(2 + a.tier * 2);
        this.d.addDanger(1 + a.tier * 2);
        this.d.toast(`+¥${t.reward.toLocaleString()}`, 1.6);
        this.d.chat('provoke', 2);
        if (a.tier >= 2) this.voluntaryContinuations += 1;
        this.horror.markGreed(Math.min(5, a.tier + 1));
        this.d.log('hold_tier_reached', `request=${a.def.id} tier=${a.tier} duration=${a.hold.toFixed(1)} reward=${t.reward}`);
        this.holdTierEffect(a.def, a.tier);
      }
      a.progress = clamp01(a.hold / CONFIG.floor1.hold.maxSeconds);
      if (a.hold >= CONFIG.floor1.hold.maxSeconds) this.releaseHold('max');
      return;
    }
    if (a.hold > 0) this.releaseHold('released');
  }

  private releaseHold(reason: string) {
    const a = this.active;
    if (!a || a.def.type !== 'hold') return;
    this.holdDurations.push({ id: a.def.id, seconds: Math.round(a.hold * 10) / 10, tier: a.tier });
    this.d.log('hold_released', `request=${a.def.id} total_duration=${a.hold.toFixed(1)} highest_tier=${a.tier} reason=${reason}`);
    if (a.def.object === 'altar' && a.hold >= 5) this.memory.remember('altar_overplayed');
    if (a.def.object === 'phone' && a.hold >= 5) this.memory.remember('phone_listened_long');
    if (a.def.object === 'fridge' && a.hold >= 5) this.memory.remember('fridge_held_long');
    if (a.def.object === 'phone') {
      this.objects.setState('phone', 'idle');
      this.d.log('subject_state_changed', 'subject=phone old=answered new=idle');
    }
    if (a.def.object === 'fridge') this.d.setFridgeOpen(false);
    if (a.tier > 0) this.finish(a, a.earned);
    else this.endRequest('ignored');
  }

  private startHoldEffect(def: Floor1RequestDef) {
    if (def.object === 'altar') this.d.sfxBell();
    if (def.object === 'phone') this.d.sfxWhisper(1);
  }

  private holdBeat = 0;
  private holdEffect(def: Floor1RequestDef, hold: number, dt: number) {
    this.holdBeat -= dt;
    if (this.holdBeat > 0) return;
    if (def.object === 'altar') {
      this.holdBeat = 0.85;
      this.d.sfxBell();
    } else if (def.object === 'phone') {
      this.holdBeat = 2.4;
      // 聞き続けるほど、音が近づいてくる
      if (hold < 5) this.d.sfxKnock(14);
      else if (hold < 9) this.d.sfxWhisper(6);
      else this.d.sfxWhisper(1);
    } else {
      this.holdBeat = 1.6;
      this.d.sfxKnock(8);
    }
  }

  /** 段を超えたときの世界側の反応。毎回追跡にはしない */
  private holdTierEffect(def: Floor1RequestDef, tier: number) {
    const p = this.d.playerPos();
    if (tier === 2) {
      this.d.flickerLamp(p.x, p.z, 1.6);
      this.d.hint('THE LIGHT MOVED', 2);
    } else if (tier === 3) {
      if (def.object === 'phone') {
        this.d.hint('THAT SOUNDS LIKE YOU', 2.4);
      } else {
        this.d.sfxDoor(12);
        this.d.hint('A DOOR, SOMEWHERE', 2.2);
      }
      this.maybeGhostStir();
    } else if (tier >= 4) {
      this.d.sfxStep();
      this.d.hint('SOMETHING IS BEHIND YOU', 2.6);
      this.d.addDanger(8);
    }
  }

  /** 幽霊を少しだけ動かす。画面内では動かさない */
  private maybeGhostStir() {
    if (this.ghost === 'seated') {
      this.d.addDanger(6);
      return;
    }
    if (this.ghostRelocateCd > 0) return;
    const pos = this.d.ghostPos();
    if (this.d.isVisible(pos.x, pos.z, 1.5)) return;
    this.ghostRelocateCd = CONFIG.floor1.ghost.relocateCooldown;
    const p = this.d.playerPos();
    const f = this.d.playerForward();
    this.d.wakeGhost(p.x - f.x * 7, p.z - f.z * 7);
  }

  // ---------------------------------------------------------------- //
  // Ghost
  // ---------------------------------------------------------------- //

  private updateGhost(dt: number) {
    this.ghostRelocateCd = Math.max(0, this.ghostRelocateCd - dt);
    const g = CONFIG.floor1.ghost;
    // 家をどれだけ荒らしたかも段階に効かせる（Danger だけでは一生座ったままだった）
    const danger = Math.max(this.d.danger(), this.d.haunting() * CONFIG.floor1.hauntedWeight);
    const prev = this.ghost;
    let next: GhostState = this.ghost;
    if (this.d.ghostChasing() || danger >= g.chasing) next = 'chasing';
    else if (danger >= g.stalking) next = 'stalking';
    else if (danger >= g.standing) next = 'standing';
    else if (danger >= g.aware) next = 'aware';
    else if (this.ghost !== 'seated') next = 'aware';

    if (next !== prev) {
      if (next === 'chasing') this.horror.markChase(true);
      else if (prev === 'chasing') this.horror.markChase(false);
      this.ghost = next;
      this.objects.setState('ghost', next);
      this.d.log('subject_state_changed', `subject=ghost old=${prev} new=${next}`);
      if (next === 'standing' && prev !== 'standing') {
        this.ghostStandTimer = g.standDelay;
      }
      if (next === 'aware' && prev === 'seated') {
        this.d.hint('IT MOVED ITS HEAD', 2);
        this.d.chat('discovered', 2);
      }
    }

    // ソファから立ち上がる
    if (this.ghostStandTimer > 0) {
      this.ghostStandTimer -= dt;
      if (this.ghostStandTimer <= 0) {
        this.d.setGhostSeatVisible(false);
        this.d.wakeGhost(SOFA.x, SOFA.z);
        this.d.hint('IT STOOD UP', 2.4);
        this.d.chat('danger', 3);
        this.markEvent('monster_appear');
        this.memory.remember('ghost_stood');
      }
    }
  }

  // ---------------------------------------------------------------- //
  // World memory の遅れた結果
  // ---------------------------------------------------------------- //

  /** HorrorDirector が選んだイベントを実際に鳴らす */
  private runHorror(def: HorrorEventDef) {
    const p = this.d.playerPos();
    const f = this.d.playerForward();
    const behind = { x: p.x - f.x * 5, z: p.z - f.z * 5 };

    switch (def.id) {
      case 'LightFlicker':
        this.d.flickerLamp(p.x, p.z, 2.0);
        break;
      case 'HouseSettle':
        this.d.sfxKnock(16);
        break;
      case 'DoorCreak':
        this.d.sfxDoor(13);
        break;
      case 'DistantFootstep':
        this.d.sfxStep();
        this.d.hint('FOOTSTEPS, SOMEWHERE', 2.2);
        break;
      case 'BehindFootstep':
        this.d.sfxStep();
        this.d.hint('A STEP BEHIND YOU', 2.4);
        this.d.addDanger(3);
        break;
      case 'PortraitTilt':
        this.objects.setState('portraits', 'tilted');
        this.d.sfxKnock(10);
        this.d.hint('SOMETHING ABOUT THE PORTRAITS', 2.4);
        break;
      case 'PortraitChanged':
        this.objects.setState('portraits', 'wrong');
        this.d.hint('THAT IS NOT THE SAME FACE', 2.8);
        this.d.addHaunting(3);
        break;
      case 'MirrorAnomaly':
        this.objects.setState('mirror', 'anomaly');
        this.d.sfxWhisper(4);
        this.d.hint('SOMETHING IN THE MIRROR', 2.4);
        break;
      case 'FridgeHum':
      case 'KitchenNoise':
        this.d.sfxKnock(11);
        break;
      case 'DistantBell':
        this.d.sfxBell();
        this.d.hint('A BELL. SOMEWHERE ELSE.', 2.6);
        break;
      case 'DistantPhone':
        this.d.sfxPhone(18);
        this.d.hint('A PHONE, FURTHER IN', 2.6);
        break;
      case 'OwnVoice':
        this.d.sfxWhisper(2);
        this.d.hint('THAT WAS YOUR VOICE', 2.8);
        this.d.addDanger(5);
        break;
      case 'WaterRunning':
        this.d.sfxWhisper(10);
        this.d.hint('WATER, RUNNING SOMEWHERE', 2.4);
        break;
      case 'SofaEmpty':
        this.d.setGhostSeatVisible(false);
        this.d.hint('THE SOFA IS EMPTY NOW', 2.6);
        break;
      case 'GhostPeek':
        this.requestGhost('PEEK', behind);
        break;
      case 'GhostReposition':
        this.requestGhost('REPOSITION', behind);
        this.d.hint('IT IS NOT WHERE IT WAS', 2.4);
        break;
      case 'GhostCrossing':
        this.requestGhost('CROSS', behind);
        this.d.hint('SOMETHING CROSSED THE HALL', 2.4);
        break;
      case 'GhostStand':
        this.requestGhost('STAND', SOFA);
        break;
      case 'FakeRush':
        this.requestGhost('FAKE_RUSH', behind);
        this.d.hint('IT MOVED AT YOU', 2.2);
        this.d.addDanger(6);
        break;
    }

    const tags = def.requiredMemories?.length ? `memory=${def.requiredMemories[0]}` : '';
    this.d.chat(def.intensity === 'subtle' ? 'idle' : 'anomaly', def.intensity === 'subtle' ? 1 : 2);
    this.markEvent('anomaly');
    this.d.log(
      'horror_event_triggered',
      [
        `event_id=${def.id}`,
        `family=${def.family}`,
        `intensity=${def.intensity}`,
        `haunted=${this.d.haunting().toFixed(0)}`,
        `tension=${this.horror.tension.toFixed(0)}`,
        `room=${this.room()}`,
        `ghost=${this.ghost}`,
        tags,
      ].filter(Boolean).join(' '),
    );
    if (def.requiredMemories?.length) {
      this.d.log('world_memory_used', `memory=${def.requiredMemories[0]} event=${def.id}`);
    }
  }

  /** Ghost へは行動要求だけ出す。どう動くかは Ghost 側 */
  private requestGhost(action: GhostAction, spot: { x: number; z: number }) {
    if (action === 'STAND') {
      this.d.setGhostSeatVisible(false);
      this.d.wakeGhost(SOFA.x, SOFA.z);
      this.d.hint('IT STOOD UP', 2.4);
      this.d.chat('danger', 3);
      this.memory.remember('ghost_stood');
      return;
    }
    if (this.ghost === 'seated') return;
    if (action === 'FAKE_RUSH') {
      this.d.addDanger(4);
      this.d.sfxWhisper(2);
      return;
    }
    // 画面内では絶対に動かさない
    const pos = this.d.ghostPos();
    if (this.d.isVisible(pos.x, pos.z, 1.5)) return;
    this.d.wakeGhost(spot.x, spot.z);
  }

  // ---------------------------------------------------------------- //
  // Request Director
  // ---------------------------------------------------------------- //

  private context(): Floor1Context {
    return {
      room: this.room(),
      distances: this.distances(),
      states: this.objects.states(),
      discovered: this.objects.discoveredSet(),
      memory: this.memory.all(),
      completed: new Set([...this.uniqueRequests].filter((id) => this.completedIds.has(id))),
      haunted: this.d.haunting(),
      ghost: this.ghost,
      ghostDistance: this.objDistance('ghost'),
      ghostOnScreen: (() => {
        const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
        return this.d.isVisible(g.x, g.z, 1.3);
      })(),
      selfie: this.d.selfie(),
      lightOn: this.d.lightOn(),
      goalReached: this.goal,
      returning: this.returningTime > 1.5 && this.d.distanceToEntrance() < 14,
      sinceEvent: this.sinceEvent,
      attention: this.objects.attentionMap(),
      reengaged: this.objects.reengagedSet(),
      lastObject: this.lastObject,
      sinceObject: this.sinceObject,
    };
  }

  private completedIds = new Set<string>();
  /** 直前に触った / 達成したオブジェクト */
  private lastObject: string | null = null;
  private sinceObject = 999;
  private lastRiskTier = 0;
  private finalTaken = false;

  /** オブジェクトに関わる出来事があった */
  private touchedObject(id: string) {
    this.lastObject = id;
    this.sinceObject = 0;
  }

  private markEvent(kind: string) {
    this.sinceEvent = 0;
    this.horror.markMeaningful();
    this.d.markEvent(kind);
  }

  /**
   * 提示するかどうか。
   * 候補があっても、直前に何か起きていたら間を置く。Silence も正解。
   */
  private updateDirector(dt: number) {
    const pace = CONFIG.floor1.pacing;
    this.director.update(dt);

    if (this.active) return;

    // 予約済みの提示を待つ
    if (this.pendingDef) {
      this.pendingDelay -= dt;
      // 待っている間に強い出来事があったら、もう一度考え直す
      if (this.sinceEvent < pace.afterEvent) {
        this.pendingDelay = Math.max(this.pendingDelay, randRange(pace.offerDelay.min, pace.offerDelay.max));
      }
      if (this.pendingDelay <= 0) {
        const def = this.pendingDef;
        this.pendingDef = null;
        // 出す直前にもう一度文脈を確認する
        const ctx = this.context();
        if (this.stillValid(def, ctx)) this.offer(def);
        else this.d.log('request_candidate_rejected', `id=${def.id} reason=context_changed`);
      }
      return;
    }

    this.quiet -= dt;
    if (this.quiet > 0) return;
    if (this.sinceEvent < pace.afterEvent) return;

    const ctx = this.context();
    const def = this.director.select(ctx);
    for (const c of this.director.lastCandidates) {
      this.d.log('request_candidate_generated', `id=${c.def.id} score=${c.score.toFixed(1)} ${c.reasons.join(',')}`);
    }
    if (!def) {
      this.quiet = randRange(3, 7);
      return;
    }
    // 近くにいることは条件であってトリガーではない。ここから更に間を置く
    this.pendingDef = def;
    this.pendingDelay = randRange(pace.offerDelay.min, pace.offerDelay.max);
    this.d.log('object_became_eligible', `id=${def.id} delay=${this.pendingDelay.toFixed(1)}`);

    // 少し前に視聴者が匂わせる（毎回はやらない）
    if (Math.random() < 0.45) {
      const lines = def.object ? DISCOVERY_CHAT[def.object] : null;
      if (lines) this.d.chatLine(pick(lines));
    }
  }

  private stillValid(def: Floor1RequestDef, ctx: Floor1Context) {
    if (def.object) {
      const d = def.object === 'ghost' ? ctx.ghostDistance : ctx.distances[def.object] ?? 999;
      if (def.maxDistance !== undefined && d > def.maxDistance * 1.6) return false;
    }
    if (ctx.ghost === 'chasing' && def.id !== 'chase_film') return false;
    return true;
  }

  private offer(def: Floor1RequestDef) {
    this.active = {
      def,
      timeLeft: def.time,
      progress: 0,
      engaged: false,
      hold: 0,
      tier: 0,
      earned: 0,
      held: 0,
      offeredAt: this.elapsed,
    };
    this.offered += 1;
    if (this.uniqueRequests.has(def.id)) this.repeatedRequests += 1;
    this.uniqueRequests.add(def.id);
    this.offeredHistory.push(def.id);
    this.director.markOffered(def.id);
    this.d.markDecision();
    this.d.sfxSpike();
    this.d.chat(def.lastTemptation ? 'temptation' : 'request', 3);
    this.d.log('request_selected', `id=${def.id} type=${def.type} reward=${def.reward} tier=${def.riskTier}`);
    this.d.log('request_offered', `${def.id}:${def.reward}`);
    if (def.lastTemptation) this.lastTemptationDone = true;
  }

  dismiss() {
    const a = this.active;
    if (!a) return false;
    this.dismissed += 1;
    this.d.log('request_dismissed', [
      `request_type=${a.def.id}`,
      `reward=${a.def.reward}`,
      `risk_tier=${a.def.riskTier}`,
      `time_since_offered=${(this.elapsed - a.offeredAt).toFixed(1)}`,
    ].join(' '));
    this.endRequest('dismissed');
    return true;
  }

  private endRequest(why: 'ignored' | 'dismissed' | 'done') {
    const pace = CONFIG.floor1.pacing;
    if (this.active && why === 'ignored') {
      this.ignored += 1;
      this.d.log('request_ignored', `${this.active.def.id}:${this.active.def.reward}`);
    }
    this.active = null;
    // 終わった直後に溜まっていたものを出さない。改めて文脈を見る
    this.pendingDef = null;
    this.quiet = randRange(pace.afterRequest.min, pace.afterRequest.max);
  }

  private finish(a: ActiveRequest, reward: number) {
    this.completed += 1;
    this.completedIds.add(a.def.id);
    if (a.def.object) this.touchedObject(a.def.object);
    // 自分から危険を選んだ。世界はこれを見てから返事を決める
    this.lastRiskTier = a.def.riskTier;
    this.horror.markGreed(a.def.riskTier);
    if (a.def.lastTemptation) this.finalTaken = true;
    this.d.log(
      'request_completed_event',
      `requestId=${a.def.id} riskTier=${a.def.riskTier} object=${a.def.object ?? '-'}`,
    );
    if (a.def.type !== 'hold') {
      this.d.addEarnings(reward);
      this.d.sfxCash();
      this.d.toast(`+¥${reward.toLocaleString()}`, 2.2);
    }
    this.d.spikeViewers(1.2);
    this.d.addBoost(1.4, 12);
    this.d.addHaunting(a.def.haunting);
    this.d.addDanger(a.def.danger);
    this.d.chat('request', 3);
    this.markEvent('request_complete');
    this.d.log('request_completed', `${a.def.id}:${reward}`);
    this.endRequest('done');

    // 段が続くかどうか
    const chances = CONFIG.floor1.continueChances;
    const idx = Math.min(a.def.riskTier - 1, chances.length - 1);
    if (Math.random() > chances[Math.max(0, idx)]) {
      this.quiet = randRange(10, 18);
    }
  }

  // ---------------------------------------------------------------- //

  private evaluate(dt: number, opts: { moved: boolean; turned: number }) {
    const a = this.active;
    if (!a) return;
    a.timeLeft -= dt;
    const def = a.def;

    if (def.type === 'action') {
      let done = false;
      switch (def.id) {
        case 'portrait_look':
          done = this.objects.get('portraits')!.interactions > 0;
          break;
        case 'portrait_pick':
          done = this.objects.get('portraits')!.state === 'held';
          break;
        case 'portrait_back':
          done = this.objects.get('portraits')!.state === 'restored';
          break;
        case 'phone_answer':
          done = this.objects.get('phone')!.state === 'answered';
          break;
        case 'bath_sip':
          done = this.bathSips >= 1;
          break;
        case 'bath_sip2':
          done = this.bathSips >= 2;
          break;
        case 'bath_finish':
          done = this.bathSips >= 3;
          break;
        case 'ghost_closer':
          a.progress = clamp01((16 - this.objDistance('ghost')) / 10);
          done = this.objDistance('ghost') <= 6;
          break;
        case 'ghost_selfie':
        case 'ghost_selfie_close':
        case 'ghost_last_selfie': {
          const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
          const near = def.id === 'ghost_selfie_close' ? 4.5 : 12;
          const ok = this.d.selfie() && this.d.isVisible(g.x, g.z, 1.3) && this.objDistance('ghost') <= near;
          a.held = ok ? a.held + dt : Math.max(0, a.held - dt);
          a.progress = clamp01(a.held / 1.2);
          done = a.held >= 1.2;
          if (done) {
            this.ghostSelfies += 1;
            this.memory.remember('ghost_selfie_taken');
            if (def.id === 'ghost_selfie_close') this.memory.remember('ghost_close_selfie');
            this.d.log('ghost_selfie', `count=${this.ghostSelfies} distance=${this.objDistance('ghost').toFixed(1)}`);
          }
          break;
        }
        case 'sit_turn':
        case 'sit_turn_last':
          a.progress = clamp01(Math.abs(opts.turned) / Math.PI);
          done = Math.abs(opts.turned) > 2.4;
          if (done) this.turnAroundConsequence();
          break;
      }
      if (a.progress < 0.5 && done) a.progress = 1;
      if (a.progress >= 0.5) a.engaged = true;
      if (done) {
        this.finish(a, def.reward);
        return;
      }
    }

    if (def.type === 'constraint') {
      const need = def.constraintSeconds ?? 5;
      let ok = false;
      switch (def.id) {
        case 'mirror_dark':
        case 'sit_lights_off':
          ok = !this.d.lightOn();
          break;
        case 'mirror_stare': {
          const spec = FLOOR1_OBJECTS.find((o) => o.id === 'mirror')!;
          ok = this.d.centerOf(spec.x, spec.z, spec.height) > 0.35;
          break;
        }
        case 'ghost_frame':
        case 'chase_film': {
          const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
          ok = this.d.isVisible(g.x, g.z, 1.3);
          break;
        }
        case 'sit_dont_turn':
          if (Math.abs(opts.turned) > 2.0) {
            this.d.toast('YOU LOOKED', 1.4);
            this.endRequest('ignored');
            return;
          }
          ok = true;
          break;
        case 'sit_dont_move':
          if (opts.moved) {
            this.d.toast('YOU MOVED', 1.4);
            this.endRequest('ignored');
            return;
          }
          ok = true;
          break;
      }
      a.held = ok ? a.held + dt : Math.max(0, a.held - dt * 0.6);
      a.progress = clamp01(a.held / need);
      if (a.progress >= 0.5) a.engaged = true;
      if (a.held >= need) {
        this.finish(a, def.reward);
        return;
      }
    }

    if (a.timeLeft <= 0) {
      if (a.def.type === 'hold' && a.tier > 0) this.finish(a, a.earned);
      else this.endRequest('ignored');
    }
  }

  /** TURN AROUND の結果。毎回びっくりさせない */
  private turnAroundConsequence() {
    const roll = Math.random();
    if (roll < 0.35) {
      this.d.hint('NOTHING', 2);
      return;
    }
    if (roll < 0.65) {
      this.d.hint('SOMETHING, FAR DOWN THE HALL', 2.6);
      this.d.chat('discovered', 2);
      return;
    }
    if (roll < 0.88) {
      this.maybeGhostStir();
      this.d.hint('IT IS NOT WHERE IT WAS', 2.6);
      this.d.chat('danger', 3);
      return;
    }
    this.d.addDanger(14);
    this.d.chat('danger', 4);
    this.d.hint('IT IS RIGHT THERE', 2.4);
  }

  // ---------------------------------------------------------------- //

  update(dt: number, input: { holdingE: boolean; moved: boolean; turned: number }) {
    this.elapsed += dt;
    this.sinceEvent += dt;
    this.sinceObject += dt;
    this.memory.update(dt);
    this.updateDiscovery(dt);
    this.updateGhost(dt);
    this.updateHold(dt, input.holdingE);
    this.evaluate(dt, input);
    this.updateDirector(dt);

    // 帰ろうとしているか
    const dEnt = this.d.distanceToEntrance();
    if (dEnt < this.lastEntranceDistance - 0.01) this.returningTime += dt;
    else if (dEnt > this.lastEntranceDistance + 0.05) this.returningTime = 0;
    this.lastEntranceDistance = dEnt;

    // 配信目標
    if (!this.goal && goalReached({ elapsed: this.elapsed, discoveries: this.discoveries, earnings: this.d.earnings() })) {
      this.goal = true;
      this.d.footage('STREAM GOAL REACHED', 3.4);
      this.d.hint("YOU'VE GOT ENOUGH. RETURN WHEN YOU'RE READY.", 4);
      this.d.sfxCash();
      this.d.addBoost(1.2, 10);
      this.d.chat('escape', 3);
      this.markEvent('discovery');
      this.d.log('stream_goal_reached', `earnings=${Math.round(this.d.earnings())}`);
    }

    // --- HorrorDirector。世界側の反応と「間」はこちらが決める ---
    const fired = this.horror.update(dt, this.horrorContext());
    if (fired) this.runHorror(fired);

    // 電話を鳴らす条件
    this.maybeRingPhone(dt);
  }

  private phoneTimer = 20;
  /**
   * 電話を鳴らす。
   * 近づいた瞬間に鳴らさない。条件が揃うまで待ち、揃わなければ短い間隔で見直す。
   * （長いタイマーを毎回引き直すと、条件が揃う瞬間を逃し続けて一度も鳴らなくなる）
   */
  private maybeRingPhone(dt: number) {
    const st = this.objects.get('phone');
    if (!st || !st.discovered) return;
    if (st.state !== 'idle' && st.state !== 'normal') return;
    this.phoneTimer -= dt;
    if (this.phoneTimer > 0) return;
    const ready =
      this.d.haunting() >= 12 && this.sinceEvent >= 5 && this.objDistance('phone') <= 26 && !this.active;
    if (!ready) {
      // 条件が揃っていないだけ。すぐ見直す
      this.phoneTimer = 3;
      return;
    }
    this.phoneTimer = randRange(45, 80);
    this.objects.setState('phone', 'ringing');
    this.d.sfxPhone(this.objDistance('phone'));
    this.d.addLikes(80);
    this.d.footage('THE PHONE IS RINGING   +80 Likes', 2.4);
    this.d.chat('anomaly', 3);
    this.markEvent('anomaly');
    this.d.log('subject_state_changed', 'subject=phone old=idle new=ringing');
  }


  /** HorrorDirector へ渡す文脈 */
  private horrorContext() {
    const dists: Record<string, number> = {};
    const rooms: Record<string, string> = {};
    for (const o of FLOOR1_OBJECTS) {
      dists[o.id] = this.objDistance(o.id);
      rooms[o.id] = o.room;
    }
    dists.ghost = this.objDistance('ghost');
    rooms.ghost = 'ldk';
    const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
    return {
      haunted: this.d.haunting(),
      danger: this.d.danger(),
      room: this.room(),
      phase: this.phase(),
      chaseActive: this.d.ghostChasing(),
      ghostState: this.ghost,
      ghostDistance: dists.ghost,
      ghostOnScreen: this.d.isVisible(g.x, g.z, 1.3),
      objectDistances: dists,
      objectStates: this.objects.states(),
      objectRoom: rooms,
      memories: this.memory.all(),
      memoryAge: this.memory.ages(),
      focusObject: this.focusObject(),
      activeRequestId: this.active?.def.id ?? null,
      activeRequestType: this.active?.def.type ?? null,
      lastRiskTier: this.lastRiskTier,
      goalReached: this.goal,
      returning: this.returningTime > 1.5 && this.d.distanceToEntrance() < 14,
      finalTemptationTaken: this.finalTaken,
    };
  }

  private phase(): RunPhase {
    if (this.d.ghostChasing()) return 'CHASE';
    if (this.returningTime > 1.5 && this.d.distanceToEntrance() < 14) return 'RETURNING';
    if (this.goal) return 'OVERTIME';
    if (this.elapsed < 35) return 'INTRO';
    if (this.completed > 0 || this.lastObject) return 'ENGAGEMENT';
    return 'EXPLORATION';
  }

  /** 今カメラを向けている対象 */
  private focusObject(): string | null {
    let best: string | null = null;
    let bestC = 0.25;
    for (const o of FLOOR1_OBJECTS) {
      const c = this.d.centerOf(o.x, o.z, o.height);
      if (c > bestC) {
        bestC = c;
        best = o.id;
      }
    }
    const g = this.ghost === 'seated' ? SOFA : this.d.ghostPos();
    if (this.d.centerOf(g.x, g.z, 1.3) > bestC) return 'ghost';
    return best;
  }

  /** UIへ渡す */
  view(): RequestView | null {
    const a = this.active;
    if (!a) return null;
    const def = a.def;
    let reward = def.reward;
    let nextTitle: string | null = null;
    let nextReward = 0;
    if (def.type === 'hold' && def.holdTiers) {
      reward = a.earned;
      const nt = def.holdTiers[a.tier];
      if (nt) {
        nextTitle = nt.label;
        nextReward = nt.reward;
      }
    }
    const risk: RequestView['risk'] =
      def.riskTier >= 5 ? 'extreme' : def.riskTier >= 4 ? 'high' : def.riskTier >= 2 ? 'medium' : 'low';
    return {
      id: this.offered,
      title: def.label,
      description: def.desc,
      reward,
      timeLeft: a.timeLeft,
      progress: a.progress,
      temptation: !!def.lastTemptation,
      risk,
      stage: 1,
      options: [],
      nextTitle,
      nextReward,
      engaged: a.engaged,
      constraint: def.type === 'constraint',
      constraintLeft: Math.max(0, (def.constraintSeconds ?? 0) - a.held),
    };
  }

  /** デバッグ表示 */
  debug() {
    return {
      room: this.room(),
      ghost: this.ghost,
      goal: this.goal,
      director: this.active ? 'ACTIVE' : this.pendingDef ? 'PENDING' : this.quiet > 0 ? 'QUIET' : 'IDLE',
      candidates: this.director.lastCandidates.map((c) => `${c.def.id} ${c.score.toFixed(0)}`),
      rejected: this.director.lastRejections.slice(0, 6).map((r) => `${r.id}:${r.reason}`),
      memory: [...this.memory.all()],
      horror: this.horror.debug(),
    };
  }

  kpi() {
    const holds = this.holdDurations;
    const median = (xs: number[]) => {
      if (!xs.length) return 0;
      const a = [...xs].sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)];
    };
    const byId = (id: string) => holds.filter((h) => h.id.startsWith(id));
    const altar = byId('altar');
    const phone = byId('phone');
    return {
      discoveries: this.discoveries,
      offered: this.offered,
      completed: this.completed,
      dismissed: this.dismissed,
      ignored: this.ignored,
      uniqueRequests: this.uniqueRequests.size,
      repeatedRequests: this.repeatedRequests,
      bathSips: this.bathSips,
      ghostSelfies: this.ghostSelfies,
      voluntaryContinuations: this.voluntaryContinuations,
      medianAltarHold: median(altar.map((h) => h.seconds)),
      altarTier2: altar.filter((h) => h.tier >= 2).length,
      medianPhoneHold: median(phone.map((h) => h.seconds)),
      phoneTier2: phone.filter((h) => h.tier >= 2).length,
      goal: this.goal,
      lastTemptation: this.lastTemptationDone,
      memory: [...this.memory.all()],
      horror: this.horror.kpi(this.elapsed),
    };
  }
}
