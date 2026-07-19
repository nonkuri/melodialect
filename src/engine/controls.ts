import type {
  ArrangementSettings,
  CompositionControls,
  Dialect,
  MixerSettings,
  NoteEvent,
  Song,
  SongPart,
} from "./types.js";

export const DEFAULT_ARRANGEMENT: ArrangementSettings = {
  pianoPattern: "block",
  guitarPattern: "off",
  drumPattern: "off",
  swing: 0,
  humanize: 0,
  velocityScale: 1,
};

export const DEFAULT_COMPOSITION: CompositionControls = {
  mode: "major",
  melodyLow: 57,
  melodyHigh: 84,
  density: 0.5,
  harmonyComplexity: 0.5,
  tension: 0.5,
  leap: 0.5,
  repetition: 0.5,
  syncopation: 0.5,
  brightness: 0.5,
  calm: 0.5,
  surprise: 0.5,
};

const DEFAULT_TIMBRES: Record<SongPart, string> = {
  melody: "flute",
  piano: "grand",
  guitar: "nylon",
  bass: "fingered",
  drums: "electronic",
};

export function defaultMixer(): MixerSettings {
  return Object.fromEntries(
    (Object.keys(DEFAULT_TIMBRES) as SongPart[]).map((part) => [
      part,
      {
        mute: false,
        solo: false,
        volume: 1,
        pan: part === "guitar" ? 0.25 : part === "piano" ? -0.15 : 0,
        timbre: DEFAULT_TIMBRES[part],
      },
    ]),
  ) as MixerSettings;
}

export function normalizeArrangement(
  value: Partial<ArrangementSettings> | undefined,
): ArrangementSettings {
  return { ...DEFAULT_ARRANGEMENT, ...value };
}

export function normalizeComposition(
  value: Partial<CompositionControls> | undefined,
  fallbackMode: CompositionControls["mode"] = "major",
): CompositionControls {
  const normalized = { ...DEFAULT_COMPOSITION, mode: fallbackMode, ...value };
  if (normalized.melodyLow > normalized.melodyHigh) {
    [normalized.melodyLow, normalized.melodyHigh] =
      [normalized.melodyHigh, normalized.melodyLow];
  }
  return normalized;
}

export function normalizeMixer(value: Partial<MixerSettings> | undefined): MixerSettings {
  const defaults = defaultMixer();
  for (const part of Object.keys(defaults) as SongPart[]) {
    defaults[part] = { ...defaults[part], ...value?.[part] };
  }
  return defaults;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Convert UI controls into a temporary dialect without mutating the source preset. */
export function dialectWithControls(
  source: Dialect,
  controls: CompositionControls,
): Dialect {
  const dialect = structuredClone(source);
  const surprise = clamp01((controls.surprise + controls.tension) / 2);
  const calmFactor = 1 + (0.5 - clamp01(controls.calm)) * 0.5;
  const leapFactor = (0.5 + controls.leap) * calmFactor;
  dialect.melody.leapProbability.default =
    clamp01(dialect.melody.leapProbability.default * leapFactor);
  dialect.melody.leapProbability.chorusHead =
    clamp01(dialect.melody.leapProbability.chorusHead * leapFactor);
  dialect.melody.repeatNoteProbability =
    clamp01((dialect.melody.repeatNoteProbability ?? 0.08) *
      (0.5 + controls.repetition));
  if (dialect.melody.motif) {
    dialect.melody.motif.repeatProbability =
      clamp01(dialect.melody.motif.repeatProbability *
        (0.5 + controls.repetition));
  }
  dialect.structure.irregularPhraseProbability =
    clamp01(dialect.structure.irregularPhraseProbability * (0.5 + surprise));
  dialect.chord.idiomProbability =
    clamp01((dialect.chord.idiomProbability ?? 0) *
      (0.4 + controls.harmonyComplexity * 0.8 + controls.tension * 0.4));

  if (dialect.chord.harmonicRhythm) {
    for (const distribution of Object.values(dialect.chord.harmonicRhythm)) {
      if (distribution["2"] !== undefined) {
        distribution["2"] *= 0.5 + controls.harmonyComplexity;
      }
      if (distribution["0.5"] !== undefined) {
        distribution["0.5"] *= 1.5 - controls.harmonyComplexity;
      }
    }
  }
  if (dialect.modulation) {
    for (const config of Object.values(dialect.modulation)) {
      if (config) config.probability = clamp01(config.probability * (0.5 + surprise));
    }
  }
  return dialect;
}

function fitPitch(pitch: number, low: number, high: number): number {
  let fitted = pitch;
  while (fitted < low) fitted += 12;
  while (fitted > high) fitted -= 12;
  return Math.max(low, Math.min(high, fitted));
}

function shapeMelody(
  notes: NoteEvent[],
  controls: CompositionControls,
  barBeats: number,
): NoteEvent[] {
  let shaped = notes.map((note) => ({
    ...note,
    pitch: fitPitch(note.pitch, controls.melodyLow, controls.melodyHigh),
    velocity: Math.max(
      1,
      Math.min(127, Math.round(note.velocity *
        (0.78 + controls.brightness * 0.28) *
        (1.08 - controls.calm * 0.18))),
    ),
  }));

  if (controls.density < 0.48) {
    const keepEvery = controls.density < 0.2 ? 3 : 2;
    shaped = shaped.filter((_, index) => index % keepEvery === 0);
  } else if (controls.density > 0.68) {
    shaped = shaped.flatMap((note, index) => {
      if (index % 2 !== 0 || note.duration < 1) return [note];
      const duration = note.duration / 2;
      return [
        { ...note, duration },
        {
          ...note,
          start: note.start + duration,
          duration,
          velocity: Math.max(1, note.velocity - 5),
        },
      ];
    });
  }

  const shift = Math.max(0, controls.syncopation - 0.5) * 0.45;
  if (shift > 0) {
    shaped = shaped.map((note, index) => {
      if (index % 4 !== 2) return note;
      const bar = Math.floor(note.start / barBeats);
      const barEnd = (bar + 1) * barBeats;
      const start = Math.min(note.start + shift, barEnd - 0.25);
      return { ...note, start, duration: Math.min(note.duration, barEnd - start) };
    });
  }
  return shaped.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

export function applyCompositionControls(
  song: Song,
  controls: CompositionControls,
): Song {
  const next = structuredClone(song);
  next.composition = controls;
  next.key.mode = controls.mode;
  for (const section of next.sections) {
    section.key.mode = controls.mode;
    section.melody = shapeMelody(section.melody, controls, next.meter.barBeats);
  }
  return next;
}

/** Populate fields added after project version 1 without breaking old saved songs. */
export function normalizeSongControls(song: Song): Song {
  const next = structuredClone(song);
  next.arrangement = normalizeArrangement(next.arrangement);
  next.mixer = normalizeMixer(next.mixer);
  next.composition = normalizeComposition(next.composition, next.key.mode);
  for (const section of next.sections) {
    section.guitar ??= [];
    section.drums ??= [];
    section.bpm ??= next.bpm;
  }
  return next;
}
