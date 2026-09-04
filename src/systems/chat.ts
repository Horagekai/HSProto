import { CONFIG, type GameMode } from '../config';
import { clamp, pick } from '../core/util';
import type { ChatMessage } from '../core/store';

export type ChatCategory =
  | 'idle'
  | 'exploring'
  | 'anomaly'
  | 'discovered'
  | 'close'
  | 'danger'
  | 'chase'
  | 'filming_back'
  | 'provoke'
  | 'stale'
  | 'request'
  | 'temptation'
  | 'leaving'
  | 'selfie'
  | 'death'
  | 'escape';

const USERS = [
  'kuro_1', 'nightowl', 'mika__', 'GHOSTFAN99', 'tenko', 'oioioi', 'ramune',
  'deadpixel', 'yuu_', 'crptid', 'no_sleep', 'shibuya404', 'mothman', 'kai',
  'lurker_02', 'AAAAAA', 'sena', 'FRIED_RICE', 'tokage', 'hanako_san',
  'blurry', 'ex_believer', 'shiro', 'nnnn', 'catgirl_ops', 'kenta',
  'akari', 'not_a_bot', 'sub_zero', '9mm',
];

const LINES: Record<ChatCategory, string[]> = {
  idle: [
    'boring',
    'anything there?',
    'go deeper',
    'this place looks creepy',
    'nothing here lol',
    'turn left',
    'why is it so dark',
    'first time here, is he legit?',
    'the silence is worse',
    'check that room',
  ],
  exploring: [
    'open that door',
    'what was that room',
    'go upstairs',
    'check behind you',
    'inspect it',
    'I want to see the doll',
    'go back to the corridor',
    'this hallway is so long',
    'film the walls too',
  ],
  anomaly: [
    'DID YOU SEE THAT??',
    'GO BACK',
    'SOMETHING WAS THERE',
    'rewind rewind',
    'nope nope nope',
    'that was NOT the wind',
    'clip it',
    'chat did you see it',
    'IT MOVED',
    'im getting chills',
  ],
  discovered: [
    'WAIT WHAT IS THAT',
    "there's something there",
    'zoom in',
    'NO WAY',
    'I SAW IT TOO',
    'THATS NOT A PERSON',
    'my heart',
    'is that a person??',
  ],
  close: [
    'GET CLOSER',
    "don't be a coward",
    "bro that's too close",
    'RUN',
    'closer closer closer',
    'this is how people die',
    'FRAME IT PROPERLY',
    'center it!!',
  ],
  danger: [
    "IT'S LOOKING AT YOU",
    'GET OUT',
    'KEEP FILMING',
    'dude leave NOW',
    'DONT BLINK',
    'why is it taller',
    'IT KNOWS',
    'this is not funny anymore',
  ],
  chase: [
    'RUN RUN RUN',
    'TURN AROUND',
    'FILM IT',
    'LMAO',
    "DON'T STOP",
    'GO GO GO',
    'ITS RIGHT BEHIND YOU',
    'EXIT EXIT EXIT',
    'nooooo',
  ],
  filming_back: [
    'OH MY GOD ITS SO CLOSE',
    'THIS IS THE SHOT',
    'HOLD IT THERE',
    'BEST STREAM EVER',
    'CLIPPING THIS',
    'HES ACTUALLY FILMING IT',
    'legend',
    'this is going viral',
  ],
  provoke: [
    'LOL IT HEARD YOU',
    'do it again',
    'call it again',
    'did it hear you?',
    'WHY WOULD YOU DO THAT',
    'LMAOOO he called it',
    'you idiot',
    'do it again',
    'HE PROVOKED IT',
    'thats on you bro',
  ],
  /** もう飽きられている。出しすぎない（§9） */
  stale: [
    'we saw that already',
    'same thing again',
    'show us something else',
    'boring',
    'move on',
    'ok and?',
    'nothing new',
    'weve seen it',
  ],
  request: [
    'DO IT',
    'take the money',
    'easy money',
    'do it for the boys',
    "that's a lot of money",
    'donate more if he does it',
    'call it again',
    'do it again',
    // 全員が煽るわけではない。コメント欄の中でも意見が割れる
    'not worth it man',
    "that's enough",
    "don't do it",
    'leave',
    'seriously just go home',
    'he doesnt have to prove anything',
  ],
  temptation: [
    'ONE LAST TIME',
    'call it from the door',
    "don't chicken out now",
    // 止める側
    "you got the money, go",
    'not worth 8k',
    'please just leave',
    'one more, come on',
    'you already came all this way',
    'ITS RIGHT THERE',
    'free money',
    "don't leave yet",
    'just one more shot',
    'you will regret leaving',
    'we paid for this',
  ],
  leaving: [
    'leaving already?',
    'W stream',
    'that was enough honestly',
    'good call',
    'coward lol',
    'smart',
    'ok that was actually scary',
  ],
  selfie: [
    'SELFIE TIME',
    'ITS BEHIND YOU',
    'BRO TURN AROUND',
    'smile',
    'DONT LOOK AT THE CAMERA LOOK BEHIND',
    'PROFILE PIC',
    'why would you turn your back',
  ],
  death: [
    'NO WAY',
    'HOLY SHIT',
    'IS THIS REAL',
    'WTF',
    'did that just happen',
    'CALL SOMEONE',
    'clip clip clip',
    'im shaking',
    'REPLAY IT',
  ],
  escape: [
    'HE MADE IT',
    'W stream',
    'never doing that again',
    'best content of the year',
    'go back in',
    'GG',
  ],
};

/**
 * ONE GHOST MODE 用の差し替え（§35）。
 * 部屋や調査に言及する行は存在しないので消し、
 * 「次の一歩を促す声」と「やめろという声」を混ぜる。
 */
const GHOST_LINES: Partial<Record<ChatCategory, string[]>> = {
  idle: [
    'where is it',
    'is it still there?',
    'closer',
    'get a better shot',
    "don't lose it",
    'zoom',
    'this is boring from here',
    'CALL IT',
    'why are you so far away',
    'ok that framing is bad',
  ],
  exploring: [
    'closer',
    'get a better shot',
    'CALL IT',
    'one more step',
    "it hasn't moved",
    'is it looking at us',
    'go around it',
    "don't get too close",
    'stay there',
  ],
  close: [
    "that's close",
    'GET CLOSER',
    'too close man',
    'RUN',
    'do not touch it',
    'FRAME IT PROPERLY',
    'center it!!',
    'leave',
  ],
  discovered: [
    'THERE IT IS',
    'NO WAY',
    'it saw you',
    'zoom in',
    'THATS NOT A PERSON',
    'my heart',
    'is that a person??',
  ],
};


/**
 * HS FLOOR 1 MODE 用の差し替え。
 *
 * 舞台は病院ではなく**一軒の家の1階**。
 * 2階も、長い廊下の先の別棟も、部屋番号も無い。
 * 存在しない場所（upstairs / that room / the walls）に言及する行を全部外してある。
 */
const FLOOR1_LINES: Partial<Record<ChatCategory, string[]>> = {
  idle: [
    'someone lived here',
    'the tatami is rotting',
    'why is it still furnished',
    'check the altar',
    'is the kitchen through there',
    'nobody cleaned up',
    'the smell must be awful',
    'look at the floor',
    'quiet house',
    'open something',
  ],
  exploring: [
    'check the altar',
    'look behind the sofa',
    'open the fridge',
    'is that a phone',
    'the bathroom',
    'what about the closet',
    'film the portraits',
    'go into the living room',
    'that door',
  ],
  anomaly: [
    'DID YOU SEE THAT??',
    'SOMETHING MOVED',
    'nope nope nope',
    'clip it',
    'that was NOT the wind',
    'IT MOVED',
    'im getting chills',
    'this house is not empty',
    'rewind rewind',
  ],
  discovered: [
    'is that a person',
    "that's not normal",
    'ON THE SOFA',
    'NO WAY',
    'I SAW IT TOO',
    'THATS NOT A PERSON',
    'my heart',
    'someone is sitting there',
  ],
  close: [
    'GET CLOSER',
    "that's close",
    "bro that's too close",
    'RUN',
    'this is how people die',
    'FRAME IT PROPERLY',
    'center it!!',
    'leave',
  ],
  danger: [
    "IT'S LOOKING AT YOU",
    'GET OUT',
    'KEEP FILMING',
    'dude leave NOW',
    'IT KNOWS',
    'this is not funny anymore',
    'it got up',
    'why is it standing',
  ],
  chase: [
    'RUN RUN RUN',
    'GET TO THE DOOR',
    'FILM IT',
    'LMAO',
    "DON'T STOP",
    'GO GO GO',
    'ITS RIGHT BEHIND YOU',
    'THE ENTRANCE',
    'nooooo',
  ],
  provoke: [
    'LOL IT HEARD YOU',
    'do it again',
    'WHY WOULD YOU DO THAT',
    'you idiot',
    'thats on you bro',
    'ring it again',
    'stop stop stop',
    'this is disrespectful',
  ],
  stale: [
    'we saw that already',
    'same thing again',
    'show us something else',
    'boring',
    'move on',
    'another room',
    'nothing new',
  ],
  request: [
    'DO IT',
    'take the money',
    'easy money',
    "that's a lot of money",
    'do it for the boys',
    'one more',
    // 全員が煽るわけではない
    'not worth it man',
    "that's enough",
    "don't do it",
    'leave',
    'seriously just go home',
    'he doesnt have to prove anything',
    'have some respect',
  ],
  temptation: [
    'ONE LAST TIME',
    "don't chicken out now",
    'you already came all this way',
    'free money',
    "don't leave yet",
    'we paid for this',
    // 止める側
    "you got the money, go",
    'please just leave',
    'not worth it',
    'go home',
  ],
  leaving: [
    'leaving already?',
    'W stream',
    'that was enough honestly',
    'good call',
    'coward lol',
    'smart',
    'ok that was actually scary',
  ],
  selfie: [
    'SELFIE TIME',
    'ITS BEHIND YOU',
    'BRO TURN AROUND',
    'smile',
    'DONT LOOK AT THE CAMERA LOOK BEHIND',
    'PROFILE PIC',
    'why would you turn your back',
  ],
  escape: [
    'HE MADE IT',
    'W stream',
    'never doing that again',
    'best content of the year',
    'GG',
  ],
};

export class ChatSystem {
  /** ONE GHOST MODE では一部の行を差し替える */
  mode: GameMode = 'standard';
  messages: ChatMessage[] = [];
  onMessage: ((m: ChatMessage) => void) | null = null;

  private timer = 0;
  private nextId = 1;

  reset() {
    this.messages = [];
    this.timer = 0;
  }

  push(text: string, hot = false, user = pick(USERS)) {
    const msg: ChatMessage = { id: this.nextId++, user, text, hot };
    this.messages = [...this.messages, msg].slice(-CONFIG.chat.maxVisible);
    this.onMessage?.(msg);
  }

  private lines(category: ChatCategory) {
    if (this.mode === 'one_ghost') return GHOST_LINES[category] ?? LINES[category];
    if (this.mode === 'floor1') return FLOOR1_LINES[category] ?? LINES[category];
    return LINES[category];
  }

  burst(category: ChatCategory, n: number) {
    for (let i = 0; i < n; i++) this.push(pick(this.lines(category)), true);
  }

  update(dt: number, category: ChatCategory, viewers: number, engagement: number) {
    // Viewer数とEngagementが高いほどコメントが速く流れる
    const heat = 1 + Math.log10(Math.max(1, viewers / 100)) * 1.6 + (engagement - 1) * 0.45;
    const interval = clamp(
      CONFIG.chat.base / heat,
      CONFIG.chat.minInterval,
      CONFIG.chat.maxInterval,
    );
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = interval * (0.6 + Math.random() * 0.8);
      const hot = category !== 'idle' && category !== 'exploring' && Math.random() < 0.5;
      this.push(pick(this.lines(category)), hot);
    }
  }
}
