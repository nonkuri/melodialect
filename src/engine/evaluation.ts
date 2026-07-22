import type {
  DiversityLevel,
  GenerationMetrics,
  GenerationReason,
  GeneratedSection,
  NoteEvent,
  Song,
  SongFingerprint,
} from "./types.js";
import { chordAtBeat, parseRoman } from "./harmony.js";
import { createNamedRng } from "./rng.js";

const EPSILON = 1e-7;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

function quantize(value: number, step = 0.25): number {
  return Math.round(value / step) * step;
}

function intervalFingerprint(notes: NoteEvent[]): string {
  const ordered = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return ordered.slice(1).map((note, index) => {
    const previous = ordered[index]!;
    const interval = Math.max(-12, Math.min(12, note.pitch - previous.pitch));
    return `${interval}@${quantize(note.start - previous.start)}/${quantize(note.duration)}`;
  }).join(",");
}

function rangeOf(notes: NoteEvent[]): string {
  if (!notes.length) return "off";
  const pitches = notes.map((note) => note.pitch);
  return `${Math.min(...pitches)}-${Math.max(...pitches)}`;
}

function onsetFingerprint(notes: NoteEvent[], barBeats: number): string {
  return Array.from(new Set(notes.map((note) => quantize(note.start % barBeats))))
    .sort((a, b) => a - b)
    .join(".");
}

function voicingFingerprint(notes: NoteEvent[]): string {
  const onsets = new Map<string, number[]>();
  notes.forEach((note) => {
    const key = quantize(note.start).toFixed(2);
    const pitches = onsets.get(key) ?? [];
    pitches.push(note.pitch);
    onsets.set(key, pitches);
  });
  return Array.from(onsets.values()).slice(0, 24).map((pitches) => {
    const ordered = pitches.sort((a, b) => a - b);
    return `${ordered.length}:${ordered.at(-1)! - ordered[0]!}`;
  }).join(".");
}

function accompanimentSectionFingerprint(section: GeneratedSection, barBeats: number): string {
  const parts = (["piano", "guitar", "drums"] as const).map((part) => {
    const notes = section[part];
    const activeBars = Array.from(new Set(notes.map((note) => Math.floor(note.start / barBeats))))
      .sort((a, b) => a - b).join(".");
    return `${part}:${activeBars}:${onsetFingerprint(notes, barBeats)}:${rangeOf(notes)}:${voicingFingerprint(notes)}:${notes.length}`;
  });
  return `${section.plan.type}[${parts.join("|")}]`;
}

export function fingerprintSong(song: Song): SongFingerprint {
  const harmonyRaw = song.sections.map((section) => section.chords
    .map((chord) => `${chord.symbol}@${quantize(chord.durationBeats)}`).join(">"))
    .join("/");
  const melodyRaw = song.sections.map((section) => intervalFingerprint(section.melody)).join("/");
  const bassRaw = song.sections.map((section) => intervalFingerprint(section.bass)).join("/");
  const accompanimentRaw = song.sections
    .map((section) => accompanimentSectionFingerprint(section, song.meter.barBeats)).join("/");
  const harmony = stableHash(harmonyRaw);
  const melody = stableHash(melodyRaw);
  const bass = stableHash(bassRaw);
  const accompaniment = stableHash(accompanimentRaw);
  return {
    harmony,
    melody,
    bass,
    accompaniment,
    combined: stableHash([harmony, melody, bass, accompaniment].join("|")),
  };
}

function duplicateEvents(notes: NoteEvent[]): boolean {
  const seen = new Set<string>();
  for (const note of notes) {
    const key = `${note.start.toFixed(5)}:${note.duration.toFixed(5)}:${note.pitch}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function validateGeneratedSong(song: Song): string[] {
  const violations: string[] = [];
  if (!song.sections.length) violations.push("セクションがありません");
  song.sections.forEach((section, sectionIndex) => {
    const sectionBeats = section.plan.bars * song.meter.barBeats;
    const chords = [...section.chords].sort((a, b) => a.start - b.start);
    if (!chords.length) violations.push(`${sectionIndex + 1}番目のセクションにコードがありません`);
    if (chords[0] && Math.abs(chords[0].start) > EPSILON) {
      violations.push(`${sectionIndex + 1}番目のセクションのコードが先頭から始まりません`);
    }
    chords.forEach((chord, index) => {
      if (!Number.isFinite(chord.start) || !Number.isFinite(chord.durationBeats) || chord.durationBeats <= 0) {
        violations.push(`${sectionIndex + 1}番目のセクションに不正なコード音価があります`);
      }
      const next = chords[index + 1];
      if (next && Math.abs(chord.start + chord.durationBeats - next.start) > EPSILON) {
        violations.push(`${sectionIndex + 1}番目のセクションのコード被覆に隙間または重複があります`);
      }
    });
    const finalChord = chords.at(-1);
    if (finalChord && Math.abs(finalChord.start + finalChord.durationBeats - sectionBeats) > EPSILON) {
      violations.push(`${sectionIndex + 1}番目のセクション末尾までコードが被覆されていません`);
    }
    for (const part of ["melody", "piano", "guitar", "bass", "drums"] as const) {
      const notes = section[part];
      if (duplicateEvents(notes)) violations.push(`${sectionIndex + 1}番目の${part}に重複イベントがあります`);
      if (notes.some((note) => !Number.isFinite(note.start) || !Number.isFinite(note.duration) ||
        note.duration <= 0 || note.start < -EPSILON || note.start + note.duration > sectionBeats + EPSILON ||
        note.pitch < 0 || note.pitch > 127)) {
        violations.push(`${sectionIndex + 1}番目の${part}に範囲外イベントがあります`);
      }
      if ((part === "melody" || part === "bass") && notes.some((note, index) =>
        index > 0 && Math.abs(note.pitch - notes[index - 1]!.pitch) > (part === "bass" ? 24 : 36))) {
        violations.push(`${sectionIndex + 1}番目の${part}に極端な跳躍があります`);
      }
    }
  });
  return Array.from(new Set(violations));
}

function harmonicCoherence(song: Song): number {
  const values: number[] = [];
  for (const section of song.sections) {
    for (let index = 1; index < section.chords.length; index++) {
      try {
        const previous = parseRoman(section.chords[index - 1]!.symbol);
        const current = parseRoman(section.chords[index]!.symbol);
        const distance = Math.abs(current.degree - previous.degree);
        const functional = current.degree === 1 || current.degree === 4 || current.degree === 5 ||
          previous.degree === 2 || previous.degree === 4 || previous.degree === 5;
        values.push(clamp01(0.82 + (functional ? 0.18 : 0) - (distance === 0 ? 0.25 : 0)));
      } catch {
        values.push(0.7);
      }
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function voiceLeading(song: Song): number {
  let movement = 0;
  let count = 0;
  for (const section of song.sections) {
    for (let index = 1; index < section.chords.length; index++) {
      const previous = section.chords[index - 1]!.pitches;
      const current = section.chords[index]!.pitches;
      if (!previous.length || !current.length) continue;
      current.forEach((pitch) => {
        movement += Math.min(...previous.map((source) => {
          const raw = Math.abs(pitch - source);
          return Math.min(raw, Math.abs(raw - 12), Math.abs(raw - 24));
        }));
        count += 1;
      });
    }
    for (const part of ["piano", "guitar"] as const) {
      const onsets = new Map<string, number[]>();
      section[part].forEach((note) => {
        const key = note.start.toFixed(4);
        const pitches = onsets.get(key) ?? [];
        pitches.push(note.pitch);
        onsets.set(key, pitches);
      });
      const groups = Array.from(onsets.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, pitches]) => pitches);
      groups.slice(1).forEach((current, index) => {
        const previous = groups[index]!;
        current.forEach((pitch) => {
          movement += Math.min(...previous.map((source) => {
            const raw = Math.abs(pitch - source);
            return Math.min(raw, Math.abs(raw - 12), Math.abs(raw - 24));
          }));
          count += 1;
        });
      });
    }
  }
  return count ? clamp01(1 - movement / count / 7) : 0.7;
}

function melodicFit(song: Song): number {
  let total = 0;
  let fitted = 0;
  for (const section of song.sections) {
    for (const note of section.melody) {
      if (!section.chords.length) continue;
      total += 1;
      const chord = chordAtBeat(section.chords, note.start);
      const chordPcs = chord.pitches.map((pitch) => ((pitch % 12) + 12) % 12);
      const pc = ((note.pitch % 12) + 12) % 12;
      const strongBeat = Math.abs(note.start - Math.round(note.start)) < EPSILON;
      fitted += chordPcs.includes(pc) ? 1 : strongBeat ? 0.45 : 0.72;
    }
  }
  return total ? fitted / total : 0;
}

function bassSmoothness(song: Song): number {
  let score = 0;
  let count = 0;
  for (const section of song.sections) {
    const notes = [...section.bass].sort((a, b) => a.start - b.start);
    notes.forEach((note, index) => {
      if (!section.chords.length) return;
      const chord = chordAtBeat(section.chords, note.start);
      const chordPcs = chord.pitches.map((pitch) => pitch % 12);
      const chordFit = chordPcs.includes(note.pitch % 12) ? 1 : 0.72;
      const leap = index ? Math.abs(note.pitch - notes[index - 1]!.pitch) : 0;
      score += chordFit * clamp01(1 - Math.max(0, leap - 7) / 17);
      count += 1;
    });
  }
  return count ? score / count : 0;
}

function accompanimentClarity(song: Song): number {
  let overlap = 0;
  let total = 0;
  let fitted = 0;
  let pitched = 0;
  for (const section of song.sections) {
    const piano = new Set(section.piano.map((note) => quantize(note.start).toFixed(2)));
    const guitar = new Set(section.guitar.map((note) => quantize(note.start).toFixed(2)));
    total += Math.max(1, piano.size + guitar.size);
    for (const onset of piano) if (guitar.has(onset)) overlap += 1;
    for (const part of [section.piano, section.guitar]) {
      for (const note of part) {
        if (!section.chords.length) continue;
        const chord = chordAtBeat(section.chords, note.start);
        const chordPcs = new Set(chord.pitches.map((pitch) => ((pitch % 12) + 12) % 12));
        fitted += chordPcs.has(((note.pitch % 12) + 12) % 12) ? 1 : 0;
        pitched += 1;
      }
    }
  }
  const separation = clamp01(1 - overlap / Math.max(1, total) * 0.65);
  const chordFit = pitched ? fitted / pitched : 1;
  // 同時発音の少なさより、コードに属する音を鳴らしていることを優先する。
  // これにより「音域変更」を誤って半音移調として実装した場合も採用前に検出できる。
  return chordFit * 0.78 + separation * 0.22;
}

function sectionContrast(song: Song): number {
  if (song.sections.length < 2) return 0.7;
  const density = (section: GeneratedSection) =>
    (section.piano.length + section.guitar.length + section.bass.length + section.drums.length) /
    Math.max(1, section.plan.bars);
  const expectedRatio: Record<GeneratedSection["plan"]["type"], number> = {
    intro: 0.7,
    verse: 0.9,
    chorus: 1.15,
    bridge: 0.95,
    outro: 0.78,
  };
  const values: number[] = [];
  for (let index = 1; index < song.sections.length; index++) {
    const previous = song.sections[index - 1]!;
    const current = song.sections[index]!;
    const ratio = Math.max(0.03, density(current) / Math.max(0.03, density(previous)));
    const target = expectedRatio[current.plan.type];
    const distance = Math.abs(Math.log(ratio / target));
    let score = clamp01(1 - distance / Math.log(2.25));
    // Outroで直前まで鳴っていたドラムが突然ゼロになる切断感を明示的に避ける。
    if (current.plan.type === "outro" && previous.drums.length > 0 && current.drums.length === 0) {
      score *= 0.35;
    }
    values.push(score);
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.7;
}

function densityOf(section: GeneratedSection, parts: Array<"piano" | "guitar" | "bass" | "drums">): number {
  return parts.reduce((sum, part) => sum + section[part].length, 0) / Math.max(1, section.plan.bars);
}

function ratioWithin(value: number, reference: number, minimum: number, maximum: number): boolean {
  if (reference < 1e-7) return value < 1e-7;
  const ratio = value / reference;
  return ratio >= minimum && ratio <= maximum;
}

/**
 * The first candidate is the compatibility baseline. Alternatives may improve it,
 * but automatic selection must not create a radically denser chorus or a hollow
 * outro merely because a global contrast score increased.
 */
function preservesSectionShape(candidate: Song, reference: Song): boolean {
  if (candidate.sections.length !== reference.sections.length) return false;
  const metrics = candidate.generationReport?.metrics ?? evaluateSong(candidate);
  const baseline = reference.generationReport?.metrics ?? evaluateSong(reference);
  if (metrics.harmonicCoherence < baseline.harmonicCoherence - 0.025 ||
    metrics.voiceLeading < baseline.voiceLeading - 0.025 ||
    metrics.melodicFit < baseline.melodicFit - 0.02 ||
    metrics.bassSmoothness < baseline.bassSmoothness - 0.035 ||
    metrics.accompanimentClarity < baseline.accompanimentClarity - 0.025) return false;
  return candidate.sections.every((section, index) => {
    const original = reference.sections[index]!;
    if (section.plan.type !== original.plan.type) return false;
    const total = densityOf(section, ["piano", "guitar", "bass", "drums"]);
    const originalTotal = densityOf(original, ["piano", "guitar", "bass", "drums"]);
    const harmony = densityOf(section, ["piano", "guitar"]);
    const originalHarmony = densityOf(original, ["piano", "guitar"]);
    const bass = densityOf(section, ["bass"]);
    const originalBass = densityOf(original, ["bass"]);
    const drums = densityOf(section, ["drums"]);
    const originalDrums = densityOf(original, ["drums"]);
    if (section.plan.type === "chorus") {
      return ratioWithin(total, originalTotal, 0.68, 1.42) &&
        ratioWithin(harmony, originalHarmony, 0.55, 1.5) &&
        ratioWithin(bass, originalBass, 0.55, 1.5) &&
        ratioWithin(drums, originalDrums, 0.65, 1.35);
    }
    if (section.plan.type === "outro") {
      return ratioWithin(total, originalTotal, 0.48, 1.25) &&
        ratioWithin(harmony, originalHarmony, 0.4, 1.35) &&
        ratioWithin(bass, originalBass, 0.55, 1.45) &&
        ratioWithin(drums, originalDrums, 0.3, 1.2);
    }
    return ratioWithin(total, originalTotal, 0.5, 1.6);
  });
}

export function evaluateSong(song: Song): GenerationMetrics {
  const violations = validateGeneratedSong(song);
  const harmonic = harmonicCoherence(song);
  const voices = voiceLeading(song);
  const melody = melodicFit(song);
  const bass = bassSmoothness(song);
  const accompaniment = accompanimentClarity(song);
  const contrast = sectionContrast(song);
  const quality = clamp01(
    harmonic * 0.21 + voices * 0.1 + melody * 0.2 + bass * 0.19 +
    accompaniment * 0.16 + contrast * 0.14 -
    violations.length * 0.25,
  );
  return {
    valid: violations.length === 0,
    violations,
    quality,
    harmonicCoherence: harmonic,
    voiceLeading: voices,
    melodicFit: melody,
    bassSmoothness: bass,
    accompanimentClarity: accompaniment,
    sectionContrast: contrast,
  };
}

function reasonsForSong(song: Song, candidateIndex: number, selectedFrom: number): GenerationReason[] {
  const reasons: GenerationReason[] = [{
    id: `selection-${candidateIndex}`,
    level: "song",
    category: "selection",
    summary: selectedFrom > 1
      ? `${selectedFrom}個の候補から、破綻を避けつつダイアレクトらしさと変化の釣り合う案を選びました`
      : "ダイアレクトの規則から曲全体を組み立てました",
    ruleId: "candidate-selection",
  }];
  song.sections.forEach((section, sectionIndex) => {
    const previous = song.sections[sectionIndex - 1];
    const currentDensity = section.piano.length + section.guitar.length + section.drums.length;
    const previousDensity = previous ? previous.piano.length + previous.guitar.length + previous.drums.length : 0;
    const densityText = !previous ? "曲の入口となる密度に設定"
      : currentDensity > previousDensity * 1.12 ? "前のセクションより伴奏を厚くして展開"
        : currentDensity < previousDensity * 0.88 ? "前のセクションより伴奏を間引いて対比"
          : "前のセクションとの一貫性を維持";
    reasons.push({
      id: `section-${sectionIndex}`,
      level: "section",
      category: "arrangement",
      sectionIndex,
      summary: `${section.plan.type}: ${densityText}`,
      ruleId: "section-arrangement-summary",
    });
  });
  return reasons;
}

export function attachGenerationReport(
  song: Song,
  candidateIndex: number,
  selectedFrom: number,
  diversity: DiversityLevel,
): Song {
  song.generationReport = {
    candidateIndex,
    selectedFrom,
    diversity,
    fingerprint: fingerprintSong(song),
    metrics: evaluateSong(song),
    summary: reasonsForSong(song, candidateIndex, selectedFrom),
  };
  return song;
}

function fingerprintDistance(a: SongFingerprint, b: SongFingerprint): number {
  const fields: Array<keyof SongFingerprint> = ["harmony", "melody", "bass", "accompaniment"];
  return fields.reduce((score, field) => score + (a[field] === b[field] ? 0 : 0.25), 0);
}

export function describeCandidateDifference(candidate: Song, reference?: Song): string[] {
  if (!reference) return ["基準候補"];
  const a = candidate.generationReport?.fingerprint ?? fingerprintSong(candidate);
  const b = reference.generationReport?.fingerprint ?? fingerprintSong(reference);
  const tags: string[] = [];
  if (a.harmony !== b.harmony) tags.push("コードを変奏");
  if (a.melody !== b.melody) tags.push("旋律を変奏");
  if (a.bass !== b.bass) tags.push("ベースが変化");
  if (a.accompaniment !== b.accompaniment) tags.push("伴奏編成を変更");
  return tags.length ? tags : ["細部を変奏"];
}

export function selectSongCandidate(
  candidates: Song[],
  seed: number,
  diversity: DiversityLevel,
): Song {
  if (!candidates.length) throw new Error("生成候補がありません");
  candidates.forEach((song, index) => attachGenerationReport(song, index, candidates.length, diversity));
  const valid = candidates.filter((song) => song.generationReport!.metrics.valid);
  const pool = valid.length ? valid : candidates;
  const reference = candidates[0]!;
  const guarded = pool.filter((song) => song === reference || preservesSectionShape(song, reference));
  const qualified = guarded.length ? guarded : [reference];
  const maxQuality = Math.max(...qualified.map((song) => song.generationReport!.metrics.quality));
  const referenceQuality = reference.generationReport!.metrics.quality;
  // A different automatic result must show a meaningful measured improvement.
  // Diversity remains available without this threshold through 「他の候補」.
  const improvement = diversity === "adventurous" ? 0.008 : diversity === "standard" ? 0.012 : 0.018;
  const top = maxQuality < referenceQuality + improvement
    ? [reference]
    : qualified.filter((song) => song.generationReport!.metrics.quality >= maxQuality - 0.003);
  const rng = createNamedRng(seed, "candidate-selection");
  const weighted = top.map((song, index) => {
    const previous = top.slice(0, index);
    const novelty = previous.length
      ? Math.min(...previous.map((item) => fingerprintDistance(song.generationReport!.fingerprint, item.generationReport!.fingerprint)))
      : 0.5;
    const noveltyWeight = diversity === "stable" ? 0.01 : diversity === "standard" ? 0.04 : 0.1;
    const qualityWeight = Math.exp((song.generationReport!.metrics.quality - maxQuality) * 120);
    return [song, qualityWeight * (1 + novelty * noveltyWeight)] as [Song, number];
  });
  const selected = rng.weighted(weighted);
  selected.generationReport!.differenceTags = describeCandidateDifference(selected, candidates[0]);
  const selectionReason = selected.generationReport!.summary.find((reason) =>
    reason.ruleId === "candidate-selection");
  if (selectionReason && candidates.length > 1) {
    selectionReason.alternatives = candidates.filter((candidate) => candidate !== selected).slice(0, 3)
      .map((candidate) => describeCandidateDifference(candidate, selected).join("・"));
  }
  return selected;
}
