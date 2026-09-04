import type { GameMode } from '../config';
import { useHud } from './useHud';

interface Props {
  onStart: (mode: GameMode) => void;
}

const CONTROLS: Array<[string, string]> = [
  ['WASD', 'MOVE'],
  ['MOUSE', 'LOOK (= YOUR CAMERA)'],
  ['SHIFT', 'RUN'],
  ['Q', 'HEY! — CALL OUT TO IT'],
  ['C', 'SELFIE MODE'],
  ['F', 'LIGHT ON / OFF'],
  ['E', 'INSPECT / ANSWER / LEAVE'],
  ['X (hold)', 'DISMISS REQUEST (NO ACCEPT BUTTON)'],
  ['P', 'DEBUG PANEL'],
  ['ESC', 'RELEASE MOUSE'],
];

const MODES: Array<{
  id: GameMode;
  name: string;
  tag: string;
  lines: string[];
}> = [
  {
    id: 'standard',
    name: 'STANDARD MVP',
    tag: '廃墟とViewer Requestが怖い',
    lines: [
      '調査地点・環境怪異・Haunted Level・リクエスト連鎖',
      '入口に戻って [E] を押した時点で収益が確定する',
    ],
  },
  {
    id: 'one_ghost',
    name: 'ONE GHOST MODE',
    tag: '一体との距離感そのものが怖い',
    lines: [
      'マップに怪異は一体だけ。環境怪異もおつかいも無い',
      '近づく・撮る・HEYする・逃げる・また戻る、それだけ',
    ],
  },
];

export function StartOverlay({ onStart }: Props) {
  const s = useHud();
  // ポインタロックが外れてもゲームは止めないので、一時停止オーバーレイは出さない
  if (s.phase !== 'menu') return null;

  return (
    <div className="overlay">
      <div className="overlay-card">
        <h1>HAUNTED STREAMER</h1>
        <p className="tagline">
          あなたの一人称視点が、そのまま配信映像です。カメラは常にONです。
          <br />
          稼いだ金は <b>入口に戻って [E] を押した時点で確定</b>する。死ぬと大半を失う。
        </p>

        <div className="modes">
          {MODES.map((m) => (
            <button key={m.id} type="button" className="mode" onClick={() => onStart(m.id)}>
              <span className="mode-name">{m.name}</span>
              <span className="mode-tag">{m.tag}</span>
              {m.lines.map((l) => (
                <span key={l} className="mode-line">
                  {l}
                </span>
              ))}
              <span className="mode-cta">CLICK TO GO LIVE</span>
            </button>
          ))}
        </div>

        <ul className="controls">
          {CONTROLS.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>
              <span>{v}</span>
            </li>
          ))}
        </ul>
        <p className="rules">
          ONE GHOST MODE では <b>[E] は帰るためだけのキー</b>。調べるものは何も無い。
          <br />
          追われても、逃げ切れば怪異はまた遠くで待っている。帰るかどうかは自分で決める。
        </p>
      </div>
    </div>
  );
}
