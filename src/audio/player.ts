import type { NoteEvent, Song, SongPart } from "../engine/types.js";

/**
 * Web Audio API による再生 (§4.4)。M2 は軽量な自前シンセ
 * (オシレーター+ADSR エンベロープ+パート別ローパス)。
 * スケジューリングは BaseAudioContext に対して行うため、リアルタイム再生
 * (AudioContext) と WAV レンダリング (OfflineAudioContext, §4.5 M4) で共用できる。
 */

type Part = SongPart;

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
    type: "triangle", gain: 0.26, attack: 0.004, decayTc: 0.28,
    sustain: 0.18, release: 0.05, lowpassHz: 1800, strumSec: 0.008,
  },
  bass: {
    type: "triangle", gain: 0.17, attack: 0.008, decayTc: 0.5,
    sustain: 0.7, release: 0.06, lowpassHz: 750, subOctave: true,
  },
  guitar: {
    type: "sawtooth", gain: 0.2, attack: 0.006, decayTc: 0.18,
    sustain: 0.24, release: 0.05, lowpassHz: 2100, strumSec: 0.014,
  },
  drums: {
    type: "square", gain: 0.19, attack: 0.001, decayTc: 0.025,
    sustain: 0.02, release: 0.025, lowpassHz: 4200,
  },
};

const TIMBRE_PRESETS: Record<string, Partial<Timbre>> = {
  sine: { type: "sine", lowpassHz: 3200 },
  flute: { type: "triangle", attack: 0.018, sustain: 0.82, lowpassHz: 2800 },
  lead: { type: "sawtooth", attack: 0.008, lowpassHz: 1800 },
  grand: { type: "triangle", decayTc: 0.3, sustain: 0.16 },
  electric: { type: "sine", decayTc: 0.42, sustain: 0.28, lowpassHz: 2600 },
  organ: { type: "square", attack: 0.02, sustain: 0.75, lowpassHz: 1700 },
  nylon: { type: "triangle", attack: 0.004, sustain: 0.18, lowpassHz: 1900 },
  bright: { type: "sawtooth", sustain: 0.16, lowpassHz: 2500 },
  fingered: { type: "triangle", subOctave: true, lowpassHz: 780 },
  synthbass: { type: "square", subOctave: true, lowpassHz: 520 },
  electronic: { type: "sawtooth", lowpassHz: 5000 },
};

/**
 * Oscillator waveforms and envelopes do not have equal perceived output.
 * These part-aware trims keep a timbre change from also acting as a volume
 * change. Values are linear gain multipliers calibrated against the rendered
 * RMS level at the default registers and note patterns.
 */
const TIMBRE_LEVELS: Record<Part, Record<string, number>> = {
  melody: { flute: 1, sine: 0.83, lead: 1.19 },
  piano: { grand: 1, electric: 0.64, organ: 0.36 },
  guitar: { nylon: 1, bright: 1.25 },
  bass: { fingered: 1, synthbass: 0.83 },
  drums: { electronic: 1, bright: 0.88 },
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
  timbreName?: string,
): void {
  const timbre = { ...TIMBRES[part], ...(TIMBRE_PRESETS[timbreName ?? ""] ?? {}) };
  const timbreLevel = TIMBRE_LEVELS[part][timbreName ?? ""] ?? 1;
  const gain = ctx.createGain();
  gain.connect(dest);

  const peak = timbre.gain * timbreLevel * (note.velocity / 127);
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
function scheduleSongLegacy(ctx: BaseAudioContext, song: Song, startTime: number): number {
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

const PARTS: Part[] = ["melody", "piano", "guitar", "bass", "drums"];

export function beatToSeconds(song: Song, beat: number): number {
  const bb = song.meter.barBeats;
  let seconds = 0;
  for (const section of song.sections) {
    const start = section.startBar * bb;
    const end = start + section.plan.bars * bb;
    const bpm = section.bpm ?? song.bpm;
    if (beat <= start) break;
    const covered = Math.min(beat, end) - start;
    if (covered > 0) seconds += covered * 60 / bpm;
    if (beat < end) break;
  }
  return seconds;
}

export function secondsToBeat(song: Song, seconds: number): number {
  const bb = song.meter.barBeats;
  let remaining = Math.max(0, seconds);
  for (const section of song.sections) {
    const beats = section.plan.bars * bb;
    const bpm = section.bpm ?? song.bpm;
    const duration = beats * 60 / bpm;
    if (remaining <= duration) {
      return section.startBar * bb + remaining * bpm / 60;
    }
    remaining -= duration;
  }
  return song.totalBars * bb;
}

export function scheduleSong(ctx: BaseAudioContext, song: Song, startTime: number): number {
  const buses = createPartBuses(ctx, song);
  const bb = song.meter.barBeats;
  for (const section of song.sections) {
    const offsetBeats = section.startBar * bb;
    const bpm = section.bpm ?? song.bpm;
    const secPerBeat = 60 / bpm;
    const sectionTime = startTime + beatToSeconds(song, offsetBeats);
    const partLists: Record<Part, NoteEvent[]> = {
      melody: section.melody,
      piano: section.piano,
      guitar: section.guitar ?? [],
      bass: section.bass,
      drums: section.drums ?? [],
    };
    for (const part of PARTS) {
      const notes = partLists[part];
      const timbre = song.mixer?.[part]?.timbre;
      const strum = TIMBRES[part].strumSec ?? 0;
      let lastStart = Number.NaN;
      let chordIndex = 0;
      for (const note of notes) {
        if (note.start === lastStart) {
          chordIndex++;
        } else {
          chordIndex = 0;
          lastStart = note.start;
        }
        scheduleNote(
          ctx,
          buses[part],
          part,
          note,
          sectionTime + note.start * secPerBeat + chordIndex * strum,
          note.duration * secPerBeat,
          timbre,
        );
      }
    }
  }
  return beatToSeconds(song, song.totalBars * bb);
}

export class SongPlayer {
  private ctx: AudioContext | null = null;
  private startTime = 0;
  private bpm = 120;
  private totalBeats = 0;
  private looping = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  get isPlaying(): boolean {
    return this.ctx !== null;
  }

  /** 再生位置 (曲頭からの拍数)。ループ中は周回ごとに巻き戻る。停止中は null */
  get positionBeats(): number | null {
    if (!this.ctx) return null;
    const elapsed = this.ctx.currentTime - this.startTime;
    const beats = elapsed * (this.bpm / 60);
    if (this.looping && this.totalBeats > 0) {
      return Math.max(0, beats) % this.totalBeats;
    }
    return Math.min(beats, this.totalBeats);
  }

  play(song: Song, onEnded?: () => void): void {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.bpm = song.bpm;
    this.totalBeats = song.totalBars * song.meter.barBeats;
    this.looping = song.ending === "loop";

    // AudioContext 起動直後のスケジューリング余裕
    this.startTime = ctx.currentTime + 0.1;
    const songSec = scheduleSong(ctx, song, this.startTime);

    if (this.looping) {
      // シームレスなリピート: 常に 1 周先までスケジュールしておき、
      // 周回ごとに次の周をスケジュールし続ける (停止はユーザー操作のみ)
      let scheduledIterations = 2;
      scheduleSong(ctx, song, this.startTime + songSec);
      const scheduleNext = () => {
        scheduleSong(ctx, song, this.startTime + scheduledIterations * songSec);
        scheduledIterations++;
        this.endTimer = setTimeout(scheduleNext, songSec * 1000);
      };
      this.endTimer = setTimeout(scheduleNext, songSec * 1000);
    } else {
      this.endTimer = setTimeout(() => {
        this.stop();
        onEnded?.();
      }, (songSec + 0.5) * 1000);
    }
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

export interface PlayOptions {
  startBeat?: number;
  endBeat?: number;
  loop?: boolean;
  metronome?: boolean;
  countInBars?: number;
}

function createPartBuses(ctx: BaseAudioContext, song: Song): Record<Part, AudioNode> {
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 20;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);
  const buses: Record<Part, AudioNode> = {} as Record<Part, AudioNode>;
  const hasSolo = PARTS.some((part) => song.mixer?.[part]?.solo);
  for (const part of PARTS) {
    const mix = song.mixer?.[part];
    const preset = TIMBRE_PRESETS[mix?.timbre ?? ""];
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = preset?.lowpassHz ?? TIMBRES[part].lowpassHz;
    const gain = ctx.createGain();
    gain.gain.value = !mix?.mute && (!hasSolo || Boolean(mix?.solo))
      ? Math.max(0, mix?.volume ?? 1)
      : 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, mix?.pan ?? 0));
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(master);
    buses[part] = filter;
  }
  return buses;
}

function scheduleSongRange(
  ctx: BaseAudioContext,
  song: Song,
  time: number,
  startBeat: number,
  endBeat: number,
): number {
  const buses = createPartBuses(ctx, song);
  for (const section of song.sections) {
    const sectionOffset = section.startBar * song.meter.barBeats;
    const parts: Array<[Part, NoteEvent[]]> = [
      ["melody", section.melody],
      ["piano", section.piano],
      ["bass", section.bass],
      ["guitar", section.guitar ?? []],
      ["drums", section.drums ?? []],
    ];
    for (const [part, notes] of parts) {
      for (const note of notes) {
        const absoluteStart = sectionOffset + note.start;
        const absoluteEnd = absoluteStart + note.duration;
        if (absoluteEnd <= startBeat || absoluteStart >= endBeat) continue;
        const clippedStart = Math.max(startBeat, absoluteStart);
        const clippedEnd = Math.min(endBeat, absoluteEnd);
        scheduleNote(
          ctx,
          buses[part],
          part,
          note,
          time + beatToSeconds(song, clippedStart) - beatToSeconds(song, startBeat),
          beatToSeconds(song, clippedEnd) - beatToSeconds(song, clippedStart),
          song.mixer?.[part]?.timbre,
        );
      }
    }
  }
  return beatToSeconds(song, endBeat) - beatToSeconds(song, startBeat);
}

function scheduleClick(ctx: BaseAudioContext, time: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(0.14, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.05);
}

function scheduleMetronomeRange(
  ctx: BaseAudioContext,
  song: Song,
  time: number,
  startBeat: number,
  endBeat: number,
): void {
  for (let beat = Math.ceil(startBeat); beat < endBeat; beat++) {
    const barBeat = ((beat % song.meter.barBeats) + song.meter.barBeats) % song.meter.barBeats;
    scheduleClick(
      ctx,
      time + beatToSeconds(song, beat) - beatToSeconds(song, startBeat),
      barBeat < 1e-9,
    );
  }
}

/** Range-aware transport used by the editor. */
export class TransportPlayer {
  private ctx: AudioContext | null = null;
  private musicStartTime = 0;
  private song: Song | null = null;
  private looping = false;
  private rangeStart = 0;
  private rangeLength = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private rangeStartSeconds = 0;
  private rangeDurationSeconds = 0;

  get isPlaying(): boolean {
    return this.ctx !== null;
  }

  get positionBeats(): number | null {
    if (!this.ctx || !this.song) return null;
    const elapsed = Math.max(0, this.ctx.currentTime - this.musicStartTime);
    const within = this.looping && this.rangeDurationSeconds > 0
      ? elapsed % this.rangeDurationSeconds
      : Math.min(elapsed, this.rangeDurationSeconds);
    return secondsToBeat(this.song, this.rangeStartSeconds + within);
  }

  play(song: Song, onEnded?: () => void, options: PlayOptions = {}): void {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.song = song;
    const totalBeats = song.totalBars * song.meter.barBeats;
    this.rangeStart = Math.max(0, Math.min(options.startBeat ?? 0, totalBeats));
    const endBeat = Math.max(
      this.rangeStart + 0.25,
      Math.min(options.endBeat ?? totalBeats, totalBeats),
    );
    this.rangeLength = endBeat - this.rangeStart;
    this.looping = options.loop ?? song.ending === "loop";

    const startSection = song.sections.find((section) =>
      this.rangeStart >= section.startBar * song.meter.barBeats &&
      this.rangeStart < (section.startBar + section.plan.bars) * song.meter.barBeats);
    const secPerBeat = 60 / (startSection?.bpm ?? song.bpm);
    const countInBeats = (options.countInBars ?? 0) * song.meter.barBeats;
    this.rangeStartSeconds = beatToSeconds(song, this.rangeStart);
    this.rangeDurationSeconds = beatToSeconds(song, endBeat) - this.rangeStartSeconds;

    const contextStart = ctx.currentTime + 0.08;
    this.musicStartTime = contextStart + countInBeats * secPerBeat;
    for (let beat = 0; beat < countInBeats; beat++) {
      scheduleClick(ctx, contextStart + beat * secPerBeat, beat % song.meter.barBeats === 0);
    }

    const iterationSec = scheduleSongRange(ctx, song, this.musicStartTime, this.rangeStart, endBeat);
    const scheduleIteration = (time: number) => {
      scheduleSongRange(ctx, song, time, this.rangeStart, endBeat);
      if (options.metronome) {
        scheduleMetronomeRange(ctx, song, time, this.rangeStart, endBeat);
      }
    };
    if (options.metronome) {
      scheduleMetronomeRange(ctx, song, this.musicStartTime, this.rangeStart, endBeat);
    }

    if (this.looping) {
      let scheduledIterations = 2;
      scheduleIteration(this.musicStartTime + iterationSec);
      const scheduleNext = () => {
        scheduleIteration(this.musicStartTime + scheduledIterations * iterationSec);
        scheduledIterations++;
        this.endTimer = setTimeout(scheduleNext, iterationSec * 1000);
      };
      this.endTimer = setTimeout(scheduleNext, iterationSec * 1000);
    } else {
      this.endTimer = setTimeout(() => {
        this.stop();
        onEnded?.();
      }, (countInBeats * secPerBeat + iterationSec + 0.25) * 1000);
    }
  }

  stop(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.song = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
