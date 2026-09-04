import * as THREE from 'three';
import { CONFIG, type GameMode, type InspectType } from './config';
import { Input } from './core/input';
import { store, type Phase } from './core/store';
import { clamp01, formatNumber, randRange } from './core/util';
import { buildLevel, MONSTER_ANCHORS, PEEK_ANCHORS, type InspectPoint, type Level } from './world/level';
import { buildGhostLevel, GHOST_MONSTER_ANCHORS, GHOST_PEEK_ANCHORS } from './world/ghostLevel';
import {
  buildFloor1Level,
  FLOOR1_OBJECTS,
  FLOOR1_GHOST_ANCHORS,
  FLOOR1_PEEK_ANCHORS,
  type Floor1Level,
} from './world/floor1Level';
import { Floor1Mode } from './systems/floor1Mode';
import { Player } from './world/player';
import { Monster } from './world/monster';
import { computeFraming, type Framing } from './systems/framing';
import { dangerGainPerSecond } from './systems/danger';
import { StreamSystem, type FilmCandidate } from './systems/stream';
import { AnomalySystem, type ActiveAnomaly } from './systems/anomalies';
import { HauntingSystem } from './systems/haunting';
import { DEFS, isConstraint, RequestSystem, type ActiveRequest } from './systems/requests';
import { ChatSystem, type ChatCategory } from './systems/chat';
import { AudioSystem } from './systems/audio';
import { Logger, type LogRow } from './systems/logger';
import { Director } from './systems/director';
import { HeySystem, type HeyResponse } from './systems/hey';
import { NoveltySystem, riskMultiplier } from './systems/novelty';
import { OneGhostStats } from './systems/oneGhost';

const DEATH_FREEZE = 2.4;
const DEATH_LOST = 3.8;
/** 撮影対象として扱う調査地点の基礎価値（異変が起きていないとき） */
const POINT_BASE_VALUE = 18;

/** 対象ごとの「今どの状態を、どれだけ続けて撮っているか」 */
interface FilmTrack {
  stateKey: string;
  /** 連続撮影時間 */
  hold: number;
  /** このexposureの新規性倍率 */
  novelty: number;
  /** すでに回数を消費したか */
  awarded: boolean;
  /** 画面から外れている時間 */
  unseen: number;
}

/** 連続撮影時間 → 倍率（折れ線補間） */
function holdMultiplier(seconds: number) {
  const curve = CONFIG.novelty.hold.curve;
  if (seconds <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1] = curve[i];
    if (seconds <= t1) {
      const [t0, v0] = curve[i - 1];
      const t = (seconds - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * t;
    }
  }
  return curve[curve.length - 1][1];
}

const INVISIBLE: Framing = {
  visible: false,
  center: 0,
  distance: 999,
  los: false,
  ndc: { x: 0, y: 0 },
};

export class Game {
  readonly logger = new Logger();
  readonly audio = new AudioSystem();

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private level: Level;
  private player = new Player();
  private monster: Monster;
  private input: Input;
  private stream = new StreamSystem();
  private anomalies: AnomalySystem;
  private haunting = new HauntingSystem();
  private requests = new RequestSystem();
  private chat = new ChatSystem();
  private director = new Director();
  private hey = new HeySystem();
  private novelty = new NoveltySystem();
  private ghostStats = new OneGhostStats();
  private flashlight: THREE.SpotLight;

  /** 検証モード。ONE GHOST MODE は独立したバランスを持つ */
  private mode: GameMode = 'standard';
  /** 今シーンに建っているステージのモード */
  private levelMode: GameMode = 'standard';
  private phase: Phase = 'menu';
  private raf = 0;
  private lastTime = 0;
  private time = 0;
  private elapsed = 0;
  private repathTimer = 0;
  private noDangerTime = 0;
  private provokeCooldown = 0;
  private inspectCooldown = 0;
  private deathTimer = 0;
  private toastTimer = 0;
  private footageTimer = 0;
  private hintTimer = 0;
  private phoneRingTimer = 0;
  private phoneWasRinging = false;
  private monsterAppearCooldown = 0;
  private mouseHintTimer = 0;
  /** 今フレームのRisk倍率（プレイヤーには見せない） */
  private risk = 1;
  private sinceHey = 999;
  /** 対象ごとの撮影トラッキング（同じ状態を撮り続けているか） */
  private filmTracks = new Map<string, FilmTrack>();
  /** 「もう飽きられている」コメントの間隔 */
  private staleChatCooldown = 0;
  /** 配信目標を達成したか */
  private goalReached = false;
  /** Dismiss（Xの押しっぱなし）の蓄積 */
  private dismissHold = 0;
  /** ONE LAST CALL のペイオフ待ち。0より大きい間はカウントダウン中 */
  private lastCallPayoff = 0;
  private debug = false;

  // このフレームの出来事
  private provokedNow = false;
  private heyUsedNow = false;
  private reactionTimer = 0;
  private reactionFor: ActiveAnomaly | null = null;
  /** 目的地系リクエストの道中に仕込む異変のタイマー */
  private journeyEvents: number[] = [];
  /**
   * 配信カメラのライト。**プレイヤーが [F] で切れる。**
   *
   * 以前は LIGHTS OFF リクエスト中にゲームが勝手に消していたが、
   * それだと「消せと言われても消し方が無い」状態だった。
   * 自分で消すからこそ「自分から危険を作った」になる。
   */
  private lightOn = true;
  /** 人形を抱えているか */
  private carryingDoll = false;
  private inspectedNow: InspectType | null = null;
  private answeredPhoneNow = false;

  private framing: Framing = INVISIBLE;
  private distance = 999;
  private wasVisible = false;
  private lookBackCooldown = 0;
  private lookBackLogged = 0;

  // 帰宅判定
  private lowClipTime = 0;
  private approachTime = 0;
  private lastEntranceDistance = 999;
  private leaving = false;
  private wasLeaving = false;
  private temptation: {
    time: number;
    earnings: number;
    distance: number;
    reward: number;
    turnedBack: boolean;
  } | null = null;
  private turnBacks = 0;
  private requestOfferedAt = 0;
  private hesitations: number[] = [];
  private maxHaunting = 0;
  private chaseCount = 0;
  /** 今の追跡中、すでに「振り返って撮った」と数えたか */
  private chaseGreedCounted = false;

  /** ONE GHOST MODE か */
  private get ghost() {
    return this.mode === 'one_ghost';
  }

  /** HS FLOOR 1 MODE か */
  private get floor1() {
    return this.mode === 'floor1';
  }

  /** HS FLOOR 1 MODE の本体。他モードでは触らない */
  private f1: Floor1Mode | null = null;
  private f1Level: Floor1Level | null = null;
  /** 直前フレームの位置と向き（DON'T MOVE / TURN AROUND の判定用） */
  private lastPos = { x: 0, z: 0 };
  private turnAnchor = 0;

  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, CONFIG.render.fogDensity);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, CONFIG.render.far);
    this.scene.add(this.camera);

    this.scene.add(new THREE.AmbientLight(0x2c3a54, CONFIG.render.ambient));
    this.scene.add(new THREE.HemisphereLight(0x415574, 0x070910, CONFIG.render.hemi));

    // 配信カメラのライト。常時ON（構える操作は存在しない）
    this.flashlight = new THREE.SpotLight(
      0xfff2dd,
      CONFIG.render.flashlightIntensity,
      CONFIG.render.flashlightRange,
      Math.PI / 6.4,
      0.38,
      1.0,
    );
    this.flashlight.position.set(0, 0, 0.1);
    this.flashlight.target.position.set(0, -0.16, -1);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.4;
    this.flashlight.shadow.camera.far = CONFIG.render.flashlightRange;
    this.flashlight.shadow.bias = -0.002;
    this.flashlight.shadow.normalBias = 0.02;
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);

    this.level = buildLevel(this.scene);
    this.monster = new Monster(this.scene);
    this.anomalies = new AnomalySystem(this.scene, this.level);
    this.player.buildAvatar(this.scene);

    this.input = new Input(canvas);
    this.input.onKeyDown = this.handleKey;
    this.input.onLockChange = (locked) => {
      // 案内は数秒で消す。UIキャプチャの邪魔をしないため常時表示にはしない
      if (!locked && this.phase === 'playing') this.mouseHintTimer = 5;
      store.setNow({ pointerLocked: locked, mouseHint: !locked && this.phase === 'playing' });
    };

    this.player.onStep = () => this.audio.footstep(this.player.running);
    this.chat.onMessage = () => {
      store.set({ chat: this.chat.messages });
      this.audio.chatBlip();
    };

    this.novelty.onStateChange = (subject, from, to) => {
      this.logger.event(
        'subject_state_changed',
        this.logRow(),
        `subject=${subject} old=${from} new=${to}`,
      );
    };
    this.monster.onBehaviorChange = (next) => {
      this.requests.notifyConsequence(`monster_${next}`);
    };
    this.monster.onStateChange = this.handleMonsterState;
    this.monster.onLunge = () => {
      this.requests.notifyConsequence('monster_lunge');
      this.audio.monsterRoar();
      this.chat.burst('danger', 3);
      this.hint('IT MOVED AT YOU', 2);
      this.director.markEvent('monster_appear');
      this.logEvent('monster_lunge');
    };
    // ONE GHOST MODE：追跡は撤退戦。逃げ切ってもゲームは終わらない（§19）
    this.monster.onChaseEnd = (reason) => {
      this.audio.setChase(false);
      this.stream.addBoost(0.8, 8);
      this.chat.burst('escape', 3);
      this.hint(reason === 'entrance' ? 'YOU MADE IT BACK' : 'IT STOPPED', 3);
      this.toast('IT LOST YOU', 2.2);
      this.ghostStats.markEscape();
      this.chaseGreedCounted = false;
      this.director.markEvent('chase');
      this.logEvent('chase_escaped', reason);
      store.setNow({ chasing: false });
    };
    this.monster.onGrab = () => {
      // 非致死。掴まれて突き放されるだけだが、配信は大いに盛り上がる
      this.audio.death();
      this.stream.spikeViewers(CONFIG.monster.grab.viewerSpike);
      this.stream.addBoost(2, 12);
      this.chat.burst('death', 4);
      this.toast('IT TOUCHED YOU', 2.5);
      this.hint('IT LET GO. GET OUT.', 3);
      this.director.markEvent('chase');
      this.logEvent('player_grabbed');
    };
    this.anomalies.onSpawn = this.handleAnomalySpawn;
    this.anomalies.onDiscovered = this.handleAnomalyDiscovered;
    this.anomalies.onSound = (type, _x, _z, distance) => {
      if (type === 'door_slam') this.audio.doorSlam(distance);
      else if (type === 'noise') this.audio.knock(distance);
      else if (type === 'phone_ring') this.audio.phoneRing(distance);
      else if (type === 'mirror_figure') this.audio.whisper(distance);
    };

    this.requests.onChainLog = (event, detail) => {
      this.logger.event(event as Parameters<Logger['event']>[0], this.logRow(), detail);
    };
    this.requests.onOffer = (r) => {
      this.director.markEvent(r.temptation ? 'temptation' : 'request_offer');
      this.director.markDecision(r.temptation ? 'temptation' : 'request');
      this.requestOfferedAt = this.elapsed;
      this.handleRequestOffer(r);
    };
    this.requests.onEngage = (r) => {
      const hesitation = this.elapsed - this.requestOfferedAt;
      this.hesitations.push(hesitation);
      // 高額の段ほど迷う時間が伸びることを期待する（§44）
      const tier =
        r.reward >= 15000 ? 5
        : r.reward >= 10000 ? 4
        : r.reward >= 6000 ? 3
        : r.reward >= 3000 ? 2
        : r.reward >= 1500 ? 1
        : 0;
      (this.requests.hesitationByTier[tier] ??= []).push(hesitation);
      this.logger.event(
        r.temptation ? 'temptation_accepted' : 'request_accepted',
        this.logRow(),
        `${r.kind} hesitation=${hesitation.toFixed(1)}s reward=${r.reward} step=${r.chainStep}`,
      );
      if (this.ghost && r.temptation) this.logEvent('last_temptation_taken', r.kind);
      // [F]で受けるのではなく、動き出したことを受諾とみなす
      this.stream.addBoost(0.6, 12);
      this.chat.burst(r.temptation ? 'temptation' : 'request', 2);
    };
    this.requests.onStage2 = (r) => {
      // 到着＝ゴールにしない。ここでもう一段の選択を出す
      this.director.markEvent('request_offer');
      this.director.markDecision('request');
      this.audio.challengeAlert();
      this.chat.burst('request', 2);
      this.logEvent('request_stage2', r.kind);
      store.setNow({ request: this.viewRequest(r) });
    };
    this.requests.onComplete = (r, reward, option) => {
      this.director.markEvent('request_complete');
      this.novelty.markRiskReignite();
      this.stream.addEarnings(reward);
      this.stream.spikeViewers(CONFIG.request.viewerSpike);
      this.stream.addBoost(1.5, 14);
      this.haunting.add(DEFS[r.kind].haunting);
      this.monster.addDanger(DEFS[r.kind].danger);
      this.audio.cash();
      this.chat.burst('request', 3);
      this.toast(`+¥${formatNumber(reward)}`, 2.4);
      if (r.kind === 'carry_doll' && this.carryingDoll) {
        this.carryingDoll = false;
        const doll = this.nearestPoint('doll');
        if (doll) doll.object.position.set(doll.x, 0, doll.z);
        this.logEvent('doll_delivered');
      }
      this.logEvent('request_completed', `${r.kind}:${option?.id ?? 'main'}:${reward}`);
      this.clearRequestEffects();
      store.setNow({ request: null });
    };
    this.requests.onDismiss = (r, sinceOffered) => {
      // ペナルティは一切与えない。安全に降りる選択肢であることが目的（§14）
      this.toast('DISMISSED', 1.4);
      this.clearRequestEffects();
      this.logger.event('request_dismissed', this.logRow(), [
        `request_type=${r.kind}`,
        `reward=${r.reward}`,
        `risk_tier=${r.risk}`,
        `time_since_offered=${sinceOffered.toFixed(1)}`,
        `monster_distance=${this.distance.toFixed(1)}`,
        `danger=${this.monster.danger.toFixed(0)}`,
        `haunting=${this.haunting.level.toFixed(0)}`,
      ].join(' '));
      store.setNow({ request: null });
    };
    this.requests.onExpire = (r, engaged) => {
      // 無視された分だけ視聴者が離れる（断ることにもコストを持たせる）
      if (!engaged) {
        // 断ったこと自体にはペナルティを与えない（§2）。
        // Viewerが減るのは「新しい撮れ高が無い時間が続いたから」であるべきなので、
        // その役目は Novelty 側に持たせてある。
        const pen = CONFIG.request.ignorePenalty;
        if (pen.viewerMult !== 1) this.stream.spikeViewers(pen.viewerMult);
        if (pen.engagement !== 0) this.stream.addBoost(pen.engagement, 8);
        this.chat.burst('stale', 1);
      }
      this.logEvent(engaged ? 'request_failed' : 'request_ignored', r.kind);
      this.clearRequestEffects();
      store.setNow({ request: null });
    };

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.resetRun();
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // --- ライフサイクル ---


  /** HS FLOOR 1 MODE から世界へ触るための口 */
  private floor1Deps() {
    return {
      playerPos: () => this.player.position,
      playerForward: () => ({ x: this.player.forward.x, z: this.player.forward.z }),
      selfie: () => this.player.selfie,
      lightOn: () => this.lightOn,
      isVisible: (x: number, z: number, h: number) => this.isVisible(x, z, h),
      centerOf: (x: number, z: number, h: number) => {
        this._probe.set(x, h, z);
        const f = this.frameOf(this._probe);
        return f.visible ? f.center : 0;
      },

      addLikes: (n: number) => this.stream.addLikes(n),
      addEarnings: (y: number) => this.stream.addEarnings(y),
      spikeViewers: (f: number) => this.stream.spikeViewers(f),
      addBoost: (a: number, d: number) => this.stream.addBoost(a, d),
      addHaunting: (n: number) => this.haunting.add(n),
      haunting: () => this.haunting.level,
      addDanger: (n: number) => this.monster.addDanger(n),
      danger: () => this.monster.danger,
      earnings: () => this.stream.earnings,

      toast: (t: string, d: number) => this.toast(t, d),
      footage: (t: string, d: number) => this.footage(t, d),
      hint: (t: string, d: number) => this.hint(t, d),
      chat: (c: string, n: number) => this.chat.burst(c as ChatCategory, n),
      chatLine: (t: string) => this.chat.push(t, true),

      sfxBell: () => this.audio.chatBlip(),
      sfxPhone: (d: number) => this.audio.phoneRing(d),
      sfxKnock: (d: number) => this.audio.knock(d),
      sfxWhisper: (d: number) => this.audio.whisper(d),
      sfxDoor: (d: number) => this.audio.doorSlam(d),
      sfxCash: () => this.audio.cash(),
      sfxShutter: () => this.audio.shutter(),
      sfxSpike: () => this.audio.viewerSpike(),
      sfxStep: () => this.audio.footstep(false),

      flickerLamp: (x: number, z: number, d: number) => this.level.flickerLamp(x, z, d),
      dropPortrait: () => this.f1Level?.dropPortrait(),
      restorePortrait: () => this.f1Level?.restorePortrait(),
      setFridgeOpen: (o: boolean) => this.f1Level?.setFridgeOpen(o),
      setGhostSeatVisible: (v: boolean) => {
        if (this.f1Level) this.f1Level.ghostSeat.visible = v;
      },
      wakeGhost: (x: number, z: number) => {
        this.monster.frozen = false;
        this.monster.group.visible = true;
        this.monster.position.set(x, 0, z);
        this.monster.group.position.copy(this.monster.position);
        if (this.f1Level) this.f1Level.ghostSeat.visible = false;
      },
      ghostPos: () => this.monster.position,
      ghostChasing: () => this.monster.chasing,

      markEvent: (kind: string) => this.director.markEvent(kind as never),
      markDecision: () => this.director.markDecision('request'),
      log: (event: string, detail: string) =>
        this.logger.event(event as Parameters<Logger['event']>[0], this.logRow(), detail),
      distanceToEntrance: () => this.distanceToEntrance(),
    };
  }

  /**
   * モードごとの設定を各システムへ配る。通常モードの数値には触れない。
   * ステージ自体が違うので、必要なら建て直す。
   */
  private applyMode() {
    const ghost = this.ghost;
    const f1 = this.mode === 'floor1';
    if (this.levelMode !== this.mode) {
      this.levelMode = this.mode;
      this.level.dispose();
      this.f1Level = null;
      if (f1) {
        const lv = buildFloor1Level(this.scene);
        this.f1Level = lv;
        this.level = lv;
      } else {
        this.level = ghost ? buildGhostLevel(this.scene) : buildLevel(this.scene);
      }
      this.anomalies.setLevel(this.level);
    }
    this.monster.anchors = f1
      ? FLOOR1_GHOST_ANCHORS
      : ghost
        ? GHOST_MONSTER_ANCHORS
        : MONSTER_ANCHORS;
    this.monster.peekAnchors = f1
      ? FLOOR1_PEEK_ANCHORS
      : ghost
        ? GHOST_PEEK_ANCHORS
        : PEEK_ANCHORS;
    if (f1 && !this.f1) this.f1 = new Floor1Mode(this.floor1Deps());
    // 環境怪異とNoveltyは FLOOR 1 では専用システムが受け持つ
    if (f1) this.anomalies.autoSpawn = false;
    this.monster.oneGhost = ghost;
    this.monster.thresholds = ghost ? CONFIG.oneGhost.thresholds : CONFIG.danger.thresholds;
    this.hey.oneGhost = ghost;
    this.requests.mode = this.mode;
    this.anomalies.autoSpawn = !ghost;
    // ONE GHOST MODE は被写体が一体しかなく、枯らすと成立しないので Novelty は使わない
    this.novelty.enabled = !ghost;
    this.chat.mode = this.mode;
    this.logger.mode = this.mode;
  }

  private resetRun() {
    this.applyMode();
    this.player.reset();
    this.monster.reset(this.ghost ? CONFIG.oneGhost.monsterSpawn : CONFIG.monster.spawn);
    this.stream.reset();
    this.requests.reset();
    this.chat.reset();
    this.logger.reset();
    this.haunting.reset();
    this.anomalies.reset();
    this.director.reset();
    this.hey.reset();
    this.novelty.reset();
    this.ghostStats.reset();
    if (this.floor1) {
      this.f1?.reset();
      // 幽霊はソファに座っているので、実体は止めておく
      this.monster.frozen = true;
      this.monster.group.visible = false;
    } else {
      this.monster.frozen = false;
      this.monster.group.visible = true;
    }
    for (const p of this.level.inspectPoints) {
      p.inspected = 0;
      p.discovered = false;
      p.freshness = 1;
      p.filmedTotal = 0;
      p.tiers = { see: false, anomaly: false, touch: false, selfie: false };
    }
    this.time = 0;
    this.elapsed = 0;
    this.noDangerTime = 0;
    this.provokeCooldown = 0;
    this.inspectCooldown = 0;
    this.reactionTimer = 0;
    this.reactionFor = null;
    this.journeyEvents = [];
    this.lightOn = true;
    this.lastPos = { x: 0, z: 0 };
    this.turnAnchor = 0;
    this.carryingDoll = false;
    this.deathTimer = 0;
    this.wasVisible = false;
    this.lookBackCooldown = 0;
    this.lookBackLogged = 0;
    this.distance = 999;
    this.lowClipTime = 0;
    this.approachTime = 0;
    this.lastEntranceDistance = 999;
    this.leaving = false;
    this.wasLeaving = false;
    this.temptation = null;
    this.turnBacks = 0;
    this.requestOfferedAt = 0;
    this.hesitations = [];
    this.maxHaunting = 0;
    this.chaseCount = 0;
    this.chaseGreedCounted = false;
    this.dismissHold = 0;
    this.lastCallPayoff = 0;
    this.risk = 1;
    this.sinceHey = 999;
    this.filmTracks.clear();
    this.staleChatCooldown = 0;
    this.goalReached = false;
    this.framing = INVISIBLE;
    this.audio.setChase(false);
    this.player.update(0.0001, this.input, this.level.grid, this.camera);
    store.reset();
    store.setNow({
      viewers: this.stream.viewers,
      debug: this.debug,
      phase: this.phase,
      mode: this.mode,
      pointerLocked: this.input.locked,
    });
  }

  startRun(mode: GameMode = this.mode) {
    this.mode = mode;
    this.audio.init();
    this.resetRun();
    this.phase = 'playing';
    store.setNow({ phase: 'playing', mode });
    this.input.requestLock();
    this.chat.push('stream started', false);
    this.chat.burst('idle', 2);
    this.logEvent('stream_started', mode);
    this.hint(
      this.ghost ? 'FIND SOMETHING WORTH FILMING.' : 'EXPLORE. FIND SOMETHING WORTH FILMING.',
      5,
    );
  }

  restart() {
    this.phase = 'menu';
    this.resetRun();
    this.startRun(this.mode);
  }

  /** モード選択へ戻る */
  returnToMenu() {
    this.phase = 'menu';
    this.resetRun();
    store.setNow({ phase: 'menu', mode: this.mode });
  }

  requestLock() {
    this.audio.init();
    this.input.requestLock();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    this.input.dispose();
    this.audio.dispose();
    this.anomalies.dispose();
    this.player.dispose(this.scene);
    this.monster.dispose(this.scene);
    this.level.dispose();
    this.renderer.dispose();
  }

  // --- 入力 ---

  private handleKey = (code: string) => {
    if (code === 'KeyP') {
      this.debug = !this.debug;
      store.setNow({ debug: this.debug });
      return;
    }
    if (this.phase === 'ended' && (code === 'KeyR' || code === 'Enter')) {
      this.restart();
      return;
    }
    // ポインタロックが無くても操作は受け付ける（移動キーと挙動を揃える）
    if (this.phase !== 'playing') return;
    if (code === 'KeyE') this.contextAction();
    if (code === 'KeyQ') this.shout();
    if (code === 'KeyC') {
      const on = this.player.toggleSelfie();
      this.audio.shutter();
      if (on) {
        this.novelty.markRiskReignite();
        this.chat.burst('selfie', 2);
        this.logEvent('selfie_started');
      } else {
        this.logEvent('selfie_ended');
      }
      store.setNow({ selfie: on });
    }
    if (code === 'KeyF') this.toggleLight();
    // Dismiss は押しっぱなしなので、単発キーでは扱わない（updatePlaying 側で処理する）
  };

  /**
   * ライトを切る / 点ける。
   *
   * 消すと何も見えなくなるが、そのぶん撮れ高のRiskが上がる。
   * 「消せ」と言われたときに自分で消す、という操作そのものが誘惑への回答になる。
   */
  private toggleLight() {
    this.lightOn = !this.lightOn;
    this.audio.shutter();
    this.toast(this.lightOn ? 'LIGHT ON' : 'LIGHT OFF', 1.2);
    if (!this.lightOn) {
      this.chat.burst('danger', 2);
      this.director.markEvent('monster_appear');
      this.novelty.markRiskReignite();
    }
    this.logEvent('light_toggled', this.lightOn ? 'on' : 'off');
  }

  /** [E] は状況で意味が変わる。入口 > 電話 > 調査 > 挑発 */
  private contextAction() {
    if (this.distanceToEntrance() <= CONFIG.entrance.range) {
      this.leaveSite();
      return;
    }
    // ONE GHOST MODE では調査地点も電話も存在しない。[E]は帰るためだけのキー
    if (this.ghost) return;
    if (this.floor1) {
      this.f1?.interact();
      return;
    }
    const phone = this.nearestPoint('phone');
    if (this.anomalies.phoneRinging && phone && this.pointDistance(phone) <= CONFIG.inspect.range) {
      if (this.anomalies.answerPhone()) {
        this.answeredPhoneNow = true;
        this.haunting.add(CONFIG.haunting.answerPhone);
        this.stream.addBoost(1.0, 10);
        this.stream.spikeViewers(1.15);
        this.chat.burst('anomaly', 3);
        this.toast('...', 2);
        this.director.markEvent('phone');
        this.logEvent('phone_answered');
      }
      return;
    }
    // 人形を持ち上げる / 置く（CARRY THE DOLL リクエスト中のみ）
    const doll = this.nearestPoint('doll');
    if (
      this.requests.active?.kind === 'carry_doll' &&
      doll &&
      !this.carryingDoll &&
      this.pointDistance(doll) <= CONFIG.inspect.range
    ) {
      this.carryingDoll = true;
      this.haunting.add(6);
      this.chat.burst('anomaly', 2);
      this.toast('YOU PICKED IT UP', 2);
      this.logEvent('doll_picked_up');
      return;
    }

    const point = this.nearestInspectPoint();
    if (point) {
      // 調査地点の前では絶対に「叫ぶ」に落ちない（連打が挑発になっていた）
      if (this.inspectCooldown <= 0) this.inspect(point);
      return;
    }
    this.shout();
  }

  /** 段階的な欲張り（見る → 異変 → 触る → 自撮り）の報酬を1回だけ払う */
  private awardTier(point: InspectPoint, tier: keyof typeof CONFIG.inspect.tiers, label: string) {
    if (point.tiers[tier]) return;
    point.tiers[tier] = true;
    const likes = Math.round(CONFIG.inspect.tiers[tier] * this.goalMult());
    this.stream.addLikes(likes);
    this.stream.addBoost(0.6, 8);
    this.footage(`${label} +${likes} Likes`, 2.4);
    this.audio.viewerSpike();
    this.director.markEvent('discovery');
    this.logEvent('tier_reward', `${point.type}:${tier}:${likes}`);
  }

  private inspect(point: InspectPoint) {
    this.inspectCooldown = CONFIG.inspect.cooldown;
    this.inspectedNow = point.type;
    const first = point.inspected === 0;
    point.inspected += 1;
    point.discovered = true;

    // --- ここが本題 ---
    // 「同じ対象」ではなく「同じ対象の同じ状態」で減衰させる（§2 / §3）。
    // 鏡を擦り続けても価値は戻らない。ただし鏡の中に何かが映れば別の状態になり、価値は戻る。
    // 「見る」と「触る」は別カウンタにする。
    // 眺めていただけで触る報酬まで枯れると、何回目に触ったかが読めなくなるため。
    // どちらも同じ「状態」に紐づくので、状態が変われば両方とも価値が戻る。
    const state = this.pointStateKey(point);
    const nov = this.novelty.consume(`touch:${point.type}`, state);
    const likes = Math.round(CONFIG.inspect.likes * nov.multiplier * this.goalMult());
    if (likes > 0) this.stream.addLikes(likes);
    this.haunting.add(CONFIG.haunting.inspect * nov.multiplier);
    this.stream.addBoost(0.5 * nov.multiplier, 8);
    this.audio.shutter();
    this.director.markEvent('inspect');
    this.awardTier(point, 'touch', `TOUCHED ${point.label}`);

    if (likes <= 0) {
      // 触れなくするのではなく、触れるけど誰も喜ばない（§17）
      this.toast('NOBODY CARES ANYMORE', 1.6);
      this.chat.burst('stale', 2);
    } else if (first) {
      this.footage(`${point.label}  +${likes} Likes`, 2.6);
      this.chat.burst('exploring', 2);
      this.audio.viewerSpike();
    } else {
      this.toast(`+${likes} Likes`, 1.2);
      if (nov.multiplier <= CONFIG.novelty.staleThreshold) this.chat.burst('stale', 1);
    }

    // 調べたことが「後から効いてくる」: 関連する異変を予約する
    this.anomalies.scheduleFromInspect(point.type, first);

    this.logger.event('interaction_reward', this.logRow(), [
      `object=${point.type}`,
      `state=${state}`,
      `count=${point.inspected}`,
      `repeat=${nov.repeat}`,
      `novelty=${nov.multiplier}`,
      `likes=${likes}`,
    ].join(' '));
    if (point.type === 'mirror') {
      // 今回の問題確認用の専用ログ（§32）
      this.logger.event('mirror_interacted', this.logRow(), [
        `mirror_interaction_count=${point.inspected}`,
        `mirror_state=${state}`,
        `mirror_likes_awarded=${likes}`,
      ].join(' '));
    }
    this.logEvent('point_inspected', point.type);
  }

  /** 今撮っている状態を何回目に見ているか（ログ・デバッグ用） */
  private repeatCountOfCurrent() {
    const key = this.stream.breakdown.stateKey;
    if (!key) return 0;
    const [subject, state] = key.split('|');
    const table = CONFIG.novelty.tables[subject] ?? CONFIG.novelty.table;
    const mult = this.novelty.peek(subject, state ?? '');
    const i = table.indexOf(mult);
    return i < 0 ? table.length : i;
  }

  /** 配信目標を達成したあとは、安全な発見の価値をわずかに下げる（§26） */
  private goalMult() {
    return this.goalReached ? CONFIG.streamGoal.afterGoalDiscoveryMult : 1;
  }

  /**
   * HEY（呼びかけ）。
   * 「危険を+25するボタン」ではなく、
   *   情報（姿が見えないときは位置が分かる）
   *   誘導（声のした方へ寄ってくる）
   *   撮れ高（こちらを見てくれる）
   * と引き換えに、自分の位置を知らせる行為。
   */
  private shout() {
    if (!this.hey.ready) return;
    const result = this.hey.use({
      distance: this.distance,
      monsterVisible: this.framing.visible,
      monsterKnown: this.monster.discovered,
      monsterState: this.monster.state,
      haunting: this.haunting.level,
      selfie: this.player.selfie,
      lightsOff: !this.lightOn,
    });

    this.heyUsedNow = true;
    this.sinceHey = 0;
    // 安全な絵が枯れたあとに自分から危険を作った、と数える（Risk Reignite Rate）
    this.novelty.markRiskReignite();
    this.toast('"HEY!"', 1.2);
    this.audio.provoke();
    if (this.monster.chasing) {
      this.monster.chaseUrgency = Math.min(
        CONFIG.monster.chaseUrgency.max,
        this.monster.chaseUrgency + CONFIG.monster.chaseUrgency.hey,
      );
    }
    this.stream.addLikes(result.likes);
    this.stream.spikeViewers(result.viewerSpike);
    this.stream.addBoost(0.8, 8);
    this.haunting.add(CONFIG.hey.hauntingPerUse);
    this.monster.addDanger(result.danger);
    this.chat.burst(this.framing.visible ? 'provoke' : 'anomaly', 2);
    this.director.markEvent('monster_appear');

    const dangerBefore = this.monster.danger - result.danger;
    this.logger.event('hey_used', this.logRow(), [
      `streak=${result.streak}`,
      `response=${result.response}`,
      `dist=${this.distance.toFixed(1)}`,
      `onScreen=${this.framing.visible ? 1 : 0}`,
      `selfie=${this.player.selfie ? 1 : 0}`,
      `haunting=${this.haunting.level.toFixed(0)}`,
      `dangerBefore=${dangerBefore.toFixed(0)}`,
      `dangerAfter=${this.monster.danger.toFixed(0)}`,
    ].join(' '));

    // ONE LAST CALL だけは「呼んだのに何も起きない」で終わらせない（§24 / §26）
    const lastCall = this.requests.active?.kind === 'one_last_call'
      || this.requests.active?.kind === 'one_last_call2';
    if (lastCall) {
      const d = CONFIG.request.lastCallPayoff.delay;
      this.lastCallPayoff = randRange(d.min, d.max);
    }

    if (result.response === 'delayed') {
      this.chat.push('did it hear you?', true);
      this.hint('...', 1.5);
      return;
    }
    this.applyHeyResponse(result.response);
  }

  /** HEYへの怪異の反応を適用する */
  private applyHeyResponse(response: HeyResponse) {
    // 「呼んだ結果どうなったか」を見せてから次の誘惑を出す
    this.requests.notifyConsequence(`hey_${response}`);
    const p = this.player.position;
    this.monster.hearShout(p.x, p.z, response !== 'relocate');

    switch (response) {
      case 'silence':
        this.chat.push('nothing?', false);
        break;
      case 'reveal': {
        // 姿は見えないが、音で方向が分かる（HEYの情報としての価値）
        this.audio.knock(this.distance);
        this.hint(`SOMETHING ANSWERED — ${this.directionTo(this.monster.position)}`, 2.6);
        this.chat.burst('anomaly', 2);
        break;
      }
      case 'look':
        this.chat.burst('danger', 2);
        this.stream.addBoost(1.0, 6);
        this.hint('IT LOOKED AT YOU', 1.8);
        break;
      case 'step':
        this.monster.forceBehavior('approaching', 2.2);
        break;
      case 'approach':
        this.monster.forceBehavior('approaching', 6);
        this.chat.burst('danger', 2);
        break;
      case 'relocate':
        this.monster.forceBehavior('relocating', 5);
        this.audio.whisper(this.distance);
        break;
      case 'stalk':
        this.monster.forceBehavior('stalking', 12);
        this.hint('IT IS FOLLOWING YOU NOW', 2.4);
        this.chat.burst('danger', 3);
        break;
      case 'lunge':
        this.monster.forceBehavior('lunging', 3);
        break;
      case 'rush':
        this.monster.forceBehavior('chasing', 10);
        this.audio.monsterRoar();
        this.chat.burst('chase', 3);
        this.hint('IT IS COMING', 2.4);
        break;
      case 'delayed':
        break;
    }
  }

  /**
   * ONE GHOST MODE の「静かすぎるとき」の一手（§32/§34）。
   * 環境怪異を増やすのではなく、主役である怪異自身を動かす。
   */
  private ghostBeat() {
    if (Math.random() < CONFIG.oneGhost.beat.lightChance) {
      this.level.flickerLamp(this.player.position.x, this.player.position.z, 2.2);
      this.audio.knock(6);
      this.chat.burst('anomaly', 2);
      return;
    }
    if (this.framing.visible) {
      // 見えているなら、こちらへ一歩踏み出す
      this.monster.forceBehavior('approaching', 3.5);
      this.chat.burst('danger', 2);
      return;
    }
    if (this.distance > 26) {
      // 遠すぎて忘れられている。近くへ回り込む
      this.monster.forceBehavior('relocating', 6);
      this.audio.knock(this.distance);
      this.hint(`SOMETHING MOVED — ${this.directionTo(this.monster.position)}`, 2.4);
      return;
    }
    // 近くにいるのに見えていない。物陰から半身を出す
    this.monster.forceBehavior('peeking', CONFIG.monster.peekDuration);
    this.audio.whisper(this.distance);
    this.chat.burst('anomaly', 2);
  }

  /**
   * ONE LAST CALL のペイオフ（§23〜§27）。
   *
   * 通常のHEYは「沈黙」で終わってよいが、ラン最後の大きな誘惑がそれでは弱い。
   * 呼んだ結果として、必ず何かが起こるようにする。
   * 幽霊を画面に出す必要はない。**背後で一歩だけ足音がすれば十分**。
   */
  private fireLastCallPayoff() {
    const p = this.player.position;
    const behind = { x: p.x - this.player.forward.x * 4, z: p.z - this.player.forward.z * 4 };
    const roll = Math.random();
    if (roll < 0.3) {
      // 背後で一歩
      this.audio.footstep(false);
      this.hint('A STEP. RIGHT BEHIND YOU.', 3);
      this.monster.hearShout(behind.x, behind.z, false);
      this.monster.forceBehavior('stalking', 10);
    } else if (roll < 0.55) {
      // 遠くで物音
      this.audio.doorSlam(14);
      this.hint(`SOMETHING ANSWERED — ${this.directionTo(this.monster.position)}`, 3);
      this.monster.forceBehavior('approaching', 6);
    } else if (roll < 0.75) {
      // ライトが落ちる
      this.level.flickerLamp(p.x, p.z, 2.6);
      this.audio.whisper(6);
      this.hint('THE LIGHT WENT OUT', 2.6);
      this.monster.forceBehavior('relocating', 6);
    } else if (roll < 0.92) {
      // 背後へ回り込む
      this.monster.position.set(behind.x, 0, behind.z);
      this.monster.group.position.copy(this.monster.position);
      this.audio.whisper(3);
      this.hint('IT IS NOT WHERE IT WAS', 3);
      this.monster.forceBehavior('watching', 6);
    } else {
      // 突進フェイント。追跡確定にはしない
      this.monster.forceBehavior('lunging', 3);
    }
    this.stream.addBoost(1.6, 10);
    this.stream.spikeViewers(1.35);
    this.chat.burst('anomaly', 4);
    this.audio.viewerSpike();
    this.director.markEvent('monster_appear');
    this.requests.notifyConsequence('one_last_call_payoff');
    this.logEvent('one_last_call_payoff', roll.toFixed(2));
  }

  /** プレイヤーの向きを基準にした方向表現（座標版） */
  private directionToPoint(p: { x: number; z: number }) {
    return this.directionOf(p.x - this.player.position.x, p.z - this.player.position.z);
  }

  /** プレイヤーの向きを基準にした方向表現 */
  private directionTo(target: THREE.Vector3) {
    return this.directionOf(
      target.x - this.player.position.x,
      target.z - this.player.position.z,
    );
  }

  private directionOf(dx: number, dz: number) {
    const f = this.player.forward;
    const dot = (dx * f.x + dz * f.z) / (Math.hypot(dx, dz) || 1);
    const cross = f.x * dz - f.z * dx;
    if (dot > 0.6) return 'AHEAD';
    if (dot < -0.6) return 'BEHIND YOU';
    return cross > 0 ? 'TO YOUR LEFT' : 'TO YOUR RIGHT';
  }

  private leaveSite() {
    const active = this.requests.active;
    if (active?.kind === 'one_last_call' && !active.engaged) {
      // 断って帰った。これは正しい判断であり、ペナルティは無い（§28）
      this.logEvent('one_last_call_declined_by_exit', `reward=${active.reward}`);
    }
    if (this.ghost) this.logEvent('player_exited');
    this.logEvent('player_left_site');
    this.chat.burst('leaving', 4);
    this.audio.escape();
    this.endRun(true);
  }

  /**
   * リクエストに紐づく一時効果を解除する。
   * ライトはここでは触らない。消したままにするかどうかはプレイヤーの判断。
   */
  private clearRequestEffects() {
    this.journeyEvents = [];
  }

  private toast(text: string, duration: number) {
    this.toastTimer = duration;
    store.setNow({ toast: text });
  }

  private footage(text: string, duration: number) {
    this.footageTimer = duration;
    store.setNow({ footage: text });
  }

  private hint(text: string, duration: number) {
    this.hintTimer = duration;
    store.setNow({ hint: text });
  }

  // --- ループ ---

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum > 0.5) {
      store.set({ fps: Math.round(this.fpsFrames / this.fpsAccum) });
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    // ポインタロックが外れてもシミュレーションは止めない。
    // 配信は勝手に止まらない、という理屈でもあり、alt-tabで中断されないようにするためでもある。
    if (this.phase === 'playing') this.updatePlaying(dt);
    else if (this.phase === 'dying') this.updateDying(dt);

    this.time += dt;
    this.level.update(dt, this.time, this.player.position.x, this.player.position.z);
    this.renderer.render(this.scene, this.camera);
    store.flush();
  };

  private updatePlaying(dt: number) {
    this.elapsed += dt;
    this.provokeCooldown = Math.max(0, this.provokeCooldown - dt);
    this.inspectCooldown = Math.max(0, this.inspectCooldown - dt);
    this.lookBackCooldown = Math.max(0, this.lookBackCooldown - dt);

    this.player.update(dt, this.input, this.level.grid, this.camera);
    // Selfie中はライトが自分の顔を焼くので落とす
    this.flashlight.intensity = !this.lightOn
      ? 0
      : CONFIG.render.flashlightIntensity *
        (this.player.selfie ? CONFIG.render.selfieLightScale : 1);

    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = CONFIG.monster.repathInterval;
      this.level.grid.computeFlow(this.player.position.x, this.player.position.z);
    }

    // --- 人型怪異 ---
    this.distance = this.monster.update(dt, this.time, {
      playerPos: this.player.position,
      grid: this.level.grid,
      visibleToPlayer: this.framing.visible,
      centerScore: this.framing.center,
      activity: this.haunting.monsterActivity,
      playerSafe:
        this.ghost && this.distanceToEntrance() <= CONFIG.oneGhost.chase.entranceSafe,
    });
    this.framing = this.monster.hidden
      ? INVISIBLE
      : this.frameOf(this.monster.headWorld, this.monster.chestWorld);

    // --- 異変（FLOOR 1 は専用システムが世界を動かす） ---
    if (!this.floor1) this.anomalies.update(dt, {
      playerPos: this.player.position,
      playerYaw: this.player.yaw,
      grid: this.level.grid,
      haunting: this.haunting.level,
      isVisible: (x, z, h) => this.isVisible(x, z, h),
    });
    if (this.anomalies.phoneRinging && !this.phoneWasRinging) {
      this.director.markDecision('phone');
    }
    this.phoneWasRinging = this.anomalies.phoneRinging;
    if (this.anomalies.phoneRinging) {
      this.phoneRingTimer -= dt;
      if (this.phoneRingTimer <= 0) {
        this.phoneRingTimer = 3.2;
        const p = this.nearestPoint('phone');
        if (p) this.audio.phoneRing(this.pointDistance(p));
      }
    }

    // 抱えている人形はプレイヤーについてくる（撮影対象としても動く）
    if (this.carryingDoll) {
      const doll = this.nearestPoint('doll');
      if (doll) {
        const f = this.player.forward;
        doll.x = this.player.position.x + f.x * 0.55;
        doll.z = this.player.position.z + f.z * 0.55;
        doll.object.position.set(doll.x, 0.75, doll.z);
        doll.object.rotation.y = this.player.yaw;
        this.haunting.add(CONFIG.haunting.carryDollPerSec * dt);
      }
    }

    // HEYの遅延反応（呼んでも今は返事がなく、数秒後に返ってくる）
    const delayed = this.hey.update(dt);
    if (delayed) {
      this.applyHeyResponse(delayed);
      this.director.markEvent('monster_appear');
      this.logEvent('hey_response_delayed', delayed);
    }

    this.updateDiscovery(dt);
    this.updateDanger(dt);
    this.haunting.update(dt, this.distance);
    this.maxHaunting = Math.max(this.maxHaunting, this.haunting.level);

    // --- Selfie 判定 ---
    const selfieMonsterInFrame = this.player.selfie && this.framing.visible;
    const f = this.player.forward;
    const toMonsterX = this.monster.position.x - this.player.position.x;
    const toMonsterZ = this.monster.position.z - this.player.position.z;
    const dot = (toMonsterX * f.x + toMonsterZ * f.z) / (this.distance || 1);
    const selfieMonsterBehind = selfieMonsterInFrame && dot < -0.2;
    if (selfieMonsterInFrame && this.distance < 16) {
      this.haunting.add(CONFIG.haunting.selfieWithMonster * dt * 0.3);
    }

    // --- Risk（プレイヤーが自分で選んだ状況の重ね合わせ。Danger単独では決めない） ---
    this.sinceHey += dt;
    this.risk = riskMultiplier({
      monsterVisible: this.framing.visible,
      monsterDistance: this.distance,
      monsterState: this.monster.state,
      monsterBehavior: this.monster.behavior,
      selfieWithMonster: selfieMonsterInFrame,
      lightsOff: !this.lightOn,
      sinceHey: this.sinceHey,
      chasing: this.monster.chasing,
      backTurnedNear: !this.framing.visible && this.distance < 10 && this.monster.discovered,
    });

    // --- 配信の数値 ---
    this.stream.update(dt, {
      candidates: this.buildCandidates(dt),
      risk: this.risk,
      chasing: this.monster.chasing,
      selfieActive: this.player.selfie,
      selfieMonsterInFrame,
      selfieMonsterDistance: this.distance,
    });

    // Selfieに調査地点が写り込んだら最上位ティア
    if (this.player.selfie && !this.ghost) {
      for (const p of this.level.inspectPoints) {
        if (p.tiers.selfie) continue;
        if (
          this.pointDistance(p) < CONFIG.inspect.selfieRange &&
          this.isVisible(p.x, p.z, p.height)
        ) {
          this.awardTier(p, 'selfie', `SELFIE WITH ${p.label}`);
        }
      }
      if (selfieMonsterInFrame && this.distance < 16) {
        this.director.markEvent('selfie_bonus');
      }
    }
    if (this.ghost && this.player.selfie && selfieMonsterInFrame && this.distance < 16) {
      this.director.markEvent('selfie_bonus');
    }

    // 怪異が久しぶりに画面に入ったら「意味のあるイベント」
    // （見え隠れするたびに数えるとテンポ指標が水増しされるので間隔を空ける）
    this.monsterAppearCooldown = Math.max(0, this.monsterAppearCooldown - dt);
    if (this.framing.visible && !this.wasVisible && this.monsterAppearCooldown <= 0) {
      this.monsterAppearCooldown = 15;
      this.director.markEvent('monster_appear');
    }

    // --- 逃走中の振り返り撮影 ---
    if (this.monster.chasing) {
      // 撮るほど、自撮りするほど、呼ぶほど追いつかれる（撤退戦の中のチキンレース）
      const u = CONFIG.monster.chaseUrgency;
      if (this.framing.visible) {
        this.monster.chaseUrgency = Math.min(
          u.max,
          this.monster.chaseUrgency + (this.player.selfie ? u.selfie : u.film) * dt,
        );
      }
      if (this.framing.visible && !this.wasVisible && this.lookBackCooldown === 0) {
        this.lookBackCooldown = 2;
        // 追われながら振り返って撮った回数（Chase Greed Rate）
        if (!this.chaseGreedCounted) {
          this.chaseGreedCounted = true;
          this.ghostStats.markChaseGreed();
        }
        this.chat.burst('filming_back', 2);
        this.stream.spikeViewers(1.08);
        this.audio.viewerSpike();
        if (this.lookBackLogged < 20) {
          this.lookBackLogged += 1;
          this.logEvent('player_looked_back_during_chase');
        }
      }
    }
    this.wasVisible = this.framing.visible;

    // --- 帰宅判定と誘惑 ---
    this.updateLeaving(dt);

    // --- テンポ管理 ---
    this.director.update(dt);
    if (this.reactionTimer > 0) {
      this.reactionTimer -= dt;
      if (this.reactionTimer <= 0) this.fireReactionRequest(selfieMonsterInFrame, selfieMonsterBehind);
    }
    // 目的地系リクエストの道中に仕込んだ異変
    for (let i = this.journeyEvents.length - 1; i >= 0; i--) {
      this.journeyEvents[i] -= dt;
      if (this.journeyEvents[i] > 0) continue;
      this.journeyEvents.splice(i, 1);
      this.anomalies.forceSpawn({
        playerPos: this.player.position,
        playerYaw: this.player.yaw,
        grid: this.level.grid,
        haunting: this.haunting.level,
        isVisible: (x, z, h) => this.isVisible(x, z, h),
      });
    }

    // 何も起きない時間が続いたら、ディレクターが強制的に異変を起こす
    // 何も新しいことが起きておらず、視聴者も冷めているなら、22秒を待たずに世界を動かす（§21）
    const bored =
      !this.ghost &&
      this.stream.breakdown.final > 0 &&
      this.stream.breakdown.novelty <= CONFIG.novelty.staleThreshold &&
      this.director.sinceEvent > CONFIG.tempo.quietLimit * 0.55;
    if ((this.director.needsEvent || bored) && !this.monster.chasing) {
      this.director.consumeForce();
      if (this.ghost) {
        this.ghostBeat();
        this.director.markEvent('forced');
        this.logEvent('director_forced_event');
      } else {
      const fired = this.anomalies.forceSpawn({
        playerPos: this.player.position,
        playerYaw: this.player.yaw,
        grid: this.level.grid,
        haunting: this.haunting.level,
        isVisible: (x, z, h) => this.isVisible(x, z, h),
      });
      if (fired) {
        this.director.markEvent('forced');
        this.logEvent('director_forced_event');
      }
      }
    }

    // --- Dismiss（Xを押しっぱなしで、明確に降りる）---
    if (this.floor1) {
      if (this.f1?.active && this.input.down('KeyX')) {
        this.dismissHold += dt;
        if (this.dismissHold >= CONFIG.request.dismiss.holdTime) {
          this.dismissHold = 0;
          this.f1.dismiss();
          this.toast('DISMISSED', 1.4);
          store.setNow({ request: null });
        }
      } else {
        this.dismissHold = 0;
      }
    }
    const req = this.floor1 ? null : this.requests.active;
    if (req && this.input.down('KeyX')) {
      this.dismissHold += dt;
      if (this.dismissHold >= CONFIG.request.dismiss.holdTime) {
        this.dismissHold = 0;
        this.requests.dismiss(this.elapsed - this.requestOfferedAt);
      }
    } else {
      this.dismissHold = 0;
    }

    // --- ONE LAST CALL のペイオフ（必ず何かが起きる）---
    if (this.lastCallPayoff > 0) {
      this.lastCallPayoff -= dt;
      if (this.lastCallPayoff <= 0) this.fireLastCallPayoff();
    }

    // --- HS FLOOR 1 MODE ---
    if (this.floor1 && this.f1) {
      const p = this.player.position;
      const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) > 0.06;
      let turned = this.player.yaw - this.turnAnchor;
      while (turned > Math.PI) turned -= Math.PI * 2;
      while (turned < -Math.PI) turned += Math.PI * 2;
      this.f1.update(dt, { holdingE: this.input.down('KeyE'), moved, turned });
      this.lastPos = { x: p.x, z: p.z };
      // TURN AROUND 系の基準は、リクエストが出た瞬間に取り直す
      if (!this.f1.active) this.turnAnchor = this.player.yaw;
      store.set({ request: this.f1.view() });
    }

    // --- Novelty のKPIと「もう飽きられている」コメント ---
    this.novelty.update(dt);
    const subjKey = this.stream.breakdown.stateKey.split('|')[0];
    if (subjKey) this.novelty.markSwitchedSubject(subjKey);
    this.novelty.recordLikes(this.stream.lastGain, this.risk, this.stream.breakdown.novelty);
    this.staleChatCooldown = Math.max(0, this.staleChatCooldown - dt);
    if (
      !this.ghost &&
      this.staleChatCooldown <= 0 &&
      this.stream.breakdown.final > 0 &&
      this.stream.breakdown.novelty <= CONFIG.novelty.staleThreshold
    ) {
      // 「この映像もうウケてない」が分かれば十分なので、出しすぎない（§9）
      this.staleChatCooldown = 14;
      this.chat.burst('stale', 1);
    }
    if (this.floor1) this.goalReached = this.f1?.goal ?? false;
    if (!this.floor1 && !this.goalReached && this.stream.earnings >= CONFIG.streamGoal.target) {
      this.goalReached = true;
      this.stream.addBoost(1.0, 8);
      this.chat.burst('escape', 3);
      this.footage(`STREAM GOAL REACHED — ¥${formatNumber(CONFIG.streamGoal.target)}`, 3.4);
      this.audio.cash();
      this.director.markEvent('discovery');
      this.logEvent('stream_goal_reached', String(Math.floor(this.stream.earnings)));
    }

    // ONE GHOST MODE のKPI（接近・後退・帰れる状態の見送り）
    if (this.ghost) {
      this.ghostStats.update({
        monsterKnown: this.monster.discovered,
        distance: this.distance,
        distanceToEntrance: this.distanceToEntrance(),
        atEntrance: this.distanceToEntrance() <= CONFIG.entrance.range,
      });
    }

    if (!this.floor1) {
      this.requests.update(dt, this.buildRequestContext(selfieMonsterInFrame, selfieMonsterBehind));
    }

    this.chat.update(dt, this.chatCategory(), this.stream.viewers, this.stream.engagement);
    this.audio.update(dt, this.monster.danger, this.distance, clamp01(this.monster.stateRank() / 4));

    if (this.monster.chasing && this.distance <= CONFIG.monster.killDistance) this.die();

    this.provokedNow = this.heyUsedNow;
    this.heyUsedNow = false;
    this.inspectedNow = null;
    this.answeredPhoneNow = false;
    this.publish(dt);
  }

  // --- 撮影対象 ---

  private frameOf(...points: THREE.Vector3[]): Framing {
    const target = points[0];
    const dx = target.x - this.camera.position.x;
    const dz = target.z - this.camera.position.z;
    if (Math.hypot(dx, dz) > CONFIG.render.maxFilmDistance) return INVISIBLE;
    return computeFraming(
      this.camera,
      points.map((p) => p.clone()),
      this.camera.position,
      target,
      this.level.grid,
    );
  }

  private _probe = new THREE.Vector3();
  private isVisible(x: number, z: number, height: number) {
    this._probe.set(x, height, z);
    return this.frameOf(this._probe).visible;
  }

  /**
   * 対象の「状態」を文字列にする。これが変われば別の映像として扱う（§3 / §23）。
   * 同じ絵を擦っても価値が戻らないのは、この文字列が変わらないため。
   */
  private monsterStateKey() {
    const [near, mid] = CONFIG.novelty.distanceBands;
    const band = this.distance < near ? 'near' : this.distance < mid ? 'mid' : 'far';
    const b = this.monster.behavior;
    const move =
      b === 'chasing' ? 'chase'
      : b === 'lunging' ? 'lunge'
      : b === 'peeking' ? 'peek'
      : b === 'vanished' ? 'gone'
      : b === 'idle' || b === 'watching' ? 'still'
      : 'moving';
    const look = this.monster.looksAt(this.player.position) ? 'L' : '-';
    const selfie = this.player.selfie ? 'S' : '-';
    return `${this.monster.state}.${move}.${band}.${look}${selfie}`;
  }

  private pointStateKey(p: InspectPoint) {
    // 関連する異変が起きているか（鏡に何かが映っている等）だけで状態が決まる。
    //
    // Haunting Phase も復活条件の候補だが、これを混ぜると
    // 1つの鏡が「normal/anomaly × フェーズ数」ぶんの状態を持ってしまい、
    // 立っているだけで満額の撮れ高が何度も湧く。§8 の例どおり
    // 「普通の鏡」と「何かが映っている鏡」の2状態だけにする。
    const active = this.anomalies.active.some((a) => a.pointType === p.type);
    return active ? 'anomaly' : 'normal';
  }

  /**
   * 撮影トラッキング。
   *   状態が変わった              → 新しい映像。Novelty満額から
   *   同じ状態を撮り続けている     → hold 減衰
   *   一度外して同じ状態を撮り直す → 次のexposure（倍率が一段下がる）
   * **画面から外して時間を置いても回復しない**（§6）。
   */
  private trackFilm(subject: string, state: string, visible: boolean, dt: number): FilmTrack {
    const cfg = CONFIG.novelty;
    let t = this.filmTracks.get(subject);
    if (!t) {
      t = { stateKey: '', hold: 0, novelty: 1, awarded: false, unseen: 999 };
      this.filmTracks.set(subject, t);
    }
    if (!visible) {
      t.unseen += dt;
      return t;
    }
    const key = `${subject}|${state}`;
    if (t.stateKey !== key) {
      // 状態が変わった＝新しい展開
      t.stateKey = key;
      t.hold = 0;
      t.awarded = false;
      t.novelty = this.novelty.peek(subject, state);
      this.novelty.setState(subject, state);
    } else if (t.awarded && t.unseen > cfg.regrace) {
      // 同じ状態をもう一度撮り直した
      t.hold = 0;
      t.awarded = false;
      t.novelty = this.novelty.peek(subject, state);
    }
    t.unseen = 0;
    t.hold += dt;
    if (!t.awarded && t.hold >= cfg.minExposure) {
      t.awarded = true;
      const nov = this.novelty.consume(subject, state);
      this.logger.event('footage_rewarded', this.logRow(), [
        `subject=${subject}`,
        `state_key=${nov.key}`,
        `repeat_count=${nov.repeat}`,
        `novelty=${nov.multiplier}`,
        `risk=${this.risk.toFixed(2)}`,
        `base=${this.stream.breakdown.base.toFixed(1)}`,
        `final=${this.stream.breakdown.final.toFixed(1)}`,
      ].join(' '));
    }
    return t;
  }

  /** 今フレームの撮影候補を作る */
  private buildCandidates(dt: number): FilmCandidate[] {
    const clip = CONFIG.stream.clip;
    const out: FilmCandidate[] = [];

    if (!this.monster.hidden) {
      const state = this.monsterStateKey();
      const t = this.trackFilm('monster', state, this.framing.visible, dt);
      out.push({
        key: 'monster',
        label: 'IT',
        framing: this.framing,
        base: clip.monsterBase * (this.ghost ? CONFIG.oneGhost.monsterClipMult : 1),
        stateKey: t.stateKey,
        novelty: t.novelty,
        hold: this.holdOf(t),
        isMonster: true,
        monsterState: this.monster.state,
        monsterMoving: this.monster.isMoving,
        monsterLooking: this.monster.looksAt(this.player.position),
      });
    }

    for (const a of this.anomalies.active) {
      this._probe.set(a.x, a.height, a.z);
      const framing = this.frameOf(this._probe);
      const t = this.trackFilm(`anomaly:${a.type}`, 'active', framing.visible, dt);
      out.push({
        key: `anomaly:${a.id}`,
        label: a.label,
        framing,
        base: a.value,
        stateKey: t.stateKey,
        novelty: t.novelty,
        hold: this.holdOf(t),
        isMonster: false,
      });
    }

    // ONE GHOST MODE では調査地点は「ただの背景」。怪異だけが被写体になる（§32）
    if (this.ghost) return out;

    // HS FLOOR 1 は独自のオブジェクトを被写体にする
    if (this.floor1) {
      for (const spec of FLOOR1_OBJECTS) {
        const st = this.f1?.objects.get(spec.id);
        if (!st || !st.discovered) continue;
        this._probe.set(spec.x, spec.height, spec.z);
        const framing = this.frameOf(this._probe);
        const t = this.trackFilm(spec.id, st.state, framing.visible, dt);
        out.push({
          key: `f1:${spec.id}`,
          label: spec.label,
          framing,
          base: spec.filmValue,
          stateKey: t.stateKey,
          novelty: t.novelty,
          hold: this.holdOf(t),
          isMonster: false,
        });
      }
      return out;
    }

    for (const p of this.level.inspectPoints) {
      this._probe.set(p.x, p.height, p.z);
      const framing = this.frameOf(this._probe);
      if (framing.visible) p.filmedTotal += dt;
      const t = this.trackFilm(p.type, this.pointStateKey(p), framing.visible, dt);
      out.push({
        key: `point:${p.type}`,
        label: p.label,
        framing,
        base: POINT_BASE_VALUE,
        stateKey: t.stateKey,
        novelty: t.novelty,
        hold: this.holdOf(t),
        isMonster: false,
      });
    }

    return out;
  }

  /**
   * 連続撮影の減衰。
   * ONE GHOST MODE は被写体が一体しかなく、枯らすとモードが成立しないので適用しない
   * （Novelty と足並みを揃える）。
   */
  private holdOf(t: FilmTrack) {
    return this.novelty.enabled ? holdMultiplier(t.hold) : 1;
  }

  private updateDiscovery(_dt: number) {
    // 人型怪異
    const discoverRange = this.ghost ? CONFIG.oneGhost.discoverDistance : 30;
    if (!this.monster.discovered && this.framing.visible && this.framing.distance < discoverRange) {
      this.monster.discovered = true;
      const ghost = this.ghost;
      this.stream.spikeViewers(
        ghost ? CONFIG.oneGhost.discoverySpike : CONFIG.stream.discoverySpike,
      );
      this.stream.addBoost(1.0, 10);
      this.audio.viewerSpike();
      this.chat.burst('discovered', 4);
      this.haunting.add(CONFIG.haunting.firstDiscovery);
      this.director.markEvent('discovery');
      if (ghost) {
        // 見つけた瞬間に「これは撮れ高になる」と分かるようにする（§5）
        const bonus = CONFIG.oneGhost.discoveryBonus;
        this.stream.addEarnings(bonus);
        this.audio.cash();
        this.footage(`SOMETHING IS IN HERE WITH YOU  +¥${formatNumber(bonus)}`, 3.4);
      } else {
        this.footage('SOMETHING IS IN HERE WITH YOU', 3);
      }
      this.logEvent('monster_discovered');
    }
    if (this.ghost) return;
    // 調査地点（近くで見えたら「見つけた」扱い）
    for (const p of this.level.inspectPoints) {
      if (p.discovered) continue;
      if (this.pointDistance(p) < 10 && this.isVisible(p.x, p.z, p.height)) {
        p.discovered = true;
        this.awardTier(p, 'see', `FOUND ${p.label}`);
        this.logEvent('anomaly_discovered', p.type);
      }
    }
  }

  private updateDanger(dt: number) {
    // 短時間追跡・掴まれた直後は、怪異の側から近づいている状態なので
    // 距離によるDanger上昇を止める（勝手に本追跡へ昇格して死ぬのを防ぐ）
    const monsterIsClosing = this.monster.inShortChase || this.monster.stunned > 0;
    const gain = dangerGainPerSecond({
      framing: this.framing,
      distance: monsterIsClosing ? 99 : this.distance,
      selfieWithMonster: this.player.selfie && this.framing.visible && this.distance < 14,
      oneGhost: this.ghost,
    });
    if (this.ghost) {
      // 常に一定量を引く。遠くから撮っている限りDangerは上がらない
      this.noDangerTime = gain > 0 ? 0 : this.noDangerTime + dt;
      const decay = this.monster.chasing ? 0 : CONFIG.oneGhost.dangerDecayPerSec;
      this.monster.addDanger((gain - decay) * dt);
      return;
    }
    if (gain > 0) {
      this.noDangerTime = 0;
      this.monster.addDanger(gain * dt);
    } else {
      this.noDangerTime += dt;
      if (this.noDangerTime > CONFIG.danger.decayDelay && !this.monster.chasing) {
        this.monster.addDanger(-CONFIG.danger.decayPerSec * dt);
      }
    }
  }

  // --- 帰宅判定 ---

  private distanceToEntrance() {
    return Math.hypot(
      this.player.position.x - CONFIG.entrance.x,
      this.player.position.z - CONFIG.entrance.z,
    );
  }

  private updateLeaving(dt: number) {
    const d = this.distanceToEntrance();
    const cfg = this.ghost ? CONFIG.oneGhost.leaving : CONFIG.leaving;

    // 「もう撮るものがない」判定。
    // 調査地点は常に低価値の被写体として存在するので、
    // 怪異や異変が映っていない限りは撮れ高なしとみなす。
    const interesting =
      this.framing.visible ||
      this.anomalies.active.some((a) => this.isVisible(a.x, a.z, a.height));
    if (!interesting) this.lowClipTime += dt;
    else this.lowClipTime = 0;

    if (d < this.lastEntranceDistance - 0.01) this.approachTime += dt;
    else if (d > this.lastEntranceDistance + 0.05) this.approachTime = 0;
    this.lastEntranceDistance = d;

    const earned = this.stream.earnings > cfg.minEarnings;
    const leaving =
      !this.monster.chasing &&
      earned &&
      // 入口のすぐ手前まで来たら、撮れ高に関係なく「帰ろうとしている」
      ((d <= cfg.nearEntranceDistance && this.approachTime > 0.8) ||
        (d < cfg.entranceDistance &&
          this.lowClipTime > cfg.lowClipDuration &&
          this.approachTime > cfg.approachDuration));

    if (leaving && !this.wasLeaving) {
      this.director.markDecision('cashout');
      this.logEvent('player_likely_leaving');
    }
    this.wasLeaving = leaving;
    this.leaving = leaving;

    // 誘惑を受けたあと、入口から離れ始めたら「引き返した」
    if (this.temptation && !this.temptation.turnedBack) {
      if (d > this.temptation.distance + 6) {
        this.temptation.turnedBack = true;
        this.turnBacks += 1;
        this.logEvent(
          'player_turned_back',
          `${(this.elapsed - this.temptation.time).toFixed(1)}s`,
        );
      }
    }
  }

  private buildRequestContext(selfieMonsterInFrame: boolean, selfieMonsterBehind: boolean) {
    const discoveredPoints = new Set<InspectType>(
      this.level.inspectPoints.filter((p) => p.discovered).map((p) => p.type),
    );
    return {
      monsterKnown: this.monster.discovered,
      monsterVisible: this.framing.visible,
      monsterCenter: this.framing.center,
      monsterDistance: this.distance,
      discoveredPoints,
      pointDistance: (type: InspectType) => {
        const p = this.nearestPoint(type);
        return p ? this.pointDistance(p) : 999;
      },
      pointVisible: (type: InspectType) => {
        const p = this.nearestPoint(type);
        return p ? this.isVisible(p.x, p.z, p.height) : false;
      },
      pointLabel: (type: InspectType) => this.nearestPoint(type)?.label ?? 'IT',
      inspectedNow: this.inspectedNow,
      provokedNow: this.provokedNow,
      answeredPhoneNow: this.answeredPhoneNow,
      phoneRinging: this.anomalies.phoneRinging,
      selfieActive: this.player.selfie,
      selfieMonsterInFrame,
      selfieMonsterBehind,
      leaving: this.leaving,
      distanceToEntrance: this.distanceToEntrance(),
      chasing: this.monster.chasing,
      playerX: this.player.position.x,
      playerZ: this.player.position.z,
      playerYaw: this.player.yaw,
      playerMoving: this.player.moving,
      carryingDoll: this.carryingDoll,
      heyUsedNow: this.heyUsedNow,
      heyStreak: this.hey.streak,
      monsterLookingAtPlayer: this.monster.isLookingBecauseCalled,
      lightsOff: !this.lightOn,
      dollDistance: (() => {
        const d = this.nearestPoint('doll');
        return d ? this.pointDistance(d) : 999;
      })(),
      dollVisible: (() => {
        const d = this.nearestPoint('doll');
        return d ? this.isVisible(d.x, d.z, d.height) : false;
      })(),
      goalReached: this.goalReached,
      returningTime: this.approachTime,
    };
  }

  // --- イベントハンドラ ---

  private handleRequestOffer(r: ActiveRequest) {
    this.audio.challengeAlert();
    this.chat.burst(r.temptation ? 'temptation' : 'request', 3);
    // 「行って戻るだけ」を無くす：道中に異変を仕込む
    if (DEFS[r.kind].destination) {
      for (let i = 0; i < CONFIG.request.journeyEvents.count; i++) {
        this.journeyEvents.push(
          randRange(CONFIG.request.journeyEvents.delay.min, CONFIG.request.journeyEvents.delay.max),
        );
      }
    }
    if (r.kind === 'lights_off' || r.kind === 'hey_lights_off') {
      if (this.lightOn) this.hint('[F] KILL YOUR LIGHT', 4);
    }
    if (r.temptation) {
      this.temptation = {
        time: this.elapsed,
        earnings: this.stream.earnings,
        distance: this.distanceToEntrance(),
        reward: r.reward,
        turnedBack: false,
      };
      this.logEvent('temptation_offered', `${r.kind}:${r.reward}`);
      if (this.ghost) this.logEvent('last_temptation_shown', `${r.kind}:${r.reward}`);
    } else {
      this.logEvent('request_offered', `${r.kind}:${r.reward}`);
    }
    store.setNow({ request: this.viewRequest(r) });
  }

  private handleAnomalySpawn = (a: ActiveAnomaly) => {
    this.requests.notifyConsequence(`anomaly_${a.type}`);
    if (a.type === 'light_flicker' || a.type === 'shadow_figure') this.chat.burst('anomaly', 2);
    this.director.markEvent('anomaly');
    this.logEvent('anomaly_spawned', a.type);
  };

  /** 直前に目撃した異変から、視聴者のリクエストを生成する */
  private fireReactionRequest(selfieInFrame: boolean, selfieBehind: boolean) {
    const a = this.reactionFor;
    this.reactionFor = null;
    if (!a) return;
    const ctx = this.buildRequestContext(selfieInFrame, selfieBehind);
    /*
     * 目的地は「そのとき見た異変そのもの」の位置を使う。
     *
     * 以前は anomalies.lastSpot を見ていたが、これは最後に発生した異変で毎回上書きされる。
     * 反応リクエストは目撃から2〜5秒遅れて出るので、その間に別の異変が起きると
     * 「見たものを追いかけているのに、目的地は別の場所」になっていた。
     */
    const spot = { x: a.x, z: a.z };
    switch (a.type) {
      case 'noise':
      case 'door_slam':
        this.requests.offerReaction('check_sound', ctx, {
          targetPos: spot,
          description: `GO WHERE IT CAME FROM — ${this.directionToPoint(spot)}`,
        });
        break;
      case 'shadow_figure':
      case 'light_flicker':
        this.requests.offerReaction('follow_it', ctx, {
          targetPos: spot,
          description: `GO WHERE IT WENT — ${this.directionToPoint(spot)}`,
        });
        break;
      case 'mirror_figure':
        this.requests.offerReaction('look_again', ctx, { target: 'mirror' });
        break;
      case 'doll_moved':
        this.requests.offerReaction('keep_in_frame', ctx, { target: 'doll' });
        break;
      case 'phone_ring':
        this.requests.offerReaction('go_back', ctx, { target: 'phone' });
        break;
    }
  }

  private handleAnomalyDiscovered = (a: ActiveAnomaly) => {
    this.director.markEvent('discovery');
    if (a.pointType) {
      const point = this.nearestPoint(a.pointType);
      if (point) this.awardTier(point, 'anomaly', a.label);
    }
    // 目撃した「その瞬間」に紐づくリクエストを予約する
    this.reactionTimer = randRange(
      CONFIG.request.reactionDelay.min,
      CONFIG.request.reactionDelay.max,
    );
    this.reactionFor = a;
    const nov = this.novelty.consume(`anomaly:${a.type}`, 'discovered');
    const likes = Math.round(CONFIG.anomaly.firstDiscoveryLikes * nov.multiplier * this.goalMult());
    if (likes > 0) this.stream.addLikes(likes);
    this.stream.spikeViewers(1.2);
    this.stream.addBoost(1.2, 10);
    this.haunting.add(CONFIG.haunting.firstDiscovery);
    this.audio.viewerSpike();
    this.chat.burst('anomaly', 3);
    this.footage(`NEW FOOTAGE — ${a.label}  +${likes} Likes`, 3);
    this.logEvent('anomaly_discovered', a.type);
  };

  private handleMonsterState = (next: string, prev: string) => {
    this.logEvent('monster_state_changed', `${prev}->${next}`);
    this.requests.notifyConsequence(`monster_${next}`);
    if (next === 'aware') {
      this.chat.burst('danger', 2);
      this.logEvent('monster_aware');
    } else if (next === 'aggressive') {
      this.chat.burst('danger', 3);
      this.stream.spikeViewers(1.15);
      this.audio.monsterRoar();
      this.hint('IT IS NOT WATCHING ANYMORE', 3);
      this.logEvent('monster_aggressive');
    } else if (next === 'chasing') {
      this.chat.burst('chase', 4);
      this.stream.spikeViewers(1.3);
      this.stream.addBoost(1.2, 15);
      this.audio.monsterRoar();
      this.audio.setChase(true);
      this.hint('RUN BACK TO THE ENTRANCE', 4);
      this.director.markEvent('chase');
      this.chaseCount += 1;
      this.chaseGreedCounted = false;
      this.ghostStats.markChase();
      if (this.ghost) this.hint('RUN. YOU CAN OUTRUN IT.', 4);
      // 「安全に逃げる vs 撮れ高を取る」を最大化する、追跡中だけのリクエスト
      this.requests.offerReaction('film_the_chase', this.buildRequestContext(false, false), {
        reward: this.ghost ? CONFIG.oneGhost.request.chaseReward : undefined,
      });
      this.logEvent('chase_started');
      store.setNow({ chasing: true });
    }
  };

  private chatCategory(): ChatCategory {
    if (this.monster.chasing) return this.framing.visible ? 'filming_back' : 'chase';
    if (this.player.selfie) return 'selfie';
    if (this.requests.active?.temptation) return 'temptation';
    if (this.leaving) return 'leaving';
    if (this.anomalies.active.length) return 'anomaly';
    if (this.monster.discovered && this.framing.visible) {
      return this.distance < 9 ? 'close' : 'discovered';
    }
    if (this.monster.danger >= CONFIG.danger.thresholds.aware) return 'danger';
    return this.stream.viewers > 300 ? 'exploring' : 'idle';
  }

  // --- 調査地点ヘルパ ---

  private pointDistance(p: InspectPoint) {
    return Math.hypot(p.x - this.player.position.x, p.z - this.player.position.z);
  }

  private nearestPoint(type: InspectType): InspectPoint | null {
    return this.level.inspectPoints.find((p) => p.type === type) ?? null;
  }

  private nearestInspectPoint(): InspectPoint | null {
    let best: InspectPoint | null = null;
    let bestDist = CONFIG.inspect.range;
    for (const p of this.level.inspectPoints) {
      const d = this.pointDistance(p);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  /** [E]で何ができるかの表示 */
  private promptText(): string | null {
    if (this.phase !== 'playing') return null;
    if (this.distanceToEntrance() <= CONFIG.entrance.range) {
      return `[E] END STREAM AND LEAVE`;
    }
    if (this.ghost) return null;
    if (this.floor1) return this.f1?.prompt() ?? null;
    const phone = this.nearestPoint('phone');
    if (this.anomalies.phoneRinging && phone && this.pointDistance(phone) <= CONFIG.inspect.range) {
      return '[E] ANSWER IT';
    }
    const point = this.nearestInspectPoint();
    if (point) return `[E] INSPECT ${point.label}`;
    return null;
  }

  // --- 死亡と終了 ---

  private die() {
    this.phase = 'dying';
    this.deathTimer = 0;
    this.monster.frozen = true;
    this.logEvent('player_died');
    this.audio.death();
    this.stream.spikeViewers(CONFIG.stream.deathSpike);
    this.stream.setSurge(1);
    this.chat.burst('death', 5);
    store.setNow({ phase: 'dying' });
  }

  private updateDying(dt: number) {
    this.deathTimer += dt;

    const target = this.monster.headWorld;
    const dx = target.x - this.camera.position.x;
    const dz = target.z - this.camera.position.z;
    const wantYaw = Math.atan2(-dx, -dz) + Math.PI;
    let diff = wantYaw - this.player.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.player.yaw += diff * Math.min(1, dt * 4);
    const fall = clamp01(this.deathTimer / DEATH_FREEZE);
    this.camera.position.set(
      this.player.position.x,
      CONFIG.player.eyeHeight * (1 - fall * 0.75),
      this.player.position.z,
    );
    this.camera.rotation.set(this.player.pitch - fall * 0.35, this.player.yaw, fall * 0.8, 'YXZ');

    this.monster.update(dt, this.time, {
      playerPos: this.player.position,
      grid: this.level.grid,
      visibleToPlayer: true,
      centerScore: 1,
      activity: 1,
    });
    this.framing = this.frameOf(this.monster.headWorld, this.monster.chestWorld);
    this.stream.update(dt, {
      candidates: [
        {
          key: 'monster',
          label: 'IT',
          framing: this.framing,
          base: CONFIG.stream.clip.monsterBase,
          stateKey: 'monster|death',
          novelty: 1,
          hold: 1,
          isMonster: true,
          monsterState: 'chasing',
          monsterMoving: false,
          monsterLooking: true,
        },
      ],
      risk: 1,
      chasing: true,
      selfieActive: false,
      selfieMonsterInFrame: false,
      selfieMonsterDistance: this.distance,
    });
    this.chat.update(dt, 'death', this.stream.viewers, this.stream.engagement);

    if (this.deathTimer > DEATH_FREEZE && !store.getSnapshot().connectionLost) {
      store.setNow({ connectionLost: true });
      this.audio.setChase(false);
    }
    if (this.deathTimer > DEATH_LOST) {
      this.endRun(false);
      return;
    }
    this.publish(dt);
  }

  private endRun(survived: boolean) {
    this.phase = 'ended';
    this.logger.tempo = this.director.stats() as unknown as Record<string, number>;
    const heyAgainRate =
      this.hey.total > 0
        ? Math.round(
            (this.logger.rows.filter(
              (r) => r.event === 'hey_used' && r.provocation_streak >= 2,
            ).length /
              this.hey.total) *
              100,
          )
        : 0;
    const ghostKpi = this.ghost ? this.ghostStats.kpi(this.hey.total, heyAgainRate) : null;
    const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
    if (this.floor1 && this.f1) {
      const k = this.f1.kpi();
      this.logger.floor1 = {
        discoveries: k.discoveries,
        requests_offered: k.offered,
        requests_completed: k.completed,
        requests_dismissed: k.dismissed,
        requests_ignored: k.ignored,
        unique_requests: k.uniqueRequests,
        repeated_requests: k.repeatedRequests,
        bath_sip_count: k.bathSips,
        ghost_selfie_count: k.ghostSelfies,
        voluntary_continuations: k.voluntaryContinuations,
        median_altar_hold: k.medianAltarHold,
        altar_reached_tier2: k.altarTier2,
        median_phone_hold: k.medianPhoneHold,
        phone_reached_tier2: k.phoneTier2,
        goal_reached: k.goal ? 1 : 0,
        last_temptation: k.lastTemptation ? 1 : 0,
      };
    }
    this.logger.economy = {
      ...this.novelty.stats(),
      goal_reached: this.goalReached ? 1 : 0,
      voluntary_continuation_rate: rate(
        this.requests.continuationDone,
        this.requests.continuationOffered,
      ),
      high_tier_continuation_rate: rate(this.requests.highTierDone, this.requests.highTierOffered),
      walk_away_rate: rate(this.requests.walkAways, this.requests.offeredCount),
      dismissed: this.requests.dismissedCount,
      dismiss_rate: rate(this.requests.dismissedCount, this.requests.offeredCount),
      full_ladders: this.requests.fullLadders,
      one_last_call_offered: this.requests.lastCallOffered ? 1 : 0,
      one_last_call_taken: this.requests.lastCallTaken ? 1 : 0,
      one_last_call_completed: this.requests.lastCallCompleted ? 1 : 0,
    };
    this.logger.oneGhost = ghostKpi as unknown as Record<string, number> | null;
    this.stream.setSurge(0);
    this.audio.setChase(false);
    document.exitPointerLock?.();

    const gross = Math.floor(this.stream.earnings);
    const lost = survived ? 0 : Math.floor(gross * CONFIG.result.deathPenalty);
    const bonus = survived
      ? Math.floor(gross * CONFIG.result.survivalBonusRate + CONFIG.result.survivalBonusFlat)
      : 0;
    const discoveryTotal = 6 + this.level.inspectPoints.length;

    store.setNow({
      phase: 'ended',
      result: {
        mode: this.mode,
        survived,
        gross,
        lost,
        bonus,
        final: gross - lost + bonus,
        peakViewers: Math.floor(this.stream.peakViewers),
        likes: Math.floor(this.stream.likes),
        maxEngagement: this.stream.maxEngagement,
        maxStars: this.stream.maxStars,
        discoveries: this.discoveryCount(),
        discoveryTotal,
        requestsCompleted: this.requests.completedCount,
        requestsOffered: this.requests.offeredCount,
        temptations: this.requests.temptationCount,
        turnBacks: this.turnBacks,
        duration: this.elapsed,
        chicken: {
          longestChain: this.requests.longestChain,
          continued: this.requests.continuedChains,
          abandoned: this.requests.abandonedChains,
          heyUses: this.hey.total,
          heyAgainRate,
          avgHesitation:
            this.hesitations.length > 0
              ? Math.round(
                  (this.hesitations.reduce((a, b) => a + b, 0) / this.hesitations.length) * 10,
                ) / 10
              : 0,
          lastTemptationTaken: this.requests.turnedBackCount > 0,
          highestHaunting: Math.round(this.maxHaunting),
        },
        oneGhost: ghostKpi,
        floor1: this.floor1 && this.f1 ? this.f1.kpi() : null,
        economy: {
          ...this.novelty.stats(),
          goalReached: this.goalReached,
        },
        director: {
          voluntaryContinuationRate: rate(
            this.requests.continuationDone,
            this.requests.continuationOffered,
          ),
          highTierContinuationRate: rate(this.requests.highTierDone, this.requests.highTierOffered),
          walkAwayRate: rate(this.requests.walkAways, this.requests.offeredCount),
          fullLadders: this.requests.fullLadders,
          hesitationByTier: Array.from({ length: 6 }, (_, i) => {
            const xs = this.requests.hesitationByTier[i];
            return xs && xs.length
              ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
              : 0;
          }),
          dismissed: this.requests.dismissedCount,
          dismissByTier: Array.from({ length: 6 }, (_, i) => this.requests.dismissByTier[i] ?? 0),
          offeredByTier: Array.from({ length: 6 }, (_, i) => this.requests.offeredByTier[i] ?? 0),
          lastCallOffered: this.requests.lastCallOffered,
          lastCallTaken: this.requests.lastCallTaken,
          lastCallCompleted: this.requests.lastCallCompleted,
        },
        tempo: {
          ...this.director.stats(),
          requestsShown: this.requests.offeredCount,
          requestsAccepted: this.requests.engagedCount,
          requestsIgnored: this.requests.ignoredCount,
          chases: this.chaseCount,
        },
      },
    });
  }

  private discoveryCount() {
    if (this.floor1) return this.f1?.discoveries ?? 0;
    return (
      this.anomalies.discovered.size + this.level.inspectPoints.filter((p) => p.discovered).length
    );
  }

  // --- 出力 ---

  private viewRequest(r: ActiveRequest) {
    const next = this.requests.nextPreview(r);
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      reward: r.reward,
      timeLeft: r.timeLeft,
      progress: r.progress,
      temptation: r.temptation,
      risk: r.risk,
      stage: r.stage,
      options: r.options.map((o) => ({ ...o })),
      engaged: r.engaged,
      nextTitle: next ? next.title : null,
      nextReward: next ? next.reward : 0,
      constraint: isConstraint(r.kind),
      constraintLeft: Math.max(
        0,
        (DEFS[r.kind].constraint ?? 0) * (1 - r.progress),
      ),
    };
  }

  private publish(dt: number) {
    this.mouseHintTimer = Math.max(0, this.mouseHintTimer - dt);
    this.toastTimer = Math.max(0, this.toastTimer - dt);
    this.footageTimer = Math.max(0, this.footageTimer - dt);
    this.hintTimer = Math.max(0, this.hintTimer - dt);
    const s = store.getSnapshot();
    const active = this.requests.active;
    store.set({
      viewers: this.stream.viewers,
      likes: this.stream.likes,
      earnings: this.stream.earnings,
      engagement: this.stream.engagement,
      clip: this.stream.clipEffective,
      stars: this.stream.stars,
      chaseFilmMultiplier: this.stream.chaseMultiplier,
      selfieMultiplier: this.stream.selfieMultiplier,
      subject: this.stream.subject,
      danger: this.monster.danger,
      haunting: this.haunting.level,
      monsterState: this.monster.state,
      monsterBehavior: this.monster.behavior,
      distance: this.distance,
      onScreen: this.framing.visible,
      centerScore: this.framing.center,
      discovered: this.monster.discovered,
      chasing: this.monster.chasing,
      discoveries: this.discoveryCount(),
      request: active ? this.viewRequest(active) : null,
      prompt: this.promptText(),
      atEntrance:
        this.distanceToEntrance() <=
        (this.ghost ? CONFIG.oneGhost.entrancePromptRange : CONFIG.entrance.promptRange),
      leaving: this.leaving,
      selfie: this.player.selfie,
      mouseHint: this.mouseHintTimer > 0,
      lightsOff: !this.lightOn,
      carrying: this.carryingDoll,
      playerPos: { x: this.player.position.x, z: this.player.position.z },
      dismissHold: this.dismissHold / CONFIG.request.dismiss.holdTime,
      f1Debug: this.floor1 && this.f1 ? this.f1.debug() : null,
      stateKey: this.stream.breakdown.stateKey,
      repeatCount: this.repeatCountOfCurrent(),
      novelty: this.stream.breakdown.novelty,
      risk: this.stream.breakdown.risk,
      footageValue: this.stream.breakdown.final,
      goalReached: this.goalReached,
    });
    if (this.toastTimer <= 0 && s.toast) store.set({ toast: null });
    if (this.footageTimer <= 0 && s.footage) store.set({ footage: null });
    if (this.hintTimer <= 0 && s.hint) store.set({ hint: null });

    this.logger.sample(dt, this.logRow());
  }

  private logEvent(name: Parameters<Logger['event']>[0], detail = '') {
    this.logger.event(name, this.logRow(), detail);
  }

  private logRow(): LogRow {
    const active = this.requests.active;
    const d = this.distanceToEntrance();
    return {
      mode: this.mode,
      timestamp: Math.round(this.elapsed * 1000) / 1000,
      event: '',
      detail: '',
      player_x: this.player.position.x,
      player_z: this.player.position.z,
      player_yaw: this.player.yaw,
      selfie: this.player.selfie ? 1 : 0,
      monster_x: this.monster.position.x,
      monster_z: this.monster.position.z,
      monster_distance: this.distance,
      monster_state: this.monster.state,
      monster_behavior: this.monster.behavior,
      danger: this.monster.danger,
      haunting: this.haunting.level,
      viewer_count: Math.floor(this.stream.viewers),
      engagement: this.stream.engagement,
      clip_value: this.stream.clipRaw,
      clip_effective: this.stream.clipEffective,
      likes: Math.floor(this.stream.likes),
      stream_earnings: Math.floor(this.stream.earnings),
      subject: this.stream.subject ?? '',
      monster_on_screen: this.framing.visible ? 1 : 0,
      monster_center_score: this.framing.center,
      discoveries: this.discoveryCount(),
      request_active: active ? 1 : 0,
      request_type: active ? active.kind : '',
      request_reward: active ? active.reward : 0,
      request_is_temptation: active?.temptation ? 1 : 0,
      requests_completed: this.requests.completedCount,
      distance_to_entrance: d,
      player_likely_leaving: this.leaving ? 1 : 0,
      returning_to_entrance: this.approachTime > 1 ? 1 : 0,
      temptation_request_triggered: this.temptation ? 1 : 0,
      temptation_request_reward: this.temptation?.reward ?? 0,
      player_turned_back: this.temptation?.turnedBack ? 1 : 0,
      time_from_request_to_turnback:
        this.temptation?.turnedBack ? this.elapsed - this.temptation.time : 0,
      distance_traveled_back_after_request: this.temptation
        ? Math.max(0, d - this.temptation.distance)
        : 0,
      stream_earnings_at_turnback: this.temptation?.turnedBack ? this.temptation.earnings : 0,
      player_provoked: this.provokedNow ? 1 : 0,
      hey_used: this.heyUsedNow ? 1 : 0,
      provocation_streak: this.hey.streak,
      chicken_chain_id: this.requests.chainId,
      chicken_step: this.requests.active?.chainStep ?? this.requests.chainStep,
      next_reward: (() => {
        const a = this.requests.active;
        return a ? (this.requests.nextPreview(a)?.reward ?? 0) : 0;
      })(),
      hey_distance_to_monster: this.heyUsedNow ? this.distance : 0,
      selfie_with_monster: this.player.selfie && this.framing.visible ? 1 : 0,
      time_since_last_meaningful_event: this.director.sinceEvent,
      state_key: this.stream.breakdown.stateKey,
      repeat_count: this.repeatCountOfCurrent(),
      novelty_multiplier: this.stream.breakdown.novelty,
      risk_multiplier: this.stream.breakdown.risk,
      footage_base_value: this.stream.breakdown.base,
      footage_final_value: this.stream.breakdown.final,
      chasing: this.monster.chasing ? 1 : 0,
      player_alive: this.phase === 'playing' ? 1 : 0,
    };
  }

  /**
   * 開発用フック。ヘッドレスでゲームループを回すためだけに使う。
   * （src/dev/autoplay.ts のバランス検証ボット）
   */
  get dev() {
    return {
      game: this,
      player: this.player,
      monster: this.monster,
      stream: this.stream,
      level: this.level,
      requests: this.requests,
      anomalies: this.anomalies,
      haunting: this.haunting,
      hey: this.hey,
      ghostStats: this.ghostStats,
      floor1: () => this.f1,
      lightOn: () => this.lightOn,
      toggleLight: () => this.toggleLight(),
      mode: () => this.mode,
      setMode: (m: GameMode) => {
        this.mode = m;
        this.applyMode();
      },
      input: this.input,
      camera: this.camera,
      logger: this.logger,
      framing: () => this.framing,
      distance: () => this.distance,
      distanceToEntrance: () => this.distanceToEntrance(),
      leaving: () => this.leaving,
      phase: () => this.phase,
      elapsed: () => this.elapsed,
      result: () => store.getSnapshot().result,
      inspectPoints: () => this.level.inspectPoints,
      setPhase: (p: Phase) => {
        this.phase = p;
      },
      reset: () => this.resetRun(),
      step: (dt: number) => this.updatePlaying(dt),
      stepDying: (dt: number) => this.updateDying(dt),
      key: (code: string) => this.handleKey(code),
    };
  }

  private handleResize = () => {
    // 0やNaNが入るとaspectが壊れ、以降フレーミング判定が全滅するので必ず正の値にする
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
