# Horror Director v1

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
