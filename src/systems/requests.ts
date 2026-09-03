import { CONFIG, type GameMode, type InspectType } from '../config';
import { clamp01, pick, randRange } from '../core/util';

export type RequestKind =
  // 目的地系（到着で終わりにせず、必ず第二段階の選択を出す）
  | 'go_back'
  | 'look_again'
  | 'check_sound'
  | 'follow_it'
  | 'one_last_look'
  // 行動制約系（既存の遊びに条件を足す）
  | 'get_closer'
  | 'stare'
  | 'provoke'
  | 'stay_here'
  | 'turn_around'
  | 'dont_look_back'
  | 'lights_off'
  | 'keep_in_frame'
  | 'carry_doll'
  | 'selfie_monster'
  | 'selfie_behind'
  | 'selfie_mirror'
  | 'last_selfie'
  | 'film_the_chase'
  | 'hey_call'
  | 'hey_again'
  | 'hey_look'
  | 'hey_closer'
  | 'hey_selfie'
  | 'hey_lights_off'
  | 'hey_dont_move'
  | 'one_last_call'
  | 'one_last_call2'
  | 'dont_turn_around'
  // ONE GHOST MODE 専用（怪異一体だけで完結する要求）
  | 'get_closer2'
  | 'keep_filming'
  | 'hey_selfie2'
  | 'dont_move';

export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

interface Def {
  title: string;
  desc: string;
  /** 円 */
  reward: number;
  risk: RiskLevel;
  /** 達成に与える時間（秒） */
  time: number;
  /** 達成時のDanger上昇 */
  danger: number;
  /** 達成時のHaunting上昇 */
  haunting: number;
  /** 目的地へ向かわせるタイプか（帰路に異変を仕込む） */
  destination?: boolean;
  /** 達成したら数秒後にこれを提示する（チキンレースの次の段） */
  next?: RequestKind;
}

/**
 * リクエスト定義。
 * 報酬・リスク・時間・Danger/Hauntingへの影響を1か所で持つ。
 * 「低報酬なら普通に断ってよい」ように、安いものほど時間もかかるようにしてある。
 */
export const DEFS: Record<RequestKind, Def> = {
  go_back: {
    title: 'GO BACK TO IT',
    desc: '',
    reward: 700,
    risk: 'low',
    time: 40,
    danger: 0,
    haunting: 4,
    destination: true,
  },
  look_again: {
    title: 'LOOK INTO THE MIRROR AGAIN',
    desc: 'GO BACK TO THE MIRROR',
    reward: 1400,
    risk: 'medium',
    time: 40,
    danger: 0,
    haunting: 6,
    destination: true,
  },
  check_sound: {
    title: 'CHECK THE SOUND',
    desc: 'GO WHERE IT CAME FROM',
    reward: 800,
    risk: 'low',
    time: 35,
    danger: 0,
    haunting: 4,
    destination: true,
  },
  follow_it: {
    title: 'FOLLOW IT',
    desc: 'GO WHERE IT WENT',
    reward: 1200,
    risk: 'medium',
    time: 35,
    danger: 2,
    haunting: 6,
    destination: true,
  },
  one_last_look: {
    title: 'ONE LAST LOOK',
    desc: 'GO BACK IN. ONE MORE SHOT.',
    reward: 2500,
    risk: 'medium',
    time: 50,
    danger: 4,
    haunting: 8,
    destination: true,
  },

  get_closer: {
    title: 'GET CLOSER',
    desc: 'WALK WITHIN 8m OF IT',
    reward: 500,
    risk: 'low',
    time: 18,
    danger: 4,
    haunting: 2,
    next: 'hey_call',
  },
  stare: {
    title: 'STARE AT IT',
    desc: 'KEEP IT CENTERED FOR 3s',
    reward: 2200,
    risk: 'medium',
    time: 25,
    danger: 6,
    haunting: 5,
  },
  provoke: {
    title: 'PROVOKE IT',
    desc: 'SHOUT AT IT  [E]',
    reward: 4000,
    risk: 'high',
    time: 25,
    danger: 10,
    haunting: 10,
  },
  stay_here: {
    title: 'STAY WHERE YOU ARE',
    desc: "DON'T MOVE FOR 10s",
    reward: 2400,
    risk: 'high',
    time: 20,
    danger: 4,
    haunting: 7,
  },
  turn_around: {
    title: 'TURN AROUND',
    desc: 'RIGHT NOW',
    reward: 700,
    risk: 'low',
    time: 6,
    danger: 0,
    haunting: 3,
  },
  dont_look_back: {
    title: "DON'T LOOK BEHIND YOU",
    desc: 'KEEP FACING FORWARD FOR 20s',
    reward: 2200,
    risk: 'medium',
    time: 22,
    danger: 2,
    haunting: 8,
  },
  lights_off: {
    title: 'LIGHTS OFF',
    desc: 'NO LIGHT UNTIL YOU REACH IT',
    reward: 5000,
    risk: 'high',
    time: 45,
    danger: 6,
    haunting: 12,
    destination: true,
  },
  keep_in_frame: {
    title: 'KEEP IT IN FRAME',
    desc: 'DO NOT LOOK AWAY FOR 12s',
    reward: 3000,
    risk: 'medium',
    time: 22,
    danger: 6,
    haunting: 7,
  },
  carry_doll: {
    title: 'CARRY THE DOLL OUT',
    desc: 'PICK IT UP [E] AND BRING IT TO THE ENTRANCE',
    reward: 7000,
    risk: 'extreme',
    time: 120,
    danger: 8,
    haunting: 25,
    destination: true,
  },
  selfie_monster: {
    title: 'TAKE A SELFIE WITH IT',
    desc: '[C] SELFIE MODE WITH IT IN FRAME',
    reward: 10000,
    risk: 'extreme',
    time: 25,
    danger: 18,
    haunting: 12,
    next: 'dont_turn_around',
  },
  dont_turn_around: {
    title: "DON'T TURN AROUND",
    desc: 'KEEP THE SELFIE ON IT FOR 5s',
    reward: 15000,
    risk: 'extreme',
    time: 18,
    danger: 22,
    haunting: 16,
  },
  selfie_behind: {
    title: 'KEEP IT BEHIND YOU',
    desc: '[C] KEEP IT IN FRAME BEHIND YOU FOR 2s',
    reward: 6000,
    risk: 'extreme',
    time: 35,
    danger: 16,
    haunting: 10,
  },
  selfie_mirror: {
    title: 'SELFIE IN FRONT OF THE MIRROR',
    desc: '[C] SELFIE MODE AT THE MIRROR',
    reward: 3000,
    risk: 'medium',
    time: 45,
    danger: 3,
    haunting: 6,
    destination: true,
  },
  last_selfie: {
    title: 'ONE LAST SELFIE BEFORE YOU LEAVE',
    desc: '[C] SELFIE BEFORE YOU WALK OUT',
    reward: 4000,
    risk: 'medium',
    time: 30,
    danger: 10,
    haunting: 8,
  },
  hey_call: {
    title: 'CALL OUT TO IT',
    desc: '[Q] SHOUT',
    reward: 1500,
    risk: 'medium',
    time: 12,
    danger: 3,
    haunting: 4,
    next: 'hey_again',
  },
  hey_again: {
    title: 'CALL IT AGAIN',
    desc: '[Q] ONE MORE TIME',
    reward: 4000,
    risk: 'high',
    time: 12,
    danger: 6,
    haunting: 7,
    next: 'hey_closer',
  },
  hey_look: {
    title: 'MAKE IT LOOK AT YOU',
    desc: '[Q] SHOUT WITH IT IN FRAME',
    reward: 4000,
    risk: 'high',
    time: 20,
    danger: 4,
    haunting: 8,
    next: 'hey_closer',
  },
  hey_closer: {
    title: 'GET REALLY CLOSE AND CALL IT',
    desc: '[Q] SHOUT FROM WITHIN 5m',
    reward: 7000,
    risk: 'extreme',
    time: 20,
    danger: 12,
    haunting: 10,
    next: 'selfie_monster',
  },
  hey_selfie: {
    title: 'CALL IT WHILE TAKING A SELFIE',
    desc: '[C] THEN [Q]',
    reward: 15000,
    risk: 'extreme',
    time: 25,
    danger: 18,
    haunting: 16,
  },
  hey_lights_off: {
    title: 'CALL IT WITH THE LIGHT OFF',
    desc: 'LIGHTS OFF, THEN [Q]',
    reward: 6000,
    risk: 'extreme',
    time: 25,
    danger: 12,
    haunting: 14,
  },
  hey_dont_move: {
    title: 'CALL IT AND DO NOT MOVE',
    desc: '[Q] THEN STAND STILL FOR 5s',
    reward: 5000,
    risk: 'extreme',
    time: 22,
    danger: 8,
    haunting: 12,
  },
  one_last_call: {
    title: 'ONE LAST CALL',
    desc: 'SHOUT INTO THE BUILDING  [Q]',
    reward: 8000,
    risk: 'high',
    time: 20,
    danger: 6,
    haunting: 10,
    next: 'one_last_call2',
  },
  one_last_call2: {
    title: 'CALL IT AGAIN',
    desc: 'SOMETHING ANSWERED. DO IT ONCE MORE.  [Q]',
    reward: 15000,
    risk: 'extreme',
    time: 18,
    danger: 14,
    haunting: 16,
  },

  // --- ONE GHOST MODE ---
  get_closer2: {
    // §9 のラダーは GET CLOSER が2段続く。NEXT表示で同じ文字が並ぶと段が進んだ実感が消えるので、
    // 2段目だけ言い方を変える（要求そのものは同じ「もっと近づく」）
    title: 'GET EVEN CLOSER',
    desc: 'WALK WITHIN 5m OF IT',
    reward: 1500,
    risk: 'medium',
    time: 20,
    danger: 6,
    haunting: 3,
  },
  keep_filming: {
    title: 'KEEP FILMING',
    desc: 'KEEP IT IN FRAME FOR 6s',
    reward: 10000,
    risk: 'high',
    time: 20,
    danger: 8,
    haunting: 6,
  },
  hey_selfie2: {
    title: 'CALL IT AGAIN',
    desc: '[Q] ONE MORE TIME, STILL IN SELFIE',
    reward: 10000,
    risk: 'extreme',
    time: 18,
    danger: 16,
    haunting: 12,
  },
  dont_move: {
    title: "DON'T MOVE",
    desc: 'STAND STILL FOR 8s',
    reward: 3000,
    risk: 'high',
    time: 18,
    danger: 5,
    haunting: 6,
  },

  film_the_chase: {
    title: 'FILM IT WHILE YOU RUN',
    desc: 'KEEP IT IN FRAME FOR 2s WHILE RUNNING',
    reward: 5000,
    risk: 'extreme',
    time: 20,
    danger: 0,
    haunting: 5,
  },
};

/** 到着後に出る第二段階の選択肢 */
export interface Stage2Option {
  id: 'film' | 'selfie' | 'touch';
  label: string;
  reward: number;
}

export interface ActiveRequest {
  id: number;
  kind: RequestKind;
  title: string;
  description: string;
  reward: number;
  risk: RiskLevel;
  temptation: boolean;
  timeLeft: number;
  progress: number;
  /** 1 = 本題 / 2 = 到着後の選択 */
  stage: 1 | 2;
  options: Stage2Option[];
  /** プレイヤーが実際に動き出したか（受諾率のKPI） */
  engaged: boolean;
  /** チキンレースの何段目か（分析用） */
  chainId: number;
  chainStep: number;
  targetType?: InspectType;
  targetLabel?: string;
  targetPos?: { x: number; z: number };
}

export interface RequestContext {
  monsterKnown: boolean;
  monsterVisible: boolean;
  monsterCenter: number;
  monsterDistance: number;
  discoveredPoints: Set<InspectType>;
  pointDistance(type: InspectType): number;
  pointVisible(type: InspectType): boolean;
  pointLabel(type: InspectType): string;
  inspectedNow: InspectType | null;
  provokedNow: boolean;
  answeredPhoneNow: boolean;
  phoneRinging: boolean;
  selfieActive: boolean;
  selfieMonsterInFrame: boolean;
  selfieMonsterBehind: boolean;
  leaving: boolean;
  distanceToEntrance: number;
  chasing: boolean;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  playerMoving: boolean;
  carryingDoll: boolean;
  /** このフレームでHEYを使ったか */
  heyUsedNow: boolean;
  heyStreak: number;
  monsterLookingAtPlayer: boolean;
  lightsOff: boolean;
  /** 追跡・接近に使う直近の被写体 */
  dollDistance: number;
  dollVisible: boolean;
}

/**
 * ONE GHOST MODE のチキンレース（§9）。
 * すべて怪異一体に対する行動で、移動クエストを含まない。
 * 報酬は CONFIG.oneGhost.request.chainRewards が段ごとに与える。
 */
const GHOST_LADDER: RequestKind[] = [
  'get_closer',
  'get_closer2',
  'hey_call',
  'hey_again',
  'keep_filming',
  'selfie_monster',
];

/** §28 Selfie Chicken Race */
const GHOST_SELFIE_LADDER: RequestKind[] = ['hey_selfie', 'hey_selfie2', 'dont_turn_around'];

/** §20 入口からの ONE LAST CALL */
const GHOST_LAST_CALL_LADDER: RequestKind[] = ['one_last_call', 'one_last_call2'];

export class RequestSystem {
  mode: GameMode = 'standard';
  active: ActiveRequest | null = null;
  offeredCount = 0;
  completedCount = 0;
  temptationCount = 0;
  /** 行動で応じた回数（＝実質の受諾数） */
  engagedCount = 0;
  ignoredCount = 0;
  turnedBackCount = 0;

  onOffer: ((r: ActiveRequest) => void) | null = null;
  onStage2: ((r: ActiveRequest) => void) | null = null;
  onEngage: ((r: ActiveRequest) => void) | null = null;
  onComplete: ((r: ActiveRequest, reward: number, option?: Stage2Option) => void) | null = null;
  onExpire: ((r: ActiveRequest, engaged: boolean) => void) | null = null;

  private nextId = 1;
  private cooldown = CONFIG.request.firstDelay;
  private sinceOffer = 999;
  private temptationCooldown = 0;
  private leavingTime = 0;
  private hold = 0;
  private lastKind: RequestKind | null = null;
  /** dont_look_back / stay_here などの基準値 */
  private anchor = { x: 0, z: 0, yaw: 0 };

  /** ONE GHOST MODE：進行中のラダーと段数 */
  private ladder: RequestKind[] | null = null;
  private ladderRewards: number[] = [];
  private ladderStep = 0;

  private get ghost() {
    return this.mode === 'one_ghost';
  }

  private get firstDelay() {
    return this.ghost ? CONFIG.oneGhost.request.firstDelay : CONFIG.request.firstDelay;
  }

  private get interval() {
    return this.ghost ? CONFIG.oneGhost.request.interval : CONFIG.request.interval;
  }

  private get minGap() {
    return this.ghost ? CONFIG.oneGhost.request.minGap : CONFIG.request.minGap;
  }

  private get postCooldown() {
    return this.ghost
      ? CONFIG.oneGhost.request.postCompleteCooldown
      : CONFIG.request.postCompleteCooldown;
  }

  private get maxCount() {
    return this.ghost ? CONFIG.oneGhost.request.maxCount : CONFIG.request.maxCount;
  }

  /** カードに出す「NEXT +¥X — TITLE」。降りるか進むかを決める材料 */
  nextPreview(r: ActiveRequest): { title: string; reward: number } | null {
    if (this.ghost && this.ladder) {
      const i = this.ladderStep + 1;
      if (i < this.ladder.length) {
        return { title: DEFS[this.ladder[i]].title, reward: this.ladderRewards[i] };
      }
      return null;
    }
    const next = DEFS[r.kind].next;
    return next ? { title: DEFS[next].title, reward: DEFS[next].reward } : null;
  }

  reset() {
    this.active = null;
    this.offeredCount = 0;
    this.completedCount = 0;
    this.temptationCount = 0;
    this.engagedCount = 0;
    this.ignoredCount = 0;
    this.turnedBackCount = 0;
    this.cooldown = this.firstDelay;
    this.sinceOffer = 999;
    this.temptationCooldown = 0;
    this.leavingTime = 0;
    this.hold = 0;
    this.lastKind = null;
    this.ladder = null;
    this.ladderRewards = [];
    this.ladderStep = 0;
    this.chainNext = null;
    this.chainId = 0;
    this.chainStep = 0;
    this.longestChain = 0;
    this.continuedChains = 0;
    this.abandonedChains = 0;
  }

  /** プレイヤーが明示的に断る（[F]）。行動での辞退と同じ扱い */
  decline() {
    if (!this.active) return false;
    const r = this.active;
    this.active = null;
    this.hold = 0;
    this.ignoredCount += 1;
    this.abandonLadder();
    this.cooldown = this.postCooldown;
    this.onExpire?.(r, false);
    return true;
  }

  /** チキンレースの途中で降りた（＝自分で止めた） */
  private abandonLadder() {
    if (!this.ladder) return;
    if (this.chainStep > 0) this.abandonedChains += 1;
    this.ladder = null;
    this.chainNext = null;
    this.chainStep = 0;
  }

  update(dt: number, ctx: RequestContext) {
    this.sinceOffer += dt;

    if (this.chainNext && !this.active) {
      this.chainNext.delay -= dt;
      if (this.chainNext.delay <= 0) {
        const { kind, temptation, reward } = this.chainNext;
        this.chainNext = null;
        if (!ctx.chasing) {
          // ONE GHOST MODE では finish() の時点で段数を進めてある
          if (!this.ghost) {
            this.chainStep += 1;
            this.continuedChains += 1;
          }
          this.offer(this.make(kind, ctx, { temptation, reward }), ctx);
          return;
        }
        this.ladder = null;
      }
    }
    if (this.active) {
      this.active.timeLeft -= dt;
      this.evaluate(dt, ctx);
      if (this.active && this.active.timeLeft <= 0) {
        const expired = this.active;
        this.active = null;
        this.hold = 0;
        if (expired.engaged) this.turnedBackCount += 0;
        else this.ignoredCount += 1;
        this.abandonLadder();
        this.cooldown = this.postCooldown;
        this.onExpire?.(expired, expired.engaged);
      }
      return;
    }

    this.cooldown -= dt;
    this.temptationCooldown = Math.max(0, this.temptationCooldown - dt);
    if (this.offeredCount >= this.maxCount || ctx.chasing) return;

    const t = CONFIG.request.temptation;
    if (ctx.leaving) {
      this.leavingTime += dt;
      if (
        this.leavingTime >= t.delay &&
        this.temptationCount < t.maxCount &&
        this.temptationCooldown <= 0
      ) {
        this.leavingTime = 0;
        this.temptationCooldown = t.cooldown;
        if (Math.random() < t.chance) {
          const req = this.ghost ? this.buildGhostTemptation(ctx) : this.buildTemptation(ctx);
          if (req) {
            this.offer(req, ctx);
            return;
          }
        }
      }
    } else {
      this.leavingTime = 0;
    }

    if (this.cooldown > 0) return;
    this.chainId += 1;
    this.chainStep = 0;
    const req = this.ghost ? this.buildOneGhost(ctx) : this.buildNormal(ctx);
    if (!req) {
      this.cooldown = 6;
      return;
    }
    this.offer(req, ctx);
  }

  /** 異変を目撃した「その瞬間」に紐づくリクエストを割り込ませる */
  offerReaction(
    kind: RequestKind,
    ctx: RequestContext,
    opts: { target?: InspectType; targetPos?: { x: number; z: number }; reward?: number } = {},
  ) {
    if (this.active) return false;
    if (this.offeredCount >= this.maxCount) return false;
    if (this.sinceOffer < this.minGap) return false;
    if (ctx.chasing && kind !== 'film_the_chase') return false;
    this.offer(this.make(kind, ctx, opts), ctx);
    return true;
  }

  private offer(req: ActiveRequest, ctx: RequestContext) {
    this.active = req;
    req.chainId = this.chainId;
    req.chainStep = this.chainStep;
    this.offeredCount += 1;
    this.lastKind = req.kind;
    this.sinceOffer = 0;
    if (req.temptation) this.temptationCount += 1;
    this.cooldown = randRange(this.interval.min, this.interval.max);
    this.hold = 0;
    this.anchor = { x: ctx.playerX, z: ctx.playerZ, yaw: ctx.playerYaw };
    this.onOffer?.(req);
  }

  private make(
    kind: RequestKind,
    ctx: RequestContext,
    opts: {
      temptation?: boolean;
      target?: InspectType;
      targetPos?: { x: number; z: number };
      description?: string;
      /** ラダーが段ごとに与える報酬（ONE GHOST MODE） */
      reward?: number;
    } = {},
  ): ActiveRequest {
    const def = DEFS[kind];
    const t = CONFIG.request.temptation;
    const raw = opts.reward !== undefined
      ? opts.reward
      : opts.temptation
        ? Math.min(def.reward * t.rewardMult + t.rewardBonus, t.rewardCap)
        : def.reward;
    const reward = Math.round(raw / 100) * 100;
    const label = opts.target ? ctx.pointLabel(opts.target) : '';
    const title = kind === 'go_back' && opts.target ? `GO BACK TO ${label}` : def.title;
    return {
      id: this.nextId++,
      kind,
      title,
      description: opts.description ?? (def.desc || `WALK BACK AND FILM ${label}`),
      reward,
      risk: def.risk,
      temptation: !!opts.temptation,
      timeLeft: def.time,
      progress: 0,
      stage: 1,
      options: [],
      engaged: false,
      chainId: 0,
      chainStep: 0,
      targetType: opts.target,
      targetLabel: label,
      targetPos: opts.targetPos,
    };
  }

  private buildNormal(ctx: RequestContext): ActiveRequest | null {
    const pool: Array<() => ActiveRequest> = [];
    const points = [...ctx.discoveredPoints];
    const far = points.filter((p) => ctx.pointDistance(p) > 12);

    if (far.length) {
      pool.push(() => this.make('go_back', ctx, { target: pick(far) }));
      pool.push(() => this.make('lights_off', ctx, { target: pick(far) }));
    }
    if (ctx.discoveredPoints.has('mirror')) {
      pool.push(() => this.make('selfie_mirror', ctx, { target: 'mirror' }));
    }
    if (ctx.discoveredPoints.has('doll') && !ctx.carryingDoll) {
      pool.push(() => this.make('carry_doll', ctx, { target: 'doll' }));
    }
    // 行動制約系は「守るのが嫌な状況」でだけ出す。
    // 怪異が近くにいないと、ただの無料報酬になってしまう。
    const monsterNear = ctx.monsterKnown && ctx.monsterDistance < 22;
    pool.push(() => this.make('turn_around', ctx));
    if (monsterNear) {
      pool.push(() => this.make('stay_here', ctx));
      pool.push(() => this.make('dont_look_back', ctx));
    }
    if (ctx.monsterKnown) {
      // チキンレースは一番安い段（¥500の接近）から始める
      if (ctx.monsterDistance < 30) {
        pool.push(() => this.make('get_closer', ctx));
        pool.push(() => this.make('get_closer', ctx));
      }
      pool.push(() => this.make('hey_call', ctx));
      if (ctx.monsterDistance < 24) pool.push(() => this.make('hey_dont_move', ctx));
      pool.push(() => this.make('hey_lights_off', ctx));
      pool.push(() => this.make('stare', ctx));
      pool.push(() => this.make('get_closer', ctx));
      pool.push(() => this.make('provoke', ctx));
      pool.push(() => this.make('selfie_monster', ctx));
      pool.push(() => this.make('selfie_behind', ctx));
      pool.push(() => this.make('keep_in_frame', ctx));
    }
    if (!pool.length) return null;
    for (let i = 0; i < 8; i++) {
      const req = pick(pool)();
      if (req.kind !== this.lastKind) return req;
    }
    return pick(pool)();
  }

  // --- ONE GHOST MODE ---

  /** ラダーを開始する。startStep で「もう達成済みの段」を飛ばす */
  private startLadder(ladder: RequestKind[], rewards: number[], startStep = 0) {
    this.ladder = ladder;
    this.ladderRewards = rewards;
    this.ladderStep = Math.min(startStep, ladder.length - 1);
  }

  private ladderRequest(ctx: RequestContext, temptation = false): ActiveRequest {
    const kind = this.ladder![this.ladderStep];
    return this.make(kind, ctx, { reward: this.ladderRewards[this.ladderStep], temptation });
  }

  /**
   * ONE GHOST MODE の提示。
   * 出るのは怪異一体に対する行動だけ。「○○へ行け」は一切作らない（§8）。
   */
  private buildOneGhost(ctx: RequestContext): ActiveRequest | null {
    if (!ctx.monsterKnown) return null;
    const cfg = CONFIG.oneGhost.request;

    // Selfie中に背後へ入っていれば、そのままSelfie Chicken Raceへ（§28）
    if (ctx.selfieActive && ctx.selfieMonsterInFrame) {
      this.startLadder(GHOST_SELFIE_LADDER, cfg.selfieChainRewards);
      return this.ladderRequest(ctx);
    }

    // 単発の「今の姿勢に制約を足す」要求。毎回ラダーだと単調になる
    if (ctx.monsterDistance < 20 && Math.random() < 0.22 && this.lastKind !== 'dont_move') {
      this.ladder = null;
      return this.make('dont_move', ctx);
    }

    // すでに近いなら GET CLOSER は無料報酬になってしまうので、その分は飛ばす
    const start = ctx.monsterDistance <= 5 ? 2 : ctx.monsterDistance <= 8 ? 1 : 0;
    this.startLadder(GHOST_LADDER, cfg.chainRewards, start);
    this.chainStep = start;
    return this.ladderRequest(ctx);
  }

  /** §20 帰れる状態から出す ONE LAST CALL。戻る必要はなく、叫べば達成 */
  private buildGhostTemptation(ctx: RequestContext): ActiveRequest | null {
    if (!ctx.monsterKnown) return null;
    this.startLadder(GHOST_LAST_CALL_LADDER, CONFIG.oneGhost.request.lastCallRewards);
    return this.ladderRequest(ctx, true);
  }

  private buildTemptation(ctx: RequestContext): ActiveRequest | null {
    const pool: Array<() => ActiveRequest> = [];
    const points = [...ctx.discoveredPoints].filter((p) => ctx.pointDistance(p) > 14);
    if (points.length) {
      pool.push(() => this.make('go_back', ctx, { temptation: true, target: pick(points) }));
      pool.push(() => this.make('one_last_look', ctx, { temptation: true, target: pick(points) }));
      pool.push(() => this.make('lights_off', ctx, { temptation: true, target: pick(points) }));
    }
    if (ctx.discoveredPoints.has('doll') && !ctx.carryingDoll) {
      pool.push(() => this.make('carry_doll', ctx, { temptation: true, target: 'doll' }));
    }
    if (ctx.monsterKnown) {
      pool.push(() => this.make('selfie_monster', ctx, { temptation: true }));
      pool.push(() => this.make('get_closer', ctx, { temptation: true }));
    }
    pool.push(() => this.make('last_selfie', ctx, { temptation: true }));
    // 入口から中へ向かって叫ぶだけ。戻る必要がないのでおつかいにならない
    if (ctx.monsterKnown) {
      pool.push(() => this.make('one_last_call', ctx, { temptation: true }));
      pool.push(() => this.make('one_last_call', ctx, { temptation: true }));
    }
    return pick(pool)();
  }

  /** 目的地に着いたので、もう一段の選択を出す */
  private enterStage2(r: ActiveRequest, ctx: RequestContext) {
    r.stage = 2;
    r.timeLeft = CONFIG.request.stage2Time;
    r.progress = 0;
    this.hold = 0;
    const bonus = Math.round((r.reward * CONFIG.request.stage2Bonus) / 100) * 100;
    const label = r.targetLabel || 'IT';
    r.title = `YOU'RE HERE — NOW WHAT?`;
    r.description = `FILM ${label}, OR GO FURTHER`;
    r.options = [
      { id: 'film', label: `FILM IT`, reward: r.reward },
      { id: 'selfie', label: `[C] SELFIE WITH IT`, reward: bonus },
    ];
    if (r.targetType) {
      r.options.push({ id: 'touch', label: `[E] TOUCH IT`, reward: Math.round(bonus * 0.7) });
    }
    this.onStage2?.(r);
    void ctx;
  }

  /** チキンレースの次の段 */
  private chainNext: {
    kind: RequestKind;
    delay: number;
    temptation: boolean;
    reward?: number;
  } | null = null;
  /** 現在の連鎖 */
  chainId = 0;
  chainStep = 0;
  longestChain = 0;
  continuedChains = 0;
  abandonedChains = 0;

  private finish(r: ActiveRequest, reward: number, option?: Stage2Option) {
    this.completedCount += 1;
    this.active = null;
    this.hold = 0;
    this.longestChain = Math.max(this.longestChain, this.chainStep);

    // ONE GHOST MODE：ラダーを一段上げて、すぐ次の金額を見せる（§9）
    if (this.ghost) {
      const cfg = CONFIG.oneGhost.request;
      const hasNext = this.ladder && this.ladderStep + 1 < this.ladder.length;
      if (hasNext && Math.random() < cfg.continueChance) {
        this.ladderStep += 1;
        this.chainStep += 1;
        this.continuedChains += 1;
        this.chainNext = {
          kind: this.ladder![this.ladderStep],
          delay: randRange(cfg.chainDelay.min, cfg.chainDelay.max),
          temptation: r.temptation,
          reward: this.ladderRewards[this.ladderStep],
        };
      } else {
        this.ladder = null;
        this.chainStep = 0;
      }
      this.cooldown = Math.max(
        this.postCooldown,
        randRange(this.interval.min, this.interval.max) * 0.7,
      );
      this.onComplete?.(r, reward, option);
      return;
    }

    // 達成したら数秒後に、もう一段高い要求が来る（途中で降りても報酬は保持される）
    const next = DEFS[r.kind].next;
    if (next) {
      // 毎回最後まで出さない。Hauntingや状況で途中終了する
      const keepGoing = Math.random() < 0.82;
      if (keepGoing) {
          // 2段目以降は素の報酬カーブ（誘惑倍率を重ねない）
        this.chainNext = { kind: next, delay: randRange(2.5, 4.5), temptation: false };
      } else {
        this.chainStep = 0;
      }
    } else {
      this.chainStep = 0;
    }
    this.cooldown = Math.max(
      this.postCooldown,
      randRange(this.interval.min, this.interval.max) * 0.7,
    );
    this.onComplete?.(r, reward, option);
  }

  private markEngaged(r: ActiveRequest) {
    if (r.engaged) return;
    r.engaged = true;
    this.engagedCount += 1;
    if (r.temptation) this.turnedBackCount += 1;
    this.onEngage?.(r);
  }

  private evaluate(dt: number, ctx: RequestContext) {
    const r = this.active;
    if (!r) return;

    // --- 第二段階：到着後の選択 ---
    if (r.stage === 2) {
      const label = r.targetType;
      const near = label ? ctx.pointDistance(label) < 5 : true;
      if (ctx.selfieActive && near) {
        this.hold += dt;
        r.progress = clamp01(this.hold / 1.5);
        if (this.hold >= 1.5) {
          this.finish(r, r.options[1].reward, r.options[1]);
          return;
        }
      } else if (label && ctx.inspectedNow === label) {
        this.finish(r, r.options[2]?.reward ?? r.reward, r.options[2]);
        return;
      } else if (label ? ctx.pointVisible(label) && near : true) {
        this.hold += dt;
        r.progress = clamp01(this.hold / 2);
        if (this.hold >= 2) {
          this.finish(r, r.options[0].reward, r.options[0]);
          return;
        }
      } else {
        this.hold = Math.max(0, this.hold - dt);
      }
      return;
    }

    // --- 第一段階 ---
    let done = false;
    switch (r.kind) {
      case 'go_back':
      case 'look_again':
      case 'one_last_look':
      case 'selfie_mirror':
      case 'lights_off': {
        const target = r.targetType ?? 'mirror';
        const d = ctx.pointDistance(target);
        r.progress = clamp01((26 - d) / 22);
        if (d < 4) {
          this.enterStage2(r, ctx);
          return;
        }
        break;
      }
      case 'check_sound':
      case 'follow_it': {
        const p = r.targetPos;
        if (!p) break;
        const d = Math.hypot(p.x - ctx.playerX, p.z - ctx.playerZ);
        r.progress = clamp01((24 - d) / 20);
        if (d <= 3.5) {
          this.enterStage2(r, ctx);
          return;
        }
        break;
      }
      case 'carry_doll': {
        if (ctx.carryingDoll) {
          r.progress = 0.5 + clamp01((40 - ctx.distanceToEntrance) / 40) * 0.5;
          done = ctx.distanceToEntrance < CONFIG.entrance.range;
        } else {
          r.progress = clamp01((26 - ctx.pointDistance('doll')) / 24) * 0.5;
        }
        break;
      }
      case 'get_closer':
        r.progress = clamp01((22 - ctx.monsterDistance) / 14);
        done = ctx.monsterDistance <= 8 && ctx.monsterKnown;
        break;
      case 'get_closer2':
        r.progress = clamp01((14 - ctx.monsterDistance) / 9);
        done = ctx.monsterDistance <= 5 && ctx.monsterKnown;
        break;
      case 'keep_filming': {
        // 撮り続けるだけ。ただし怪異は近づいてくる
        const ok = ctx.monsterVisible;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 1.5);
        r.progress = clamp01(this.hold / 6);
        done = this.hold >= 6;
        break;
      }
      case 'hey_selfie2':
        r.progress = ctx.selfieActive ? 0.6 : 0.2;
        done = ctx.heyUsedNow && ctx.selfieActive && ctx.heyStreak >= 2;
        break;
      case 'dont_move': {
        const moved = Math.hypot(ctx.playerX - this.anchor.x, ctx.playerZ - this.anchor.z);
        if (moved > 2.5) {
          // 動いた＝自分で降りた
          this.active = null;
          this.hold = 0;
          this.ignoredCount += 1;
          this.abandonLadder();
          this.cooldown = this.postCooldown;
          this.onExpire?.(r, r.engaged);
          return;
        }
        this.hold += dt;
        r.progress = clamp01(this.hold / 8);
        done = this.hold >= 8;
        break;
      }
      case 'dont_turn_around': {
        // Selfieを解除した瞬間に失敗（＝自分から降りた）
        if (this.hold > 0.3 && !ctx.selfieActive) {
          this.active = null;
          this.hold = 0;
          this.ignoredCount += 1;
          this.abandonedChains += 1;
          this.ladder = null;
          this.chainNext = null;
          this.chainStep = 0;
          this.cooldown = this.postCooldown;
          this.onExpire?.(r, r.engaged);
          return;
        }
        const ok = ctx.selfieActive && ctx.selfieMonsterInFrame;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 0.5);
        r.progress = clamp01(this.hold / 5);
        done = this.hold >= 5;
        break;
      }
      case 'stare': {
        const ok = ctx.monsterVisible && ctx.monsterCenter >= 0.7;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 1.5);
        r.progress = clamp01(this.hold / 3);
        done = this.hold >= 3;
        break;
      }
      case 'provoke':
        r.progress = ctx.monsterDistance <= CONFIG.danger.provokeRange ? 0.6 : 0.2;
        done = ctx.provokedNow && ctx.monsterDistance <= CONFIG.danger.provokeRange;
        break;
      case 'stay_here': {
        const moved = Math.hypot(ctx.playerX - this.anchor.x, ctx.playerZ - this.anchor.z);
        if (moved > 2.5) {
          // 動いてしまったら失敗（＝辞退）
          this.active = null;
          this.hold = 0;
          this.ignoredCount += 1;
          this.cooldown = this.postCooldown;
          this.onExpire?.(r, r.engaged);
          return;
        }
        this.hold += dt;
        r.progress = clamp01(this.hold / 10);
        done = this.hold >= 10;
        break;
      }
      case 'turn_around': {
        const diff = Math.abs(angleDiff(ctx.playerYaw, this.anchor.yaw));
        r.progress = clamp01(diff / Math.PI);
        done = diff > 2.4;
        break;
      }
      case 'dont_look_back': {
        const diff = Math.abs(angleDiff(ctx.playerYaw, this.anchor.yaw));
        if (diff > 2.1) {
          this.active = null;
          this.hold = 0;
          this.ignoredCount += 1;
          this.cooldown = this.postCooldown;
          this.onExpire?.(r, r.engaged);
          return;
        }
        this.hold += dt;
        r.progress = clamp01(this.hold / 20);
        done = this.hold >= 20;
        break;
      }
      case 'keep_in_frame': {
        const ok = ctx.monsterVisible || ctx.dollVisible;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 2);
        r.progress = clamp01(this.hold / 12);
        done = this.hold >= 12;
        break;
      }
      case 'selfie_monster': {
        const ok = ctx.selfieActive && ctx.selfieMonsterInFrame;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt);
        r.progress = clamp01(this.hold / 1.2);
        done = this.hold >= 1.2;
        break;
      }
      case 'selfie_behind': {
        const ok = ctx.selfieActive && ctx.selfieMonsterInFrame && ctx.selfieMonsterBehind;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt);
        r.progress = clamp01(this.hold / 2);
        done = this.hold >= 2;
        break;
      }
      case 'last_selfie': {
        const ok = ctx.selfieActive && ctx.distanceToEntrance < 18;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt);
        r.progress = clamp01(this.hold / 1.5);
        done = this.hold >= 1.5;
        break;
      }
      case 'hey_call':
      case 'one_last_call':
      case 'one_last_call2':
        r.progress = ctx.monsterKnown || ctx.distanceToEntrance < 20 ? 0.5 : 0.2;
        done = ctx.heyUsedNow;
        break;
      case 'hey_again':
        r.progress = 0.5;
        done = ctx.heyUsedNow && ctx.heyStreak >= 2;
        break;
      case 'hey_look':
        r.progress = ctx.monsterVisible ? 0.6 : 0.2;
        done = ctx.heyUsedNow && ctx.monsterVisible;
        break;
      case 'hey_closer':
        r.progress = clamp01((20 - ctx.monsterDistance) / 12);
        done = ctx.heyUsedNow && ctx.monsterDistance <= 8;
        break;
      case 'hey_selfie':
        r.progress = ctx.selfieActive ? 0.6 : 0.2;
        done = ctx.heyUsedNow && ctx.selfieActive;
        break;
      case 'hey_lights_off':
        r.progress = ctx.lightsOff ? 0.6 : 0.2;
        done = ctx.heyUsedNow && ctx.lightsOff;
        break;
      case 'hey_dont_move': {
        if (this.hold === 0 && ctx.heyUsedNow) {
          this.hold = 0.001;
          this.anchor = { x: ctx.playerX, z: ctx.playerZ, yaw: ctx.playerYaw };
        } else if (this.hold > 0) {
          const moved = Math.hypot(ctx.playerX - this.anchor.x, ctx.playerZ - this.anchor.z);
          if (moved > 2) {
            this.active = null;
            this.hold = 0;
            this.ignoredCount += 1;
            this.cooldown = this.postCooldown;
            this.onExpire?.(r, r.engaged);
            return;
          }
          this.hold += dt;
        }
        r.progress = clamp01(this.hold / 5);
        done = this.hold >= 5;
        break;
      }
      case 'film_the_chase': {
        const ok = ctx.monsterVisible && ctx.chasing;
        this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 0.6);
        r.progress = clamp01(this.hold / 2);
        done = this.hold >= 2;
        break;
      }
    }

    // 「行動で応じた」の定義は進捗50%で統一する。
    // これ未満で時間切れになったものは ignored（＝断った）として数える。
    if (r.progress >= 0.5) this.markEngaged(r);

    if (done) {
      r.progress = 1;
      this.finish(r, r.reward);
    }
  }
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
