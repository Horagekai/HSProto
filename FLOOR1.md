# HS FLOOR 1 MODE

本編1階のレイアウトで、HSProto で見つかった面白さが実際のレベル構造でも成立するかを検証するモード。

`STANDARD` / `ONE GHOST MODE` には手を入れていない。

---

## 1. マップ

[`src/world/floor1Level.ts`](src/world/floor1Level.ts)

```text
   ┌──────────────────────────────────────────┐  z = -16
   │  TV  SOFA        DINING        KITCHEN   │
   │      (人影)                      FRIDGE   │   LDK
   ├──────────────── LDK DOOR ────────────────┤  z = 0
   │  CLOSED ROOM   │ 廊下 │       BATH       │
   │  (壁。入れない) │PHONE │                  │
   ├────────────────┤      ├──────────────────┤  z = 14
   │  BUTSUMA       │      │  WASHROOM        │
   │  仏壇 遺影 押入 │      │  MIRROR / TOILET │
   ├────────────────┴──────┴──────────────────┤  z = 27
   │              ENTRANCE 玄関                │
   └──────────────────────────────────────────┘  z = 34
```

玄関から入り、左が仏間、右が洗面所、正面が廊下。廊下の奥（LDKドアの手前）に電話。
洗面所の奥が風呂、右手前にトイレのドア（開かない）。LDKは右がキッチンと冷蔵庫、
中央がダイニング、左がリビングとソファ。

玄関 `(0, 33)` は開始地点であり唯一の帰還地点。座標は他モードと共有しているので、
帰宅判定・`[E]` の距離・プレイヤーの開始位置がそのまま使える。

## 2. Interaction の見せ方

**遠距離の光る表示は入れていない。** 近づいて初めて `[E] EXAMINE`（冷蔵庫だけ `[E] OPEN`）が出る。
UIは「ここを見ろ」ではなく「近づいたので触れます」だけを伝える。

## 3. Discovery

`[E]` を押したことではなく、**配信として意味のある対象を初めて認識したこと**に報酬を出す。
カメラに 0.6 秒収め、6m 以内に入ると発見になる（幽霊だけ 16m / 1.4秒）。

```text
FOUND: THE ALTAR          +30 Likes
FOUND: FAMILY PORTRAITS   +20 Likes
FOUND: OLD PHONE          +20 Likes
FOUND: MIRROR             +10 Likes
FOUND: FILTHY BATH        +50 Likes
FOUND: THE FRIDGE         +20 Likes
BUGS EVERYWHERE          +120 Likes   （開けたとき）
FOUND: FAMILY PHOTO       +20 Likes
FOUND: SOMEONE ON THE SOFA  +150 Likes
THE PORTRAIT FELL        +100 Likes   （状態変化）
THE PHONE IS RINGING      +80 Likes   （状態変化）
```

洗面台・洗濯機・通路などのUtilityには Likes を出さない。

## 4. HOLD — 押している間だけ続く不謹慎行為

**このモードの中心。** 指を離せばいつでも終われる。離した時点で終了し、
すでに得た段の報酬は保持する。ペナルティは無い。

| 仏壇 `[HOLD E]` | 電話 `[HOLD E]` | 冷蔵庫 `[HOLD E]` |
| --- | --- | --- |
| 2秒 +¥1,000 | 2秒 +¥1,000 | 2秒 +¥2,000 |
| 5秒 +¥2,000 | 5秒 +¥2,500 | 5秒 +¥4,000 |
| 8秒 +¥4,000 | 9秒 +¥5,000 | 8秒 +¥7,000 |
| 12秒 +¥7,000 | 13秒 +¥9,000 | |

カードに出るのは **獲得済みの額** と **NEXT の額** だけ。時間ゲージは細い線1本。

段を超えるたびに世界が反応する。毎回追跡にはしない。

```text
2段目  照明が揺れる
3段目  どこかでドアの音 / 電話なら「今のは自分の声だ」
4段目  背後で足音。Danger +8
```

仏壇を5秒以上、電話を5秒以上押し続けると World Memory に記録され、
**あとから別の部屋で同じ鈴や電話の音が鳴る。**

## 5. Request Director

[`src/systems/floor1.ts`](src/systems/floor1.ts)

Request は Quest ではない。「もう一歩だけ余計なことをする理由」を出すだけ。
Accept ボタンは無く、行動そのものが回答。`X` 長押しで明確に降りられる。

### 3タイプ

| | 例 |
| --- | --- |
| ACTION | TAKE A SIP / PICK IT UP / TAKE A SELFIE / TURN AROUND |
| HOLD | PLAY A BEAT / KEEP LISTENING / KEEP IT OPEN |
| CONSTRAINT | DON'T TURN AROUND / DON'T MOVE / KEEP LOOKING / LIGHTS OFF |

### 選び方

固定でもランダムでもない。

```text
全26候補
  → Context でフィルタ（部屋 / 距離 / 状態 / 記憶 / Haunted / 幽霊の段階 / cooldown）
  → スコア付け
  → 上位5件から重み付き抽選
```

スコアの内訳（実測ログより）:

```text
id=phone_answer  score=59.4  prox+9,attention+10,reengaged+12,pacing+2,escalation+6
id=bath_sip      score=56.4  prox+0,attention+10,reengaged+12,pacing+10,escalation+6
id=mirror_dark   score=53.1  prox+7,attention+10,reengaged+12,pacing+8,escalation+4
id=sit_dont_move score=19.5  situation+4,pacing+2,escalation+4
```

- **attention** — カメラを向けていた時間。たまたま通りかかっただけでは伸びない
- **reengaged** — 一度離れて戻ってきた対象。§149の「自分から関わりに行っている」シグナル
- **escalation** — Haunted が高いほど高Tierが自然になる
- **fatigue** — 直近で同じオブジェクトが出ていたら減点

### 「近くにいる」はトリガーではない

風呂に入った瞬間に `TAKE A SIP` は出さない。

```text
風呂を発見
  → Viewer Comments（ew / drink it / he won't do it）
  → 2.5〜6秒の間
  → 直前に強い出来事が無ければ提示
```

提示の直前にもう一度 Context を確認し、その間に離れていたらキャンセルする。

以下の間は待つ: 発見トーストの直後 / 強い出来事の直後 / 追跡中 / Constraint中 / HOLD中 /
リクエスト完了直後。**沈黙も正解**として扱い、常に何かが出ている状態にはしない。

### 重ならない

判断すべき Request は同時に1つだけ。Constraint中やHOLD中に別のカードは出さない。
ただし世界側（怪異の移動・足音・水音・ドア）は動く。
終了後は溜まっていたものを順に出すのではなく、その時点の Context を見直す。

## 6. World Memory

```text
altar_overplayed / portrait_restored / phone_listened_long
bath_sip_1 / bath_sip_2 / bath_overdone / fridge_held_long
ghost_selfie_taken / ghost_close_selfie / ghost_stood
```

記録すると 25〜75秒後に、別の場所で結果が起きる。

```text
altar_overplayed     → 別室から鈴 / 照明が揺れる / 遺影が傾く
phone_listened_long  → 奥で電話が鳴る / 自分の声 / 背後で足音
bath_sip_2           → どこかで水音 / 排水音
ghost_selfie_taken   → ソファが空になっている
```

狙いは「これ、さっき自分がやったせいでは？」と思わせること。

## 7. Ghost

ソファに座っている。最初は追いかけてこない。

```text
SEATED → AWARE → STANDING → STALKING → CHASING
        18       40         62         88     （Danger）
```

STANDING で1.6秒の溜めを置いてから立ち上がる。位置を変えるのは**画面外にいるときだけ**。
Selfie を1回撮っただけで毎回 Chase にはしない。

## 8. Stream Goal / Last Temptation

目標は時間だけでは発火しない。

```text
120秒以上 かつ 発見5個以上 かつ ¥20,000以上
```

達成後は通常の発見系 Request のスコアを下げ、高額枠（`overtime`）を前に出す。
帰ろうとしている（入口へ向かって進み続けている + 14m以内）ときだけ、
1ランに1回、そのRunで何を触ったかに応じた最後の誘惑が出る。

```text
ONE LAST LISTEN  ¥10,000   （電話を長く聞いていた場合）
TAKE ONE LAST SELFIE ¥15,000（Selfieを撮っていた場合）
TURN AROUND ¥12,000        （Hauntedが高い場合）
```

## 8.5 状況Requestは直前のオブジェクトに紐づく

`DON'T TURN AROUND` のような制約は、**直前に触った / 発見したオブジェクトから20秒以内**にしか出ない。
受け皿として単独で出ることはない。

| 直前に触ったもの | 出うる状況Request |
| --- | --- |
| ソファの人影 / 電話 / 鏡 / 冷蔵庫 / 遺影 | DON'T TURN AROUND |
| ソファの人影 / 電話 / 鏡 | TURN AROUND |
| 仏壇 / 風呂 / 電話 / 遺影 | DON'T MOVE |
| 鏡 / 仏壇 / 冷蔵庫 | LIGHTS OFF |

スコアも「その出来事からどれだけ経ったか」で減衰する（`after_mirror+12` → 時間が経つほど0へ）。

実測で、状況Requestの比率は 7/17 → **4/13** に下がった。

```text
portrait_look → sit_dont_turn      遺影を調べた直後
（鏡を発見）  → sit_lights_off      鏡を見つけた直後
phone_listen  → sit_dont_turn      電話を聞いた直後
```

## 9. ログ

```text
room_entered / discovery_found / object_interacted
hold_started / hold_tier_reached / hold_released
request_candidate_generated / request_candidate_rejected / request_selected
object_became_eligible / request_offered / request_completed / request_dismissed / request_ignored
subject_state_changed / delayed_consequence / world_beat
bath_sip / ghost_selfie / stream_goal_reached
```

`[P]` のデバッグパネルに Room / Ghost / Director状態 / 候補とスコア / 却下理由 / World Memory を出す。

## 9.5 コメント

このモードは病院ではなく**一軒の家の1階**なので、コメントプールを差し替えてある。
2階も長い廊下の先の別棟も部屋番号も無いので、そこへ言及する行を全部外した。
配信のハンドルも `@the_house_tonight` になる。

```text
someone lived here / the tatami is rotting / why is it still furnished
check the altar / open the fridge / is that a phone / look behind the sofa
this house is not empty / have some respect / ON THE SOFA
```

## 10. 3ラン実測

```text
【tourist】危ないことはしない
  3.4分 ¥7,380 発見9 Request 2/6 ユニーク6 目標未達 Ghost=seated Danger 4
  altar_beat → portrait_look → bath_sip → sit_dont_move → sit_lights_off → sit_dont_turn
  World Memory: なし

【curious】見合うものには乗る。HOLDは途中で離す
  5.1分 ¥51,023 発見9 Request 12/13 ユニーク11 目標達成 Ghost=seated Danger 10
  altar_beat → sit_dont_move → sit_lights_off → bath_sip → sit_dont_turn → sit_turn
    → ghost_selfie → phone_answer → mirror_dark → ghost_frame → ghost_closer → …
  仏壇 5.5秒 / World Memory: altar_overplayed, bath_sip_1

【greedy】全部やる。HOLDは限界まで
  6.6分 ¥91,642 発見9 Request 13/15 ユニーク12 目標達成 Ghost=aware Danger 24
  altar_beat → … → phone_answer → bath_sip → phone_listen → ghost_closer → ghost_selfie
    → mirror_dark → bath_sip2 → ghost_frame → …
  仏壇 14秒 / 電話 14秒 / 風呂 2口 / Selfie 1回
  World Memory: altar_overplayed, bath_sip_1, phone_listened_long,
                ghost_selfie_taken, bath_sip_2, bath_overdone
```

同じ curious スタイルで3回まわしたときの並び:

```text
Run A: altar_beat → sit_dont_move → sit_dont_turn → sit_turn → sit_lights_off → bath_sip
       → ghost_selfie → ghost_closer → sit_dont_turn → mirror_dark → sit_turn → ghost_frame → phone_answer
Run B: altar_beat → sit_dont_move → mirror_dark → sit_dont_turn → sit_lights_off → ghost_selfie
       → ghost_frame → ghost_closer → phone_answer → mirror_stare → sit_dont_turn → sit_turn → ghost_frame
Run C: altar_beat → sit_dont_move → mirror_dark → sit_lights_off → ghost_selfie → ghost_frame
       → ghost_closer → sit_dont_turn → sit_turn → sit_lights_off → phone_answer → mirror_dark → ghost_frame
```

提示間隔は 13〜40秒。常に何かが出ている状態にはなっていない。


---

## Request Runtime v2 — Inspect と Request Action を分ける

人間プレイのログで、中心ループが成立していないことが分かった。

```text
26.1s  object_interacted: bath → bath_sip_1   ただし request_active = 0
10.9s  altar_beat が候補 → 66.1s に context_changed で破棄（55秒 Pending）
Run全体 discoveries 9 / requests_offered 1（唯一 sit_dont_turn）
74.6s  request_offered なのに同フレームで request_active = 0
```

### 1. 権威ある Request 状態をひとつにする

`ActiveRequest` に `state / actionUnlocked / activatedAt` を持たせ、
**UI・[E]のアンロック・HOLD・制約・完了・Dismiss・ログ・Debug HUD がすべてこれだけを見る。**

```ts
requestRuntime() → { active, id, type, reward, temptation, state, relatedObject, actionUnlocked }
```

ログ行の `request_active / request_type / request_reward` はここから作る。
以前は FLOOR 1 でも STANDARD 側の `RequestDirector` を見ていたため、
`request_offered` と同じフレームで `request_active=0` になっていた。

同じ原因で `publish()` が毎フレーム `request: null` を書き込み、
**Request カードが一度も表示されていなかった。**

### 2. Inspect と Special Action

| | 何ができるか |
| --- | --- |
| `[E]`（Request 無し） | 調べるだけ。発見・説明・視聴者の反応・Request の資格 |
| `[E]`（Request の対象、解放済み） | 飲む / 鳴らす / 受話器を取る / セルフィー |

```text
bath_sip / altar_hold / phone_listen / ghost selfie は
ActiveRequest が無ければ絶対に発生しない
```

破られたら `invalid_special_action` を記録する。実測 0 件。
Inspect は discovery を成立させる（ここが繋がっていないと Request の資格が立たない）。

### 3. 候補の寿命

```text
warmup       2.5〜6秒
出来事に譲る 合計 5秒まで   ← 以前は毎フレーム引き直していた
対象の近く   15秒まで粘る
離れたら     8秒で諦める
stale        20秒で必ず捨てる
```

Horror Event が 10秒おきに出るだけで候補が 55秒 Pending していたのはここ。
実測の最大 Pending は 10.3秒。

### 4. Object Request Need

調べた対象が増えているのに Object Request が0件、という状態を不自然として扱う。

```text
need = 調べた数（発見数の半分も弱く効かせる）と、最後の Object Request からの間隔
Object Request  +26 × need
Situation Req   -20 × need
```

「3個調べたら必ず出す」ではない。

### 5. ログ

```text
object_inspected           無害な調査
request_offered            category=object|situation を付ける
request_ui_visible         提示から何ms でカードが出たか
request_action_unlocked    [E] が押せるようになった
request_action_started     特殊アクションの実行
request_action_locked      ロックし直した
invalid_special_action     Request 無しで特殊アクションが起きた（0件が正常）
hey_input_context          focusedObject / activeRequest / requestActionAvailable
request_candidate_generated / _rejected（reason に stale_timeout / left_object / grace_expired）
```

### 6. 実測

```text
object_inspected object=bath state=normal count=1 first=true  [active=0]
request_selected id=bath_sip type=action reward=2000 tier=2    [active=1]
request_offered  bath_sip:2000 type=action object=bath category=object
request_action_unlocked id=bath_sip object=bath
request_ui_visible id=bath_sip delay=17ms
request_action_started id=bath_sip object=bath
world_memory_created memory=bath_sip_1
bath_sip count=1
request_completed bath_sip:2000
request_action_locked id=bath_sip reason=done
```

| Run | Discoveries | Object Req | Situation Req | Completed | UI | Invalid |
| --- | --- | --- | --- | --- | --- | --- |
| safe | 9 | 5 | 1 | 2 | 6 | 0 |
| moderate | 6 | 7 | 4 | 7 | 11 | 0 |
| greedy | 8 | 7 | 4 | 11 | 11 | 0 |
| max greed | 6 | 9 | 1 | 9 | 10 | 0 |
| greedy | 8 | 7 | 4 | 10 | 11 | 0 |

修正前は `discoveries 9 / object requests 0`。


---

## Viewer Request v2 — 密度 / 状況Request / 実行フィードバック

人間プレイで 150秒に 4件（状況Request は 1件）しか出ず、
`KEEP IT IN FRAME` が「何を撮ればいいのか分からない」状態だった。

### 1. 状況Requestは「お膳立て」で成立する

v1 は `afterObject`（直前に触ったオブジェクト）必須だったため、
移動中や幽霊を見失った直後には一切出せなかった。

```text
object      直前にオブジェクトへ触った
moving      部屋から部屋へ移動している
lingering   同じ場所に留まっている
behind      背後で音がした
ghostLost   見えていた幽霊を見失った
returning   帰路
afterEvent  Horror Event の直後の静けさ
```

どれか1つ立てば候補になる。`LOOK BEHIND YOU` は `behind` / `ghostLost` のみ、
`KEEP WALKING` と `STOP` は `moving` のみ、と条件は Request ごとに違う。

### 2. Object と Situation を取り合いにしない

```text
ObjectRequestNeed     +26 × need   （調べた対象 / 最後のObject Requestからの間隔）
SituationRequestNeed  +26 × need   （最後のSituation Requestからの間隔）
```

v1 は `ObjectRequestNeed が高い → Situation を -20` というゼロサムだった。

### 3. 追加した状況Request

```text
LOOK BEHIND YOU / STAY HERE / KEEP WALKING / STOP / GO BACK / NOW TURN AROUND
```

`NOW TURN AROUND` は `DON'T TURN AROUND` を守り切った後だけ、1Runに1回。

### 4. 実行フィードバック

`RequestView` が進捗の単一情報源になり、UI は計算しない。

```ts
kind: 'action' | 'hold' | 'constraint' | 'target_constraint'
progressState: 'offered' | 'ready' | 'progress' | 'paused' | 'completed' | 'failed'
progressSeconds / requiredSeconds / failureReason / targetName / targetLocked / earned / inputHint
```

```text
KEEP THE FIGURE IN FRAME
   DO NOT LOOK AWAY  [4 SEC]
TARGET: THE FIGURE ON THE SOFA   NOT IN FRAME
   ████░░░░░░░░  2.1 / 6.0 sec
      TARGET NOT IN FRAME
```

**0% のまま黙らない。** `TARGET NOT IN FRAME` / `TOO FAR` / `MOVE CLOSER` /
`HOLD E` / `PROGRESS PAUSED` のいずれかを必ず出す。

### 5. KEEP IN FRAME の修正

`ghost_frame` は `target_constraint` になり、**提示時点で幽霊が画面に映っていること**を要求する
（`requiresVisible`、最大距離 18m → 14m）。
見失った相手を撮り直させるのは別Request `GET IT BACK IN FRAME` に分けた。

対象を見失っても進捗は 0 に戻らない。毎秒 0.35 でゆっくり減るだけ。

```text
見続けて3秒     progress 3.0/6.0s  locked=true
目を離して2秒   paused   2.3/6.0s  TARGET NOT IN FRAME
戻して1秒       progress 3.3/6.0s  locked=true
                完了
```

### 6. 10Run の密度

| | Before (人間プレイ) | After (10Run) |
| --- | --- | --- |
| Request | 150秒で4件 | 3.4〜6.6分で 6〜15件 |
| Situation | 1件 | 2〜6件（合計44件） |
| Object : Situation | 3 : 1 | 46 : 44 |
| 同一Requestの連続 | — | 0% |

```text
平均間隔 28.1s   中央値 22〜37s   最長の無音 71.5s
Situation: STAY HERE 14 / DON'T MOVE 10 / LIGHTS OFF 6 / DON'T TURN AROUND 6
           KEEP WALKING 3 / LOOK BEHIND YOU 3 / NOW TURN AROUND 1 / TURN AROUND 1
Safe Peak 初回: 27〜63s（v1.3 の固定55〜65sから分散）
```


---

## RequestDirector v2 — Core Temptation と Situation Filler

### 1. 状況Requestの Eligibility を広くONにする

v1 は「最近オブジェクトに触っていること」が必須で、
廊下を歩いて背後で足音が鳴っても `TURN AROUND` が候補にすら入らなかった。

```text
eligible = 部屋で意味が通る
        || 関連オブジェクトが近い
        || 最近その対象に触った
        || 明確なお膳立てがある
```

**お膳立て（背後の音・幽霊を見失った・電話）は Gate ではなく Score のボーナス。**
無くても部屋にいるだけで候補には入り、順位が下がるだけ。

落とすのは本当に意味が通らないものだけ。

```text
sit_lights_off      既に暗い          → light_already_off
sit_dont_look_away  見ている物が無い  → no_target_to_watch
sit_go_back         戻る先が無い      → nowhere_to_go_back
ghost_frame         今映っていない    → target_not_visible
```

### 2. 部屋ごとのプール

```text
hallway   TURN AROUND / DON'T TURN AROUND / LOOK BEHIND YOU / STOP / KEEP WALKING / DON'T MOVE / GO BACK
butsuma   DON'T MOVE / TURN AROUND / DON'T TURN AROUND / DON'T LOOK AWAY / LIGHTS OFF / STAY HERE / LOOK BEHIND YOU
washroom  LIGHTS OFF / DON'T MOVE / DON'T LOOK AWAY / TURN AROUND / STAY HERE
bath      DON'T MOVE / TURN AROUND / DON'T LOOK AWAY / STAY HERE / LIGHTS OFF
ldk       DON'T MOVE / TURN AROUND / DON'T TURN AROUND / DON'T LOOK AWAY / GO BACK / STAY HERE / LOOK BEHIND YOU
```

直前に触った対象からも候補化する。

```text
phone      TURN AROUND / DON'T MOVE / DON'T TURN AROUND / STOP / LOOK BEHIND YOU
altar      DON'T MOVE / DON'T LOOK AWAY / TURN AROUND / LIGHTS OFF
ghost      DON'T LOOK AWAY / DON'T TURN AROUND / TURN AROUND / GO BACK / STAY HERE
```

**部屋・距離・履歴は足し合わせない。一番強い理由だけを採る。**
全部足すと状況Requestだけで Object を押しのけてしまう。

### 3. Core Object Temptation

世界で今まさに起きていることを Viewer が拾う。baseWeight を上げるのとは別物で、
文脈が成立した時だけ乗る。

```text
電話が鳴っている → PICK IT UP      +38（近ければ +10）
仏壇を調べた     → PLAY A BEAT     +22（見ていれば +8）
風呂・幽霊の発見 → TAKE A SIP 等   +18
```

明確な機会があるときは **72% で Object Request を選ぶ**。残り 28% は通常の抽選なので、
電話が鳴っているのに「動くな」と言われる Run も起こる（§47）。

さらに、鳴った瞬間に待機中の候補を捨てて考え直す。
そうしないと、鳴る前から並んでいた候補が先に出てしまう。

### 4. Need は救済であって支配項ではない

```text
bonus = 18 * sqrt(need)     Object / Situation それぞれ独立
```

互いを減点しない。v1 は `Situation -= ObjectNeed * 20` で状況Requestを直接殺していた。

### 5. 連鎖

`chainRole: 'followup'` は状況Requestの連発ペナルティを免除する。
`DON'T TURN AROUND` を守り切った後の `NOW TURN AROUND` が fatigue で消えていた。

### 6. Offer 直前の完全再評価

`stillValid()`（距離と Chase だけ）を廃止し、`revalidate()` が最初と同じ条件を全部やり直す。
部屋・オブジェクト状態・幽霊の状態・可視性・記憶・Haunted・お膳立て・連鎖まで。

### 7. 遺影は見ている時に落ちる

Viewer Request ではなく World Horror Event（§54）。
`preferOnScreen` で、見ている時 +26 / 見ていない時 -16。
音だけ聞こえる `PortraitFellUnseen` は残すが重みは低い。
`[E]` の Inspect では落ちない。

### 8. ファネル計測

```text
request_eligibility_checked / request_candidate_scored（eligible_by 付き）
request_candidate_warmup / request_candidate_cancelled / request_offered
```

### 9. 実測（10 Run）

| | Before | After |
| --- | --- | --- |
| Request | 150秒で4件 | 3.4〜6.7分で 6〜18件 |
| Object : Situation | 3 : 1 | 44 : 74 |
| 状況Requestの種類 | 1 | 10〜12 |
| 候補数 | 1〜3 | 平均 6.1（4〜8） |
| 平均間隔 | — | 24.8s（最長 51.3s） |

```text
PICK IT UP      85% （20シード。他に sit_stay_here / sit_turn）
PLAY A BEAT     80% （20シード。他に sit_turn / sit_look_behind / sit_stay_here）
背後の足音      20/20 で状況Request。TURN AROUND / LOOK BEHIND YOU / STAY HERE
NOW TURN AROUND 12/12 で候補入り（最高スコア 69）
KEEP IN FRAME   見えていない幽霊への提示 0/15
遺影            Inspectで落ちた 0 ／ 見ている時 15 ／ 見ていない時 0
```

候補の内訳（eligible_by）:

```text
room 54 / setup 38 / nearby_object 31 / recent_object 29 / object 11
```


---

## Core Object Request Priority

### 1. altar_beat が一度も出なかった原因

Eligibility でも Score でもなく、**距離**だった。

```text
altar_beat  maxDistance 3.2
```

仏壇の 2.3m に立てば `altar_beat:74` で候補に入り、11秒後に提示される（実測）。
だが Inspect できる距離が 3.0m なので、調べて一歩下がっただけで候補ごと消える。
機会が「対象の前に立っている間だけ」だったのが原因。

### 2. Core Opportunity を「窓」にする

```text
altar / bath  16秒
phone         12秒
ghost         14秒
```

窓の間は距離条件を 2.2 倍まで緩める。ただし `phone_answer` は例外
（遠いときは `GO BACK AND ANSWER IT` が担当するため `noCoreReach`）。

### 3. bath_sip 84 に STAY HERE 26 が勝った経路

上位を素の重み付き抽選にかけていたため、84 対 26 でも 26 が 24% で勝っていた。
数学的には正しいが、ゲームとして不自然。

```text
dominance = bestCore / max(bestOther, 1)

< 1.2      通常の重み付き抽選
1.2〜1.5   50% で Core
1.5〜2.0   65% で Core
2.0+       78% で Core
```

100% にはしない。電話が鳴っていても「動くな」と言われる Run は残る。

### 4. 電話の近距離 / 遠距離

```text
PICK IT UP              8m 以内
GO BACK AND ANSWER IT   8m 以上、40m まで
```

一度発見していれば Viewer は電話の場所を知っている。
どちらも「近づく」だけでは完了せず、受話器を取って初めて完了する。
鳴り止んだら Request も終わる。

電話だけ基礎点が高い（46）のは、**鳴っている間しか成立しない時間制限つきの出来事**だから。
幽霊はいつでも撮れる。

### 5. Core Miss Protection

窓が resolve されずに切れたら `coreMisses` を増やし、次の機会を押す（1回 +6、上限 +18）。
Hard Guarantee にはしない。

### 6. ログ

```text
core_opportunity_started / _expired / _resolved
core_selection_evaluated  bestCore=bath_sip:84 bestOther=sit_stay_here:26 dominance=3.23 coreProbability=0.78
core_request_rejected     id=phone_answer reason=too_far room=ldk
```

### 7. 実測

```text
PICK IT UP             28/30 (93%)   他: sit_stay_here / sit_turn
GO BACK AND ANSWER IT  25/30 (83%)   無反応 0
PLAY A BEAT            28/30 (93%)   他: sit_stay_here / sit_turn
TAKE A SIP             25/30 (83%)   他: sit_turn / sit_look_behind
```

10 Run:

| | 前回 | 今回 |
| --- | --- | --- |
| Object : Situation | 44 : 74 | **54 : 57** |
| 最長の無音 | 51.3s | 46.4s |
| Core の内訳 | — | bath_sip 10 / phone_answer 7 / phone_return 6 / ghost_refind 6 / phone_listen 6 / altar_beat 3 |


---

## Core Opportunity Lifecycle / Urgency

### 1. 壁時計で腐らせない

風呂を見つけているのに、**別のリクエストを処理していただけ**で興味が消えていた。
これは世界の都合ではなく内部都合。

```text
budget を消費するのは「RequestDirector が実際に Offer できた時間」だけ
別Request中 / Pending中 / Chase中 は Pause
```

実測（Test A）:

```text
wall_time 20.5s  eligible_active_time 0.5s  paused_time 20.0s
```

20秒間ずっと別のリクエストが走っていても、風呂の機会は 0.5秒しか減らない。

### 2. Persistent と Time-Sensitive

| | 例 | 別Request中 | 期限 |
| --- | --- | --- | --- |
| persistent | 仏壇 / 風呂 / 幽霊 | Pause して待つ | Offer できた累計 14〜16秒 |
| timeSensitive | 鳴っている電話 | Pause しない | 鳴り止んだら消える |

電話だけ Pause しないのは、世界の時間が止まらないから。
その代わり **Urgency** を持ち、塞がっている間はさらに上がる。

```text
残り >10秒  +10
残り 5〜10  +20
残り <5     +30
別Request中 さらに +8
```

### 3. 意味で死ぬ

```text
phone   鳴り止んだ / 取った        → phone_stopped_ringing / already_completed
bath    洗面所・風呂を離れた       → left_room
altar   仏間を離れた / 鳴らし終えた → left_room / already_completed
ghost   追跡が始まった / 見失った   → run_phase_changed / target_lost
```

Pause から戻るときは必ず再検証する（`core_opportunity_revalidated`）。

### 4. 実行中のリクエストは中断しない

電話が鳴っても `PLAY A BEAT` の HOLD は続く。
終わった直後に、上がった Urgency で電話へ食いつく。

### 5. 逃した理由の内訳

```text
Before  miss_due_to_active_request が主因
After   miss_due_to_active_request 0
        miss_due_to_context 10 / time_sensitive_expiry 8 / selection 2
```

### 6. KPI の分母を機会にする

```text
Core Offer / Opportunity   bath 10/19 (53%)  phone 17/26 (65%)  ghost 5/8 (63%)
30シード（機会を確実に踏ませた場合）
  PLAY A BEAT 90% / TAKE A SIP 77% / PICK IT UP 87% / GO BACK AND ANSWER IT 87%
```

Run 数を分母にしない。`altar_beat` が 10Run で 0 件でも、
**ボットが仏間に入っても仏壇を Inspect しなかった**のが理由であり、Director の問題ではない。

```text
仏間へ入った Run 7/10   仏壇を Inspect した回数 0
```

これは Level Design / 導線側の指標として分けて持つ。


---

## Core Opportunity Session（Soft / Hard Context Loss）

風呂と洗面所を出入りしただけで機会が何度も死に、KPI 上「逃した」と数えられていた。

### Soft と Hard を分ける

```text
ok    エリア内にいる
soft  エリアを出たが近い（16m 以内）→ SUSPENDED。予算を減らさない。Miss に数えない
hard  エリアの外へ十分離れた / 対象が使えなくなった → ENDED。ここで初めて Miss
```

関連エリアを定義した。風呂と洗面所は同じ場所として扱う。

```text
altar  butsuma
bath   bath + washroom
phone  hallway + entrance（鳴っている限り部屋を出ても有効）
ghost  ldk
```

猶予 10秒。戻れば **同じ Session** を続ける（`core_session_resumed`）。
Session が終わった直後は 8秒だけ再オープンを抑える。

### Session KPI

```text
started 43  soft_lost 16  resumed 2  hard_lost 10  resolved 32
逃した理由: hard_context_loss 3 / time_sensitive_expiry 7
            active_request 0   ← 以前の主因
```

`SUSPEND → RESUME` は成功したライフサイクルであって Miss ではない。

### 機会の開き方をそろえた

風呂と幽霊は「発見」で機会が開くのに、仏壇だけ「Inspect」を要求していた。
視聴者は配信を見ているので、見つけた時点で口は出せる。

```text
Core Offer / Session   altar 8/8 (100%)  bath 10/10 (100%)  phone 8/16 (50%)  ghost 6/9 (67%)
30シード              PLAY A BEAT 80%  TAKE A SIP 83%  PICK IT UP 93%  GO BACK 73%
```

---

## 仏間の導線

### 原因はレベルでもDirectorでもなかった

```text
仏壇 discovered=true  attention=10.4  reengaged=true  interactions=0
```

ボットは仏間に入り、仏壇を**見て発見もしている**。`[E]` を押していないだけだった。
遺影と押入れは調べるのに仏壇だけ押さない、というボットの入力癖。

したがって `altar_beat` の weight も core bonus も触っていない（§36, §42）。
代わりに、上記のとおり **発見だけで機会が開く**ようにした。

### 間取り

```text
玄関   x -7..7,  z 27..34
廊下   x -2.5..2.5, z 0..27
仏間   x -15..-2.5, z 13..27   入口は x=-2.5, z 19〜22
```

玄関 (0, 31) から仏壇 (-12.5, 15.5) までは 19.9m。
**本編の「入ってすぐ左」ではなく、廊下を10m進んでから左**になっている。
玄関からは仏間の入口が見えない。ここは Level Design 側の課題として残す。

### コメントによる薄い誘導

UI 誘導・マーカー・矢印は使わない。仏間をまだ見つけていない状態で
入口付近にいるときだけ、雑談として流す。

```text
"what's that room on the left"
"left door looks busted"
"why is that one broken"
```

55% の確率で、1 Run に最大2回。仏壇を見つけたら止まる。
これは Request ではない（§49）。
