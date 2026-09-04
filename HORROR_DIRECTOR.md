# Horror Director v1.1

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
