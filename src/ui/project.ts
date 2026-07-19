import type { ChordEvent, NoteEvent, Song } from "../engine/types.js";
import type { Settings } from "./SettingsPanel.js";

export type LockPart = "melody" | "chords" | "accompaniment";

export interface LockState {
  sections: number[];
  bars: string[];
  notes?: string[];
  chords?: string[];
}

export interface WorkspaceState {
  settings: Settings;
  song: Song;
  locks: LockState;
  /** Only overridden section seeds are populated. Sparse entries use the base song seed. */
  sectionSeeds: number[];
}

export interface Variation {
  id: string;
  name: string;
  createdAt: string;
  favorite: boolean;
  workspace: WorkspaceState;
}

export interface ProjectDocument {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspace: WorkspaceState;
  variations: Variation[];
  seedHistory: number[];
}

export interface RecentProject {
  id: string;
  title: string;
  updatedAt: string;
}

const PROJECT_PREFIX = "melodialect.project.";
const RECENTS_KEY = "melodialect.recentProjects";

export function cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
  return structuredClone(workspace);
}

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createProject(title: string, workspace: WorkspaceState): ProjectDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    workspace: cloneWorkspace(workspace),
    variations: [],
    seedHistory: [workspace.settings.seed],
  };
}

export function barLockKey(sectionIndex: number, part: LockPart, bar: number): string {
  return `${sectionIndex}:${part}:${bar}`;
}

export function isSectionLocked(locks: LockState, sectionIndex: number): boolean {
  return locks.sections.includes(sectionIndex);
}

export function isBarLocked(
  locks: LockState,
  sectionIndex: number,
  part: LockPart,
  bar: number,
): boolean {
  return isSectionLocked(locks, sectionIndex) ||
    locks.bars.includes(barLockKey(sectionIndex, part, bar));
}

export function toggleSectionLock(locks: LockState, sectionIndex: number): LockState {
  const sections = locks.sections.includes(sectionIndex)
    ? locks.sections.filter((index) => index !== sectionIndex)
    : [...locks.sections, sectionIndex];
  return { ...locks, sections };
}

export function lockBar(
  locks: LockState,
  sectionIndex: number,
  part: LockPart,
  bar: number,
  locked = true,
): LockState {
  const key = barLockKey(sectionIndex, part, bar);
  const bars = locked
    ? locks.bars.includes(key) ? locks.bars : [...locks.bars, key]
    : locks.bars.filter((value) => value !== key);
  return { ...locks, bars };
}

function noteLockKey(sectionIndex: number, part: string, note: NoteEvent): string {
  return [
    sectionIndex,
    part,
    note.start.toFixed(4),
    note.duration.toFixed(4),
    note.pitch,
  ].join(":");
}

function chordLockKey(sectionIndex: number, chord: ChordEvent): string {
  return [sectionIndex, chord.start.toFixed(4), chord.symbol].join(":");
}

export function isNoteLocked(
  locks: LockState,
  sectionIndex: number,
  part: string,
  note: NoteEvent,
): boolean {
  return (locks.notes ?? []).includes(noteLockKey(sectionIndex, part, note));
}

export function toggleNoteLock(
  locks: LockState,
  sectionIndex: number,
  part: string,
  note: NoteEvent,
): LockState {
  const key = noteLockKey(sectionIndex, part, note);
  const values = locks.notes ?? [];
  const notes = values.includes(key)
    ? values.filter((value) => value !== key)
    : [...values, key];
  return { ...locks, notes };
}

export function isChordLocked(
  locks: LockState,
  sectionIndex: number,
  chord: ChordEvent,
): boolean {
  return (locks.chords ?? []).includes(chordLockKey(sectionIndex, chord));
}

export function toggleChordLock(
  locks: LockState,
  sectionIndex: number,
  chord: ChordEvent,
): LockState {
  const key = chordLockKey(sectionIndex, chord);
  const values = locks.chords ?? [];
  const chords = values.includes(key)
    ? values.filter((value) => value !== key)
    : [...values, key];
  return { ...locks, chords };
}

export function emptyLocks(): LockState {
  return { sections: [], bars: [], notes: [], chords: [] };
}

export function listRecentProjects(): RecentProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is RecentProject =>
          Boolean(item && typeof item === "object" && "id" in item && "title" in item))
      : [];
  } catch {
    return [];
  }
}

export function saveProject(project: ProjectDocument): ProjectDocument {
  const saved = { ...project, updatedAt: new Date().toISOString() };
  localStorage.setItem(PROJECT_PREFIX + saved.id, JSON.stringify(saved));
  const recent = listRecentProjects().filter((item) => item.id !== saved.id);
  recent.unshift({ id: saved.id, title: saved.title, updatedAt: saved.updatedAt });
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recent.slice(0, 8)));
  return saved;
}

export function loadProject(id: string): ProjectDocument | null {
  try {
    const raw = localStorage.getItem(PROJECT_PREFIX + id);
    return raw ? parseProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadLatestProject(): ProjectDocument | null {
  const latest = listRecentProjects()[0];
  return latest ? loadProject(latest.id) : null;
}

export function parseProject(value: unknown): ProjectDocument {
  const project = value as Partial<ProjectDocument>;
  if (
    project.version !== 1 ||
    typeof project.id !== "string" ||
    typeof project.title !== "string" ||
    !project.workspace?.song ||
    !project.workspace.settings
  ) {
    throw new Error("Melodialect プロジェクトの形式が正しくありません");
  }
  return project as ProjectDocument;
}

export function downloadProject(project: ProjectDocument): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.title || "melodialect"}.melodialect.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<ProjectDocument> {
  return parseProject(JSON.parse(await file.text()));
}
