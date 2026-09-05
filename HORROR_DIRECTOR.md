# Horror Director v1.3

[`src/systems/horrorDirector.ts`](src/systems/horrorDirector.ts) /
[`src/systems/horrorEvents.ts`](src/systems/horrorEvents.ts)

Horror Event Generator ではなく **Pacing Director**。

仕事は「怖いイベントを出すこと」ではなく、
**「今は何か起こすべきか、それとも何も起こさないべきか。起こすなら今の状況に最も自然な恐怖は何か」**
を判断すること。したがって `Nothing` は正式な候補として同じ土俵でスコアを競う。

---

## 1. RequestDirector との役割分担

| | 問い | 出すもの |
| --- | --- | --- |
| RequestDirector | 今プレイヤーに何をやらせたら誘惑として面白いか | TAKE A SIP / KEEP LISTENING / DON'T TURN AROUND |
| **HorrorDirector** | 今、世界側が何を返したら怖い／自然か | 足音 / 明滅 / 遠くの鈴 / 電話 / 幽霊の移動 |

HorrorDirector は Viewer Request を作らない。Ghost の経路も決めず、
`STAND / PEEK / REPOSITION / CROSS / FAKE_RUSH` という**行動要求**だけを出す。
互いの内部関数を呼び合わず、Context を読む形にしてある。

## 2. Haunted と Tension を分ける

| | 意味 | 性質 |
| --- | --- | --- |
| **Haunted** | 世界がどれだけ危険・異常になったか | Run全体。プレイヤーの欲張りで上がる。下がらない |
| **EstimatedTension** | 今この瞬間、演出的にどれくらい圧迫しているか | 短期。毎秒 1.8 で減衰 |

Haunted 100 でも Chase 直後なら Tension も高い。そのとき Director は**むしろ黙る**。

```text
Haunted = escalation ceiling
Tension = current pacing pressure
```

Tension の加算:

```text
subtle 6 / minor 12 / medium 20 / strong 34 / climax 62
自分から危険な行動 Risk Tier 1〜5 → +3 / +6 / +10 / +15 / +20
```

## 3. Gate

Utility ではなく明確な禁止条件。

```text
Chase 中          → 通常の恐怖判定を止める（Chase 自体が十分な恐怖）
Relief Window 中  → 出さない
予約済みイベント中 → 出さない
```

Relief Window は出来事の強さで長さが変わる（毎回ランダム）。

```text
minor  3〜6秒 / medium 5〜9秒 / strong 8〜14秒 / Chase後 10〜20秒
```

## 4. Anticipation Window

プレイヤーが危険な行動をした直後 1.5〜5秒は、**因果関係のあるイベントだけ**を検討する。
無関係なイベントは `anticipation_unrelated` で却下。Nothing も許可。

## 5. Utility Score

```text
Score = BaseWeight
      + TensionFit        その帯なら +12、外れるほど減点
      + HauntedFit
      + PacingNeed        Dryness × 26（弱いものだけ。強いものは ×6）
      + Focus             見ている対象なら +18、背後系は周辺なら +10
      + WorldMemoryMatch  +34、記憶が古いほど +最大18、現場を離れていれば +26
      + Returning / Overtime / FinalTemptation
      - RecentRepeat      同じIDは -28/回
      - FamilyRepeat      同じ系統は -14/回
      - Saturated         Tension 72超で全体に減点
```

`Nothing` は逆向きに積む。

```text
Tension が高い          + (tension-60) × 1.3
直前に強い出来事        + (18-sinceStrong) × 2.2
直前に何か起きた        + (8-sinceHorror) × 3
Dryness                 - dryness × 46
Haunted が高い          - 10
Constraint / HOLD 中    - 8
```

## 6. Dryness は強制しない

「22秒経ったら必ずイベント」にはしない。
`sinceMeaningfulEvent` から 0〜1 の `PacingNeed` を出し、**スコアに加点するだけ**。
30秒静かでも、文脈的に Silence が良ければ Nothing が勝ってよい。

## 7. 選択

最高スコアを必ず選ぶと決定論的になるので、
`score >= 34` の候補を上位5件まで取り、**重み付き抽選**する。

## 8. World Memory は即時トリガーではない

`bath_sip_2 = true` → すぐ水音、ではない。
記録すると**関連イベントのスコアが上がるだけ**で、時機は Director が選ぶ。

現場を離れているほど、記憶が古いほど強く加点する。
仏壇の前で鈴が鳴るより、洗面所へ移ってから鳴る方が「まだ続いている」感が出る。

## 9. Ghost の段階

FLOOR 1 の幽霊は Danger だけでは動かなかった（欲張っても Danger が伸びない）ので、
**家をどれだけ荒らしたか** も効かせている。

```text
escalation = max(danger, haunted × 0.62)
SEATED → AWARE(18) → STANDING(40) → STALKING(62) → CHASING(88)
```

空間移動は `requiresGhostOffscreen` により**画面内では絶対に起きない**。

## 10. ログ

```text
horror_event_triggered   event_id / family / intensity / haunted / tension / room / ghost / memory
world_memory_created     memory / haunted
world_memory_used        memory / event
request_completed_event  requestId / riskTier / object
```

`[P]` のデバッグパネルに Tension / Pacing Need / 最後の恐怖からの秒数 /
Relief・Anticipation の残り / 候補とスコア / 却下理由 / 選択結果 を表示する。

---

## 11. 不変条件テスト

```js
const t = await import('/src/dev/horrorTests.ts');
console.table(t.runHorrorTests());
```

```text
PASS  chase中は通常イベントを出さない          [fired=0]
PASS  画面内では幽霊を瞬間移動させない          [bad=none]
PASS  cooldownが守られる
PASS  強いイベントが連続しない                  [backToBack=0]
PASS  記憶が無ければ記憶イベントは出ない        [bad=none]
PASS  oncePerRunが複数回出ない                  [bad=none]
PASS  Nothingが候補に入る
PASS  Tensionが0-100に収まる
PASS  高Tensionで強いイベントが下がりNothingが上がる  [nothing 30→82]
PASS  強いイベントの直後に間が入る              [minGap=9.4s need>=8]
                                                 10/10
```

## 12. 5ラン実測

```js
const bot = await import('/src/dev/floor1Bot.ts');
console.table(bot.runAllFloor1());
```

| Run | 時間 | 収益 | Haunted | Ghost | 件数(強) | 平均間隔 | 沈黙率 | 系統 | 反復 | 記憶連動 | T>80 | T<20 | 強連続 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A 安全 | 3.4分 | ¥3,517 | 25 | seated | 8 (0) | 27.1s | 94% | 3 | 0% | 0% | **0%** | 100% | 0 |
| B Request多め | 5.3分 | ¥15,382 | 92 | standing | 37 (1) | 8.7s | 61% | 7 | 0% | 11% | **0%** | 56% | 0 |
| C 挑発多め | 3.2分 | ¥44,449 | 100 | **chasing** | 18 (2) | 9.8s | 68% | 7 | 0% | 17% | **25%** | 11% | 0 |
| D 逃げて戻る | 6.1分 | ¥14,653 | 100 | stalking | 32 (3) | 11.6s | 79% | 7 | 0% | 0% | **13%** | 60% | 0 |
| E 欲張り | 4.6分 | ¥18,981 | 96 | **chasing** | 23 (1) | 12.2s | 82% | 6 | 0% | 4% | **1%** | 82% | 0 |

Event sequence は5ランすべて異なる。同じイベントの連続は0%。

```text
A: HouseSettle → LightFlicker → DoorCreak → PortraitTilt → LightFlicker
   → DistantFootstep → BehindFootstep → HouseSettle

C: HouseSettle → LightFlicker → DistantFootstep → DistantBell → GhostStand
   → PortraitTilt → GhostReposition → BehindFootstep → LightFlicker → GhostPeek
   → DistantBell → FakeRush → DistantFootstep → LightFlicker → BehindFootstep
   → DistantBell → GhostReposition → MirrorAnomaly

E: … → GhostReposition → LightFlicker → DoorCreak → GhostStand → HouseSettle
   → GhostPeek → SofaEmpty
```

Run C は仏壇を長く鳴らして `altar_overplayed` を作り、その後別の部屋で `DistantBell` が
3回鳴っている。Run E は Selfie の後に `SofaEmpty`（ソファが空になっている）で終わっている。
どちらも「自分がやったことへの返事」になっている。

---

# v1.1 — Global Horror Pressure / Low-Haunted Ambient / Last Temptation Guarantee

v1 のプレイテストで出た3点を直したもの。

## 13. Horror Pressure

v1 は個別イベントに `maxPerRun` を付けただけだったので、**環境イベントが枯れた枠を
Ghost イベントが埋めて** Run B が平均 8.7 秒間隔になった。
個別の上限では「Run 全体で今どれだけ刺激を与えたか」を管理できていなかった。

| | 意味 |
| --- | --- |
| **EstimatedTension** | 今プレイヤーがどれくらい緊張していると推定するか（プレイヤー心理） |
| **HorrorPressure** | Director が最近どれだけイベントを投下したか（**自分の出力密度**） |

```text
加算  subtle +5 / minor +7 / medium +11 / strong +16 / climax +22
      Ghost Visual・Spatial +3 / Fake Rush +5 / Chase +7
減衰  指数減衰（半減期およそ14秒）
帯    0-5 LOW / 5-9 NORMAL / 9-14 HIGH / 14+ SATURATED
```

**減衰を定数にしてはいけない。** 定数減衰だと Pressure の絶対値が
「どの種類のイベントが支配的か」で決まってしまい、安い環境音が並ぶだけで
Pressure が天井に張り付き、Ghost が Run 中ずっと 0 件になった（実測）。
指数減衰にすると Pressure が「直近の刺激密度」そのものを表す。

Pressure が高いほど:

```text
Nothing                 + (P - 5) × 5.0
subtle / minor / medium - (P - 5) × 4.2 / 4.6 / 5.0
strong / climax         - (P - 5) × 5.6 / 6.0
Ghost 系                さらに - (P - 5) × 0.4
```

`minScore` も Pressure で動かす（全体一律では上げない）。

```text
LOW / NORMAL  34
HIGH          55
SATURATED     72
```

## 14. Ghost Chain 防止

```text
14秒以内に Ghost イベント        → -40
25秒以内に Ghost イベント 2件    → -60
同 Family が直近30秒に1件ごとに   → -16
```

`maxPerRun` は「同じものの擦りすぎ」防止として残す。役割を分ける。

```text
maxPerRun       = content repetition protection
HorrorPressure  = pacing density protection
```

## 15. 候補が枯れたら黙る

残りものを出さない。

```text
Nothing以外の候補が2件以下 → Nothing +15
1件以下                    → Nothing +30
```

## 16. 低 Haunted 用の語彙

v1 の安全プレイは `LightFlicker / HouseSettle / DoorCreak` の3種しか出ず、
すぐパターンが読めた。明確な幽霊イベントを増やすのではなく、
**「今なんか鳴った？」で止まる違和感** の語彙を10種足した。

| Family | Event |
| --- | --- |
| AMBIENT_HOUSE | HousePop / FloorCreakDistant |
| AMBIENT_WATER | PipeKnock / DistantWaterDrop |
| AMBIENT_ELECTRIC | FridgeHumStop / TVStaticTick / PhoneClick |
| AMBIENT_OBJECT | LightCordSway / ObjectTinyShift |
| AMBIENT_LIVING | FabricRustle |

すべて `subtle`（`ObjectTinyShift` のみ `minor`）。断定するヒントは出さず、45%の確率でしか出さない。

同じ `HousePop` でも毎回同じに聞こえないよう、**音源方向・距離・variant** を振る。
全部を背後から出すとすぐ読まれるので、方向は定義側の `sources` から選ぶ。

```text
ambient_family=AMBIENT_WATER variant=2 source=ahead source_room=washroom target_room=bath distance=8.9
ambient_family=AMBIENT_LIVING variant=1 source=distant_room source_room=hallway target_room=ldk distance=16.2
```

環境系の `baseWeight` は 30〜34。Ghost 系（44〜48）より低い **ノイズフロア** として扱う。
同じ重みにすると全部を押しのけて、Run 全体が環境音だけになる（実測）。

さらに `haunted > 50` では環境系を後ろに下げる。
家が荒れているのに「気のせい」ばかり返すと、世界が反応していないように見えるため。

## 17. Last Temptation は必ず返事を返す

v1 は `finalTemptationTaken → score +26` だけで、**保証になっていなかった**。
v1.1 では予約そのものを持つ。

```text
Last Temptation 実行
  → PendingConsequence{ required: true, earliest: +2s, latest: +6s, contextTags }
  → earliest まで通常イベントを止める（短い溜め。即ジャンプスケアにしない）
  → Meaningful な候補だけを Utility でスコアし、Nothing を候補から外して抽選
  → latest が近づくと urgency +最大100
  → 候補が全滅したら fallback（BehindFootstep / DoorCreak / DistantFootstep）
```

Meaningful でないもの:

```text
Nothing
subtle（ほとんど聞こえない環境音）
AMBIENT_* すべて
今回の Run で既に2回以上見たもの
```

**何が返るかは固定しない。** Pressure が SATURATED なら strong を -45 して、
Meaningful だが軽い結果へ寄せる（§38）。

出口で Run が終わりそうな場合は、`leaveSite()` の直前に未解決の予約をその場で返す。
プレイヤーを足止めはしない。

## 18. 検証

不変条件テスト 10/10（v1 と同じ）に加えて、Run タイプ別のシナリオテストを追加。

```js
const s = await import('/src/dev/horrorScenarios.ts');
console.table(s.runScenarios());
```

```text
PASS  A Safe: 低Hauntedの語彙       unique=15 families=8
PASS  B Greedy: 密度制御            avgGap=15.3s short(<6s)=1/27 maxPressure=29.3
PASS  C Ghost-heavy: Ghost連発なし  ghost=12/28 (43%) within10s=0
PASS  D 枯渇: Ghostで埋めない       events=6/90s ghost=3 chained=0 silence=81%
PASS  E LastTemptation: 必ず返事    fired=30/30 avgLatency=2.8s unique=7
```

Scenario D が今回のバグ再現ケース。
`LightFlicker / HouseSettle / DoorCreak / DistantFootstep` と環境系すべてを
使い切った状態から 90 秒回して、Ghost が空いた枠を埋めないことを見る。

Last Temptation は通常 Run では到達を待つしかないので、強制する操作を用意した。

```js
const f1 = window.__HS.dev.floor1();
f1.forceLastTemptation();   // FORCE STREAM GOAL → RETURNING → 提示
f1.forceTake();             // 乗る
```

## 19. 5Run 実測（v1 → v1.1）

| Run | 件数 | 平均間隔 | 中央値 | 範囲 | 系統 | Ambient | Ghost | 強 | 強連続 | 反復 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A 安全 | 21 | 10.0s | 10.1 | 5.0–12.8 | 8 | 8種/5系統 | 0 | 0 | 0 | 0% |
| B Request多め | 30 | 10.2s | 10.0 | 7.4–16.6 | 9 | 9種/5系統 | 1 | 1 | 0 | 0% |
| C 挑発多め | 36 | 10.9s | 10.5 | 5.4–19.4 | 12 | 10種/5系統 | 4 | 1 | 0 | 0% |
| D 逃げて戻る | 31 | 11.9s | 11.3 | 7.4–18.9 | 11 | 10種/5系統 | 4 | 1 | 0 | 0% |
| E 欲張り | 31 | 13.1s | 11.3 | 4.8–34.4 | 13 | 9種/5系統 | 5 | 2 | 0 | 0% |

```text
v1  Run B: 平均 8.7s / 系統 7 / Ghost が枠を埋める
v1.1 Run B: 平均 10.2s / 系統 9 / 6秒未満の間隔 0件
v1  安全Run: LightFlicker / HouseSettle / DoorCreak の3種のみ
v1.1 安全Run: 8種 5系統
```

Run E（欲張り）の終盤が §52 の狙い通りになっている。

```text
… → ObjectTinyShift → GhostPeek → SofaEmpty → OwnVoice → DistantPhone
  → BehindFootstep → FakeRush → GhostReposition → GhostPeek
```

Ghost が続くのではなく、World Memory の結果（SofaEmpty / OwnVoice / DistantPhone）が
間に挟まっている。

---

# v1.2 — Safe Suspense Peak / Tension Envelope / Consequence Intent

v1.1 の 5Run で出た3点。どれも定数調整では直らず、モデルを1段変えている。

```text
安全寄りの Run は強イベント 0〜1件   → 強い演出 = 高 Haunted = 高危険 が暗黙の前提だった
Tension < 20 が Run の 75〜100%       → Tension が緊張ではなく RecentShock だった
bath_sip_2 が5Run中1回しか返らない   → スコア加点は保証ではなかった
```

## 20. Intensity と Threat を分ける

```text
Intensity  演出としての強さ   subtle / minor / medium / strong / climax
Threat     実際の危険度       safe / low / medium / high / lethal
```

危険度ごとに解禁 Haunted を持つ。**安全な山は最初から出せる。**

```text
safe 0 / low 8 / medium 30 / high 55 / lethal 75
```

これで「危険なことをしていないのに危険になった」を作らずに、山だけ出せる。

## 21. Safe Suspense Peak

| Event | Intensity | Threat | 内容 |
| --- | --- | --- | --- |
| PortraitCrash | strong | safe | 遺影が大きな音で落ちる |
| PhoneSuddenRing | strong | safe | 電話が突然鳴る |
| WholeHouseLightDrop | strong | safe | 家全体の照明が一瞬落ちる |
| TVSuddenOn | strong | safe | TVが突然つく |
| BathroomDoorMove | strong | safe | 風呂のドアが勝手に動く |
| HallwaySilhouetteCross | strong | low | 廊下奥を人影が横切る。追ってこない |
| SofaPostureChange | strong | low | 座ったまま姿勢だけ変わる |

選択条件:

```text
Run 開始 55秒以内は出さない
PeakNeed = 最後の山からの秒数（45秒で上がり始め、110秒で 1.0）→ スコア +34 まで
70秒経っても一度も山が無ければ +26
1Run 4回を超えると -40
ThreatFit = 12 - |haunted/25 - threatRank| x 7
```

最後の項が §12。Haunted は**山の有無ではなく山の質**を決める。
低 Haunted なら「廊下を横切って、そのまま行った」、
高 Haunted なら同じ枠が `FakeRush` になる。

## 22. Tension Envelope

v1.1 までは `イベント → +20 → 毎秒減衰`。これは緊張ではなく RecentShock で、
音そのものは1秒でも「さっきの足音なんだった？」が10秒続くことを表現できていなかった。

```text
DesiredTension = PhaseBaseline + UnresolvedThreat + Anticipation
               + GhostAwareness + Constraint + PendingConsequence + Residue

ActualTension += (Desired - Actual) x speed x dt
                 speed = 0.55（上がるとき） / 0.14（下がるとき）
```

| 成分 | 値 |
| --- | --- |
| PhaseBaseline | INTRO 10 / EXPLORATION 15 / ENGAGEMENT 25 / OVERTIME 35 / RETURNING 40 / CHASE 85 |
| UnresolvedThreat | 出来事ごとに subtle 6(9秒) 〜 climax 45(34秒)。重なると2件目以降は 0.45 倍。上限46 |
| Anticipation | 危険な行動の結果待ち。返事が返ると 0.35 倍に落ちる |
| GhostAwareness | seated 0 / aware 8 / standing 15 / stalking 25 / chasing 50 |
| Constraint | 制約中 16 / HOLD 中 12 |
| PendingConsequence | 未回収の因果。required 14、その他は urgency x 12（上限20） |
| Residue | 直後の余韻。strong 22、毎秒 1.6 で消える |

危険度が低い出来事は尾を引かない（`threatFactor` safe 0.5 / low 0.75 / medium 1.0 / high 1.2）。
遺影が落ちるのは驚くが「落ちた」で説明がつく。

**下限を持ち上げるようなことはしていない。** 中間帯は状況要因から出ている。

## 23. Consequence Intent

```text
World Memory      = 世界が覚えていること
ConsequenceIntent = Director がいつか返事をしたい、未回収の因果
```

[`src/systems/consequenceIntent.ts`](src/systems/consequenceIntent.ts)

| source | 候補 | earliest / preferred / latest |
| --- | --- | --- |
| bath_sip_2 | WaterRunning / DistantWaterDrop / PipeKnock / BathroomDoorMove / MirrorAnomaly | 8 / 15-45 / 70 |
| altar_overplayed | DistantBell / PortraitTilt / LightCordSway / PortraitCrash | 8 / 15-45 / 75 |
| phone_listened_long | DistantPhone / OwnVoice / PhoneClick / BehindFootstep / PhoneSuddenRing | 8 / 15-50 / 80 |
| ghost_close_selfie | SofaEmpty / GhostReposition / GhostCrossing / GhostPeek / BehindFootstep | 6 / 12-40 / 70 |
| LAST_TEMPTATION | Meaningful なもの全部 | 2 / 2-5 / 6・required |

即イベントではない。風呂を出て、別の部屋へ移って、緊張が落ちた頃に返す。

```text
IntentBonus = urgency x 62
            + 別の部屋なら +20 / 同室でも遠ければ +10
            + RETURNING なら +14
```

`latest` を過ぎたら fallback を1つだけ返す。fallback は Haunted 条件を見ない
（見ると「低 Haunted だから返事なし」になる）が、画面内テレポートのような
破ってはいけない条件は確認する。それも無理なら +18秒で `expired`。

## 24. Debug / Log

```text
Tension              42 → 58 (desired)
Tension内訳          phase 25 / unresolvedThreat 18 / ghostAwareness 15 / residue 4
Peak Need            0.62  [PortraitCrash(safe), HallwaySilhouetteCross(low)]
Consequence Intents  bath_sip_2 age=28s u=0.65
```

```text
consequence_intent_created / _resolved / _expired
tension trace（30秒ごとに desired と actual）
```

## 25. 検証

不変条件 10/10（5回連続実行して 0 失敗）、シナリオ 9/9。

```text
PASS  A Safe: 低Hauntedの語彙        unique=21 families=11
PASS  B Greedy: 密度制御             avgGap=17.3s short(<6s)=0/24
PASS  C Ghost-heavy: Ghost連発なし   ghost=11/24 (46%) within10s=0
PASS  D 枯渇: Ghostで埋めない        events=6/90s ghost=3 silence=84%
PASS  E LastTemptation: 必ず返事     30/30 avgLatency=2.7s unique=9
PASS  C bath_sip_2 の返事            100% (20/20) lat=20.7s unique=5
PASS  D phone_listened_long の返事   100% (20/20) lat=21.9s unique=4
PASS  E ghost_close_selfie の返事    100% (20/20) lat=18.0s unique=4
PASS  F Safe Run: 山はあるが危険にならない  peaks=5 dangerous=0
```

実ゲーム上の Consequence（`forceGreed` で Greed だけ起こし、あとは通常進行）:

```text
bath_sip_2           8/8 (100%) lat=15.9s  [PipeKnock, WaterRunning]
altar_overplayed     8/8 (100%) lat=20.9s  [PortraitCrash, DistantBell]
phone_listened_long  8/8 (100%) lat=23.0s  [DistantPhone, PhoneClick, PhoneSuddenRing]
ghost_close_selfie   8/8 (100%) lat=70.5s  [BehindFootstep]
```

## 26. 5Run 実測（v1.1 → v1.2）

| | v1.1 | v1.2 |
| --- | --- | --- |
| 安全 Run の山 | 0〜1件 | 3件（すべて threat safe/low） |
| Tension < 20 | 9〜18% | 9〜20% |
| Tension 40〜70 | 測定なし | 34〜58% |
| Tension 70+ | 0〜35% | 2〜21% |
| 系統多様性 | 8〜13 | 11〜13 |
| 平均間隔 | 10.0〜13.1s | 12.1〜14.0s |

Tension 推移（tourist / greedy）:

```text
tourist  0 → 16 → 27 → 36 → 27 → 42 → 52
greedy   0 → 16 → 54 → 55 → 36 → 54 → 47 → 47 → 66 → 52 → 67 → 61 → 81 → 68
```

Run の大部分が「平時か Chase か」の二択ではなくなっている。

実際に出た Consequence（ボットが自然に Greed した2Run）:

```text
curious  216.5s created source=bath_sip_2 preferred=15-45 latest=70
         240.8s resolved source=bath_sip_2 event=WaterRunning latency=24.3s
greedy   356.6s created source=phone_listened_long preferred=15-50 latest=80
         376.8s resolved source=phone_listened_long event=DistantPhone latency=20.3s
```

---

# v1.3 — 観測できるようにする

コアモデルは触っていない。**Director を賢くするより、Director の挙動を正しく観測できるようにする**回。

## 27. Behavior-targeted Playtest Bots

従来のボットは「提示されたリクエストに反応する」だけだったので、
風呂の2口目や至近距離セルフィーまで自然には到達しなかった
（v1.2 の5Runで `bath_sip_2` 到達1回、セルフィー0回）。
つまり Consequence Intent の実効果を実プレイで測れていなかった。

v1.3 では **狙った Greed を実際の操作経路で踏みに行く** 4本を足した。

```js
const bot = await import('/src/dev/floor1Bot.ts');
console.table(bot.runBehaviorBots());
```

| Bot | riskCeiling | HOLD | 狙う Greed |
| --- | --- | --- | --- |
| safe | 1 | 0秒 | なし |
| moderate | 3 | 7秒 | phone |
| greedy_targeted | 5 | 7秒 | bath / altar / phone |
| max_greed | 5 | 8秒 | selfie / bath / altar / phone（降りない） |

仕組みは「対象の前に張り付いて、目当てのリクエストが出るまで待つ」。

```text
CAMP_LIMIT 55秒   何も出なければ順路へ戻る
GOAL_LIMIT 110秒  ひとつの Greed を追いかける上限。出なければ諦めて次へ
```

**追われている間は逃げる。** 逃げずに死ぬと Run が2分で終わり、その先の Greed を観測できない
（実際、最初の実装では greedy が 2.2 分で死んで agenda の半分に届かなかった）。

12 Run の到達率:

```text
bath_sip_2           4/12
altar_overplayed     4/12
phone_listened_long  7/12
ghost_close_selfie   1/12
Consequence Intent   14/17 resolved (82%)
```

v1.2 は5Runで `bath_sip_2` 1回・セルフィー0回だった。

## 28. Dynamic Peak Opportunity

固定の `notBefore: 55` を廃止。5Run とも1つ目の山が 55〜65秒に来て順番が読めていた。

```text
ready = 時間 x 0.45 + 探索の進み具合 x 0.35 + すでに起きた出来事の数 x 0.2
        （時間は 20秒から 90秒で 1.0 / 探索は4箇所 / 出来事は6件）

ready < 0.34            → 山を出さない
Pressure が SATURATED   → 山を出さない
elapsed < 25秒          → 山を出さない（これだけは無条件）
```

早く家を回った人には早く来る。12 Run の初回の山:

```text
v1.2  55s 56s 59.6s 60.3s 65.1s        （ほぼ固定）
v1.3  33s 39s 41s 42s 52s 63s 63s 64s 65s 70s 77s 79s
```

`peakOpportunity` は Gate だけでなく PeakNeed のスコアにも掛かる
（開いたばかりのときは控えめ、開ききってから強く押す）。

## 29. Underused Event Bonus

`WholeHouseLightDrop` は v1.2 の5Runで0回だった。
個別の `baseWeight` を上げ下げする泥沼を避けたいので、Run の中で自己調整させる。

```text
その Run でまだ一度も出ていないイベント → +10
```

12 Run での使用回数:

```text
WholeHouseLightDrop  0回 → 4回
LightCordSway              4回
TVStaticTick               4回
ObjectTinyShift            3回
SofaEmpty                  1回
```

12 Run 通して一度も出なかったのは 4種。すべてスコアではなく**前提条件**で落ちている。

```text
FridgeHum        requiredObjectState fridge|bugs
PortraitChanged  requiredMemories portrait_restored
KitchenNoise     requiredMemories fridge_held_long
GhostStand       requiredGhostState ['aware'] のみ（窓が狭い）
```

## 30. Runtime Build Verification

v1.2 の実装中、HMR が古いモジュールを配っていたせいで
**「ソースは正しいのにテストが 0% を返す」** を長時間追いかけた。
異常な結果を見たら、まず実行中のコードが最新かを疑えるようにする。

```text
vite.config.ts  define: { __BUILD_ID__: "<git短縮SHA>-<ビルド時刻>" }
[P] パネル      DEBUG [P] · build 894a791-26090501510
game.dev        buildId
ログJSON        { version: 3, build: "...", mode, summary, rows }
```

`node_modules/.vite` を消してサーバを再起動すると直る、という手順もここに紐づく。

## 31. `[P]` パネル

実プレイ中に「なぜ今これが起きた？」を追えるように、以下が並ぶ。

```text
DEBUG [P] · build 894a791-26090501510
Tension                   42 → 58 (desired)
Tension内訳               phase 25 / unresolvedThreat 18 / ghostAwareness 15 / residue 4
Peak Need / Opportunity   0.62 / 0.81  [PortraitCrash(safe), HallwaySilhouetteCross(low)]
Consequence Intents       bath_sip_2 age=28s u=0.65
Horror Pressure           11.4 HIGH
Last 30s                  3 events / 0 strong / 1 ghost
Nothing / MinScore        78 / 34
Top Candidates            …
Rejected                  …
```

## 32. v1.3 の実測（4 Bot）

| Bot | 時間 | 結果 | 完了 | 山 | Intent | 系統 | 平均間隔 | T <20/20-40/40-70/70-85/85+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| safe | 3.5分 | 生還 | 0 | 4（危険0） | 0/0 | 10 | 12.5s | 15/50/35/0/0% |
| moderate | 6.6分 | 生還 | 6 | 5（危険1） | 0/0 | 14 | 13.5s | 9/20/55/9/7% |
| greedy_targeted | 6.6分 | 生還 | 9 | 6（危険2） | 3/3 | 13 | 16.1s | 9/5/21/38/27% |
| max_greed | 6.6分 | 生還 | 11 | 5（危険1） | 0/1 | 13 | 14.9s | 9/17/39/24/11% |

safe は最後まで幽霊が座ったまま（危険な山0）。
greedy_targeted は 70+ に 65% 滞在して `FakeRush` が2回。§85 の連続的な変化になっている。
