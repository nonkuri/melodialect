import type {
  ArrangementSettings,
  ChordEvent,
  CompositionControls,
  NoteEvent,
  Song,
  SongPart,
} from "../engine/types.js";
import { chordFromRoman } from "../engine/harmony.js";
import { generateAccompaniment } from "../engine/accompaniment.js";
import { createRng } from "../engine/rng.js";
import { dialects } from "../dialects/index.js";
import { buildSong } from "./songBuilder.js";
import {
  cloneWorkspace,
  isBarLocked,
  isChordLocked,
  isNoteLocked,
  isSectionLocked,
  type LockPart,
  type WorkspaceState,
} from "./project.js";

export type RegenerationTarget = "all" | LockPart;
export type NotePart = "melody" | "piano" | "guitar" | "bass" | "drums";

export interface NoteSelection {
  sectionIndex: number;
  part: NotePart;
  noteIndex: number;
}

export interface ChordSelection {
  sectionIndex: number;
  chordIndex: number;
}

export interface ControlChangeImpact {
  arrangementChanged: boolean;
  compositionChanged: boolean;
  affectedParts: SongPart[];
  preservedSections: number;
  preservedBars: number;
  message: string;
}

export interface ClipboardNote {
  part: NotePart;
  offset: number;
  duration: number;
  pitch: number;
  velocity: number;
}

function barOf(start: number, barBeats: number): number {
  return Math.floor((start + 1e-9) / barBeats);
}

function mergeNotes(
  oldNotes: NoteEvent[],
  newNotes: NoteEvent[],
  workspace: WorkspaceState,
  sectionIndex: number,
  part: LockPart,
): NoteEvent[] {
  const bb = workspace.song.meter.barBeats;
  const specificallyLocked = oldNotes.filter((note) =>
    isNoteLocked(workspace.locks, sectionIndex, part, note));
  return [
    ...oldNotes.filter((note) =>
      isBarLocked(workspace.locks, sectionIndex, part, barOf(note.start, bb)) ||
      isNoteLocked(workspace.locks, sectionIndex, part, note)),
    ...newNotes.filter((note) =>
      !isBarLocked(workspace.locks, sectionIndex, part, barOf(note.start, bb)) &&
      !specificallyLocked.some((locked) =>
        Math.abs(locked.start - note.start) < 0.125 &&
        locked.pitch === note.pitch)),
  ].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function mergeChords(
  oldChords: ChordEvent[],
  newChords: ChordEvent[],
  workspace: WorkspaceState,
  sectionIndex: number,
  sectionBeats: number,
): ChordEvent[] {
  const merged = [
    ...oldChords.filter((chord) =>
      isBarLocked(workspace.locks, sectionIndex, "chords", chord.bar) ||
      isChordLocked(workspace.locks, sectionIndex, chord)),
    ...newChords.filter((chord) =>
      !isBarLocked(workspace.locks, sectionIndex, "chords", chord.bar) &&
      !oldChords.some((old) =>
        isChordLocked(workspace.locks, sectionIndex, old) &&
        Math.abs(old.start - chord.start) < 0.125)),
  ].sort((a, b) => a.start - b.start);
  const unique = merged.filter((chord, index) =>
    index === 0 || Math.abs(chord.start - merged[index - 1]!.start) > 1e-9);
  return unique.map((chord, index) => ({
    ...chord,
    durationBeats: (unique[index + 1]?.start ?? sectionBeats) - chord.start,
  }));
}

export function analyzeControlChange(
  workspace: WorkspaceState,
  arrangement: ArrangementSettings,
  composition: CompositionControls,
): ControlChangeImpact {
  const arrangementChanged = JSON.stringify(arrangement) !== JSON.stringify(workspace.arrangement);
  const compositionChanged = JSON.stringify(composition) !== JSON.stringify(workspace.composition);
  const affectedParts: SongPart[] = compositionChanged
    ? ["melody", "piano", "guitar", "bass", "drums"]
    : arrangementChanged ? ["piano", "guitar", "bass", "drums"] : [];
  const preservedSections = workspace.locks.sections.length;
  const preservedBars = workspace.locks.bars.length;
  return {
    arrangementChanged,
    compositionChanged,
    affectedParts,
    preservedSections,
    preservedBars,
    message: affectedParts.length === 0
      ? "再構築される内容はありません"
      : `${affectedParts.join(" / ")} を部分更新します。ロック済み ${preservedSections}セクション・${preservedBars}小節は維持されます`,
  };
}

/** Rebuild only affected parts and merge protected/manual bars back into the candidate. */
export function applyControlChanges(
  workspace: WorkspaceState,
  arrangement: ArrangementSettings,
  composition: CompositionControls,
): WorkspaceState {
  const impact = analyzeControlChange(workspace, arrangement, composition);
  if (!impact.arrangementChanged && !impact.compositionChanged) return workspace;
  const next = cloneWorkspace(workspace);
  const candidate = buildSong(workspace.settings, {
    sectionSeeds: workspace.sectionSeeds,
    sectionPhraseLengths: workspace.song.sections.map((section) => section.plan.phraseLengths),
    arrangement,
    composition,
    mixer: workspace.mixer,
    sectionControls: workspace.sectionControls,
  });
  next.arrangement = arrangement;
  next.composition = composition;
  next.song.arrangement = arrangement;
  next.song.composition = composition;
  next.song.key = candidate.key;
  next.song.bpm = candidate.bpm;

  for (let sectionIndex = 0; sectionIndex < next.song.sections.length; sectionIndex++) {
    if (isSectionLocked(workspace.locks, sectionIndex)) continue;
    const current = workspace.song.sections[sectionIndex];
    const generated = candidate.sections[sectionIndex];
    if (!current || !generated) continue;
    const section = structuredClone(current);
    const sectionBeats = section.plan.bars * workspace.song.meter.barBeats;
    if (impact.compositionChanged) {
      section.chords = mergeChords(current.chords, generated.chords, workspace, sectionIndex, sectionBeats);
      section.melody = mergeNotes(current.melody, generated.melody, workspace, sectionIndex, "melody");
      section.key = generated.key;
    }
    if (impact.arrangementChanged || impact.compositionChanged) {
      section.piano = mergeNotes(current.piano, generated.piano, workspace, sectionIndex, "accompaniment");
      section.guitar = mergeNotes(current.guitar, generated.guitar, workspace, sectionIndex, "accompaniment");
      section.bass = mergeNotes(current.bass, generated.bass, workspace, sectionIndex, "accompaniment");
      section.drums = mergeNotes(current.drums, generated.drums, workspace, sectionIndex, "accompaniment");
    }
    section.annotations = [
      ...section.annotations.filter((annotation) => annotation.ruleId !== "control-apply"),
      { bar: 0, ruleId: "control-apply", text: "編曲・作曲パラメーターを部分適用" },
    ];
    next.song.sections[sectionIndex] = section;
  }
  return next;
}

/** Partially regenerate one section while preserving locked bars and every unrelated section. */
export function regenerateWorkspace(
  workspace: WorkspaceState,
  sectionIndex: number,
  target: RegenerationTarget,
): WorkspaceState {
  if (isSectionLocked(workspace.locks, sectionIndex)) return workspace;
  const next = cloneWorkspace(workspace);
  const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  next.sectionSeeds[sectionIndex] = seed;
  const candidate = buildSong(workspace.settings, {
    sectionSeeds: next.sectionSeeds,
    sectionPhraseLengths: workspace.song.sections.map((section) => section.plan.phraseLengths),
    arrangement: workspace.arrangement,
    composition: workspace.composition,
    mixer: workspace.mixer,
    sectionControls: workspace.sectionControls,
  });
  const currentSection = workspace.song.sections[sectionIndex];
  const candidateSection = candidate.sections[sectionIndex];
  if (!currentSection || !candidateSection) return workspace;
  const section = structuredClone(currentSection);
  const sectionBeats = section.plan.bars * workspace.song.meter.barBeats;

  if (target === "all" || target === "melody") {
    section.melody = mergeNotes(
      currentSection.melody,
      candidateSection.melody,
      workspace,
      sectionIndex,
      "melody",
    );
  }
  if (target === "all" || target === "chords") {
    section.chords = mergeChords(
      currentSection.chords,
      candidateSection.chords,
      workspace,
      sectionIndex,
      sectionBeats,
    );
  }
  if (target === "all" || target === "accompaniment") {
    section.piano = mergeNotes(
      currentSection.piano,
      candidateSection.piano,
      workspace,
      sectionIndex,
      "accompaniment",
    );
    section.bass = mergeNotes(
      currentSection.bass,
      candidateSection.bass,
      workspace,
      sectionIndex,
      "accompaniment",
    );
    section.guitar = mergeNotes(
      currentSection.guitar,
      candidateSection.guitar,
      workspace,
      sectionIndex,
      "accompaniment",
    );
    section.drums = mergeNotes(
      currentSection.drums,
      candidateSection.drums,
      workspace,
      sectionIndex,
      "accompaniment",
    );
  }
  section.annotations = [
    ...section.annotations.filter((note) => note.ruleId !== "partial-regeneration"),
    { bar: 0, ruleId: "partial-regeneration", text: "部分再生成: " + target },
  ];
  next.song.sections[sectionIndex] = section;
  return next;
}

export function updateNote(
  workspace: WorkspaceState,
  selection: NoteSelection,
  patch: Partial<Pick<NoteEvent, "start" | "duration" | "pitch" | "velocity">>,
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[selection.sectionIndex];
  const note = section?.[selection.part][selection.noteIndex];
  if (!section || !note) return workspace;
  const end = section.plan.bars * next.song.meter.barBeats;
  Object.assign(note, patch);
  note.start = Math.max(0, Math.min(note.start, end - 0.25));
  note.duration = Math.max(0.25, Math.min(note.duration, end - note.start));
  note.pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
  section[selection.part].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return next;
}

export function addNote(
  workspace: WorkspaceState,
  sectionIndex: number,
  note: NoteEvent,
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[sectionIndex];
  if (!section) return workspace;
  section.melody.push(note);
  section.melody.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return next;
}

export function deleteNote(workspace: WorkspaceState, selection: NoteSelection): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[selection.sectionIndex];
  if (!section) return workspace;
  section[selection.part].splice(selection.noteIndex, 1);
  return next;
}

export function quantizeNote(
  workspace: WorkspaceState,
  selection: NoteSelection,
  grid = 0.25,
): WorkspaceState {
  const section = workspace.song.sections[selection.sectionIndex];
  const note = section?.[selection.part][selection.noteIndex];
  if (!note) return workspace;
  return updateNote(workspace, selection, {
    start: Math.round(note.start / grid) * grid,
    duration: Math.max(grid, Math.round(note.duration / grid) * grid),
  });
}

function selectionKey(selection: NoteSelection): string {
  return `${selection.sectionIndex}:${selection.part}:${selection.noteIndex}`;
}

export function updateSelectedNotes(
  workspace: WorkspaceState,
  selections: NoteSelection[],
  transform: (note: NoteEvent, selection: NoteSelection) => Partial<NoteEvent>,
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const selected = new Set(selections.map(selectionKey));
  next.song.sections.forEach((section, sectionIndex) => {
    for (const part of ["melody", "piano", "guitar", "bass", "drums"] as NotePart[]) {
      const end = section.plan.bars * next.song.meter.barBeats;
      section[part] = section[part].map((note, noteIndex) => {
        const selection = { sectionIndex, part, noteIndex };
        if (!selected.has(selectionKey(selection))) return note;
        const changed = { ...note, ...transform(note, selection) };
        changed.start = Math.max(0, Math.min(changed.start, end - 0.01));
        changed.duration = Math.max(0.01, Math.min(changed.duration, end - changed.start));
        changed.pitch = Math.max(0, Math.min(127, Math.round(changed.pitch)));
        changed.velocity = Math.max(1, Math.min(127, Math.round(changed.velocity)));
        return changed;
      }).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    }
  });
  return next;
}

export function deleteSelectedNotes(
  workspace: WorkspaceState,
  selections: NoteSelection[],
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const grouped = new Map<string, number[]>();
  for (const selection of selections) {
    const key = `${selection.sectionIndex}:${selection.part}`;
    grouped.set(key, [...(grouped.get(key) ?? []), selection.noteIndex]);
  }
  for (const [key, indices] of grouped) {
    const [sectionText, partText] = key.split(":");
    const section = next.song.sections[Number(sectionText)];
    const part = partText as NotePart;
    if (!section) continue;
    for (const index of Array.from(new Set(indices)).sort((a, b) => b - a)) {
      section[part].splice(index, 1);
    }
  }
  return next;
}

export function quantizeSelectedNotes(
  workspace: WorkspaceState,
  selections: NoteSelection[],
  grid: number,
): WorkspaceState {
  return updateSelectedNotes(workspace, selections, (note) => ({
    start: Math.round(note.start / grid) * grid,
    duration: Math.max(grid, Math.round(note.duration / grid) * grid),
  }));
}

export function transposeSelectedNotes(
  workspace: WorkspaceState,
  selections: NoteSelection[],
  semitones: number,
): WorkspaceState {
  return updateSelectedNotes(workspace, selections, (note) => ({ pitch: note.pitch + semitones }));
}

export function setSelectedNoteVelocity(
  workspace: WorkspaceState,
  selections: NoteSelection[],
  velocity: number,
): WorkspaceState {
  return updateSelectedNotes(workspace, selections, () => ({ velocity }));
}

export function copySelectedNotes(song: Song, selections: NoteSelection[]): ClipboardNote[] {
  const values = selections.flatMap((selection) => {
    const section = song.sections[selection.sectionIndex];
    const note = section?.[selection.part][selection.noteIndex];
    if (!section || !note) return [];
    return [{
      part: selection.part,
      absoluteStart: section.startBar * song.meter.barBeats + note.start,
      duration: note.duration,
      pitch: note.pitch,
      velocity: note.velocity,
    }];
  });
  const origin = Math.min(...values.map((value) => value.absoluteStart));
  if (!Number.isFinite(origin)) return [];
  return values.map(({ absoluteStart, ...value }) => ({ ...value, offset: absoluteStart - origin }));
}

export function pasteNotes(
  workspace: WorkspaceState,
  clipboard: ClipboardNote[],
  targetBeat: number,
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const totalBeats = next.song.totalBars * next.song.meter.barBeats;
  for (const copied of clipboard) {
    const absoluteStart = Math.max(0, Math.min(totalBeats - 0.01, targetBeat + copied.offset));
    const sectionIndex = next.song.sections.findIndex((section) => {
      const start = section.startBar * next.song.meter.barBeats;
      return absoluteStart >= start && absoluteStart < start + section.plan.bars * next.song.meter.barBeats;
    });
    const section = next.song.sections[sectionIndex];
    if (!section) continue;
    const localStart = absoluteStart - section.startBar * next.song.meter.barBeats;
    const sectionEnd = section.plan.bars * next.song.meter.barBeats;
    section[copied.part].push({
      start: localStart,
      duration: Math.min(copied.duration, sectionEnd - localStart),
      pitch: copied.pitch,
      velocity: copied.velocity,
    });
    section[copied.part].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
  return next;
}

export function duplicateSelectedNotes(
  workspace: WorkspaceState,
  selections: NoteSelection[],
  offsetBeats: number,
): WorkspaceState {
  const clipboard = copySelectedNotes(workspace.song, selections);
  const starts = selections.flatMap((selection) => {
    const section = workspace.song.sections[selection.sectionIndex];
    const note = section?.[selection.part][selection.noteIndex];
    return section && note ? [section.startBar * workspace.song.meter.barBeats + note.start] : [];
  });
  return pasteNotes(workspace, clipboard, Math.min(...starts) + offsetBeats);
}

export type ChordRefreshPart = "piano" | "guitar" | "bass" | "drums";

function refreshAccompaniment(
  workspace: WorkspaceState,
  sectionIndex: number,
  parts: ChordRefreshPart[] = ["piano", "guitar", "bass", "drums"],
): void {
  const section = workspace.song.sections[sectionIndex];
  if (!section) return;
  const dialect = dialects[section.dialectId];
  if (!dialect) return;
  const generated = generateAccompaniment(
    section.plan,
    section.chords,
    dialect,
    section.key,
    workspace.song.meter,
    createRng((workspace.settings.seed + sectionIndex * 1009) >>> 0),
    workspace.arrangement,
  );
  if (parts.includes("piano")) section.piano = generated.piano;
  if (parts.includes("bass")) section.bass = generated.bass;
  if (parts.includes("guitar")) section.guitar = generated.guitar;
  if (parts.includes("drums")) section.drums = generated.drums;
}

export function replaceChord(
  workspace: WorkspaceState,
  selection: ChordSelection,
  symbol: string,
  refreshParts?: ChordRefreshPart[],
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[selection.sectionIndex];
  const old = section?.chords[selection.chordIndex];
  if (!section || !old) return workspace;
  section.chords[selection.chordIndex] = chordFromRoman(
    symbol,
    old.bar,
    section.key,
    old.start,
    old.durationBeats,
  );
  refreshAccompaniment(next, selection.sectionIndex, refreshParts);
  return next;
}

export function insertChord(
  workspace: WorkspaceState,
  selection: ChordSelection,
  symbol: string,
  refreshParts?: ChordRefreshPart[],
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[selection.sectionIndex];
  const old = section?.chords[selection.chordIndex];
  if (!section || !old || old.durationBeats < 0.5) return workspace;
  const firstDuration = old.durationBeats / 2;
  old.durationBeats = firstDuration;
  section.chords.splice(
    selection.chordIndex + 1,
    0,
    chordFromRoman(
      symbol,
      Math.floor((old.start + firstDuration) / next.song.meter.barBeats),
      section.key,
      old.start + firstDuration,
      firstDuration,
    ),
  );
  refreshAccompaniment(next, selection.sectionIndex, refreshParts);
  return next;
}

export function deleteChord(
  workspace: WorkspaceState,
  selection: ChordSelection,
  refreshParts?: ChordRefreshPart[],
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[selection.sectionIndex];
  const chord = section?.chords[selection.chordIndex];
  if (!section || !chord || section.chords.length <= 1) return workspace;
  if (selection.chordIndex > 0) {
    section.chords[selection.chordIndex - 1]!.durationBeats += chord.durationBeats;
  } else {
    const following = section.chords[1]!;
    following.start = chord.start;
    following.bar = chord.bar;
    following.durationBeats += chord.durationBeats;
  }
  section.chords.splice(selection.chordIndex, 1);
  refreshAccompaniment(next, selection.sectionIndex, refreshParts);
  return next;
}

export function updateChordTiming(
  workspace: WorkspaceState,
  selection: ChordSelection,
  patch: { start?: number; durationBeats?: number },
  grid = 0.25,
  refreshParts?: ChordRefreshPart[],
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const section = next.song.sections[selection.sectionIndex];
  const chord = section?.chords[selection.chordIndex];
  if (!section || !chord) return workspace;
  const sectionEnd = section.plan.bars * next.song.meter.barBeats;
  const previous = section.chords[selection.chordIndex - 1];
  const following = section.chords[selection.chordIndex + 1];
  if (patch.start !== undefined && previous) {
    const end = following?.start ?? chord.start + chord.durationBeats;
    const start = Math.max(previous.start + grid, Math.min(end - grid, patch.start));
    previous.durationBeats = start - previous.start;
    chord.start = start;
    chord.durationBeats = end - start;
    chord.bar = Math.floor(start / next.song.meter.barBeats);
  }
  if (patch.durationBeats !== undefined) {
    const nextBoundary = Math.max(
      chord.start + grid,
      Math.min(sectionEnd, chord.start + patch.durationBeats),
    );
    if (following) {
      const followingEnd = following.start + following.durationBeats;
      following.start = Math.min(followingEnd - grid, nextBoundary);
      following.durationBeats = followingEnd - following.start;
      following.bar = Math.floor(following.start / next.song.meter.barBeats);
      chord.durationBeats = following.start - chord.start;
    } else {
      chord.durationBeats = sectionEnd - chord.start;
    }
  }
  refreshAccompaniment(next, selection.sectionIndex, refreshParts);
  return next;
}

function qualitySuffix(chord: ChordEvent): { lower: boolean; suffix: string } {
  switch (chord.quality) {
    case "min": return { lower: true, suffix: "" };
    case "min7": return { lower: true, suffix: "7" };
    case "min9": return { lower: true, suffix: "9" };
    case "dom7": return { lower: false, suffix: "7" };
    case "dom9": return { lower: false, suffix: "9" };
    case "maj7": return { lower: false, suffix: "△7" };
    case "maj9": return { lower: false, suffix: "△9" };
    case "dim": return { lower: true, suffix: "°" };
    case "halfDim7": return { lower: true, suffix: "ø7" };
    default: return { lower: false, suffix: chord.quality === "maj" ? "" : chord.quality };
  }
}

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

function symbolForPitchClass(chord: ChordEvent, key: Song["key"], targetPc: number): string {
  const { lower, suffix } = qualitySuffix(chord);
  for (const flat of [false, true]) {
    for (let degree = 1; degree <= 7; degree++) {
      const numeral = ROMAN_NUMERALS[degree - 1]!;
      const candidate = `${flat ? "♭" : ""}${lower ? numeral.toLowerCase() : numeral}${suffix}`;
      try {
        if (chordFromRoman(candidate, 0, key).rootPc === targetPc) return candidate;
      } catch {
        // Try the next spelling.
      }
    }
  }
  return chord.symbol;
}

export function transposeSelectedChords(
  workspace: WorkspaceState,
  selections: ChordSelection[],
  semitones: number,
  refreshParts?: ChordRefreshPart[],
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  const affected = new Set<number>();
  for (const selection of selections) {
    const section = next.song.sections[selection.sectionIndex];
    const chord = section?.chords[selection.chordIndex];
    if (!section || !chord) continue;
    const targetPc = ((chord.rootPc + semitones) % 12 + 12) % 12;
    const symbol = symbolForPitchClass(chord, section.key, targetPc);
    section.chords[selection.chordIndex] = chordFromRoman(
      symbol,
      chord.bar,
      section.key,
      chord.start,
      chord.durationBeats,
    );
    affected.add(selection.sectionIndex);
  }
  for (const sectionIndex of affected) refreshAccompaniment(next, sectionIndex, refreshParts);
  return next;
}
