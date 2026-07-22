import type {
  Annotation,
  BassProfile,
  BassRole,
  ChordEvent,
  Dialect,
  KeySignature,
  NoteEvent,
  SectionPlan,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { chordAtBeat, pcToPitch, scaleOf } from "./harmony.js";

const DEFAULT_PROFILE: BassProfile = {
  roles: { default: ["root"] },
  activity: 0.5,
  syncopation: 0.15,
  rests: 0.05,
  chordToneRatio: 0.82,
  approachRatio: 0.35,
  diatonicApproachRatio: 0.28,
  chromaticApproachRatio: 0.22,
  enclosureRatio: 0.12,
  resolveLeapRatio: 0.7,
  fifthOctaveRatio: 0.25,
  fillProbability: 0.25,
  range: [34, 58],
  maxLeap: 12,
};

export interface BassGenerationOptions {
  plan: SectionPlan;
  chords: ChordEvent[];
  melody?: NoteEvent[];
  drums?: NoteEvent[];
  dialect: Dialect;
  key: KeySignature;
  meter: Meter;
  rng: Rng;
  legacy: NoteEvent[];
  candidateIndex: number;
}

export interface BassGenerationResult {
  notes: NoteEvent[];
  profile: BassProfile;
  role: BassRole;
  annotations: Annotation[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function bassProfileFor(dialect: Dialect): BassProfile {
  const legacyRole: BassRole = dialect.groove?.bassPattern === "drone" ? "pedal"
    : dialect.groove?.bassPattern === "melodic" ? "counterline"
      : dialect.groove?.bassPattern === "bossa" ? "walking"
        : dialect.groove?.accentPattern.length ? "ostinato" : "root";
  const source = dialect.bass;
  return {
    ...DEFAULT_PROFILE,
    ...source,
    roles: source?.roles ?? { default: [legacyRole] },
    range: source?.range ?? DEFAULT_PROFILE.range,
    activity: clamp01(source?.activity ?? (
      legacyRole === "counterline" ? 0.72 : legacyRole === "walking" ? 0.62 : 0.5)),
    syncopation: clamp01(source?.syncopation ?? (dialect.groove?.anticipation ? 0.55 : 0.15)),
    rests: clamp01(source?.rests ?? DEFAULT_PROFILE.rests),
    chordToneRatio: clamp01(source?.chordToneRatio ?? DEFAULT_PROFILE.chordToneRatio),
    approachRatio: clamp01(source?.approachRatio ?? (legacyRole === "counterline" ? 0.62 : 0.35)),
    diatonicApproachRatio: clamp01(source?.diatonicApproachRatio ?? DEFAULT_PROFILE.diatonicApproachRatio),
    chromaticApproachRatio: clamp01(source?.chromaticApproachRatio ??
      (dialect.chord.cliches.includes("descending-bass") ? 0.55 : 0.22)),
    enclosureRatio: clamp01(source?.enclosureRatio ?? DEFAULT_PROFILE.enclosureRatio),
    resolveLeapRatio: clamp01(source?.resolveLeapRatio ?? DEFAULT_PROFILE.resolveLeapRatio),
    fifthOctaveRatio: clamp01(source?.fifthOctaveRatio ?? DEFAULT_PROFILE.fifthOctaveRatio),
    fillProbability: clamp01(source?.fillProbability ?? DEFAULT_PROFILE.fillProbability),
    maxLeap: Math.max(5, Math.min(24, source?.maxLeap ?? DEFAULT_PROFILE.maxLeap)),
  };
}

function fitPitchClass(pc: number, reference: number, low: number, high: number): number[] {
  const values: number[] = [];
  for (let pitch = low; pitch <= high; pitch++) {
    if (((pitch % 12) + 12) % 12 === pc) values.push(pitch);
  }
  return values.sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference)).slice(0, 3);
}

function melodyDirectionAt(melody: NoteEvent[] | undefined, beat: number): number {
  if (!melody?.length) return 0;
  const before = [...melody].reverse().find((note) => note.start <= beat + 1e-7);
  const after = melody.find((note) => note.start > beat + 1e-7);
  if (!before || !after) return 0;
  return Math.sign(after.pitch - before.pitch);
}

function slotStarts(
  sectionBeats: number,
  meter: Meter,
  profile: BassProfile,
  role: BassRole,
): number[] {
  if (role === "pedal") {
    const pulse = meter.name === "4/4" ? 2 : 1.5;
    return Array.from({ length: Math.ceil(sectionBeats / pulse) }, (_, index) => index * pulse)
      .filter((beat) => beat < sectionBeats - 1e-7);
  }
  const pulse = meter.name === "6/8" ? (profile.activity > 0.72 ? 0.75 : 1.5)
    : profile.activity > 0.78 ? 0.5 : profile.activity > 0.4 ? 1 : 2;
  const starts: number[] = [];
  for (let beat = 0; beat < sectionBeats - 1e-7; beat += pulse) starts.push(beat);
  return starts;
}

function pitchCandidates(
  beat: number,
  previous: number,
  chord: ChordEvent,
  nextChord: ChordEvent | undefined,
  profile: BassProfile,
  role: BassRole,
  key: KeySignature,
  isLastBeforeChange: boolean,
): number[] {
  const [low, high] = profile.range;
  if (role === "pedal") {
    const tonic = pcToPitch(key.tonic, low);
    return [tonic, tonic + 7].filter((pitch) => pitch <= high);
  }
  const pcs = new Set<number>([chord.bassPitch % 12, chord.rootPc]);
  chord.pitches.forEach((pitch) => pcs.add(pitch % 12));
  if (role === "ostinato") pcs.add((chord.rootPc + 7) % 12);
  if (nextChord && isLastBeforeChange) {
    pcs.add(nextChord.bassPitch % 12);
    pcs.add((nextChord.bassPitch + 11) % 12);
    pcs.add((nextChord.bassPitch + 1) % 12);
  }
  if (role === "walking" || role === "counterline") {
    scaleOf(key).forEach((pc) => pcs.add(pc));
  }
  return Array.from(pcs)
    .flatMap((pc) => fitPitchClass(pc, previous, low, high))
    .filter((pitch, index, values) => values.indexOf(pitch) === index)
    .slice(0, 16);
}

interface State {
  pitch: number;
  score: number;
  path: number[];
}

function pathCandidate(options: BassGenerationOptions, profile: BassProfile, role: BassRole, variant: number): NoteEvent[] {
  const { chords, melody, key, meter, rng } = options;
  const sectionBeats = options.plan.bars * meter.barBeats;
  const starts = slotStarts(sectionBeats, meter, {
    ...profile,
    activity: clamp01(profile.activity + (variant - 1) * 0.14),
  }, role);
  if (!starts.length) return [];
  let states: State[] = [{
    pitch: Math.max(profile.range[0], Math.min(profile.range[1], chords[0]?.bassPitch ?? 40)),
    score: 0,
    path: [],
  }];
  starts.forEach((beat, slotIndex) => {
    const chord = chordAtBeat(chords, beat);
    const nextChange = chords.find((candidate) => candidate.start > beat + 1e-7);
    const nextBeat = starts[slotIndex + 1] ?? sectionBeats;
    const isLastBeforeChange = Boolean(nextChange && nextChange.start <= nextBeat + 1e-7);
    const melodyDirection = melodyDirectionAt(melody, beat);
    const expanded: State[] = [];
    for (const state of states) {
      const candidates = pitchCandidates(
        beat, state.pitch, chord, nextChange, profile, role, key, isLastBeforeChange,
      );
      for (const pitch of candidates) {
        const leap = Math.abs(pitch - state.pitch);
        const chordPcs = new Set(chord.pitches.map((note) => note % 12));
        const chordTone = chordPcs.has(pitch % 12);
        const movement = Math.sign(pitch - state.pitch);
        const contrary = melodyDirection !== 0 && movement !== 0 && movement !== melodyDirection;
        const rootAtBoundary = Math.abs(beat - chord.start) < 1e-7 && pitch % 12 === chord.bassPitch % 12;
        const approach = nextChange && isLastBeforeChange &&
          Math.abs(pitch - nextChange.bassPitch) % 12 <= 2;
        const targetDistance = nextChange && isLastBeforeChange
          ? Math.min(
            Math.abs((pitch % 12) - (nextChange.bassPitch % 12)),
            12 - Math.abs((pitch % 12) - (nextChange.bassPitch % 12)),
          )
          : 12;
        const previousPitch = state.path.at(-2);
        const previousLeap = previousPitch === undefined ? 0 : state.pitch - previousPitch;
        const resolvesLeap = Math.abs(previousLeap) > 5 && movement === -Math.sign(previousLeap) && leap <= 4;
        const roleFit = role === "root" ? rootAtBoundary ? 1 : chordTone ? 0.35 : -0.35
          : role === "counterline" ? contrary ? 0.45 : 0
            : role === "walking" ? leap <= 4 ? 0.35 : -0.1
              : role === "ostinato" ? pitch % 12 === chord.rootPc || pitch % 12 === (chord.rootPc + 7) % 12 ? 0.4 : -0.2
                : pitch % 12 === key.tonic || pitch % 12 === (key.tonic + 7) % 12 ? 0.8 : -1;
        const score = state.score + (chordTone ? profile.chordToneRatio : 1 - profile.chordToneRatio) +
          (rootAtBoundary ? 0.8 : 0) + (approach ? profile.approachRatio * 0.7 : 0) +
          (targetDistance === 1 ? profile.chromaticApproachRatio : 0) +
          (targetDistance === 2 ? profile.diatonicApproachRatio : 0) +
          (resolvesLeap ? profile.resolveLeapRatio * 0.45 : 0) + roleFit -
          Math.max(0, leap - profile.maxLeap) * 0.4 - leap * 0.025 + rng.next() * 0.09;
        expanded.push({ pitch, score, path: [...state.path, pitch] });
      }
    }
    states = expanded.sort((a, b) => b.score - a.score).slice(0, 18);
  });
  const choices = states.sort((a, b) => b.score - a.score).slice(0, 5);
  const best = choices[0]?.score ?? 0;
  const path = rng.weighted(choices.map((state) => [state.path, Math.exp(state.score - best) + 0.05]));
  let notes = path.map((pitch, index) => {
    const start = starts[index]!;
    const nextStart = starts[index + 1] ?? sectionBeats;
    const barEnd = (Math.floor(start / meter.barBeats) + 1) * meter.barBeats;
    return {
      start,
      duration: Math.max(0.12, Math.min(nextStart, barEnd, sectionBeats) - start),
      pitch,
      velocity: index === 0 || Math.abs(start % meter.barBeats) < 1e-7 ? 90 : 80,
    };
  });
  notes = notes.filter((note, index) => index === 0 ||
    Math.abs(note.start % meter.barBeats) < 1e-7 || !rng.chance(profile.rests));
  notes = notes.map((note, index) => {
    if (index === 0 || Math.abs(note.start % meter.barBeats) < 1e-7 ||
      !rng.chance(profile.syncopation * 0.45)) return note;
    const shift = Math.min(0.25, note.start % meter.barBeats);
    return { ...note, start: note.start - shift, duration: note.duration + shift * 0.5 };
  });
  const tail = notes.at(-1);
  if (tail && tail.duration >= 0.75 && rng.chance(profile.fillProbability)) {
    const split = Math.min(0.5, tail.duration / 2);
    tail.duration -= split;
    const chord = chordAtBeat(chords, tail.start + tail.duration);
    const targetPc = chord.rootPc;
    const approach = fitPitchClass((targetPc + (rng.chance(profile.chromaticApproachRatio) ? 11 : 10)) % 12,
      tail.pitch, profile.range[0], profile.range[1])[0];
    if (approach !== undefined) {
      notes.push({
        start: tail.start + tail.duration,
        duration: split,
        pitch: approach,
        velocity: 76,
      });
    }
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function candidateScore(
  notes: NoteEvent[],
  chords: ChordEvent[],
  profile: BassProfile,
  role: BassRole,
  drums?: NoteEvent[],
): number {
  if (!notes.length) return -Infinity;
  let score = 0;
  notes.forEach((note, index) => {
    const chord = chordAtBeat(chords, note.start);
    const chordPcs = chord.pitches.map((pitch) => pitch % 12);
    score += chordPcs.includes(note.pitch % 12) ? 1 : 0.45;
    if (Math.abs(note.start - chord.start) < 1e-7 && note.pitch % 12 === chord.bassPitch % 12) score += 0.65;
    if (note.pitch % 12 === (chord.rootPc + 7) % 12) score += profile.fifthOctaveRatio * 0.18;
    if (index) {
      const leap = Math.abs(note.pitch - notes[index - 1]!.pitch);
      score -= Math.max(0, leap - profile.maxLeap) * 0.3;
      if ((role === "walking" || role === "counterline") && leap <= 2) score += 0.25;
    }
    if (drums?.some((drum) => drum.pitch === 36 && Math.abs(drum.start - note.start) < 0.04)) {
      score += 0.16;
    }
    const nextChord = chords.find((candidate) => candidate.start > note.start + 1e-7);
    if (nextChord && index >= 1 && Math.abs(nextChord.start - note.start) <= 1.01) {
      const target = nextChord.bassPitch;
      const previousPitch = notes[index - 1]!.pitch;
      const encloses = (previousPitch < target && note.pitch > target) ||
        (previousPitch > target && note.pitch < target);
      if (encloses) score += profile.enclosureRatio * 0.4;
    }
  });
  const target = profile.activity * 4;
  const density = notes.length / Math.max(1, chords.at(-1)!.start + chords.at(-1)!.durationBeats) * 4;
  score -= Math.abs(density - target) * 0.18;
  return score / notes.length;
}

export function generateBassLine(options: BassGenerationOptions): BassGenerationResult {
  const profile = bassProfileFor(options.dialect);
  const automaticRoles: Partial<Record<SectionPlan["type"], BassRole[]>> = {
    intro: ["root", "pedal"],
    verse: ["root", "ostinato"],
    chorus: ["walking", "counterline"],
    bridge: ["counterline", "pedal"],
    outro: ["root", "pedal"],
  };
  const roles = profile.roles[options.plan.type] ??
    (options.dialect.bass?.roles ? profile.roles.default : automaticRoles[options.plan.type]) ??
    profile.roles.default ?? ["root"];
  const role = roles[options.rng.int(0, roles.length - 1)]!;
  // Legacy special patterns remain a first-class candidate. This preserves the
  // recognizable bossa anticipation, modal drone and existing custom dialects.
  const candidates = [
    options.legacy,
    pathCandidate(options, profile, role, 0),
    pathCandidate(options, profile, role, 1),
    pathCandidate(options, profile, role, 2),
  ].filter((notes) => notes.length);
  const ranked = candidates.map((notes) => ({
    notes,
    score: candidateScore(notes, options.chords, profile, role, options.drums),
  })).sort((a, b) => b.score - a.score);
  const top = ranked.filter((item) => item.score >= ranked[0]!.score - 0.22);
  // Candidate zero favors compatibility; other whole-song candidates explore
  // the qualified alternatives without allowing an incoherent random pattern.
  const selected = options.candidateIndex === 0
    ? ranked.find((item) => item.notes === options.legacy) ?? ranked[0]!
    : options.rng.pick(top);
  const roleLabel: Record<BassRole, string> = {
    root: "コードの輪郭を明確にするルート中心",
    pedal: "調の中心を保つペダル",
    walking: "コードトーンと経過音を結ぶウォーキング",
    ostinato: "グルーヴを支えるオスティナート",
    counterline: "旋律と反行を交えた対旋律",
  };
  const hasApproach = selected.notes.some((note) => options.chords.some((chord) =>
    chord.start > note.start && chord.start - note.start <= 1.01 &&
    Math.min(Math.abs((note.pitch % 12) - (chord.bassPitch % 12)),
      12 - Math.abs((note.pitch % 12) - (chord.bassPitch % 12))) <= 2));
  return {
    notes: selected.notes,
    profile,
    role,
    annotations: [{
      bar: 0,
      ruleId: "bass-path-plan",
      text: `ベース設計: ${roleLabel[role]}として、セクション全体の接続を評価${hasApproach ? "。次のコードへ半音・全音で接近" : ""}`,
      level: "section",
      category: "bass",
    }],
  };
}
