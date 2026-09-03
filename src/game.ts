import * as THREE from 'three';
import { CONFIG, type GameMode, type InspectType } from './config';
import { Input } from './core/input';
import { store, type Phase } from './core/store';
import { clamp01, formatNumber, randRange } from './core/util';
import { buildLevel, MONSTER_ANCHORS, PEEK_ANCHORS, type InspectPoint, type Level } from './world/level';
import { buildGhostLevel, GHOST_MONSTER_ANCHORS, GHOST_PEEK_ANCHORS } from './world/ghostLevel';
import { Player } from './world/player';
import { Monster } from './world/monster';
import { computeFraming, type Framing } from './systems/framing';
import { dangerGainPerSecond } from './systems/danger';
import { StreamSystem, type FilmCandidate } from './systems/stream';
import { AnomalySystem, type ActiveAnomaly } from './systems/anomalies';
import { HauntingSystem } from './systems/haunting';
import { DEFS, RequestSystem, type ActiveRequest } from './systems/requests';
import { ChatSystem, type ChatCategory } from './systems/chat';
import { AudioSystem } from './systems/audio';
import { Logger, type LogRow } from './systems/logger';
import { Director } from './systems/director';
import { HeySystem, type HeyResponse } from './systems/hey';
import { OneGhostStats } from './systems/oneGhost';

const DEATH_FREEZE = 2.4;
const DEATH_LOST = 3.8;
/** 撮影対象として扱う調査地点の基礎価値（異変が起きていないとき） */
const POINT_BASE_VALUE = 18;

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
  private debug = false;

  // このフレームの出来事
  private provokedNow = false;
  private heyUsedNow = false;
  private reactionTimer = 0;
  private reactionFor: ActiveAnomaly | null = null;
  /** 目的地系リクエストの道中に仕込む異変のタイマー */
  private journeyEvents: number[] = [];
  /** LIGHTS OFF リクエスト中はライトを消す */
  private forcedLightsOff = false;
  /** 人形を抱えているか */
  private carryingDoll = false;
  private inspectedNow: InspectType | null = null;
  private answeredPhoneNow = false;

  private framing: Framing = INVISIBLE;
  private monsterFreshness = 1;
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

    this.monster.onStateChange = this.handleMonsterState;
    this.monster.onLunge = () => {
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

    this.requests.onOffer = (r) => {
      this.director.markEvent(r.temptation ? 'temptation' : 'request_offer');
      this.director.markDecision(r.temptation ? 'temptation' : 'request');
      this.requestOfferedAt = this.elapsed;
      this.handleRequestOffer(r);
    };
    this.requests.onEngage = (r) => {
      const hesitation = this.elapsed - this.requestOfferedAt;
      this.hesitations.push(hesitation);
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
    this.requests.onExpire = (r, engaged) => {
      // 無視された分だけ視聴者が離れる（断ることにもコストを持たせる）
      if (!engaged) {
        this.stream.spikeViewers(CONFIG.request.ignorePenalty.viewerMult);
        this.stream.addBoost(CONFIG.request.ignorePenalty.engagement, 8);
        this.chat.push('coward', false);
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

  /**
   * モードごとの設定を各システムへ配る。通常モードの数値には触れない。
   * ステージ自体が違うので、必要なら建て直す。
   */
  private applyMode() {
    const ghost = this.ghost;
    if (this.levelMode !== this.mode) {
      this.levelMode = this.mode;
      this.level.dispose();
      this.level = ghost ? buildGhostLevel(this.scene) : buildLevel(this.scene);
      this.anomalies.setLevel(this.level);
    }
    this.monster.anchors = ghost ? GHOST_MONSTER_ANCHORS : MONSTER_ANCHORS;
    this.monster.peekAnchors = ghost ? GHOST_PEEK_ANCHORS : PEEK_ANCHORS;
    this.monster.oneGhost = ghost;
    this.monster.thresholds = ghost ? CONFIG.oneGhost.thresholds : CONFIG.danger.thresholds;
    this.hey.oneGhost = ghost;
    this.requests.mode = this.mode;
    this.anomalies.autoSpawn = !ghost;
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
    this.ghostStats.reset();
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
    this.forcedLightsOff = false;
    this.carryingDoll = false;
    this.deathTimer = 0;
    this.wasVisible = false;
    this.lookBackCooldown = 0;
    this.lookBackLogged = 0;
    this.monsterFreshness = 1;
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
        this.chat.burst('selfie', 2);
        this.logEvent('selfie_started');
      } else {
        this.logEvent('selfie_ended');
      }
      store.setNow({ selfie: on });
    }
    // リクエストは行動そのものが受諾なので、[F]は「断る」に割り当てる
    if (code === 'KeyF') {
      if (this.requests.decline()) this.toast('DECLINED', 1.2);
    }
  };

  /** [E] は状況で意味が変わる。入口 > 電話 > 調査 > 挑発 */
  private contextAction() {
    if (this.distanceToEntrance() <= CONFIG.entrance.range) {
      this.leaveSite();
      return;
    }
    // ONE GHOST MODE では調査地点も電話も存在しない。[E]は帰るためだけのキー
    if (this.ghost) return;
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
    const likes = CONFIG.inspect.tiers[tier];
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
    const likes = CONFIG.inspect.likes * (first ? 1 : CONFIG.inspect.repeatLikesMult);
    this.stream.addLikes(likes);
    this.haunting.add(CONFIG.haunting.inspect * (first ? 1 : CONFIG.inspect.repeatLikesMult));
    this.stream.addBoost(0.5, 8);
    this.audio.shutter();
    this.director.markEvent('inspect');
    this.awardTier(point, 'touch', `TOUCHED ${point.label}`);
    if (first) {
      this.footage(`${point.label}  +${Math.round(likes)} Likes`, 2.6);
      this.chat.burst('exploring', 2);
      this.audio.viewerSpike();
    } else {
      this.toast(`+${Math.round(likes)} Likes`, 1.2);
    }
    // 調べたことが「後から効いてくる」: 関連する異変を予約する
    this.anomalies.scheduleFromInspect(point.type, first);
    this.logEvent('point_inspected', point.type);
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
      lightsOff: this.forcedLightsOff,
    });

    this.heyUsedNow = true;
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

    if (result.response === 'delayed') {
      this.chat.push('did it hear you?', true);
      this.hint('...', 1.5);
      return;
    }
    this.applyHeyResponse(result.response);
  }

  /** HEYへの怪異の反応を適用する */
  private applyHeyResponse(response: HeyResponse) {
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

  /** プレイヤーの向きを基準にした方向表現 */
  private directionTo(target: THREE.Vector3) {
    const dx = target.x - this.player.position.x;
    const dz = target.z - this.player.position.z;
    const f = this.player.forward;
    const dot = (dx * f.x + dz * f.z) / (Math.hypot(dx, dz) || 1);
    const cross = f.x * dz - f.z * dx;
    if (dot > 0.6) return 'AHEAD';
    if (dot < -0.6) return 'BEHIND YOU';
    return cross > 0 ? 'TO YOUR LEFT' : 'TO YOUR RIGHT';
  }

  private leaveSite() {
    if (this.ghost) this.logEvent('player_exited');
    this.logEvent('player_left_site');
    this.chat.burst('leaving', 4);
    this.audio.escape();
    this.endRun(true);
  }

  /** リクエストに紐づく一時効果を解除する */
  private clearRequestEffects() {
    this.forcedLightsOff = false;
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
    this.flashlight.intensity = this.forcedLightsOff
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

    // --- 異変 ---
    this.anomalies.update(dt, {
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

    // --- 配信の数値 ---
    this.stream.update(dt, {
      candidates: this.buildCandidates(dt),
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
    if (this.director.needsEvent && !this.monster.chasing) {
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

    // ONE GHOST MODE のKPI（接近・後退・帰れる状態の見送り）
    if (this.ghost) {
      this.ghostStats.update({
        monsterKnown: this.monster.discovered,
        distance: this.distance,
        distanceToEntrance: this.distanceToEntrance(),
        atEntrance: this.distanceToEntrance() <= CONFIG.entrance.range,
      });
    }

    this.requests.update(dt, this.buildRequestContext(selfieMonsterInFrame, selfieMonsterBehind));

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

  /** 今フレームの撮影候補を作る */
  private buildCandidates(dt: number): FilmCandidate[] {
    const clip = CONFIG.stream.clip;
    const out: FilmCandidate[] = [];

    if (!this.monster.hidden) {
      if (this.framing.visible) {
        this.monsterFreshness = Math.max(
          clip.freshnessMin,
          this.monsterFreshness - clip.freshnessDecayPerSec * dt,
        );
      } else {
        this.monsterFreshness = Math.min(1, this.monsterFreshness + clip.freshnessRecoverPerSec * dt);
      }
      out.push({
        key: 'monster',
        label: 'IT',
        framing: this.framing,
        // 被写体が一体しかいないので、撮影価値そのものを底上げする（§6）
        base: clip.monsterBase * (this.ghost ? CONFIG.oneGhost.monsterClipMult : 1),
        freshness: this.monsterFreshness,
        isMonster: true,
        monsterState: this.monster.state,
        monsterMoving: this.monster.isMoving,
        monsterLooking: this.monster.looksAt(this.player.position),
      });
    }

    for (const a of this.anomalies.active) {
      this._probe.set(a.x, a.height, a.z);
      out.push({
        key: `anomaly:${a.id}`,
        label: a.label,
        framing: this.frameOf(this._probe),
        base: a.value,
        freshness: a.freshness,
        isMonster: false,
      });
    }

    // ONE GHOST MODE では調査地点は「ただの背景」。怪異だけが被写体になる（§32）
    if (this.ghost) return out;

    for (const p of this.level.inspectPoints) {
      this._probe.set(p.x, p.height, p.z);
      const framing = this.frameOf(this._probe);
      if (framing.visible) {
        p.filmedTotal += dt;
        p.freshness = Math.max(clip.freshnessMin, p.freshness - clip.freshnessDecayPerSec * 1.6 * dt);
      } else {
        p.freshness = Math.min(1, p.freshness + clip.freshnessRecoverPerSec * dt);
      }
      out.push({
        key: `point:${p.type}`,
        label: p.label,
        framing,
        base: POINT_BASE_VALUE,
        freshness: p.freshness,
        isMonster: false,
      });
    }

    return out;
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
      lightsOff: this.forcedLightsOff,
      dollDistance: (() => {
        const d = this.nearestPoint('doll');
        return d ? this.pointDistance(d) : 999;
      })(),
      dollVisible: (() => {
        const d = this.nearestPoint('doll');
        return d ? this.isVisible(d.x, d.z, d.height) : false;
      })(),
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
    if (r.kind === 'lights_off') this.forcedLightsOff = true;
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
    const spot = this.anomalies.lastSpot ?? { x: a.x, z: a.z };
    switch (a.type) {
      case 'noise':
      case 'door_slam':
        this.requests.offerReaction('check_sound', ctx, { targetPos: spot });
        break;
      case 'shadow_figure':
      case 'light_flicker':
        this.requests.offerReaction('follow_it', ctx, { targetPos: spot });
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
    const likes = CONFIG.anomaly.firstDiscoveryLikes;
    this.stream.addLikes(likes);
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
          freshness: 1,
          isMonster: true,
          monsterState: 'chasing',
          monsterMoving: false,
          monsterLooking: true,
        },
      ],
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
      lightsOff: this.forcedLightsOff,
      carrying: this.carryingDoll,
      playerPos: { x: this.player.position.x, z: this.player.position.z },
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
