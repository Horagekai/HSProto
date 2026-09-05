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
    /**
     * 時間経過による自然上昇。
     * 100 / (30分 * 60秒) = 0.0556。放置だけなら30分で満タンになる速さ。
     *
     * 撮れ高の Novelty はこの値と切り離してある（状態キーに Haunting を含めていない）ので、
     * ここを上げても「待つだけで安全に稼げる」状態には戻らない。
     */
    perSec: 0.055,
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
    /**
     * 無視して時間切れになったときのペナルティ。
     *
     * **v2で 0 にした（§2）。**
     * ペナルティがあると「金が欲しいからやる」ではなく「やらないと損するからやる」になり、
     * Requestが誘惑ではなく命令になってしまう。
     * Viewerが減るのは「Requestを断ったから」ではなく
     * 「新しい撮れ高が無い時間が続いたから」であるべきなので、その役目は Novelty に渡した。
     *
     * 旧仕様と比較したいときは 0.88 / -0.4 に戻す（§48）。
     */
    ignorePenalty: { viewerMult: 1.0, engagement: 0 },
    viewerSpike: 1.3,

    /**
     * 帰ろうとしているときの誘惑リクエスト。
     * 道中の引き止めは ONE MORE SHOT / CALL IT BEFORE YOU GO を使い、
     * **ONE LAST CALL は本当の最後にだけ**取っておく（§23 / §24）。
     */
    temptation: {
      delay: 1.2,
      chance: 0.6,
      maxCount: 3,
      cooldown: 45,
      rewardMult: 2.2,
      rewardBonus: 1500,
      rewardCap: 18000,
    },

    /**
     * Request Director v2。
     * 達成 → すぐ次、をやめて「結果を見せてから次の誘惑」にする（§8 / §37）。
     */
    director: {
      /** 段ごとの次段までの待ち。後半ほど考える時間を長くする（§6） */
      chainDelays: [
        [1.5, 2.5],
        [2.0, 3.0],
        [2.5, 4.0],
        [3.0, 5.0],
        [4.0, 7.0],
      ] as ReadonlyArray<readonly [number, number]>,
      /** 段ごとの継続確率。上に行くほど出にくくする（§10 / §11） */
      continueChances: [0.9, 0.8, 0.7, 0.6, 0.5] as readonly number[],
      /** 怪異・世界の反応を待つ最大時間。何も起きなければ静寂そのものを結果とする（§39） */
      maxConsequenceWait: 5,
      /** 直近このぶんの Request Surface は繰り返さない（§16） */
      recentSurfaceMemory: 3,
      /** 強い反応のあとは、次の新規Chainまでさらに延ばす（§13） */
      afterReactionPause: { min: 3, max: 6 },
    },

    /** Dismiss（明示的に降りる）（§11〜§17） */
    dismiss: {
      /** 誤操作しないよう、押しっぱなしで確定させる秒数 */
      holdTime: 0.55,
    },

    /**
     * ONE LAST CALL のペイオフ（§23〜§27）。
     * 通常のHEYは無反応があってよいが、ここだけは**必ず何かが起こる**。
     */
    lastCallPayoff: {
      /** 即時に何も返らなかった場合、この後に必ず何かを起こす */
      delay: { min: 2, max: 4 },
    },

    /** ONE LAST CALL（本当の最後の誘惑）（§25） */
    lastCall: {
      /** 1ランに1回だけ */
      once: true,
      /** 配信目標を達成していること */
      requireGoal: true,
      /** 入口までこの距離 */
      distance: 8,
      chance: 0.7,
      /** 達成したあとに、さらに第2段階が出る確率（§29） */
      secondStageChance: 0.45,
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
   * Novelty（撮れ高の新規性）と Risk。
   *
   * 狙い:
   *   同じ安全な絵を擦っても稼げない。もっと稼ぎたいなら
   *   「新しいものを見る」「状況を変える」「怪異を刺激する」しかない。
   *
   * ただし **危険そのものが正解にならないように**、価値は
   *   Base × Novelty × Risk × Framing × Activity
   * の掛け算で決める。危ないだけの絵（既知の状態）は伸びない。
   */
  novelty: {
    /** 同じ (対象 + 状態) を何度も見たときの倍率。index = 回数（0 = 初回） */
    table: [1.0, 0.25, 0.05, 0] as const,
    /** 対象ごとの上書き。撮れ高として弱いものは早く枯らす */
    tables: {
      // 調査地点を「触る」ぶんは、仕様どおり3回で実質ゼロ（§2）
      'touch:mirror': [1.0, 0.25, 0.05, 0],
      'touch:doll': [1.0, 0.25, 0.05, 0],
      'touch:phone': [1.0, 0.25, 0.05, 0],
      'touch:locker': [1.0, 0.25, 0.05, 0],
      'touch:photo': [1.0, 0.25, 0.05, 0],
      'touch:altar': [1.0, 0.25, 0.05, 0],
      // 怪異は状態が細かく変わるぶん、同じ状態の枯れ方を少し緩くする
      monster: [1.0, 0.3, 0.08, 0],
      // 異変は一度撮れば十分
      anomaly: [1.0, 0.2, 0.04, 0],
    } as Record<string, readonly number[]>,

    /** この秒数だけ撮り続けたら「1回見た」と数える（一瞬映り込んだだけでは消費しない） */
    minExposure: 1.0,
    /** 画面から外してこの秒数以内に戻せば、同じexposureの続きとみなす */
    regrace: 2.5,
    /** これ以下になったら「もう飽きられている」 */
    staleThreshold: 0.08,
    /** 枯れてから、この秒数以内の行動を「反応」としてKPIに数える */
    reigniteWindow: 25,
    /** これ以下のRiskは「安全」（Safe Farming Earnings Share の判定） */
    safeRiskCeiling: 1.15,

    /**
     * 同じ状態を撮り続けたときの、連続撮影時間による減衰（§10）。
     * 状態が変われば 0 に戻る。**画面から外して時間を置いても回復しない。**
     */
    hold: {
      /** [経過秒, 倍率] の折れ線 */
      curve: [
        [0, 1.0],
        [2, 1.0],
        [5, 0.6],
        [10, 0.2],
        [16, 0.05],
      ] as ReadonlyArray<readonly [number, number]>,
    },

    /** 怪異の距離を段階に落とす境界（この境界をまたぐと別の絵として扱う） */
    distanceBands: [8, 18] as const,

    /**
     * Risk 倍率。プレイヤーには数値を見せない。
     * 1.0 安全 / 1.3 少し危険 / 1.8 危険 / 2.5 非常に危険 になるように積む。
     */
    risk: {
      max: 2.6,
      nearDistance: 5,
      midDistance: 9,
      farDistance: 14,
      near: 0.55,
      mid: 0.3,
      far: 0.12,
      state: {
        dormant: 0,
        observed: 0.05,
        aware: 0.15,
        aggressive: 0.3,
        hunting: 0.5,
        chasing: 0.6,
      } as Record<string, number>,
      stalking: 0.2,
      lunging: 0.35,
      selfie: 0.4,
      lightsOff: 0.3,
      /** HEYを使ってからこの秒数はリスク扱い */
      heyWindow: 6,
      recentHey: 0.25,
      backTurned: 0.2,
    },
  },

  /**
   * 配信の目標額（STANDARD MODE）。
   * 達成後は「安全な撮れ高はもう撮り尽くした」状態を作るため、
   * 発見系の報酬をわずかに下げる。リクエスト報酬は下げない。
   */
  streamGoal: {
    target: 25000,
    /** 達成後の Discovery / Interaction 報酬の倍率 */
    afterGoalDiscoveryMult: 0.7,
  },

  /**
   * HorrorDirector。
   *
   * 「一定時間ごとに何か出してPlayerを飽きさせない」ためのものではない。
   * 何か起こす時と、何も起こさない時を選び、Run全体に呼吸のある曲線を作るための値。
   */
  horror: {
    /** 判断する間隔。毎フレーム選ばない */
    evalInterval: [0.9, 1.6] as [number, number],
    /**
     * Tension の自然減衰（毎秒）。
     * ここが速すぎると Tension が常に底に張り付き、
     * 弱いイベントが延々と選ばれ続けて「波」が消える（実測でRunの95%がT<20だった）。
     */
    /**
     * Tension Envelope。
     * 状況から DesiredTension を出し、ActualTension がゆっくり追従する。
     * KPI のために下限を持ち上げるようなことはしない。中間帯は状況要因から自然に出す。
     */
    envelope: {
      riseSpeed: 0.55,
      fallSpeed: 0.14,
      /** 未解決が重なったときの2件目以降の効き */
      stackFalloff: 0.45,
      unresolvedCap: 46,
      anticipationDecay: 1.1,
      residueDecay: 1.6,
      /** 返事が返ったら結果待ちはこの割合まで下がる */
      answeredRelief: 0.35,
      /** 危険度が低い出来事は、驚いても尾を引かない */
      threatFactor: { safe: 0.5, low: 0.75, medium: 1.0, high: 1.2, lethal: 1.4 } as Record<string, number>,
      constraint: 16,
      hold: 12,
      pendingRequired: 14,
      intentWeight: 12,
      intentCap: 20,
    },
    /** これを超えたら「飽和」。強いイベントのスコアを大きく下げる */
    saturatedTension: 72,
    /** これ未満のスコアの候補は捨てる。低いと弱いイベントが常時ばら撒かれる */
    minScore: 34,
    /** ここを超えると「気のせい」系は後ろに下がる。世界が反応していないように見せない */
    ambientFadeHaunted: 50,
    /**
     * 危険度ごとの解禁 Haunted。
     * 「強い演出」と「実際の危険」を分けたので、安全な山は最初から出せる。
     */
    threatUnlock: { safe: 0, low: 8, medium: 30, high: 55, lethal: 75 } as Record<string, number>,
    /** 未回収の因果（Consequence Intent） */
    intent: {
      urgencyWeight: 62,
      /** 現場と別の部屋で返す方が効く */
      otherRoom: 20,
      farInRoom: 10,
      returning: 14,
      /** latest を過ぎてから諦めるまで */
      graceAfterLatest: 18,
    },
    /** 印象に残る山。Haunted は山の質を決めるが、山の有無は決めない */
    peak: {
      /** この秒数を過ぎると PeakNeed が上がり始め、後ろで 1.0 になる */
      /**
       * 山を出してよい状況かどうか。固定秒数では待たせない。
       * 時間・探索の進み具合・すでに起きた出来事の数から開く。
       */
      opportunity: {
        /** これだけは無条件に待つ。家に入った直後に山は来ない */
        hardFloor: 25,
        timeFrom: 20,
        timeSpan: 70,
        discoveries: 4,
        events: 6,
        threshold: 0.34,
      },
      window: [45, 110] as [number, number],
      needWeight: 34,
      /** Run 序盤に山を出さない。ここを過ぎても一度も無ければ強く押す */
      firstAfter: 70,
      firstBonus: 26,
      maxPerRun: 4,
    },
    ambientFadePerPoint: 0.5,
    ambientFadeMax: 13,
    /** 見ている瞬間に起こす方が効く出来事（遺影の落下など） */
    onScreenBonus: 26,
    offScreenPenalty: 16,
    /**
     * 1Run で一度も出ていないイベントへの下駄。
     * 個別 baseWeight を触らずに、埋もれたイベントを拾えるようにする。
     */
    unusedBonus: 10,
    /** Pressure が高いときだけ最低スコアを上げる。全体一律では上げない */
    minScoreHigh: 55,
    minScoreSaturated: 72,
    /**
     * Director 自身の出力密度。Tension（プレイヤーの緊張推定）とは別物で、
     * 「最近どれだけ刺激を投下したか」を見る。出せることと出すべきことを分ける。
     */
    pressure: {
      /** 指数減衰の係数。半減期およそ14秒 */
      decay: 0.05,
      max: 60,
      bands: [5, 9, 14] as [number, number, number],
      /** intensity rank ごとの減点係数。強いものほど強く抑える */
      penaltyPerPoint: [4.2, 4.6, 5.0, 5.6, 6.0],
      /** Ghost 系への上乗せ */
      ghostExtra: 0.4,
      ghostNearWindow: 14,
      ghostNearPenalty: 40,
      ghostWideWindow: 25,
      ghostWidePenalty: 60,
      /** Family 単位の短期予算 */
      familyWindow: 30,
      familyBudgetPenalty: 16,
      /** Pressure が高いと Nothing が上がる */
      nothingPerPoint: 5.0,
      /** 候補が枯れたら黙る。残りものを出さない */
      scarcityBonus: [30, 15] as [number, number],
    },
    /** 最後の誘惑に乗ったら必ず返事を返す */
    pendingConsequence: {
      earliest: 2,
      latest: 6,
      /** これ以上見たイベントは「返事」として弱い */
      maxSeenBefore: 2,
      fallback: ['BehindFootstep', 'DoorCreak', 'DistantFootstep'],
    },
    /** 危険な行動を自分でやったときの Tension 加算（Risk Tier 1〜5） */
    greedTension: [3, 6, 10, 15, 20],
    /** 危険な行動の直後、無関係なイベントを抑える窓 */
    anticipation: { min: 1.5, max: 5 },
    /** 出来事の強さごとの「間」 */
    relief: {
      minor: [4, 9] as [number, number],
      medium: [6, 12] as [number, number],
      strong: [8, 14] as [number, number],
      chase: [10, 20] as [number, number],
    },
    /** 直近この秒数に、強いイベントをこの数まで */
    strongWindow: 20,
    strongBudget: 1,
  },

  /**
   * HS FLOOR 1 MODE。
   * 本編1階のレイアウトで、Discovery / HOLD / RequestPool Director を検証する。
   */
  floor1: {
    /** 発見できる距離と、カメラに収める判定 */
    discoverDistance: 6,
    /** これだけカメラに収め続けたら「見つけた」 */
    discoverLook: 0.6,
    /** 幽霊はもっと遠くからでも見つかる */
    ghostDiscoverDistance: 16,
    ghostDiscoverLook: 1.4,

    /** [E] で触れる距離 */
    interactRange: 3.0,
    /** 電話が鳴っている時間 */
    phoneRing: { min: 16, max: 26 },
    /**
     * お膳立ての強さ（§30）。
     * 「何が今それを言わせているか」がはっきりしているほど自然な口出しになる。
     */
    setupWeight: {
      object: 12,
      behind: 25,
      ghostLost: 22,
      afterPhone: 18,
      afterHorror: 15,
      roomTransition: 12,
      hallway: 10,
      returning: 16,
      lingering: 12,
      moving: 11,
      quietSuspense: 14,
    } as Record<string, number>,
    /**
     * 状況Requestの文脈（§7, §11, §14）。
     * Eligibility は広くONにして、ここで順位を決める。
     */
    situationContext: {
      /** 関連オブジェクトがこの距離なら候補になれる */
      nearbyDistance: 8,
      /** 最近触った、とみなす秒数 */
      recentWindow: 20,
      roomBonus: 11,
      dist0: 15,
      dist3: 10,
      dist6: 5,
      recent0: 18,
      recent5: 12,
      recent12: 6,
    },
    /** 連鎖の続き（DON'T TURN AROUND → NOW TURN AROUND）への加点 */
    chainBonus: 30,
    /**
     * 世界で今まさに起きていることを Viewer が拾う（§5-6）。
     * 文脈が成立した時だけ乗る。baseWeight を上げるのとは別物。
     */
    coreOpportunity: {
      /**
       * 機会の予算。壁時計ではなく「Offer できた累計時間」で消費する（§3-7）。
       * 別Requestを処理していただけで機会を失わないようにするため。
       */
      budget: { altar: 16, bath: 16, phone: 999, ghost: 14 } as Record<string, number>,
      /** Core が Filler を蹴った後、短時間 Core を優先する */
      reservation: 8,
      /** 今を逃すと機会が消えるものを押す（§25） */
      urgency: { phoneFar: 10, phoneMid: 20, phoneNear: 30, blockedBoost: 8, fading: 6 },
      /** 機会の最中は距離条件をこの倍率まで緩める */
      reachMult: 2.2,
      /** 対象ごとの基礎点 */
      /**
       * 対象ごとの基礎点。電話だけ高いのは、鳴っている間しか成立しない
       * 時間制限つきの出来事だから。幽霊はいつでも撮れる。
       */
      base: { altar: 20, bath: 24, phone: 46, ghost: 20 } as Record<string, number>,
      near: 10,
      lookingAt: 8,
      /** 明確な機会を逃すほど次を押す。Hard Guarantee にはしない（§61） */
      missStep: 6,
      missCap: 18,
      /**
       * Core が Filler より何倍強ければ、どれくらいの確率で Core を選ぶか（§13）。
       * 100% にはしない。電話が鳴っていても「動くな」と言われる Run は残す。
       */
      dominance: [1.2, 1.5, 2.0],
      prob: [0.5, 0.65, 0.78],
    },
    /** 状況Requestの「お膳立て」判定（§10-13） */
    setup: {
      movingFor: 2.5,
      lingeringFor: 4,
      /** お膳立ての寿命（§28） */
      behindLife: 10,
      ghostLostLife: 13,
      afterPhoneLife: 16,
      afterHorrorLife: 12,
      roomTransitionLife: 8,
      /** 何も起きていないのに家がおかしい状態 */
      quietFrom: 10,
      quietSpan: 18,
      quietHaunted: 15,
    },
    /**
     * Object Request の不足（§38-43）。
     * 「調べた対象が増えているのに Object Request が0件」を不自然として扱う。
     * 3個調べたら必ず出す、のような固定保証はしない。
     */
    objectNeed: {
      /** 調べた対象がこの数を超えると need が上がり始める */
      inspectedFrom: 1,
      inspectedTo: 3,
      /** 最後の Object Request からこれだけ経つと need が上がる */
      sinceFrom: 40,
      sinceTo: 110,
      /**
       * Need は救済であって支配項ではない（§3-4）。
       * bonus = needBonus * sqrt(need) で頭を打たせる。互いを減点しない。
       */
      needBonus: 18,
      /** 最後の状況Requestからこれだけ経つと need が上がる */
      situationFrom: 25,
      situationTo: 70,
    },

    /**
     * HOLD。押している間だけ不謹慎な行為が続く。
     * 段に達した瞬間に確定で入り、離せばそこで終わり。ペナルティは無い。
     */
    hold: {
      /** 押し続けられる上限 */
      maxSeconds: 16,
      /** 段を超えた瞬間のViewer反応 */
      viewerSpike: 1.12,
    },

    /**
     * Request を出す「間」。
     * 近くにいることは条件であってトリガーではない。
     * 直前に何か起きていたら、それを理解する時間を残す。
     */
    pacing: {
      /** 候補が出てから実際に提示するまでの最短・最長 */
      offerDelay: { min: 2, max: 5.5 },
      /**
       * 候補の寿命。
       * v1.3 までは出来事のたびに待ち時間を引き直していたので、
       * Horror Event が10秒おきに出るだけで候補が55秒 Pending していた。
       */
      candidate: {
        /** 出来事に譲れる合計秒数 */
        maxDefer: 5,
        /** 対象の近くにいる間は粘る */
        graceNear: 15,
        /** 離れたら早く諦める */
        graceAway: 8,
        /** 何があってもここで捨てる */
        staleTimeout: 20,
      },
      /** 意味のある出来事の直後はこれだけ空ける */
      afterEvent: 3.5,
      /** リクエスト終了後の静寂 */
      afterRequest: { min: 3, max: 8 },
      /** 発見トーストの直後 */
      afterDiscovery: 2.5,
      /** Request 提示直後、無関係な恐怖を重ねない時間 */
      decisionSpace: 3.5,
      /** 何も出さない時間の上限。これを超えたら世界の方を動かす */
      quietLimit: 22,
      /**
       * 状況Request（DON'T TURN AROUND など）を出せる窓。
       * 直前にオブジェクトへ触ってから、この秒数だけ。
       * 過ぎたら「今やったことの続き」ではなくなるので出さない。
       */
      situationWindow: 20,
    },

    /** 段を進む確率。後半ほど出にくい */
    continueChances: [0.85, 0.7, 0.55, 0.4],

    /** 配信目標 */
    goal: { target: 20000, minTime: 120, minDiscoveries: 5 },

    /**
     * 幽霊の段階。
     * Danger だけだと、FLOOR 1 では欲張っても Danger が伸びず幽霊が一生ソファに座ったままだった。
     * 「その家をどれだけ荒らしたか」= Haunted も効かせる。
     *   escalation = max(danger, haunted * hauntedWeight)
     */
    hauntedWeight: 0.62,
    ghost: {
      aware: 18,
      standing: 40,
      stalking: 62,
      chasing: 88,
      /** ソファから立ち上がるまでの溜め */
      standDelay: 1.6,
      /** 画面外でしか位置を変えない */
      relocateCooldown: 12,
    },

    /** Discovery の報酬倍率（Novelty と併用） */
    discoveryLikesMult: 1,
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
export type GameMode = 'standard' | 'one_ghost' | 'floor1';

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
