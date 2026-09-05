import type { GameMode } from '../config';
import { useState } from 'react';
import { CONFIG } from '../config';
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
  ['E', 'EXAMINE — AND THE REQUEST ACTION, ONLY WHEN ASKED'],
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
    id: 'floor1',
    name: 'HS FLOOR 1 MODE',
    tag: '本編1階のレイアウトで検証',
    lines: [
      '仏壇・遺影・電話・風呂・冷蔵庫・ソファの人影',
      '見るのは自由。飲む・鳴らす・受話器を取るのは、視聴者に頼まれたときだけ',
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

/**
 * 視聴者ノイズの調整バー（FLOOR 1 用）。
 *
 * 理想の値を決め打ちせず、実験できるようにしておく。
 * 変更は次の Run から効く。
 */
function NoiseTuner() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(() => ({ ...CONFIG.viewerNoise }));

  const apply = (next: typeof cfg) => {
    setCfg(next);
    const g = (window as unknown as { __HS?: { dev: { setNoise: (o: unknown) => void } } }).__HS;
    g?.dev.setNoise(next);
  };

  const bar = (
    label: string,
    key: 'longScale' | 'shortScale' | 'longWeight' | 'reactionOffset',
    min: number,
    max: number,
    step: number,
    unit = '',
  ) => (
    <label className="tuner-row" key={key}>
      <span className="tuner-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={cfg[key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          const next = { ...cfg, [key]: v };
          // 長短の重みは合計1に保つ
          if (key === 'longWeight') next.shortWeight = Math.round((1 - v) * 100) / 100;
          apply(next);
        }}
      />
      <span className="tuner-value">
        {cfg[key]}
        {unit}
      </span>
    </label>
  );

  if (!open) {
    return (
      <button type="button" className="tuner-toggle" onClick={() => setOpen(true)}>
        VIEWER NOISE ▸
      </button>
    );
  }

  return (
    <div className="tuner">
      <div className="tuner-head">
        VIEWER ACTIVITY NOISE
        <button type="button" className="tuner-toggle" onClick={() => setOpen(false)}>
          ▾
        </button>
      </div>
      <p className="tuner-note">
        視聴者が「いつ口を開きやすいか」だけを揺らします。何を言うかは変わりません。
        <br />
        変更は次の RUN から反映されます。
      </p>
      <label className="tuner-row">
        <span className="tuner-label">ON / OFF</span>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => apply({ ...cfg, enabled: e.target.checked })}
        />
        <span className="tuner-value">{cfg.enabled ? 'ON' : 'OFF'}</span>
      </label>
      {bar('長い波', 'longScale', 20, 90, 5, 's')}
      {bar('短い波', 'shortScale', 5, 25, 1, 's')}
      {bar('長い波の比重', 'longWeight', 0.4, 1, 0.05)}
      {bar('コメント先行', 'reactionOffset', 0, 10, 1, 's')}
    </div>
  );
}

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

        <div className="modes modes-3">
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

        <NoiseTuner />

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
