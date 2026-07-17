import type { NoteEvent, Song } from "../engine/types.js";
import { BEATS_PER_BAR } from "../engine/types.js";

/**
 * Web Audio API による再生 (§4.4)。M2 は軽量な自前シンセ
 * (オシレーター+エンベロープ)。音源方式の本格比較は §10 の未決事項。
 * スケジューリングは BaseAudioContext に対して行うため、リアルタイム再生
 * (AudioContext) と WAV レンダリング (OfflineAudioContext, §4.5 M4) で共用できる。
 */

type Part = "melody" | "piano" | "bass";

interface Timbre {
  type: OscillatorType;
  /** 音量スケール */
  gain: number;
  attack: number;
  /** 音長に対するリリースの長さ (秒) */
  release: number;
  /** 1 オクターブ下の副オシレーターを重ねる */
  subOctave?: boolean;
}

const TIMBRES: Record<Part, Timbre> = {
  melody: { type: "triangle", gain: 0.28, attack: 0.02, release: 0.08 },
  piano: { type: "triangle", gain: 0.1, attack: 0.005, release: 0.15 },
  bass: { type: "sawtooth", gain: 0.16, attack: 0.01, release: 0.1, subOctave: true },
};

function midiToFreq(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
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
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + timbre.attack);
  // ノート長に沿って減衰し、末尾でリリース
  gain.gain.setTargetAtTime(peak * 0.6, time + timbre.attack, duration * 0.5);
  gain.gain.setTargetAtTime(0, end - Math.min(timbre.release, duration * 0.3), 0.03);

  const oscs: OscillatorNode[] = [];
  const main = ctx.createOscillator();
  main.type = timbre.type;
  main.frequency.value = midiToFreq(note.pitch);
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
    osc.stop(end + 0.1);
  }
}

/** 曲全体をコンテキストにスケジュールする。戻り値は曲の長さ (秒)。 */
export function scheduleSong(ctx: BaseAudioContext, song: Song, startTime: number): number {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);

  const secPerBeat = 60 / song.bpm;
  for (const section of song.sections) {
    const offsetBeats = section.startBar * BEATS_PER_BAR;
    const parts: Array<[Part, NoteEvent[]]> = [
      ["melody", section.melody],
      ["piano", section.piano],
      ["bass", section.bass],
    ];
    for (const [part, notes] of parts) {
      for (const n of notes) {
        const t = startTime + (offsetBeats + n.start) * secPerBeat;
        scheduleNote(ctx, master, part, n, t, n.duration * secPerBeat);
      }
    }
  }
  return song.totalBars * BEATS_PER_BAR * secPerBeat;
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
    this.totalBeats = song.totalBars * BEATS_PER_BAR;

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
