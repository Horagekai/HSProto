/**
 * HAUNTED STREAMER MVP v2 — ゲームバランス定数。
 * 検証中に触る数値は原則すべてここに置く。
 *
 * v2の設計方針:
 *   「死ぬかどうか」ではなく「もう帰った方がいい。でも、もう一つだけ撮りたい」を作る。
 *   - 普通に撮っているだけではDangerはほとんど上がらない
 *   - 危険は挑発・接近・リクエスト達成など、プレイヤーが押したボタンから生まれる
 *   - 追跡は目的ではなく、欲張った場合のクライマックスの一つ
 */
export const CONFIG = {
  player: {
    walkSpeed: 4,
    runSpeed: 7,
    accel: 45,
    /**
     * 進行方向と視線がずれているときの速度倍率。
     * 「振り返って撮る」= 後ろ歩き = 遅い、という操作レベルのリスクを作る中核パラメータ。
     */
    backwardSpeedMult: 0.55,
    strafeSpeedMult: 0.78,
    /** Selfie中は前が見えない上に少し遅くなる */
    selfieSpeedMult: 0.72,
    eyeHeight: 1.65,
    radius: 0.35,
    mouseSensitivity: 0.0022,
    maxPitch: 1.45,
    stepInterval: { walk: 0.52, run: 0.34 },
  },

  monster: {
    height: 2.35,
    killDistance: 1.5,
    repathInterval: 0.25,
    turnSpeed: 3.2,
    /** 初期位置（最奥の廊下） */
    spawn: { x: 0, z: -18 },
    speed: {
      idle: 0,
      watching: 0,
      /** 距離を保って付いてくる */
      stalking: 2.6,
      /** ゆっくり近づく */
      approaching: 1.5,
      relocating: 3.0,
      chasing: 6.4,
    },
    /** Stalkingで保とうとする距離 */
    stalkDistance: 13,
    /** Approachingで足を止める距離 */
    approachStandoff: 5.0,
    /**
     * 追跡中以外は、怪異のほうからこれ以上近づかない。
     * 「勝手に寄ってきてDangerが上がった」＝ゲームに殺された、を避けるための下限。
     */
    minPlayerDistance: 4.5,
    /** 追跡開始時にこの距離まで引き離す（開幕即死の防止） */
    chaseStartMinDistance: 9,
    chaseStartMaxDistance: 13,
    /** 追跡開始直後の溜め */
    chaseWindup: 0.9,
    /** 行動を選び直す間隔 */
    behaviorInterval: { min: 6, max: 13 },
    /** これ以上プレイヤーの画面に映らないと、近くへ寄ってくる */
    unseenLimit: 22,
    /** Peeking（物陰から半身）の持続時間 */
    peekDuration: 4.5,
    /** 突進フェイント：速度・持続・止まる距離 */
    lunge: { speed: 7.5, duration: 1.1, stopAt: 3.2, cooldown: 9 },
    /** 短時間追跡：継続時間と、諦めたときのDanger低下 */
    shortChase: { duration: { min: 6, max: 9 }, dangerDrop: 12 },
    /**
     * 追跡中に「欲張った」ときの加速。
     * 撮る・自撮り・HEYをするたびに追いつかれやすくなる（撤退戦の中のチキンレース）。
     */
    chaseUrgency: { film: 0.35, selfie: 0.7, hey: 1.6, max: 1.8, decay: 0.25 },
    /** 掴まれた（非致死）ときのDangerリセット先とViewer倍率 */
    grab: { dangerTo: 52, viewerSpike: 1.45, stunTime: 1.6 },
    /** Vanish（消失）の持続時間 */
    vanishDuration: { min: 6, max: 12 },
  },

  danger: {
    max: 100,
    /**
     * Danger値 → 人型怪異の警戒段階。
     * v2.3: 「88未満は完全に安全 / 88で突然死」という崖をなくし、
     * 非致死的な危険を段階的に挟む。
     *   20-40  Observed  見られている
     *   40-55  Aware     ついてくる / 覗く
     *   55-70  Aggressive 突進フェイント（当たらない）
     *   70-85  Hunting   短時間の追跡。捕まっても「掴まれる」だけで死なない
     *   85+    Chasing   本物の追跡。捕まれば死ぬ
     */
    thresholds: { observed: 20, aware: 40, aggressive: 55, hunting: 70, chasing: 85 },

    /**
     * v2: 「普通に撮っているだけ」ではほとんど上がらない。
     * 撮影由来の上昇は合計でも毎秒1前後に抑える。
     */
    visiblePerSec: 0.1,
    centeredPerSec: 0.25,
    lightPerSec: 0.15,
    /** 至近距離だけ強く効く（distance < proximityRange で二乗カーブ） */
    proximityPerSec: 7.0,
    proximityRange: 7,

    /** プレイヤーが自分で押した危険 */
    provoke: 25,
    provokeRange: 14,
    provokeCooldown: 2.0,
    /** 触れるほど近づく */
    touchDistance: 2.0,
    touchPerSec: 18,
    requestAccept: 3,

    /** Selfieで背後に怪異を入れている間 */
    selfiePerSec: 4,

    decayPerSec: 4.0,
    decayDelay: 2.5,
  },

  /**
   * Haunting = 廃墟全体の活性度。Dangerとは別物。
   * 高いほど異変が増え、コメントが加速し、人型怪異が活発に動く。
   * 高くても即追跡にはしない。
   */
  haunting: {
    max: 100,
    start: 5,
    /** 時間経過による自然上昇 */
    perSec: 0.1,
    inspect: 3,
    firstDiscovery: 4,
    requestComplete: 8,
    provoke: 4,
    answerPhone: 8,
    selfieWithMonster: 10,
    nearMonsterPerSec: 0.6,
    /** 人形を抱えている間 */
    carryDollPerSec: 1.2,
    /** 異変の発生間隔（Haunting 0 → 100 で補間） */
    anomalyInterval: { calm: 42, active: 14 },
    /** 人型怪異が行動を起こす頻度の倍率 */
    monsterActivity: { calm: 0.5, active: 1.6 },
  },

  stream: {
    startViewers: [80, 140] as [number, number],
    minViewers: 30,
    maxViewers: 500000,
    discoverySpike: 1.55,

    /**
     * Viewer数は「今の映像の価値」が決める目標値へ追従する。
     *   target = viewerBase * 10 ^ (viewerExponent * sqrt(clipEffective / viewerClipRef))
     */
    viewerBase: 100,
    viewerExponent: 2.0,
    viewerClipRef: 600,
    viewerEngInfluence: 0.15,
    viewerRiseSpeed: 0.55,
    viewerDecaySpeed: 0.09,
    deathSpike: 1.8,
    surgeGrowth: 0.05,

    /** clipEffective=100, engagement=1, viewerFactor=1 のときの毎秒Likes */
    likesPerSec: 45,
    likeEngInfluence: 0.35,
    likeViewerFloor: 0.5,
    likeViewerScale: 8000,
    likeViewerCap: 2.5,

    /** Likes → 円 */
    yenPerLike: 1.5,

    engagement: {
      min: 1,
      max: 8,
      clipGain: 2.2,
      chaseFilmBonus: 2.0,
      riseSpeed: 1.6,
      fallSpeed: 0.32,
    },

    clip: {
      maxDistance: 22,
      minDistance: 2.0,
      centerWeight: 30,
      proximityWeight: 26,
      /** 人型怪異の状態ボーナス */
      monsterStateBonus: {
        dormant: 0,
        observed: 6,
        aware: 12,
        aggressive: 22,
        hunting: 26,
        chasing: 30,
      },
      monsterBase: 16,
      movingBonus: 7,
      lookingAtYouBonus: 9,
      /** 追跡中に画面に入れているだけで ×4、中央に捉えると ×6 */
      chaseFilmMultiplier: 4,
      chaseCenteredMultiplier: 6,
      chaseCenterThreshold: 0.55,
      /** Selfieに怪異が入っているときの倍率（距離が近いほど高い） */
      selfieMultiplier: { far: 1.8, near: 3.5, nearDistance: 4, farDistance: 16 },
      smooth: 7,
      starThresholds: [6, 25, 45, 70, 110, 220],
      /**
       * 同じ対象を撮り続けると価値が下がる。
       * freshness = 1 で満額、freshnessMin まで低下する。
       */
      freshnessDecayPerSec: 0.09,
      freshnessRecoverPerSec: 0.035,
      freshnessMin: 0.25,
    },
  },

  /**
   * テンポ管理。
   * 「探索時間」ではなく「短い意思決定の回数」でプレイ時間を伸ばすための中核。
   * 何も起きない時間が quietLimit を超えたら、ディレクターが強制的に何かを起こす。
   */
  tempo: {
    /** これ以上「何も起きない」状態を続けない（秒） */
    quietLimit: 22,
    /** 強制発生後のクールダウン */
    forceCooldown: 12,
    /** 意思決定がこれ以上途切れたら、リクエストを前倒しする */
    decisionLimit: 55,
    /** 目標値（リザルトのテンポ分析で判定に使う） */
    targetEventGap: 30,
    targetDecisionGap: 60,
  },

  /** 異変（プレイヤーを殺さないコンテンツ） */
  anomaly: {
    /** 最初の異変までの時間 */
    firstDelay: 18,
    /** 同時に存在できる数 */
    maxActive: 2,
    /** 発生後の持続時間 */
    duration: {
      door_slam: 12,
      light_flicker: 9,
      doll_moved: 90,
      mirror_figure: 14,
      phone_ring: 26,
      noise: 20,
      shadow_figure: 3.2,
    } as Record<string, number>,
    /**
     * Hauntingがこの値を超えるまで発生しない。
     * 静かな配信が、プレイヤー自身の行動で徐々に壊れていく順番を作る。
     */
    unlockHaunting: {
      noise: 0,
      light_flicker: 0,
      door_slam: 0,
      doll_moved: 0,
      mirror_figure: 10,
      phone_ring: 28,
      shadow_figure: 34,
    } as Record<string, number>,
    /** 撮影価値（Clip Valueの基礎値） */
    value: {
      door_slam: 42,
      light_flicker: 55,
      doll_moved: 48,
      mirror_figure: 62,
      phone_ring: 38,
      noise: 30,
      shadow_figure: 70,
    } as Record<string, number>,
    /** 初回発見ボーナス（Likes） */
    firstDiscoveryLikes: 320,
    /** プレイヤーからこの範囲で発生させる */
    spawnRange: { min: 6, max: 26 },
  },

  /**
   * HEY（呼びかけ）。
   *
   * 「Dangerを+25するボタン」にはしない。
   *   - 姿が見えないときは、反応で位置が分かる（情報）
   *   - 怪異を誘導できる（Lure）
   *   - 撮影中に使うと、こちらを見てくれて映像価値が跳ねる
   * その代わり、自分の位置を知らせるという明確なリスクを常に伴う。
   * 連打するほど反応がエスカレートする（Provocation Streak）。
   */
  hey: {
    cooldown: 1.1,
    /** この時間内に続けて使うと連打として扱う */
    streakWindow: 14,
    /** 反応が返る最大距離 */
    range: 32,
    /** 声が届く距離（誘導に使える範囲） */
    lureRange: 26,
    lureDuration: 7,
    /** 連打回数ごとのDanger上昇（近いほど倍率が乗る） */
    streakDanger: [5, 10, 17, 26],
    /** 距離0で×2、range で×0.35 */
    distanceScale: { near: 2, far: 0.35 },
    hauntingPerUse: 3,
    /** Likes（画面に入れている / 自撮り中はさらに大きい） */
    likes: { base: 70, onScreen: 260, selfie: 480 },
    viewerSpike: { base: 1.03, onScreen: 1.13 },
    /** 反応が遅れて返ってくる確率と、その遅延 */
    delayedChance: 0.28,
    delay: { min: 2, max: 4 },
    /** こちらを見続ける時間 */
    lookDuration: 4,
  },

  /** 調査地点 */
  inspect: {
    range: 2.8,
    /**
     * 段階的な欲張り（Likes）。
     *   見る → 異変が起きる → 触る → 一緒に自撮り
     * 「見るだけ」では稼げず、もう一段踏み込みたくなるようにする。
     */
    tiers: {
      see: 100,
      anomaly: 300,
      touch: 1500,
      selfie: 4000,
    },
    /** Selfieで一緒に写ったと判定する距離 */
    selfieRange: 6,
    /** 調査そのものの報酬（Likes）。tiers.touch と合わせて入る */
    likes: 180,
    /** 同じ地点を再調査しても価値は下がる */
    repeatLikesMult: 0.25,
    cooldown: 1.0,
    /** 調べたあとに関連する異変が起きる確率と、その遅延 */
    anomalyChance: 0.7,
    anomalyChanceRepeat: 0.2,
    anomalyDelay: { min: 3, max: 11 },
  },

  /**
   * 視聴者リクエスト。
   *
   * v2.3の方針:
   *  - [F]ACCEPTを廃止。**行動そのものが受諾/辞退**（クエストUI感を消す）
   *  - 「目的地へ行くだけ」を廃止。到着後にもう一段の選択を出す
   *  - 場所へ行かせるより、**既存の行動に制約を足す**タイプを増やす
   *  - 低報酬のものは普通に断って良い（受諾率50〜70%を狙う）
   */
  request: {
    firstDelay: 14,
    /** 通常リクエストの間隔。異変から生まれる「反応リクエスト」は別枠で割り込む */
    interval: { min: 45, max: 90 },
    /** どんな理由でもリクエスト同士はこれ以上詰めない */
    minGap: 14,
    /** 達成/失敗直後にすぐ次を出さない */
    postCompleteCooldown: 15,
    /** 異変を目撃してから、それに紐づくリクエストが来るまで */
    reactionDelay: { min: 2, max: 5 },
    /** 1ランで提示する最大数 */
    maxCount: 14,
    /** 到着後の第二段階に与える時間 */
    stage2Time: 18,
    /** 第二段階で「もう一歩踏み込む」選択をしたときの報酬倍率 */
    stage2Bonus: 2.2,
    /**
     * 目的地系リクエストを出したとき、帰路に仕込む異変の数とタイミング。
     * 「行って戻るだけ」を無くすための仕掛け。
     */
    journeyEvents: { count: 2, delay: { min: 3, max: 9 } },
    /** 無視して時間切れになったときのViewer離脱 */
    ignorePenalty: { viewerMult: 0.88, engagement: -0.4 },
    viewerSpike: 1.3,

    /** 帰ろうとしているときの誘惑リクエスト */
    temptation: {
      delay: 1.2,
      chance: 0.6,
      maxCount: 3,
      cooldown: 45,
      rewardMult: 2.2,
      rewardBonus: 1500,
      rewardCap: 18000,
    },
  },

  /** 「帰ろうとしている」判定 */
  leaving: {
    /** この距離まで戻ってきていること */
    entranceDistance: 40,
    /** ここまで近づいたら、撮れ高に関係なく「帰ろうとしている」とみなす */
    nearEntranceDistance: 14,
    /** 怪異も異変も映していない時間 */
    lowClipDuration: 3.5,
    approachDuration: 2.0,
    minEarnings: 3000,
  },

  entrance: {
    /** 入口（=出口）の位置 */
    x: 0,
    z: 33,
    /** [E] で配信終了できる範囲 */
    range: 3.4,
    /** 収支表示を出す範囲 */
    promptRange: 12,
  },

  result: {
    /** 死亡時に失う割合 */
    deathPenalty: 0.7,
    /** 生還ボーナス */
    survivalBonusRate: 0.2,
    survivalBonusFlat: 5000,
  },

  chat: {
    base: 1.7,
    minInterval: 0.12,
    maxInterval: 2.4,
    maxVisible: 9,
  },

  /**
   * ONE GHOST MODE。
   *
   * 通常モード（廃墟とViewer Requestが主役）とは分離した検証モード。
   * マップに怪異は一体だけ。環境怪異・調査地点・おつかいリクエストを止め、
   * 「一体の危険な存在と、どこまで関係を深めるかを自分で決める」だけで成立するかを見る。
   *
   * 通常モードの数値には一切影響しない。ここを触っても STANDARD MVP は変わらない。
   */
  oneGhost: {
    /**
     * 開幕位置。部屋の最奥に立っている（§4：長い探索をさせない）。
     * 入口(0,33)から26m。姿は最初から見えているが、
     * 下の discoverDistance まで近づくまで配信は反応しない。
     * 「見えている → でも何も起きない → 一歩踏み込む → 跳ねる」を作るための距離。
     */
    monsterSpawn: { x: 0, z: 5 },
    /** ここまで自分から近づいて初めて「発見」になる（§5） */
    discoverDistance: 20,
    /**
     * 入口の収支パネルを出す距離。
     * 一部屋なので通常モードの12mだと部屋の1/3で出っぱなしになる。
     */
    entrancePromptRange: 6,
    /**
     * 接近そのもののDanger。
     * このモードでは距離こそがゲームなので、通常モードより広く・強く効かせる。
     * decayPerSec(4) を上回るのは約7m以内。
     */
    proximity: { proximityPerSec: 16, proximityRange: 9 },
    /**
     * Dangerの自然低下（毎秒・常時）。
     * 通常モードは「上昇が0の間だけ減る」が、このモードでは怪異を撮り続けるのが常態なので、
     * それだと撮っているだけでDangerが100まで登ってしまう。
     * 常に引くことで「約7.5mより外なら、いくら撮っても安全」を作る（§13）。
     */
    dangerDecayPerSec: 1.2,
    /** 発見した瞬間の報酬（§5 軽いMoney feedback） */
    discoveryBonus: 800,
    discoverySpike: 1.7,
    /** 怪異しか被写体がないので、撮影価値そのものを底上げする */
    monsterClipMult: 1.35,

    /**
     * Danger = 怪異との関係の悪化度。
     * STALKING（内部 aggressive）の帯を一番広く取り、
     * 「あいつさっきより近くない？」の時間を長くする（§15）。
     */
    thresholds: { observed: 15, aware: 32, aggressive: 46, hunting: 72, chasing: 90 },

    /**
     * HEY のDanger。通常モードより緩い。
     * 4回押しただけで CHASING まで行くと「自分で決めた」感覚が消えるため、
     * 4回でおよそ STALKING〜AGGRESSIVE 止まりになる値にしてある（§24/§25）。
     */
    hey: {
      streakDanger: [4, 8, 13, 20],
      distanceScale: { near: 1.5, far: 0.35 },
    },

    /** Stalking中、こちらが見ている間は止まる。見ていない間に詰めてくる（§15） */
    stalkFreezeCenter: 0.25,
    /** 視界外のときに詰めてくる距離 */
    stalkDistanceHidden: 6.5,

    /**
     * 追跡は「撤退戦」。10〜15秒で決着し、逃げ切れば怪異はSTALKINGへ戻る（§17/§19）。
     * ここでゲームが終わらないことが、§20「また戻れる」の前提になる。
     */
    chase: {
      /**
       * 追跡開始時の溜め。
       * このモードでは怪異を瞬間移動させない（見ている前で消えるのは§31に反する）ので、
       * 代わりに「一拍置いてから走り出す」ことで逃げる判断の時間を作る。
       */
      windup: 1.5,
      /**
       * 追跡速度（通常モードは6.4）。
       * 一部屋では長い直線が取れず、角を曲がるたびに詰められる。
       * 走る(7.0)との差を 1.2 m/s 取って、**普通に逃げれば逃げ切れる**ようにする（§17）。
       * 撮る・自撮り・HEYで最大+1.8されるので、欲張れば追いつかれる（§18）。
       */
      speed: 5.8,
      /** これ未満では諦めない。必ず10〜15秒の撤退戦になる（§17） */
      minDuration: 10,
      /**
       * これを超えたら諦める。
       * 一部屋で走って追いかけっこをすると、距離は約4〜5mで平衡してしまい
       * escapeDistance には永遠に届かない。時間で必ず決着させることで、
       * 「10〜15秒の撤退戦」を成立させる（§17）。
       */
      maxDuration: 15,
      /**
       * この距離を保ち続けたら逃げ切り。
       * 一部屋なので長い直線が取れない。柱を使って回り込み続けることになる。
       */
      escapeDistance: 15,
      escapeTime: 1.6,
      /** 諦める最低距離（掴まれる寸前でなければよい） */
      giveUpDistance: 2.5,
      /**
       * 一部屋なので、逃げ道は「扉まで戻る」か「部屋を周回して振り切る」かの二択しかない。
       *
       *   扉まで戻る   … 確実だが短い。撮影を切って走り出す決断が要る
       *   周回して振り切る … 10秒以上かかるが、その間も撮り続けられる
       *
       * さらに、追われている最中でも扉で [E] を押せば配信を畳んで全額持ち帰れる。
       * 「扉はすぐそこ。今降りれば全部持って帰れる。でも降りたら今日はもう終わり」
       */
      entranceSafe: 3.5,
      /**
       * ただし扉に着いた瞬間には解除しない。
       * 部屋の端から端まで走っても5秒なので、そのままだと追跡が一瞬で終わる。
       * 扉に着いてからも数秒は粘る必要がある＝そこで [E] を押すか迷うことになる。
       */
      entranceSafeAfter: 5,
      /** 逃げ切ったあとのDanger（＝AWARE〜STALKINGへ戻る） */
      dangerAfter: 44,
      /**
       * 逃げ切った直後、この秒数は再追跡しない。
       * 「帰るか、もう一度撮りに行くか」を落ち着いて決める時間を必ず作る（§20）。
       */
      lockout: 14,
    },

    /** リクエストは少数・短間隔。行動そのものが回答（§8/§10） */
    request: {
      firstDelay: 10,
      interval: { min: 20, max: 34 },
      minGap: 8,
      postCompleteCooldown: 6,
      maxCount: 40,
      /** チキンレースの段が続く確率 */
      continueChance: 0.85,
      /** 次の段が出るまで */
      chainDelay: { min: 1.6, max: 3.0 },
      /** §9 の報酬ラダー */
      chainRewards: [500, 1500, 3000, 6000, 10000, 15000],
      /** §28 Selfie Chicken Race */
      selfieChainRewards: [5000, 10000, 15000],
      /** §18 追跡中の欲張りリクエスト */
      chaseReward: 8000,
      /** §20 入口からの ONE LAST CALL */
      lastCallRewards: [12000, 20000],
    },

    /** 環境演出は最低限（§32）。静かすぎるときだけ怪異側が動く */
    beat: {
      /** ライトの明滅を混ぜる確率。残りは怪異自身の行動 */
      lightChance: 0.25,
    },

    /**
     * 「帰ろうとしている」判定。
     * 一部屋なので入口が常に近い。通常モードの距離のままだと、
     * 部屋の真ん中に立っているだけで誘惑が飛んでくる。
     */
    leaving: {
      entranceDistance: 20,
      nearEntranceDistance: 7,
      lowClipDuration: 3.5,
      approachDuration: 2.0,
      minEarnings: 3000,
    },

    /** KPI用のしきい値（§39） */
    kpi: {
      /** ここまで近づいたら「接近した」 */
      approachDistance: 10,
      /** ここまで離れたら「引いた」 */
      retreatDistance: 22,
      /** 入口に立ったあと、ここまで奥へ入り直したら「帰れるのに戻った」 */
      reenterDistance: 16,
    },
  },

  log: { sampleInterval: 0.2 },

  audio: { master: 0.6 },

  render: {
    fogDensity: 0.038,
    far: 120,
    /** これより遠い対象は「映っていない」扱いにする */
    maxFilmDistance: 30,
    ambient: 1.7,
    hemi: 0.9,
    flashlightIntensity: 70,
    flashlightRange: 42,
    lampRange: 15,
    /** 同時に有効にする蛍光灯の数（点光源は数が多いと重い） */
    maxActiveLamps: 8,
    /** Selfie時のカメラ距離（腕の長さ）と、そのときのライト減衰 */
    selfieCameraDistance: 1.35,
    selfieLightScale: 0.35,
  },
};

/**
 * 検証モード。
 *  standard  : 廃墟 + Viewer Request + 環境怪異（通常のMVP）
 *  one_ghost : 怪異一体だけ。距離・撮影・挑発・撤退だけで遊ぶ
 */
export type GameMode = 'standard' | 'one_ghost';

export type MonsterState =
  | 'dormant'
  | 'observed'
  | 'aware'
  | 'aggressive'
  | 'hunting'
  | 'chasing';

export type MonsterBehavior =
  | 'idle'
  | 'watching'
  | 'stalking'
  | 'peeking'
  | 'relocating'
  | 'approaching'
  | 'lunging'
  | 'vanished'
  | 'chasing';

export type AnomalyType =
  | 'door_slam'
  | 'light_flicker'
  | 'doll_moved'
  | 'mirror_figure'
  | 'phone_ring'
  | 'noise'
  | 'shadow_figure';

export type InspectType = 'mirror' | 'doll' | 'phone' | 'locker' | 'photo' | 'altar';
