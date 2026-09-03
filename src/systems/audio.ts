import { CONFIG } from '../config';
import { clamp, clamp01 } from '../core/util';

/**
 * 外部アセットを使わず、WebAudioの合成だけで最低限の音を鳴らす。
 * - 足音 / 心音 / 怪異の環境音 / コメント通知 / チャレンジ通知 / Viewer急増 / 追跡BGM
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private chaseGain: GainNode | null = null;
  private chaseTimer = 0;
  private chaseOn = false;
  private heartTimer = 0;
  private chatBlipCooldown = 0;

  get enabled() {
    return this.ctx !== null;
  }

  /** ユーザー操作の中から呼ぶこと */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = CONFIG.audio.master;
    this.master.connect(ctx.destination);

    // ノイズバッファ（足音・環境音用）
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // 怪異のドローン（常時鳴らして音量で距離感を出す）
    const drone = ctx.createGain();
    drone.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    drone.connect(filter).connect(this.master);
    for (const f of [41, 57.5, 84]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 20;
      osc.connect(drone);
      osc.start();
    }
    this.droneGain = drone;
    this.droneFilter = filter;

    // 追跡BGM用のバス
    const chase = ctx.createGain();
    chase.gain.value = 0;
    chase.connect(this.master);
    this.chaseGain = chase;
  }

  private env(node: GainNode, peak: number, attack: number, release: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private tone(
    freq: number,
    peak: number,
    attack: number,
    release: number,
    type: OscillatorType = 'sine',
    slideTo?: number,
    dest?: AudioNode,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + attack + release);
    }
    osc.connect(g).connect(dest ?? this.master);
    this.env(g, peak, attack, release);
    osc.start();
    osc.stop(ctx.currentTime + attack + release + 0.05);
  }

  private noiseBurst(peak: number, duration: number, freq: number, q = 1, dest?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    src.connect(filter).connect(g).connect(dest ?? this.master);
    this.env(g, peak, 0.005, duration);
    src.start();
    src.stop(ctx.currentTime + duration + 0.1);
  }

  footstep(running: boolean) {
    this.noiseBurst(running ? 0.22 : 0.12, 0.1, running ? 420 : 300, 1.2);
  }

  chatBlip() {
    if (this.chatBlipCooldown > 0) return;
    this.chatBlipCooldown = 0.45;
    this.tone(1180 + Math.random() * 200, 0.035, 0.004, 0.05, 'square');
  }

  challengeAlert() {
    this.tone(880, 0.16, 0.01, 0.18, 'triangle');
    window.setTimeout(() => this.tone(1320, 0.16, 0.01, 0.3, 'triangle'), 120);
  }

  viewerSpike() {
    this.tone(520, 0.1, 0.02, 0.35, 'sine', 1500);
  }

  provoke() {
    this.noiseBurst(0.3, 0.35, 700, 0.8);
    this.tone(180, 0.12, 0.02, 0.4, 'sawtooth', 90);
  }

  /** 遠くの音は小さく、方向は付けない（MVPでは距離減衰のみ） */
  private atDistance(distance: number) {
    return Math.max(0.12, 1 - distance / 40);
  }

  doorSlam(distance: number) {
    const g = this.atDistance(distance);
    this.noiseBurst(0.5 * g, 0.28, 120, 0.7);
    this.tone(90, 0.28 * g, 0.005, 0.35, 'square', 45);
  }

  knock(distance: number) {
    const g = this.atDistance(distance);
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => this.noiseBurst(0.3 * g, 0.09, 260, 2), i * 190);
    }
  }

  phoneRing(distance: number) {
    const g = this.atDistance(distance);
    for (let i = 0; i < 2; i++) {
      window.setTimeout(() => {
        this.tone(1040, 0.11 * g, 0.005, 0.12, 'square');
        window.setTimeout(() => this.tone(820, 0.11 * g, 0.005, 0.12, 'square'), 90);
      }, i * 220);
    }
  }

  whisper(distance: number) {
    const g = this.atDistance(distance);
    this.noiseBurst(0.16 * g, 1.1, 1500, 0.5);
    this.tone(230, 0.07 * g, 0.2, 1.0, 'sine', 180);
  }

  shutter() {
    this.noiseBurst(0.22, 0.06, 2600, 1.5);
    this.tone(1800, 0.06, 0.003, 0.05, 'square');
  }

  cash() {
    this.tone(880, 0.14, 0.01, 0.12, 'triangle');
    window.setTimeout(() => this.tone(1320, 0.14, 0.01, 0.16, 'triangle'), 90);
    window.setTimeout(() => this.tone(1760, 0.12, 0.01, 0.3, 'triangle'), 180);
  }

  monsterRoar() {
    this.tone(140, 0.35, 0.03, 1.4, 'sawtooth', 46);
    this.noiseBurst(0.25, 1.0, 220, 0.6);
  }

  death() {
    this.setChase(false);
    this.tone(320, 0.4, 0.01, 1.8, 'sawtooth', 40);
    this.noiseBurst(0.5, 1.6, 160, 0.4);
  }

  escape() {
    this.setChase(false);
    this.tone(440, 0.2, 0.02, 0.4, 'triangle');
    window.setTimeout(() => this.tone(660, 0.2, 0.02, 0.7, 'triangle'), 160);
  }

  setChase(on: boolean) {
    if (!this.ctx || !this.chaseGain) return;
    if (on === this.chaseOn) return;
    this.chaseOn = on;
    const t = this.ctx.currentTime;
    this.chaseGain.gain.cancelScheduledValues(t);
    this.chaseGain.gain.linearRampToValueAtTime(on ? 0.5 : 0, t + (on ? 0.4 : 1.2));
  }

  update(dt: number, danger: number, monsterDistance: number, aggression: number) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.chatBlipCooldown = Math.max(0, this.chatBlipCooldown - dt);

    // 怪異の環境音（距離と興奮度で強くなる）
    if (this.droneGain && this.droneFilter) {
      const prox = clamp01((26 - monsterDistance) / 26);
      const target = prox * (0.05 + aggression * 0.16);
      this.droneGain.gain.value += (target - this.droneGain.gain.value) * Math.min(1, dt * 2);
      this.droneFilter.frequency.value = 200 + aggression * 500 + prox * 200;
    }

    // 心音：Dangerが上がるほど速く・強く
    const d = clamp01(danger / 100);
    if (d > 0.12) {
      this.heartTimer -= dt;
      const interval = 1.15 - d * 0.72;
      if (this.heartTimer <= 0) {
        this.heartTimer = interval;
        const peak = 0.06 + d * 0.28;
        this.tone(58, peak, 0.01, 0.12, 'sine');
        window.setTimeout(() => this.tone(48, peak * 0.7, 0.01, 0.16, 'sine'), 145);
      }
    }

    // 追跡BGM：不協和なパルス
    if (this.chaseOn && this.chaseGain) {
      this.chaseTimer -= dt;
      if (this.chaseTimer <= 0) {
        this.chaseTimer = 0.22;
        this.tone(74, 0.5, 0.005, 0.16, 'square', undefined, this.chaseGain);
        if (Math.random() < 0.5) {
          this.tone(
            660 + Math.random() * 500,
            0.08,
            0.005,
            0.12,
            'sawtooth',
            undefined,
            this.chaseGain,
          );
        }
      }
    }
  }

  setMasterVolume(v: number) {
    if (this.master) this.master.gain.value = clamp(v, 0, 1);
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
  }
}
