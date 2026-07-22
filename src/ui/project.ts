import type {
  ArrangementSettings,
  ChordEvent,
  CompositionControls,
  CompositionDesign,
  MasterSettings,
  MixerSettings,
  NoteEvent,
  SectionControl,
  Song,
} from "../engine/types.js";
import type { Settings } from "./SettingsPanel.js";

import {
  normalizeArrangement,
  normalizeComposition,
  normalizeMaster,
  normalizeMixer,
  normalizeSongControls,
} from "../engine/controls.js";
import { normalizeCompositionDesign } from "../engine/design.js";

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
  arrangement?: ArrangementSettings;
  mixer?: MixerSettings;
  master?: MasterSettings;
  composition?: CompositionControls;
  sectionControls?: SectionControl[];
  /** v0.9: コード原案、モチーフ、セクション表現。 */
  design?: CompositionDesign;
}

export interface Variation {
  id: string;
  name: string;
  createdAt: string;
  favorite: boolean;
  workspace: WorkspaceState;
}

export interface ProjectDocument {
  version: 2;
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

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  project: ProjectDocument;
}

export interface TrashEntry {
  project: ProjectDocument;
  deletedAt: string;
}

export interface ProjectBackup {
  format: "melodialect-backup";
  version: 1;
  exportedAt: string;
  projects: ProjectDocument[];
  trash: TrashEntry[];
  snapshots: ProjectSnapshot[];
}

export interface StorageReport {
  localBytes: number;
  localProjectBytes: number;
  quota?: number;
  usage?: number;
  available?: number;
  persisted?: boolean;
}

export class ProjectStorageError extends Error {
  constructor(
    message: string,
    public readonly reason: "quota" | "security" | "serialization" | "unknown",
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "ProjectStorageError";
  }
}

const CURRENT_VERSION = 2;
const PROJECT_PREFIX = "melodialect.project.";
const SNAPSHOT_PREFIX = "melodialect.snapshots.";
const TRASH_KEY = "melodialect.trash";
const RECENTS_KEY = "melodialect.recentProjects";
const MAX_SNAPSHOTS = 12;

function storage(): Storage {
  if (typeof localStorage === "undefined") {
    throw new ProjectStorageError("この環境ではブラウザ保存を利用できません", "security");
  }
  return localStorage;
}

export function cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
  return structuredClone(workspace);
}

/** Apply mixer/master values together so one preset load cannot overwrite the other. */
export function applyAudioSettings(
  workspace: WorkspaceState,
  values: { mixer?: MixerSettings; master?: MasterSettings },
): WorkspaceState {
  const next = cloneWorkspace(workspace);
  if (values.mixer) {
    next.mixer = structuredClone(values.mixer);
    next.song.mixer = structuredClone(values.mixer);
  }
  if (values.master) {
    next.master = { ...values.master };
    next.song.master = { ...values.master };
  }
  return next;
}

export function normalizeWorkspace(workspace: WorkspaceState): WorkspaceState {
  const song = normalizeSongControls(workspace.song);
  const mode = workspace.settings.mode ?? song.key.mode;
  const arrangement = normalizeArrangement(workspace.arrangement ?? song.arrangement);
  const mixer = normalizeMixer(workspace.mixer ?? song.mixer);
  const master = normalizeMaster(workspace.master ?? song.master);
  const composition = normalizeComposition(workspace.composition ?? song.composition, mode);
  const design = normalizeCompositionDesign(workspace.design, song, composition);
  const sourceSectionControls = workspace.sectionControls?.length === song.sections.length
    ? workspace.sectionControls
    : song.sections.map((section, index) => ({
        id: "section-" + index + "-" + Date.now().toString(36),
        type: section.plan.type,
        dialectId: section.dialectId,
        bars: section.plan.bars,
        transpose: 0,
        bpm: section.bpm ?? song.bpm,
      }));
  // SectionControl.bars is the visible section length. For a final ending this
  // includes the one-bar coda, while phraseLengths describes only the body.
  // Reconcile saved v0.9 workspaces that accidentally persisted the body length;
  // otherwise partial regeneration shortens the candidate and leaves a silent bar.
  const sectionControls = sourceSectionControls.map((control, index) => ({
    ...control,
    bars: song.sections[index]?.plan.bars ?? control.bars,
  }));
  const settings = { ...workspace.settings, mode };
  song.arrangement = arrangement;
  song.mixer = mixer;
  song.master = master;
  song.composition = composition;
  return {
    ...workspace,
    settings,
    song,
    arrangement,
    mixer,
    master,
    composition,
    design,
    sectionControls,
    locks: {
      sections: workspace.locks?.sections ?? [],
      bars: workspace.locks?.bars ?? [],
      notes: workspace.locks?.notes ?? [],
      chords: workspace.locks?.chords ?? [],
    },
    sectionSeeds: workspace.sectionSeeds ?? [],
  };
}

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createProject(title: string, workspace: WorkspaceState): ProjectDocument {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    workspace: normalizeWorkspace(cloneWorkspace(workspace)),
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
  return [sectionIndex, part, note.start.toFixed(4), note.duration.toFixed(4), note.pitch].join(":");
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

function parseArray<T>(key: string): T[] {
  try {
    const value = JSON.parse(storage().getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

export function listRecentProjects(): RecentProject[] {
  return parseArray<RecentProject>(RECENTS_KEY).filter((item) =>
    Boolean(item && typeof item.id === "string" && typeof item.title === "string"));
}

function updateRecents(project: ProjectDocument): void {
  const recent = listRecentProjects().filter((item) => item.id !== project.id);
  recent.unshift({ id: project.id, title: project.title, updatedAt: project.updatedAt });
  storage().setItem(RECENTS_KEY, JSON.stringify(recent.slice(0, 50)));
}

function normalizeProject(project: ProjectDocument): ProjectDocument {
  project.workspace = normalizeWorkspace(project.workspace);
  project.variations = (project.variations ?? []).map((variation) => ({
    ...variation,
    workspace: normalizeWorkspace(variation.workspace),
  }));
  project.seedHistory ??= [project.workspace.settings.seed];
  return project;
}

/** Versioned migrations are deliberately explicit and run before normalization. */
export function migrateProject(value: unknown): ProjectDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Melodialect プロジェクトの形式が正しくありません");
  }
  const source = structuredClone(value) as Record<string, unknown>;
  let version = typeof source.version === "number" ? source.version : 1;
  if (version > CURRENT_VERSION) {
    throw new Error(`このプロジェクトは新しい形式 (v${version}) のため読み込めません`);
  }
  if (version < 1) version = 1;
  if (version === 1) {
    source.version = 2;
    version = 2;
  }
  if (version !== 2) {
    throw new Error(`プロジェクト形式 v${version} の移行経路がありません`);
  }
  const project = source as unknown as ProjectDocument;
  if (
    typeof project.id !== "string" ||
    typeof project.title !== "string" ||
    !project.workspace?.song ||
    !project.workspace.settings
  ) {
    throw new Error("Melodialect プロジェクトの形式が正しくありません");
  }
  project.version = 2;
  project.createdAt ||= new Date().toISOString();
  project.updatedAt ||= project.createdAt;
  project.variations ??= [];
  return normalizeProject(project);
}

export function parseProject(value: unknown): ProjectDocument {
  return migrateProject(value);
}

function rawProject(id: string): string | null {
  return storage().getItem(PROJECT_PREFIX + id);
}

export function listProjectSnapshots(projectId: string): ProjectSnapshot[] {
  return parseArray<ProjectSnapshot>(SNAPSHOT_PREFIX + projectId)
    .filter((snapshot) => snapshot?.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createProjectSnapshot(
  project: ProjectDocument,
  label = "自動保存",
): ProjectSnapshot {
  const snapshot: ProjectSnapshot = {
    id: createId(),
    projectId: project.id,
    label,
    createdAt: new Date().toISOString(),
    project: structuredClone(project),
  };
  const existing = listProjectSnapshots(project.id);
  const serializedWorkspace = JSON.stringify(snapshot.project.workspace);
  const deduped = existing.filter((item) =>
    JSON.stringify(item.project.workspace) !== serializedWorkspace);
  const snapshots = [snapshot, ...deduped].slice(0, MAX_SNAPSHOTS);
  const target = storage();
  const key = SNAPSHOT_PREFIX + project.id;

  // localStorage has a comparatively small quota. If the retained generations no
  // longer fit, prefer keeping the newest recovery point over blocking the edit
  // that requested it. Replacing this key with a shorter value also releases the
  // space occupied by its older generations.
  for (let count = snapshots.length; count >= 1; count--) {
    try {
      target.setItem(key, JSON.stringify(snapshots.slice(0, count)));
      return snapshot;
    } catch (error) {
      const normalized = storageError(error);
      if (normalized.reason !== "quota" || count === 1) throw normalized;
    }
  }
  throw new ProjectStorageError("保存世代を作成できませんでした", "unknown");
}

function storageError(error: unknown): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  if (error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
    return new ProjectStorageError(
      "保存容量が不足しています。不要なプロジェクトや音源を削除し、一括バックアップ後に再試行してください",
      "quota",
      error,
    );
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return new ProjectStorageError(
      "ブラウザのプライバシー設定により端末内保存が拒否されました",
      "security",
      error,
    );
  }
  return new ProjectStorageError("プロジェクトを保存できませんでした", "unknown", error);
}

export function saveProject(
  project: ProjectDocument,
  options: { createGeneration?: boolean; snapshotLabel?: string } = {},
): ProjectDocument {
  try {
    const saved = normalizeProject({
      ...structuredClone(project),
      version: 2,
      updatedAt: new Date().toISOString(),
    });
    const previousRaw = rawProject(saved.id);
    if (options.createGeneration !== false && previousRaw) {
      const previous = parseProject(JSON.parse(previousRaw));
      if (JSON.stringify(previous.workspace) !== JSON.stringify(saved.workspace)) {
        try {
          createProjectSnapshot(previous, options.snapshotLabel ?? "自動保存");
        } catch (error) {
          const normalized = storageError(error);
          // The current project is more important than an additional recovery
          // generation. Overwriting its existing key often still succeeds even
          // when there is no room to add another snapshot.
          if (normalized.reason !== "quota") throw normalized;
        }
      }
    }
    storage().setItem(PROJECT_PREFIX + saved.id, JSON.stringify(saved));
    updateRecents(saved);
    return saved;
  } catch (error) {
    throw storageError(error);
  }
}

export function loadProject(id: string): ProjectDocument | null {
  try {
    const raw = rawProject(id);
    return raw ? parseProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadLatestProject(): ProjectDocument | null {
  const latest = listRecentProjects()[0];
  return latest ? loadProject(latest.id) : null;
}

export function listProjects(): ProjectDocument[] {
  const projects: ProjectDocument[] = [];
  const target = storage();
  for (let index = 0; index < target.length; index++) {
    const key = target.key(index);
    if (!key?.startsWith(PROJECT_PREFIX)) continue;
    const loaded = loadProject(key.slice(PROJECT_PREFIX.length));
    if (loaded) projects.push(loaded);
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function renameStoredProject(id: string, title: string): ProjectDocument | null {
  const project = loadProject(id);
  if (!project) return null;
  return saveProject({ ...project, title: title.trim() || "名称未設定" }, { createGeneration: false });
}

export function duplicateProject(id: string): ProjectDocument | null {
  const source = loadProject(id);
  if (!source) return null;
  const now = new Date().toISOString();
  const duplicate: ProjectDocument = {
    ...structuredClone(source),
    id: createId(),
    title: source.title + " のコピー",
    createdAt: now,
    updatedAt: now,
  };
  return saveProject(duplicate, { createGeneration: false });
}

export function listTrash(): TrashEntry[] {
  return parseArray<TrashEntry>(TRASH_KEY)
    .filter((entry) => Boolean(entry?.project?.id))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function deleteProject(id: string): void {
  const project = loadProject(id);
  if (!project) return;
  const trash = listTrash().filter((entry) => entry.project.id !== id);
  trash.unshift({ project, deletedAt: new Date().toISOString() });
  storage().setItem(TRASH_KEY, JSON.stringify(trash.slice(0, 30)));
  storage().removeItem(PROJECT_PREFIX + id);
  storage().setItem(
    RECENTS_KEY,
    JSON.stringify(listRecentProjects().filter((item) => item.id !== id)),
  );
}

export function restoreProject(id: string): ProjectDocument | null {
  const trash = listTrash();
  const entry = trash.find((item) => item.project.id === id);
  if (!entry) return null;
  const restored = saveProject(entry.project, { createGeneration: false });
  storage().setItem(TRASH_KEY, JSON.stringify(trash.filter((item) => item.project.id !== id)));
  return restored;
}

export function permanentlyDeleteProject(id: string): void {
  storage().setItem(
    TRASH_KEY,
    JSON.stringify(listTrash().filter((item) => item.project.id !== id)),
  );
  storage().removeItem(SNAPSHOT_PREFIX + id);
}

export function restoreSnapshot(projectId: string, snapshotId: string): ProjectDocument | null {
  const snapshot = listProjectSnapshots(projectId).find((item) => item.id === snapshotId);
  if (!snapshot) return null;
  const current = loadProject(projectId);
  if (current) createProjectSnapshot(current, "復元前");
  return saveProject(
    { ...structuredClone(snapshot.project), updatedAt: new Date().toISOString() },
    { createGeneration: false },
  );
}

export function createBackup(): ProjectBackup {
  return {
    format: "melodialect-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: listProjects(),
    trash: listTrash(),
    snapshots: listProjects().flatMap((project) => listProjectSnapshots(project.id)),
  };
}

export function restoreBackup(value: unknown): number {
  const backup = value as Partial<ProjectBackup>;
  if (backup.format !== "melodialect-backup" || backup.version !== 1 || !Array.isArray(backup.projects)) {
    throw new Error("Melodialect 一括バックアップの形式が正しくありません");
  }
  const projects = backup.projects.map((project) => parseProject(project));
  for (const project of projects) saveProject(project, { createGeneration: false });
  if (Array.isArray(backup.trash)) storage().setItem(TRASH_KEY, JSON.stringify(backup.trash));
  if (Array.isArray(backup.snapshots)) {
    for (const project of projects) {
      const snapshots = backup.snapshots.filter((item) => item.projectId === project.id);
      if (snapshots.length) {
        storage().setItem(SNAPSHOT_PREFIX + project.id, JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS)));
      }
    }
  }
  return projects.length;
}

function downloadJson(value: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadProject(project: ProjectDocument): void {
  downloadJson(project, `${project.title || "melodialect"}.melodialect.json`);
}

export function downloadBackup(): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJson(createBackup(), `melodialect-backup-${stamp}.json`);
}

export async function readProjectFile(file: File): Promise<ProjectDocument> {
  return parseProject(JSON.parse(await file.text()));
}

export async function readBackupFile(file: File): Promise<number> {
  return restoreBackup(JSON.parse(await file.text()));
}

export function getLocalStorageBytes(): { total: number; projects: number } {
  let total = 0;
  let projects = 0;
  const target = storage();
  for (let index = 0; index < target.length; index++) {
    const key = target.key(index) ?? "";
    const bytes = (key.length + (target.getItem(key)?.length ?? 0)) * 2;
    total += bytes;
    if (key.startsWith(PROJECT_PREFIX) || key.startsWith(SNAPSHOT_PREFIX)) projects += bytes;
  }
  return { total, projects };
}

export async function getStorageReport(): Promise<StorageReport> {
  const local = getLocalStorageBytes();
  const estimate = typeof navigator !== "undefined" && navigator.storage?.estimate
    ? await navigator.storage.estimate()
    : {};
  const persisted = typeof navigator !== "undefined" && navigator.storage?.persisted
    ? await navigator.storage.persisted()
    : undefined;
  return {
    localBytes: local.total,
    localProjectBytes: local.projects,
    quota: estimate.quota,
    usage: estimate.usage,
    available: estimate.quota !== undefined && estimate.usage !== undefined
      ? Math.max(0, estimate.quota - estimate.usage)
      : undefined,
    persisted,
  };
}
