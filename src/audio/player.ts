import type { NoteEvent, Song } from "../engine/types.js";

/**
 * Web Audio API による再生 (§4.4)。M2 は軽量な自前シンセ
 * (オシレーター+ADSR エンベロープ+パート別ローパス)。
 * スケジューリングは BaseAudioContext に対して行うため、リアルタイム再生
 * (AudioContext) と WAV レンダリング (OfflineAudioContext, §4.5 M4) で共用できる。
 */

type Part = "melody" | "piano" | "bass";

interface Timbre {
  type: OscillatorType;
  /** 音量スケール */
  gain: number;
  attack: number;
  /** ピークからサステインへ向かう減衰の時定数 (秒) */
  decayTc: number;
  /** サステインレベル (ピーク比) */
  sustain: number;
  /** リリース (秒) */
  release: number;
  /** パート別ローパスのカットオフ (Hz)。倍音のきつさを抑える */
  lowpassHz: number;
  /** 1 オクターブ下の副オシレーターを重ねる */
  subOctave?: boolean;
  /** 同時発音する和音を 1 音ずつずらす (秒)。位相の揃ったバリつきを防ぐ */
  strumSec?: number;
}

const TIMBRES: Record<Part, Timbre> = {
  melody: {
    type: "triangle", gain: 0.26, attack: 0.015, decayTc: 0.4,
    sustain: 0.8, release: 0.06, lowpassHz: 2600,
  },
  piano: {
    type: "triangle", gain: 0.13, attack: 0.004, decayTc: 0.28,
    sustain: 0.18, release: 0.05, lowpassHz: 1800, strumSec: 0.008,
  },
  bass: {
    type: "triangle", gain: 0.22, attack: 0.008, decayTc: 0.5,
    sustain: 0.7, release: 0.06, lowpassHz: 750, subOctave: true,
  },
};

function midiToFreq(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

/** ピッチと位置から決まる決定的な微小デチューン (±3 セント)。音の重なりを和らげる */
function detuneCents(note: NoteEvent): number {
  return ((note.pitch * 7 + Math.round(note.start * 4)) % 7) - 3;
}

function scheduleNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  part: Part,
  note: NoteEvent,
  time: number,
  duration: number,
): void {
  const timbre = TIMBRES[part];
  const gain = ctx.createGain();
  gain.connect(dest);

  const peak = timbre.gain * (note.velocity / 127);
  const end = time + duration;
  const attackEnd = time + timbre.attack;

  // ADSR: アタック → サステインへ指数減衰 → リリース → 完全消音後にオシレーター停止
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.setTargetAtTime(peak * timbre.sustain, attackEnd, timbre.decayTc);
  const releaseStart = Math.max(attackEnd, end - timbre.release);
  gain.gain.setTargetAtTime(0, releaseStart, 0.025);

  const oscs: OscillatorNode[] = [];
  const main = ctx.createOscillator();
  main.type = timbre.type;
  main.frequency.value = midiToFreq(note.pitch);
  main.detune.value = detuneCents(note);
  oscs.push(main);

  if (timbre.subOctave) {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = midiToFreq(note.pitch - 12);
    oscs.push(sub);
  }

  for (const osc of oscs) {
    osc.connect(gain);
    osc.start(time);
    // リリースの指数減衰が十分ゼロに近づいてから止める (クリックノイズ防止)
    osc.stop(end + 0.2);
  }
}

/** 曲全体をコンテキストにスケジュールする。戻り値は曲の長さ (秒)。 */
export function scheduleSong(ctx: BaseAudioContext, song: Song, startTime: number): number {
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const comp = ctx.createDynamicsCompressor();
  // ポンピングノイズを避ける控えめな設定
  comp.threshold.value = -14;
  comp.knee.value = 20;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  // パート別バス (ローパスで倍音のきつさを抑える)
  const buses: Record<Part, AudioNode> = {} as Record<Part, AudioNode>;
  for (const part of ["melody", "piano", "bass"] as const) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = TIMBRES[part].lowpassHz;
    filter.Q.value = 0.5;
    filter.connect(master);
    buses[part] = filter;
  }

  const secPerBeat = 60 / song.bpm;
  for (const section of song.sections) {
    const offsetBeats = section.startBar * song.meter.barBeats;
    const parts: Array<[Part, NoteEvent[]]> = [
      ["melody", section.melody],
      ["piano", section.piano],
      ["bass", section.bass],
    ];
    for (const [part, notes] of parts) {
      const strum = TIMBRES[part].strumSec ?? 0;
      let lastStart = Number.NaN;
      let chordIndex = 0;
      for (const n of notes) {
        // 同時刻に始まる和音は 1 音ずつ strumSec だけずらす
        if (n.start === lastStart) {
          chordIndex++;
        } else {
          chordIndex = 0;
          lastStart = n.start;
        }
        const t = startTime + (offsetBeats + n.start) * secPerBeat + chordIndex * strum;
        scheduleNote(ctx, buses[part], part, n, t, n.duration * secPerBeat);
      }
    }
  }
  return song.totalBars * song.meter.barBeats * secPerBeat;
}

export class SongPlayer {
  private ctx: AudioContext | null = null;
  private startTime = 0;
  private bpm = 120;
  private totalBeats = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  get isPlaying(): boolean {
    return this.ctx !== null;
  }

  /** 再生位置 (曲頭からの拍数)。停止中は null */
  get positionBeats(): number | null {
    if (!this.ctx) return null;
    const elapsed = this.ctx.currentTime - this.startTime;
    return Math.min(elapsed * (this.bpm / 60), this.totalBeats);
  }

  play(song: Song, onEnded?: () => void): void {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.bpm = song.bpm;
    this.totalBeats = song.totalBars * song.meter.barBeats;

    // AudioContext 起動直後のスケジューリング余裕
    this.startTime = ctx.currentTime + 0.1;
    const totalSec = scheduleSong(ctx, song, this.startTime) + 0.5;

    this.endTimer = setTimeout(() => {
      this.stop();
      onEnded?.();
    }, totalSec * 1000);
  }

  stop(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
