import type { ChordEvent, NoteEvent, Song } from "../engine/types.js";
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

function refreshAccompaniment(workspace: WorkspaceState, sectionIndex: number): void {
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
  section.piano = generated.piano;
  section.bass = generated.bass;
  section.guitar = generated.guitar;
  section.drums = generated.drums;
}

export function replaceChord(
  workspace: WorkspaceState,
  selection: ChordSelection,
  symbol: string,
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
  refreshAccompaniment(next, selection.sectionIndex);
  return next;
}

export function insertChord(
  workspace: WorkspaceState,
  selection: ChordSelection,
  symbol: string,
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
  refreshAccompaniment(next, selection.sectionIndex);
  return next;
}

export function deleteChord(workspace: WorkspaceState, selection: ChordSelection): WorkspaceState {
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
  refreshAccompaniment(next, selection.sectionIndex);
  return next;
}
