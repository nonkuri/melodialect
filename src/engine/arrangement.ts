import type {
  Annotation,
  ArrangementPlan,
  ArrangementSectionPlan,
  ArrangementSettings,
  Dialect,
  NoteEvent,
  SectionType,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { createNamedRng } from "./rng.js";
import { normalizeArrangement } from "./controls.js";

const STRATEGIES: ArrangementPlan["strategy"][] = [
  "piano-led", "guitar-led", "alternating", "ensemble",
];

/**
 * Data-driven compatibility layer for the legacy pattern renderers. The beat,
 * duration, voice and velocity fields are deliberately renderer-agnostic so
 * dialect-owned pattern libraries can replace the legacy id incrementally.
 */
export interface AccompanimentPatternDefinition {
  id: string;
  instrument: "piano" | "guitar" | "drums";
  texture: ArrangementSectionPlan["pianoTexture"] | "groove" | "fill";
  meters: Array<"4/4" | "3/4" | "6/8">;
  beats: number[];
  durations: number[];
  voices: "all" | "upper" | "guide" | "alternating" | "kit";
  velocities: number[];
  anticipation?: number;
  legacyPattern: ArrangementSettings["pianoPattern"] | ArrangementSettings["guitarPattern"] |
    ArrangementSettings["drumPattern"];
}

export const ACCOMPANIMENT_PATTERN_LIBRARY: AccompanimentPatternDefinition[] = [
  { id: "piano-comping", instrument: "piano", texture: "comping", meters: ["4/4", "3/4", "6/8"], beats: [0.5, 1.5, 3], durations: [0.7], voices: "guide", velocities: [72, 66], legacyPattern: "syncopated" },
  { id: "piano-arpeggio", instrument: "piano", texture: "arpeggio", meters: ["4/4", "3/4", "6/8"], beats: [0, 0.5, 1, 1.5], durations: [0.45], voices: "alternating", velocities: [70, 64], legacyPattern: "arpeggio" },
  { id: "piano-pad", instrument: "piano", texture: "pad", meters: ["4/4", "3/4", "6/8"], beats: [0], durations: [4], voices: "upper", velocities: [62], legacyPattern: "block" },
  { id: "piano-answer", instrument: "piano", texture: "answer", meters: ["4/4", "3/4", "6/8"], beats: [2, 3], durations: [0.8], voices: "guide", velocities: [64], legacyPattern: "ballad" },
  { id: "guitar-comping", instrument: "guitar", texture: "comping", meters: ["4/4", "3/4", "6/8"], beats: [0.5, 1.5, 2.5, 3.5], durations: [0.55], voices: "upper", velocities: [66, 61], anticipation: 0.5, legacyPattern: "syncopated" },
  { id: "guitar-arpeggio", instrument: "guitar", texture: "arpeggio", meters: ["4/4", "3/4", "6/8"], beats: [0, 0.5, 1, 1.5], durations: [0.42], voices: "alternating", velocities: [65, 60], legacyPattern: "arpeggio" },
  { id: "guitar-interlock", instrument: "guitar", texture: "interlock", meters: ["4/4", "3/4", "6/8"], beats: [0.75, 1.75, 2.75, 3.75], durations: [0.4], voices: "guide", velocities: [68, 62], legacyPattern: "interlocking" },
  { id: "guitar-answer", instrument: "guitar", texture: "answer", meters: ["4/4", "3/4", "6/8"], beats: [2, 3.5], durations: [0.45], voices: "upper", velocities: [65], legacyPattern: "strum" },
  { id: "guitar-pad", instrument: "guitar", texture: "pad", meters: ["4/4", "3/4", "6/8"], beats: [0], durations: [4], voices: "upper", velocities: [58], legacyPattern: "strum" },
  { id: "guitar-block", instrument: "guitar", texture: "block", meters: ["4/4", "3/4", "6/8"], beats: [0, 2], durations: [1.4], voices: "upper", velocities: [64], legacyPattern: "strum" },
  { id: "drums-basic", instrument: "drums", texture: "groove", meters: ["4/4", "3/4", "6/8"], beats: [0, 1, 2, 3], durations: [0.12], voices: "kit", velocities: [82, 70], legacyPattern: "basic" },
  { id: "drums-fill", instrument: "drums", texture: "fill", meters: ["4/4", "3/4", "6/8"], beats: [3, 3.25, 3.5, 3.75], durations: [0.12], voices: "kit", velocities: [78, 82, 86, 90], legacyPattern: "basic" },
];

function compatibleLegacyPattern(
  instrument: "piano" | "guitar",
  texture: ArrangementSectionPlan["pianoTexture"],
): AccompanimentPatternDefinition["legacyPattern"] | undefined {
  return ACCOMPANIMENT_PATTERN_LIBRARY.find((item) =>
    item.instrument === instrument && item.texture === texture)?.legacyPattern;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sectionBaseDensity(type: SectionType): number {
  switch (type) {
    case "intro": return 0.42;
    case "verse": return 0.58;
    case "chorus": return 0.78;
    case "bridge": return 0.72;
    case "outro": return 0.58;
  }
}

function textureFor(
  type: SectionType,
  instrument: "piano" | "guitar",
  strategy: ArrangementPlan["strategy"],
  candidateIndex: number,
): ArrangementSectionPlan["pianoTexture"] {
  if (strategy === "alternating") {
    return instrument === "piano" ? (candidateIndex % 2 ? "answer" : "comping") : "interlock";
  }
  if (strategy === "piano-led") {
    return instrument === "piano" ? type === "chorus" ? "arpeggio" : "comping" : "answer";
  }
  if (strategy === "guitar-led") {
    return instrument === "guitar" ? type === "chorus" ? "interlock" : "comping" : "pad";
  }
  return type === "chorus" ? "comping" : type === "bridge" ? "arpeggio" : "block";
}

export function createArrangementPlan(
  types: SectionType[],
  dialects: Dialect[],
  arrangement: ArrangementSettings | undefined,
  seed: number,
  candidateIndex: number,
): ArrangementPlan {
  const config = normalizeArrangement(arrangement);
  const rng = createNamedRng(seed, "arrangement-plan", 0, candidateIndex);
  const legacyStrategy: ArrangementPlan["strategy"] = config.guitarPattern === "off"
    ? "piano-led" : config.pianoPattern === "off" ? "guitar-led" : "ensemble";
  const strategy = !config.autoArrange || candidateIndex === 0
    ? legacyStrategy
    : rng.pick(STRATEGIES);
  const densityControl = config.accompanimentDensity ?? 0.5;
  const development = config.development ?? 0.5;
  return {
    strategy,
    sections: types.map((type, sectionIndex) => {
      const dialectConfig = normalizeArrangement({
        ...dialects[sectionIndex]?.defaults.arrangement,
        ...arrangement,
      });
      const repeatIndex = types.slice(0, sectionIndex).filter((candidate) => candidate === type).length;
      const repeatGrowth = repeatIndex * development * 0.06;
      const density = clamp01(sectionBaseDensity(type) + (densityControl - 0.5) * 0.5 + repeatGrowth);
      const automaticallyVary = Boolean(config.autoArrange && candidateIndex > 0);
      const sourcePianoActive = dialectConfig.pianoPattern !== "off";
      const sourceGuitarActive = dialectConfig.guitarPattern !== "off";
      let pianoActive = automaticallyVary
        ? sourcePianoActive && strategy !== "guitar-led"
        : sourcePianoActive;
      let guitarActive = automaticallyVary
        ? sourceGuitarActive && strategy !== "piano-led"
        : sourceGuitarActive;
      // 自動編曲は既存パートを引き算して役割を分ける。ダイアレクトが
      // 無効にしている楽器を勝手に追加せず、和声楽器が全消音になる場合だけ
      // 元の有効パートを残す。
      if (!pianoActive && !guitarActive) {
        if (sourcePianoActive) pianoActive = true;
        else if (sourceGuitarActive) guitarActive = true;
      }
      const drumsActive = dialectConfig.drumPattern !== "off";
      return {
        sectionIndex,
        strategy,
        density,
        // registerShift は移調ではなく音域変更なので、必ずオクターブ単位にする。
        // 既定値では音域を動かさず、「展開」を明示的に大きくした場合だけ上げる。
        registerShift: type === "chorus" && development >= 0.85 ? 12 : 0,
        pianoTexture: textureFor(type, "piano", strategy, candidateIndex),
        guitarTexture: textureFor(type, "guitar", strategy, candidateIndex),
        pianoActive,
        guitarActive,
        drumsActive,
        fillBars: [],
        breakBars: [],
        pickupBars: [],
      };
    }),
  };
}

export function settingsForArrangementPlan(
  source: ArrangementSettings,
  section: ArrangementSectionPlan | undefined,
  candidateIndex: number,
): ArrangementSettings {
  if (!section || !source.autoArrange || candidateIndex === 0) return source;
  const next = { ...source };
  if (!section.pianoActive) next.pianoPattern = "off";
  else if (source.pianoPattern !== "bossa" && source.pianoPattern !== "voice-led") {
    const planned = compatibleLegacyPattern("piano", section.pianoTexture);
    next.pianoPattern = planned === "off" || planned === "block" || planned === "arpeggio" ||
      planned === "bossa" || planned === "eighth" || planned === "ballad" ||
      planned === "syncopated" || planned === "voice-led" ? planned : source.pianoPattern;
  }
  if (!section.guitarActive) next.guitarPattern = "off";
  else if (source.guitarPattern !== "bossa") {
    const planned = compatibleLegacyPattern("guitar", section.guitarTexture);
    next.guitarPattern = planned === "off" || planned === "strum" || planned === "arpeggio" ||
      planned === "bossa" || planned === "syncopated" || planned === "interlocking"
      ? planned : source.guitarPattern;
  }
  if (!section.drumsActive) next.drumPattern = "off";
  else if (source.drumPattern === "off") next.drumPattern = "basic";
  return next;
}

function thinByOnset(notes: NoteEvent[], density: number, rng: Rng, barBeats: number): NoteEvent[] {
  if (density >= 0.88 || notes.length < 4) return notes;
  const onsets = new Map<string, NoteEvent[]>();
  for (const note of notes) {
    const key = note.start.toFixed(4);
    const group = onsets.get(key) ?? [];
    group.push(note);
    onsets.set(key, group);
  }
  const kept = Array.from(onsets.entries()).flatMap(([key, group], index) => {
    const start = Number(key);
    const downbeat = Math.abs(start - Math.round(start / barBeats) * barBeats) < 1e-7;
    return downbeat || index === 0 || rng.chance(Math.max(0.3, density)) ? group : [];
  });
  return kept.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function makeRoomForMelody(
  notes: NoteEvent[], melody: NoteEvent[] | undefined, meter: Meter, offset: number,
): NoteEvent[] {
  if (!melody?.length) return notes;
  const counts = new Map<number, number>();
  melody.forEach((note) => {
    const bar = Math.floor(note.start / meter.barBeats);
    counts.set(bar, (counts.get(bar) ?? 0) + 1);
  });
  return notes.filter((note, index) => {
    const bar = Math.floor(note.start / meter.barBeats);
    const dense = (counts.get(bar) ?? 0) >= Math.ceil(meter.barBeats * 1.5);
    return !dense || Math.abs(note.start % meter.barBeats) < 1e-7 || (index + offset) % 2 === 0;
  });
}

function addDrumFill(notes: NoteEvent[], bar: number, meter: Meter): NoteEvent[] {
  const beat = bar * meter.barBeats + Math.max(0, meter.barBeats - 1);
  const step = meter.name === "6/8" ? 0.25 : 0.25;
  const pitches = [38, 45, 47, 50];
  const additions = pitches.map((pitch, index) => ({
    start: beat + index * step,
    duration: Math.min(0.18, meter.barBeats * (bar + 1) - (beat + index * step)),
    pitch,
    velocity: 78 + index * 3,
  })).filter((note) => note.duration > 0.05);
  const seen = new Set(notes.map((note) => `${note.start.toFixed(4)}:${note.pitch}`));
  return [...notes, ...additions.filter((note) => !seen.has(`${note.start.toFixed(4)}:${note.pitch}`))]
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function addHarmonicPickup(notes: NoteEvent[], bar: number, meter: Meter): NoteEvent[] {
  const barEnd = (bar + 1) * meter.barBeats;
  const source = [...notes].reverse().find((note) => note.start < barEnd - 0.5);
  if (!source) return notes;
  const pickup: NoteEvent = {
    start: barEnd - 0.5,
    duration: 0.38,
    pitch: source.pitch,
    velocity: Math.max(48, source.velocity - 8),
  };
  if (notes.some((note) => Math.abs(note.start - pickup.start) < 1e-7 && note.pitch === pickup.pitch)) {
    return notes;
  }
  return [...notes, pickup].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function avoidPartCollision(piano: NoteEvent[], guitar: NoteEvent[], strategy: ArrangementPlan["strategy"]): NoteEvent[] {
  if (strategy === "ensemble" || !piano.length) return guitar;
  const pianoOnsets = new Set(piano.map((note) => note.start.toFixed(3)));
  return guitar.filter((note, index) => {
    if (!pianoOnsets.has(note.start.toFixed(3))) return true;
    if (strategy === "guitar-led") return true;
    return strategy === "alternating" ? index % 2 === 1 : index % 3 === 0;
  });
}

export function applyArrangementSectionPlan(
  values: { piano: NoteEvent[]; guitar: NoteEvent[]; drums: NoteEvent[]; melody?: NoteEvent[] },
  section: ArrangementSectionPlan | undefined,
  meter: Meter,
  bars: number,
  rng: { piano: Rng; guitar: Rng; drums: Rng },
  preservePattern: boolean,
): { piano: NoteEvent[]; guitar: NoteEvent[]; drums: NoteEvent[]; annotations: Annotation[] } {
  if (!section) return { ...values, annotations: [] };
  // 旧版互換候補には自動編曲の音域変更を適用しない。自動候補でも
  // 半音単位の値が混入してコード外音にならないようオクターブへ正規化する。
  const registerShift = preservePattern ? 0 : Math.round(section.registerShift / 12) * 12;
  let piano = values.piano.map((note) => ({ ...note, pitch: note.pitch + registerShift }));
  let guitar = values.guitar.map((note) => ({ ...note, pitch: note.pitch + registerShift }));
  let drums = [...values.drums];
  if (!preservePattern) {
    piano = thinByOnset(piano, section.density, rng.piano, meter.barBeats);
    guitar = thinByOnset(guitar, section.density, rng.guitar, meter.barBeats);
    piano = makeRoomForMelody(piano, values.melody, meter, 0);
    guitar = makeRoomForMelody(guitar, values.melody, meter, 1);
    guitar = avoidPartCollision(piano, guitar, section.strategy);
    drums = thinByOnset(drums, Math.min(1, section.density + 0.12), rng.drums, meter.barBeats);
  }
  const finalBar = Math.max(0, bars - 1);
  section.fillBars = !preservePattern && section.density > 0.86 ? [finalBar] : [];
  section.breakBars = !preservePattern && section.density < 0.45 && bars > 2
    ? [Math.max(1, finalBar - 1)] : [];
  section.pickupBars = !preservePattern && section.density >= 0.5 && section.density <= 0.7
    ? [finalBar] : [];
  if (!preservePattern && section.breakBars.length) {
    const breakStart = section.breakBars[0]! * meter.barBeats + meter.barBeats * 0.75;
    piano = piano.filter((note) => note.start < breakStart);
    guitar = guitar.filter((note) => note.start < breakStart);
    drums = drums.filter((note) => note.start < breakStart);
  }
  if (!preservePattern && section.drumsActive) {
    section.fillBars.forEach((bar) => { drums = addDrumFill(drums, bar, meter); });
  }
  if (!preservePattern) {
    section.pickupBars.forEach((bar) => {
      if (section.guitarActive && guitar.length) guitar = addHarmonicPickup(guitar, bar, meter);
      else if (section.pianoActive && piano.length) piano = addHarmonicPickup(piano, bar, meter);
    });
  }
  const gestureText = [
    section.fillBars.length ? `末尾${section.fillBars.map((bar) => bar + 1).join("・")}小節にフィル` : "",
    section.breakBars.length ? `${section.breakBars.map((bar) => bar + 1).join("・")}小節にブレイク` : "",
    section.pickupBars.length ? `${section.pickupBars.map((bar) => bar + 1).join("・")}小節末にピックアップ` : "",
  ].filter(Boolean).join("、");
  return {
    piano,
    guitar,
    drums,
    annotations: [{
      bar: 0,
      ruleId: "arrangement-plan",
      text: `${section.strategy}の編曲戦略で、密度${Math.round(section.density * 100)}%・音域差${section.registerShift >= 0 ? "+" : ""}${section.registerShift}半音に設定${gestureText ? `。${gestureText}` : ""}。旋律が細かい場所は伴奏を間引いた`,
      level: "section",
      category: "arrangement",
    }],
  };
}
