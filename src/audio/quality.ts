import type { NoteEvent, Song, SongPart } from "../engine/types.js";

export const MIX_QUALITY_TARGETS = {
  peakDbfs: -1,
  rmsMinDbfs: -24,
  rmsMaxDbfs: -10,
  voiceCap: 128,
} as const;

export const PART_LEVEL_TARGETS_DBFS: Readonly<Record<SongPart, {
  rmsMin: number;
  rmsMax: number;
  peakMax: number;
}>> = {
  melody: { rmsMin: -24, rmsMax: -14, peakMax: -6 },
  piano: { rmsMin: -28, rmsMax: -16, peakMax: -7 },
  guitar: { rmsMin: -28, rmsMax: -16, peakMax: -7 },
  bass: { rmsMin: -26, rmsMax: -15, peakMax: -7 },
  drums: { rmsMin: -28, rmsMax: -14, peakMax: -5 },
};

/** Reference renders captured at default register/velocity before trim gain. */
export const TIMBRE_REFERENCE_RMS: Readonly<Record<SongPart, Record<string, number>>> = {
  melody: { flute: 0.12, sine: 0.145, lead: 0.101 },
  piano: { grand: 0.1, electric: 0.156, organ: 0.278 },
  guitar: { nylon: 0.1, bright: 0.08 },
  bass: { fingered: 0.09, synthbass: 0.108 },
  drums: { electronic: 0.11, bright: 0.125 },
};

const PARTS: SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];

export interface PcmQuality {
  peak: number;
  peakDbfs: number;
  rms: number;
  rmsDbfs: number;
  clippedSamples: number;
  recommendedGain: number;
}

export interface PolyphonyReport {
  peak: number;
  exceedsVoiceCap: boolean;
  parts: Record<SongPart, number>;
}

export function linearToDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
}

export function analyzePcm(channels: readonly Float32Array[]): PcmQuality {
  let peak = 0;
  let sum = 0;
  let samples = 0;
  let clippedSamples = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      sum += sample * sample;
      samples++;
      if (absolute >= 1) clippedSamples++;
    }
  }
  const rms = samples ? Math.sqrt(sum / samples) : 0;
  const target = 10 ** (MIX_QUALITY_TARGETS.peakDbfs / 20);
  return {
    peak,
    peakDbfs: linearToDb(peak),
    rms,
    rmsDbfs: linearToDb(rms),
    clippedSamples,
    recommendedGain: peak > target && peak > 0 ? target / peak : 1,
  };
}

function sectionNotes(song: Song, part: SongPart): Array<{ start: number; note: NoteEvent }> {
  return song.sections.flatMap((section) => {
    const offset = section.startBar * song.meter.barBeats;
    return section[part].map((note) => ({ start: offset + note.start, note }));
  });
}

function peakForNotes(values: Array<{ start: number; note: NoteEvent }>): number {
  const events = values.flatMap(({ start, note }) => [
    { beat: start, delta: 1 },
    { beat: start + note.duration, delta: -1 },
  ]).sort((a, b) => a.beat - b.beat || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

/** Upper-bound estimate used before realtime or offline SoundFont rendering. */
export function estimatePeakPolyphony(song: Song): PolyphonyReport {
  const hasSolo = PARTS.some((part) => song.mixer?.[part]?.solo);
  const parts = Object.fromEntries(PARTS.map((part) => [part, 0])) as Record<SongPart, number>;
  const combined: Array<{ start: number; note: NoteEvent }> = [];
  for (const part of PARTS) {
    const mix = song.mixer?.[part];
    if (mix?.mute || (hasSolo && !mix?.solo)) continue;
    const values = sectionNotes(song, part);
    parts[part] = peakForNotes(values);
    combined.push(...values);
  }
  const peak = peakForNotes(combined);
  return { peak, exceedsVoiceCap: peak > MIX_QUALITY_TARGETS.voiceCap, parts };
}
