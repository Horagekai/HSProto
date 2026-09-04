# Novelty / Risk と Request Director v2

STANDARD MODE の経済と Request の設計。
数値はすべて [`src/config.ts`](src/config.ts) の `novelty` / `streamGoal` / `request` にある。

---

## 1. 何を直したか

改修前、鏡は**何度触っても毎回 45 Likes**が入っていた。

```ts
const likes = CONFIG.inspect.likes * (first ? 1 : CONFIG.inspect.repeatLikesMult);
// 180 * 0.25 = 45  ← 2回目以降ずっと同じ
```

さらに撮影価値（`freshness`）が**時間経過で回復**していたため、
「鏡を見る → 30秒待つ → また満額」が成立していた。仕様が禁じている挙動そのもの。

改修後の実測:

| 鏡を触った回数 | 1 | 2 | 3 | 4回目以降 |
| --- | --- | --- | --- | --- |
| Likes | **180** | **45** | **9** | **0** |

```text
鏡を6分間ひたすら擦り続けた場合の1分ごとの収益
  1分目 ¥4,933 → 2分目 ¥111 → 3分目 ¥104 → 4分目 ¥102 → 5分目 ¥84

怪異を13mの安全距離から6分間撮り続けた場合
  ¥0（1分ごとに 0 / 0 / 0 / 0 / 0）
```

---

## 2. Novelty は「対象」ではなく「対象 + 状態」で数える

鏡そのものを永久に価値0にはしない。評価単位は `Object + State`。

```text
mirror|normal    普通の鏡
mirror|anomaly   何かが映っている鏡
```

同じ状態を繰り返すと `1.0 → 0.25 → 0.05 → 0`。
**時間では絶対に戻らない。** [`novelty.ts`](src/systems/novelty.ts) にタイマー回復は一切置いていない。

戻るのは世界の状態が変わったときだけ:

- 対象に紐づく異変が起きた（鏡に何かが映る）
- 怪異の段階・行動・距離帯・こちらを見ているかが変わった
- 新しい異変が発生した
- Selfie になった / 追跡が始まった

### 実測された復活

```text
mirror_interaction_count=1  mirror_state=normal   likes=180
mirror_interaction_count=2  mirror_state=normal   likes=45
mirror_interaction_count=3  mirror_state=normal   likes=9
mirror_interaction_count=4  mirror_state=normal   likes=0
（40秒待つ）
mirror_interaction_count=6  mirror_state=normal   likes=0    ← 時間では戻らない
（Hauntingが上がり、鏡に何かが映る）
mirror_interaction_count=8  mirror_state=anomaly  likes=180  ← 状態が変われば戻る
```

### 「見る」と「触る」は別カウンタ

`mirror`（撮影）と `touch:mirror`（インタラクション）を分けてある。
眺めていただけで触る報酬まで枯れると、何回目に触ったのかが読めなくなるため。
どちらも同じ「状態」に紐づくので、状態が変われば両方戻る。

---

## 3. 連続撮影の減衰

同じ状態を撮り続けている時間で減衰する（`novelty.hold.curve`）。

| 連続撮影 | 0〜2秒 | 5秒 | 10秒 | 16秒〜 |
| --- | --- | --- | --- | --- |
| 倍率 | 1.0 | 0.6 | 0.2 | 0.05 |

状態が変われば 0 に戻る。**画面から外して時間を置いても回復しない。**
一度外して同じ状態を撮り直すと、次の exposure として倍率が一段下がる。

---

## 4. 価値の式

```text
FootageValue = Base × Novelty × Hold × Risk × Framing × Activity
```

Framing（中央度・距離）と Activity（動き・こちらを見ている・段階）は Base 側に入っている。
Viewer Request の報酬は**これとは完全に別枠**で加算される（§15）。

### Risk は Danger 単独では決めない

距離・怪異の段階・行動・Selfie・ライト・直前のHEY・背中を向けているか、を積む。

| 状況 | 倍率 |
| --- | --- |
| 安全 | 1.0 |
| 少し危険 | 〜1.3 |
| 危険 | 〜1.8 |
| 非常に危険 | 〜2.6（上限） |

追跡中の ×4〜6 は別枠なので Risk には積まない（二重取りを避けるため）。
プレイヤーには倍率を表示しない。Likes / Viewer の動きで体感させる。

---

## 5. Haunting は時間で上がらない

`haunting.perSec` を **0** にした。

時間で上がると、立っているだけで世界の状態が変わり、
全対象の Novelty が戻ってしまう（＝待つだけで安全に稼げる）。
Haunted はプレイヤーの行動だけで上がる。

---

## 6. Request Director v2

### 無視のペナルティは 0

```ts
ignorePenalty: { viewerMult: 1.0, engagement: 0 }
```

断ったこと自体には何のコストも無い。
Viewer が減るのは「Requestを断ったから」ではなく「新しい撮れ高が無い時間が続いたから」。
その役目は Novelty 側に移した。

旧仕様と比較したいときは `0.88 / -0.4` に戻す。ログの
`request_ignore_viewer_penalty` で現在値を確認できる。

### 達成 → すぐ次、をやめた

```text
Player action → Request completed → Monster / World reaction
  → Short silence → Next temptation
```

内部状態:

```text
IDLE → CHAIN_ACTIVE → WAITING_FOR_CONSEQUENCE → CHAIN_PAUSE → CHAIN_ACTIVE
```

`WAITING_FOR_CONSEQUENCE` では次を出さず、怪異・世界の反応を待つ。
最大 5 秒で、何も起きなければ**静寂そのものを結果として**次へ進む。

実測ログ:

```text
66s request_chain_continuation_roll current_step=1 continue_chance=0.8 result=continue
66s request_waiting_for_consequence after_step=1
67s request_consequence_observed consequence_type=monster_watching wait_duration=0.9
67s request_chain_delay_started from_step=1 to_step=2 delay_duration=2.8
69s request_offered hey_call:3000

156s request_waiting_for_consequence after_step=0
160s request_consequence_observed consequence_type=monster_relocating wait_duration=4.3
160s request_chain_delay_started from_step=0 to_step=1 delay_duration=2.4
162s request_offered get_closer2:1500
```

### 段が上がるほど「間」が長くなる

| 段 | 次段までの待ち | 継続確率 |
| --- | --- | --- |
| 1 → 2 | 1.5〜2.5秒 | 0.90 |
| 2 → 3 | 2.0〜3.0秒 | 0.80 |
| 3 → 4 | 2.5〜4.0秒 | 0.70 |
| 4 → 5 | 3.0〜5.0秒 | 0.60 |
| 5 → 6 | 4.0〜7.0秒 | 0.50 |

高額ほど出にくく、出る前の静寂が長い。`SELFIE WITH IT ¥15,000` まで到達する確率は
`0.9 × 0.8 × 0.7 × 0.6 × 0.5 ≈ 15%`。

Chain が終わっても画面には何も出さない。次が来ないだけ。

### 状況に応じた言い換え

危険の段は固定のまま、文言だけ今の状況へ反応させる（達成条件は変えない）。

```text
CALL IT AGAIN        通常
CALL IT IN THE DARK  ライトOFF中
CALL IT WHILE SMILING  Selfie中
CALL IT BACK         怪異を見失っている
```

直近3件と同じ Surface は出さない。

### ONE LAST CALL は1ランに1回

発生条件:

```text
streamGoalReached      配信目標 ¥25,000 を達成している
returning              入口へ向かって進み続けている
distanceToEntrance ≤ 8m
oneLastCallOffered == false
currentRequest == none
```

確率 70%。達成した場合のみ、45% で最終段 `CALL IT AGAIN` が出る。
最終段のあとは Chain を続けない。

道中の引き止めは別名を使う。

```text
ONE MORE SHOT           ¥5,000
CALL IT BEFORE YOU GO   ¥7,000
```

**断って帰ってもペナルティは無い。**「怖くて帰った」が正しい判断として成立する。

---

## 7. 配信目標（Stream Goal）

`streamGoal.target = 25000`。達成すると HUD に一度だけ表示が出る。

達成後は発見・インタラクション報酬が ×0.7 になる（Request 報酬は下げない）。
「安全な撮れ高はもう撮り尽くした。それでも稼ぎたいなら危険なことをする」を作るため。

---

## 8. ログとKPI

行ごとに `state_key` / `repeat_count` / `novelty_multiplier` / `risk_multiplier` /
`footage_base_value` / `footage_final_value` が入る。

イベント:

```text
footage_rewarded         subject / state_key / repeat_count / novelty / risk / base / final
interaction_reward       object / state / count / repeat / novelty / likes
mirror_interacted        mirror_interaction_count / mirror_state / mirror_likes_awarded
subject_state_changed    subject / old / new
stream_goal_reached

request_chain_started              chain_id / start_step / kind
request_chain_continuation_roll    current_step / continue_chance / result
request_waiting_for_consequence    after_step
request_consequence_observed       consequence_type / wait_duration
request_chain_delay_started        from_step / to_step / delay_duration
request_ignored                    request_type / reward / viewer_penalty
one_last_call_offered / _taken / _completed / _declined_by_exit
```

リザルト画面の KPI:

| パネル | 指標 | 望ましい値 |
| --- | --- | --- |
| ECONOMY | Repeat farming (3回以上) | 少ないほどよい |
| | Novelty seeking rate | 50%以上 |
| | Risk reignite rate | 30%以上 |
| | Safe farming earnings share | 40%以下 |
| REQUEST DIRECTOR | Voluntary continuation rate | — |
| | High-tier (¥6,000+) continuation | — |
| | **Walk away rate** | **0%に近いとRequestが強制的すぎる** |
| | Full ladders | 15〜35% |
| | Hesitation by tier | 高Tierほど伸びること |
| | ONE LAST CALL | TAKEN / WALKED AWAY が割れること |

---

## 9. ONE GHOST MODE には適用していない

`novelty.enabled = false`（連続撮影の減衰も同様）。

被写体が一体しかないため、枯らすとモード自体が成立しない。
ONE GHOST の実測は改修前と同水準を維持している（timid ¥6.9k〜13.3k / curious ¥25k〜92k / greedy 死亡）。

Request Director v2（結果待ち・段階式の間と継続確率・ONE LAST CALL の1回制限）は
**両モードに適用**している。
