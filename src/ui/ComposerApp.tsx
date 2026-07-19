import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  ArrangementSettings,
  CompositionControls,
  MasterSettings,
  MixerSettings,
  NoteEvent,
  SectionControl,
  Song,
  SongPart,
  SoundFontAssignment,
} from "../engine/types.js";
import { dialects, shortName } from "../dialects/index.js";
import { auditionNote, TransportPlayer } from "../audio/player.js";
import { downloadMidi } from "../export/download.js";
import { downloadWav, downloadWavStems } from "../export/wav.js";
import { downloadMusicXml } from "../export/musicxml.js";
import { downloadSunoText } from "../export/text.js";
import { generateLyrics } from "../engine/lyrics.js";
import { DEFAULT_COMPOSITION, normalizeArrangement, normalizeComposition } from "../engine/controls.js";
import { SettingsPanel, type Settings } from "./SettingsPanel.js";
import { ScoreView } from "./ScoreView.js";
import { EditablePianoRoll } from "./EditablePianoRoll.js";
import { ProjectToolbar } from "./ProjectToolbar.js";
import { TransportBar, type TransportState } from "./TransportBar.js";
import { EditorToolbar } from "./EditorToolbar.js";
import {
  buildSong,
  resolveFullGenerationSectionControls,
  resolveFullGenerationSeed,
} from "./songBuilder.js";
import { ArrangementPanel, type MixerLevels } from "./ArrangementPanel.js";
import { StructureEditor } from "./StructureEditor.js";
import { HelpGuide } from "./HelpGuide.js";
import { ProjectManager } from "./ProjectManager.js";
import { SoundFontLibrary } from "./SoundFontLibrary.js";
import { CompositionDesignDialog } from "./CompositionDesignDialog.js";
import { validateSoundFontAssignments } from "../audio/soundfonts.js";
import {
  addNote,
  analyzeControlChange,
  applyControlChanges,
  copySelectedNotes,
  deleteChord,
  deleteNote,
  deleteSelectedNotes,
  duplicateSelectedNotes,
  insertChord,
  pasteNotes,
  quantizeSelectedNotes,
  quantizeNote,
  regenerateWorkspace,
  regenerateCompositionParts,
  replaceChord,
  setSelectedNoteVelocity,
  transposeSelectedChords,
  transposeSelectedNotes,
  updateChordTiming,
  updateNote,
  updateSelectedNotes,
  type ChordRefreshPart,
  type ChordSelection,
  type ClipboardNote,
  type NoteSelection,
  type RegenerationTarget,
} from "./editor.js";
import {
  applyAudioSettings,
  cloneWorkspace,
  createId,
  createProject,
  createProjectSnapshot,
  downloadProject,
  emptyLocks,
  isChordLocked,
  isNoteLocked,
  toggleChordLock,
  isBarLocked,
  isSectionLocked,
  listRecentProjects,
  loadLatestProject,
  loadProject,
  lockBar,
  readProjectFile,
  saveProject,
  toggleSectionLock,
  toggleNoteLock,
  normalizeWorkspace,
  ProjectStorageError,
  type LockPart,
  type ProjectDocument,
  type RecentProject,
  type Variation,
  type WorkspaceState,
} from "./project.js";

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

const SECTION_TOKENS = { intro: "i", verse: "v", chorus: "c", bridge: "b", outro: "o" } as const;
const ONBOARDING_KEY = "melodialect.onboarding.v0.8";

function emptyLevels(): MixerLevels {
  const zero = () => ({ peak: 0, rms: 0 });
  return {
    master: zero(),
    parts: {
      melody: zero(), piano: zero(), guitar: zero(), bass: zero(), drums: zero(),
    },
    clipping: false,
  };
}

function defaultSettings(): Settings {
  const dialect = dialects.chromatic!;
  return {
    dialectId: dialect.id,
    keyName: dialect.defaults.key,
    mode: dialect.defaults.mode,
    bpm: dialect.defaults.bpm,
    seed: 42,
    meterName: "4/4",
    form: "v,c,v,c",
    sectionDialects: ["", "", "", ""],
    ending: "final",
  };
}

function defaultWorkspace(): WorkspaceState {
  const settings = defaultSettings();
  return normalizeWorkspace({
    settings,
    song: buildSong(settings),
    locks: emptyLocks(),
    sectionSeeds: [],
  });
}

function initialProject(): ProjectDocument {
  return loadLatestProject() ?? createProject("新しい曲", defaultWorkspace());
}

function noteBar(song: Song, selection: NoteSelection): number | null {
  const note = song.sections[selection.sectionIndex]?.[selection.part][selection.noteIndex];
  return note ? Math.floor(note.start / song.meter.barBeats) : null;
}

function selectionPart(selection: NoteSelection | null): LockPart {
  return selection?.part === "melody" ? "melody" : "accompaniment";
}

export function ComposerApp() {
  const [project, setProject] = useState<ProjectDocument>(initialProject);
  const [recents, setRecents] = useState<RecentProject[]>(listRecentProjects);
  const [playing, setPlaying] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState(0);
  const [noteSelections, setNoteSelections] = useState<NoteSelection[]>([]);
  const [chordSelections, setChordSelections] = useState<ChordSelection[]>([]);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [view, setView] = useState<"roll" | "score">("roll");
  const [showLyrics, setShowLyrics] = useState(false);
  const [renderingWav, setRenderingWav] = useState(false);
  const [renderingStems, setRenderingStems] = useState(false);
  const [status, setStatus] = useState("自動保存");
  const [fullGenerationFeedback, setFullGenerationFeedback] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [parameterHeight, setParameterHeight] = useState<number | null>(null);
  const [viewHeight, setViewHeight] = useState<number | null>(null);
  const [showProjects, setShowProjects] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSoundFonts, setShowSoundFonts] = useState(false);
  const [showCompositionDesign, setShowCompositionDesign] = useState(false);
  const [soundFontIssues, setSoundFontIssues] = useState<string[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem(ONBOARDING_KEY) !== "done");
  const [comparisonBefore, setComparisonBefore] = useState<WorkspaceState | null>(null);
  const [comparisonSide, setComparisonSide] = useState<"before" | "after">("after");
  const [grid, setGrid] = useState(0.25);
  const [levels, setLevels] = useState<MixerLevels>(emptyLevels);
  const [refreshParts, setRefreshParts] = useState<ChordRefreshPart[]>(["piano", "guitar", "bass", "drums"]);
  const [transport, setTransport] = useState<TransportState>(() => ({
    positionBeat: 0,
    loopRange: false,
    rangeStartBar: 0,
    rangeEndBar: initialProject().workspace.song.totalBars,
    metronome: false,
    countIn: false,
  }));

  const workspace = project.workspace;
  const { settings, song } = workspace;
  const [draftArrangement, setDraftArrangement] = useState<ArrangementSettings>(() => workspace.arrangement!);
  const [draftComposition, setDraftComposition] = useState<CompositionControls>(() => workspace.composition!);
  const noteSelection = noteSelections[0] ?? null;
  const chordSelection = chordSelections[0] ?? null;
  const setNoteSelection = useCallback((selection: NoteSelection | null) =>
    setNoteSelections(selection ? [selection] : []), []);
  const setChordSelection = useCallback((selection: ChordSelection | null) =>
    setChordSelections(selection ? [selection] : []), []);
  const clipboardRef = useRef<ClipboardNote[]>([]);
  const audioGestureRef = useRef<WorkspaceState | null>(null);
  const playerRef = useRef<TransportPlayer | null>(null);
  if (playerRef.current === null) playerRef.current = new TransportPlayer();
  const player = playerRef.current;
  const pastRef = useRef<WorkspaceState[]>([]);
  const futureRef = useRef<WorkspaceState[]>([]);
  const fullGenerationFeedbackTimerRef = useRef<number | null>(null);
  const showFullGenerationFeedback = useCallback((message: string) => {
    if (fullGenerationFeedbackTimerRef.current !== null) {
      window.clearTimeout(fullGenerationFeedbackTimerRef.current);
    }
    setFullGenerationFeedback(message);
    fullGenerationFeedbackTimerRef.current = window.setTimeout(() => {
      setFullGenerationFeedback(null);
      fullGenerationFeedbackTimerRef.current = null;
    }, 1_800);
  }, []);
  useEffect(() => () => {
    if (fullGenerationFeedbackTimerRef.current !== null) {
      window.clearTimeout(fullGenerationFeedbackTimerRef.current);
    }
  }, []);
  const parameterDirty = JSON.stringify(draftArrangement) !== JSON.stringify(workspace.arrangement) ||
    JSON.stringify(draftComposition) !== JSON.stringify(workspace.composition);

  useEffect(() => {
    let cancelled = false;
    const refreshIssues = () => {
      void validateSoundFontAssignments(workspace.mixer!).then((issues) => {
        if (!cancelled) setSoundFontIssues(issues);
      }).catch(() => {
        if (!cancelled) setSoundFontIssues(["音源ライブラリの状態を確認できませんでした"]);
      });
    };
    refreshIssues();
    window.addEventListener("melodialect:soundfonts-changed", refreshIssues);
    return () => {
      cancelled = true;
      window.removeEventListener("melodialect:soundfonts-changed", refreshIssues);
    };
  }, [workspace.mixer]);

  const onSplitterDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewArea = event.currentTarget.previousElementSibling;
    if (!(viewArea instanceof HTMLElement)) return;
    const startY = event.clientY;
    const startHeight = viewArea.getBoundingClientRect().height;
    const splitterBottom = event.currentTarget.getBoundingClientRect().bottom;
    const mainBottom =
      event.currentTarget.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
    const maximum = Math.max(120, startHeight + mainBottom - splitterBottom - 44);
    const move = (moveEvent: PointerEvent) => {
      const next = startHeight + moveEvent.clientY - startY;
      setViewHeight(Math.min(Math.max(next, 120), maximum));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, []);

  const onParameterSplitterDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const parameterArea = event.currentTarget.previousElementSibling;
    if (!(parameterArea instanceof HTMLElement)) return;
    const startY = event.clientY;
    const startHeight = parameterArea.getBoundingClientRect().height;
    const splitterBottom = event.currentTarget.getBoundingClientRect().bottom;
    const mainBottom =
      event.currentTarget.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
    // Reserve space for the editor view, its lower splitter, and the annotation header.
    const maximum = Math.max(80, startHeight + mainBottom - splitterBottom - 205);
    const move = (moveEvent: PointerEvent) => {
      const next = startHeight + moveEvent.clientY - startY;
      setParameterHeight(Math.min(Math.max(next, 80), maximum));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, []);

  const stopPlayback = useCallback((reset = false) => {
    player.stop();
    setPlaying(false);
    setPlayheadBeat(null);
    setLevels(emptyLevels());
    if (reset) setTransport((current) => ({ ...current, positionBeat: 0 }));
  }, [player]);

  const commitWorkspace = useCallback((
    next: WorkspaceState,
    options: { history?: boolean; seedHistory?: boolean; preserveComparison?: boolean } = {},
  ) => {
    stopPlayback(false);
    if (options.history !== false) {
      pastRef.current.push(cloneWorkspace(project.workspace));
      if (pastRef.current.length > 80) pastRef.current.shift();
      futureRef.current = [];
      setHistoryTick((value) => value + 1);
    }
    setProject((current) => ({
      ...current,
      workspace: cloneWorkspace(next),
      seedHistory: options.seedHistory
        ? Array.from(new Set([next.settings.seed, ...current.seedHistory])).slice(0, 40)
        : current.seedHistory,
    }));
    if (!options.preserveComparison) {
      setComparisonBefore(null);
      setComparisonSide("after");
    }
  }, [project.workspace, stopPlayback]);

  const resetEditorState = useCallback((nextSong: Song) => {
    stopPlayback(true);
    pastRef.current = [];
    futureRef.current = [];
    setHistoryTick((value) => value + 1);
    setSelectedSection(0);
    setNoteSelection(null);
    setChordSelection(null);
    setComparisonBefore(null);
    setComparisonSide("after");
    setTransport((current) => ({
      ...current,
      positionBeat: 0,
      rangeStartBar: 0,
      rangeEndBar: nextSong.totalBars,
    }));
  }, [stopPlayback]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        saveProject(project);
        setRecents(listRecentProjects());
        setStatus("保存済み");
      } catch (error) {
        setStatus(error instanceof ProjectStorageError ? error.message : "自動保存に失敗しました");
      }
    }, 450);
    setStatus("保存中…");
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const position = player.positionBeats;
      if (position !== null) {
        setPlayheadBeat(position);
        setTransport((current) => ({ ...current, positionBeat: position }));
      }
      setLevels(player.levels);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);

  useEffect(() => () => player.stop(), [player]);

  const startPlayback = useCallback(async (targetSong: Song, startBeat?: number) => {
    const bb = targetSong.meter.barBeats;
    const rangeStart = transport.rangeStartBar * bb;
    const rangeEnd = transport.rangeEndBar * bb;
    const requested = startBeat ?? transport.positionBeat;
    const atSongEnd = requested >= targetSong.totalBars * bb - 1e-9;
    const outsideLoop = requested < rangeStart || requested >= rangeEnd;
    const requestedStart = atSongEnd
      ? transport.loopRange ? rangeStart : 0
      : transport.loopRange && outsideLoop ? rangeStart : requested;
    setStatus("音源を読み込み中…");
    await player.play(
      targetSong,
      () => {
        setPlaying(false);
        setPlayheadBeat(null);
        setLevels(emptyLevels());
        setTransport((current) => ({ ...current, positionBeat: 0 }));
      },
      {
        startBeat: requestedStart,
        endBeat: transport.loopRange ? rangeEnd : undefined,
        loopStartBeat: transport.loopRange ? rangeStart : 0,
        loop: transport.loopRange || targetSong.ending === "loop",
        metronome: transport.metronome,
        countInBars: transport.countIn ? 1 : 0,
        onSoundFontFallback: (fallbacks) =>
          setStatus(`音源フォールバック: ${fallbacks.map((item) => item.part).join(", ")}（再取込または標準音源を確認）`),
      },
    );
    if (player.isPlaying) {
      setPlaying(true);
      setStatus("再生中");
    }
  }, [player, transport]);

  const playPause = useCallback(() => {
    if (player.isPlaying) {
      const position = player.positionBeats;
      player.stop();
      setPlaying(false);
      setPlayheadBeat(null);
      if (position !== null) {
        setTransport((current) => ({ ...current, positionBeat: position }));
      }
      return;
    }
    const targetSong = comparisonSide === "before" && comparisonBefore
      ? comparisonBefore.song
      : song;
    void startPlayback(targetSong);
  }, [player, song, comparisonSide, comparisonBefore, startPlayback]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(cloneWorkspace(project.workspace));
    setProject((current) => ({ ...current, workspace: previous }));
    setHistoryTick((value) => value + 1);
    setNoteSelection(null);
    setChordSelection(null);
    stopPlayback(false);
  }, [project.workspace, stopPlayback]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneWorkspace(project.workspace));
    setProject((current) => ({ ...current, workspace: next }));
    setHistoryTick((value) => value + 1);
    setNoteSelection(null);
    setChordSelection(null);
    stopPlayback(false);
  }, [project.workspace, stopPlayback]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, select, textarea");
      if (typing) return;
      if (event.code === "Space") {
        event.preventDefault();
        playPause();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && noteSelection) {
        event.preventDefault();
        commitWorkspace(deleteNote(workspace, noteSelection));
        setNoteSelection(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playPause, undo, redo, noteSelection, commitWorkspace, workspace]);

  const annotationRows = useMemo(
    () => song.sections.flatMap((section, sectionIndex) =>
      section.annotations.map((annotation, noteIndex) => ({
        key: String(sectionIndex) + "-" + String(noteIndex),
        section: SECTION_LABELS[section.plan.type] ?? section.plan.type,
        bar: section.startBar + annotation.bar + 1,
        ruleId: annotation.ruleId,
        text: annotation.text,
      }))),
    [song],
  );
  const lyrics = useMemo(() => generateLyrics(song), [song]);

  const addVariationSnapshot = useCallback((
    current: ProjectDocument,
    snapshot: WorkspaceState,
    name: string,
  ): Variation[] => {
    const variation: Variation = {
      id: createId(),
      name,
      createdAt: new Date().toISOString(),
      favorite: false,
      workspace: cloneWorkspace(snapshot),
    };
    return [variation, ...current.variations].slice(0, 24);
  }, []);

  const generateFullSong = useCallback(() => {
    try {
      const seed = resolveFullGenerationSeed(settings.seed, song.seed);
      const generationSettings = seed === settings.seed ? settings : { ...settings, seed };
      const composition = {
        ...draftComposition,
        mode: generationSettings.mode ?? draftComposition.mode,
      };
      const arrangement = draftArrangement;
      const sectionControls = resolveFullGenerationSectionControls(
        generationSettings,
        workspace.sectionControls,
        song.bpm,
      );
      const generated = buildSong(generationSettings, {
        arrangement, composition, mixer: workspace.mixer, sectionControls, design: workspace.design,
      });
      generated.lyrics = workspace.song.lyrics ? structuredClone(workspace.song.lyrics) : undefined;
      const next = normalizeWorkspace({
        ...cloneWorkspace(workspace),
        settings: generationSettings,
        arrangement,
        composition,
        song: generated,
        sectionControls,
        locks: emptyLocks(),
        sectionSeeds: [],
      });
      let snapshotWarning: string | null = null;
      try {
        createProjectSnapshot(project, "全体生成前");
      } catch (error) {
        snapshotWarning = error instanceof Error
          ? error.message
          : "生成前スナップショットを保存できませんでした";
      }
      setProject((current) => ({
        ...current,
        variations: addVariationSnapshot(
          current,
          workspace,
          "生成 " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
        ),
      }));
      commitWorkspace(next, { seedHistory: true });
      setDraftArrangement(next.arrangement!);
      setDraftComposition(next.composition!);
      setSelectedSection(0);
      setNoteSelection(null);
      setChordSelection(null);
      setTransport((current) => ({ ...current, positionBeat: 0, rangeEndBar: generated.totalBars }));
      const dialect = dialects[generationSettings.dialectId];
      showFullGenerationFeedback(`✓ ${dialect ? shortName(dialect) : "全体"} 生成済み`);
      if (snapshotWarning) setStatus(`全体生成済み（${snapshotWarning}）`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "全体生成に失敗しました");
      showFullGenerationFeedback("! 生成失敗");
    }
  }, [
    settings,
    song.seed,
    workspace,
    draftArrangement,
    draftComposition,
    project,
    addVariationSnapshot,
    commitWorkspace,
    showFullGenerationFeedback,
  ]);

  const createVariation = useCallback(() => {
    const nextSeed = Math.floor(Math.random() * 1_000_000);
    const nextSettings = { ...settings, seed: nextSeed };
    const composition = { ...workspace.composition!, mode: nextSettings.mode ?? workspace.composition!.mode };
    const nextWorkspace = normalizeWorkspace({
      settings: nextSettings,
      song: buildSong(nextSettings, {
        arrangement: workspace.arrangement, composition, mixer: workspace.mixer,
        sectionControls: workspace.sectionControls, design: workspace.design,
      }),
      locks: emptyLocks(),
      sectionSeeds: [],
      arrangement: workspace.arrangement, mixer: workspace.mixer, composition,
      sectionControls: workspace.sectionControls,
      design: workspace.design,
    });
    nextWorkspace.song.lyrics = workspace.song.lyrics
      ? structuredClone(workspace.song.lyrics)
      : undefined;
    setProject((current) => ({
      ...current,
      variations: [
        {
          id: createId(),
          name: "候補 seed " + String(nextSeed),
          createdAt: new Date().toISOString(),
          favorite: false,
          workspace: cloneWorkspace(nextWorkspace),
        },
        ...addVariationSnapshot(current, workspace, "候補 seed " + String(settings.seed)),
      ].slice(0, 24),
      seedHistory: Array.from(new Set([nextSeed, ...current.seedHistory])).slice(0, 40),
    }));
    commitWorkspace(nextWorkspace);
    setDraftArrangement(nextWorkspace.arrangement!);
    setDraftComposition(nextWorkspace.composition!);
    resetEditorState(nextWorkspace.song);
  }, [settings, workspace, addVariationSnapshot, commitWorkspace, resetEditorState]);

  const rebuildControlledSong = useCallback((values: {
    arrangement?: ArrangementSettings;
    composition?: CompositionControls;
    sectionControls?: SectionControl[];
  }) => {
    const next = cloneWorkspace(workspace);
    const arrangement = values.arrangement ?? next.arrangement!;
    const composition = values.composition ?? next.composition!;
    const sectionControls = values.sectionControls ?? next.sectionControls!;
    const nextSettings = values.sectionControls
      ? {
          ...next.settings,
          form: sectionControls.map((section) => SECTION_TOKENS[section.type]).join(","),
          sectionDialects: sectionControls.map((section) => section.dialectId),
        }
      : next.settings;
    const song = buildSong(nextSettings, {
      arrangement, composition, mixer: next.mixer, sectionControls,
      design: values.sectionControls ? undefined : next.design,
    });
    song.lyrics = next.song.lyrics ? structuredClone(next.song.lyrics) : undefined;
    song.mixer = next.mixer;
    const normalized = normalizeWorkspace({
      ...next, settings: nextSettings, song, arrangement, composition, sectionControls,
      locks: values.sectionControls ? emptyLocks() : next.locks,
      sectionSeeds: values.sectionControls ? [] : next.sectionSeeds,
    });
    commitWorkspace(normalized);
    setTransport((current) => ({
      ...current,
      positionBeat: 0,
      rangeStartBar: 0,
      rangeEndBar: normalized.song.totalBars,
    }));
  }, [workspace, commitWorkspace]);

  const commitAudioSettings = useCallback((values: {
    mixer?: MixerSettings;
    master?: MasterSettings;
  }, commit = false) => {
    const next = applyAudioSettings(workspace, values);
    if (!commit && !audioGestureRef.current) audioGestureRef.current = cloneWorkspace(workspace);
    if (commit && audioGestureRef.current) {
      pastRef.current.push(audioGestureRef.current);
      if (pastRef.current.length > 80) pastRef.current.shift();
      futureRef.current = [];
      audioGestureRef.current = null;
      setHistoryTick((value) => value + 1);
      commitWorkspace(next, { history: false });
    } else {
      commitWorkspace(next, { history: commit });
    }
  }, [workspace, commitWorkspace]);

  const applyParameterDraft = useCallback(() => {
    const impact = analyzeControlChange(workspace, draftArrangement, draftComposition);
    if (!impact.arrangementChanged && !impact.compositionChanged) return;
    try {
      createProjectSnapshot(project, "パラメーター適用前");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "適用前スナップショットを保存できませんでした");
      return;
    }
    const before = cloneWorkspace(workspace);
    const next = applyControlChanges(workspace, draftArrangement, draftComposition);
    setComparisonBefore(before);
    setComparisonSide("after");
    commitWorkspace(next, { preserveComparison: true });
    setStatus(impact.message);
  }, [workspace, draftArrangement, draftComposition, project, commitWorkspace]);

  const resetParameterDraft = useCallback(() => {
    const dialect = dialects[settings.dialectId];
    setDraftArrangement(normalizeArrangement(dialect?.defaults.arrangement));
    setDraftComposition(normalizeComposition({
      ...DEFAULT_COMPOSITION,
      mode: dialect?.defaults.mode ?? settings.mode ?? "major",
    }, settings.mode));
  }, [settings]);

  const toggleComparison = useCallback(() => {
    if (!comparisonBefore) return;
    const position = player.positionBeats ?? transport.positionBeat;
    const wasPlaying = player.isPlaying;
    stopPlayback(false);
    setTransport((current) => ({ ...current, positionBeat: position }));
    const side = comparisonSide === "after" ? "before" : "after";
    setComparisonSide(side);
    if (wasPlaying) {
      const target = side === "before" ? comparisonBefore.song : workspace.song;
      void startPlayback(target, position);
    }
  }, [comparisonBefore, comparisonSide, player, transport.positionBeat, stopPlayback, workspace.song, startPlayback]);

  const updateStructure = useCallback((sections: SectionControl[]) => {
    const protectedCount = workspace.locks.sections.length + workspace.locks.bars.length +
      (workspace.locks.notes?.length ?? 0) + (workspace.locks.chords?.length ?? 0);
    if (protectedCount > 0 && !window.confirm(
      `構成変更ではセクション対応が変わるため、ロック済み・手動編集済み ${protectedCount}件を維持できません。適用前状態は保存世代へ退避します。続けますか？`,
    )) return;
    try {
      createProjectSnapshot(project, "構成変更前");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "構成変更前の保存に失敗しました");
      return;
    }
    rebuildControlledSong({ sectionControls: sections });
    setNoteSelection(null);
    setChordSelection(null);
    setSelectedSection((index) => Math.min(index, sections.length - 1));
  }, [workspace.locks, project, rebuildControlledSong]);

  const reorderStructure = useCallback((from: number, to: number) => {
    if (from === to || !workspace.sectionControls?.[from] || !workspace.sectionControls?.[to]) return;
    const next = [...workspace.sectionControls];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    updateStructure(next);
    setSelectedSection(to);
  }, [workspace.sectionControls, updateStructure]);

  const selectedNoteBar = noteSelection ? noteBar(song, noteSelection) : null;
  const selectedChordBar = chordSelection
    ? song.sections[chordSelection.sectionIndex]?.chords[chordSelection.chordIndex]?.bar ?? null
    : null;
  const selectedPart: LockPart = chordSelection ? "chords" : selectionPart(noteSelection);
  const selectionBar = chordSelection ? selectedChordBar : selectedNoteBar;
  const selectionSection = chordSelection?.sectionIndex ?? noteSelection?.sectionIndex ?? selectedSection;
  const selectionLocked = selectionBar !== null &&
    isBarLocked(workspace.locks, selectionSection, selectedPart, selectionBar);

  const selectedNote = noteSelection
    ? song.sections[noteSelection.sectionIndex]?.[noteSelection.part][noteSelection.noteIndex]
    : undefined;
  const selectedChord = chordSelection
    ? song.sections[chordSelection.sectionIndex]?.chords[chordSelection.chordIndex]
    : undefined;
  const entityLocked = selectedNote && noteSelection
    ? isNoteLocked(workspace.locks, noteSelection.sectionIndex, noteSelection.part, selectedNote)
    : Boolean(selectedChord && chordSelection &&
        isChordLocked(workspace.locks, chordSelection.sectionIndex, selectedChord));
  const commitManualEdit = useCallback((
    next: WorkspaceState,
    sectionIndex: number,
    part: LockPart,
    bar: number,
  ) => {
    next.locks = lockBar(next.locks, sectionIndex, part, bar, true);
    commitWorkspace(next);
  }, [commitWorkspace]);

  const editNote = useCallback((selection: NoteSelection, patch: Partial<NoteEvent>) => {
    const bar = noteBar(song, selection);
    if (bar === null) return;
    const next = updateNote(workspace, selection, patch);
    commitManualEdit(next, selection.sectionIndex, selectionPart(selection), bar);
    setNoteSelection(null);
  }, [song, workspace, commitManualEdit]);

  const commitSelectedEdit = useCallback((
    next: WorkspaceState,
    selections: NoteSelection[],
    options: { history?: boolean } = {},
  ) => {
    for (const selection of selections) {
      const note = workspace.song.sections[selection.sectionIndex]?.[selection.part][selection.noteIndex];
      if (!note) continue;
      const bar = Math.floor(note.start / workspace.song.meter.barBeats);
      next.locks = lockBar(next.locks, selection.sectionIndex, selectionPart(selection), bar, true);
    }
    commitWorkspace(next, { history: options.history });
  }, [workspace, commitWorkspace]);

  const handlePianoCommand = useCallback((command: import("./EditablePianoRoll.js").PianoRollCommand) => {
    if (command === "copy") {
      clipboardRef.current = copySelectedNotes(song, noteSelections);
      setStatus(`${clipboardRef.current.length}ノートをコピーしました`);
      return;
    }
    if (command === "cut") {
      clipboardRef.current = copySelectedNotes(song, noteSelections);
      if (noteSelections.length) commitSelectedEdit(deleteSelectedNotes(workspace, noteSelections), noteSelections);
      setNoteSelections([]);
      return;
    }
    if (command === "paste") {
      if (!clipboardRef.current.length) return;
      commitWorkspace(pasteNotes(workspace, clipboardRef.current, transport.positionBeat));
      return;
    }
    if (command === "duplicate") {
      if (!noteSelections.length) return;
      commitSelectedEdit(duplicateSelectedNotes(workspace, noteSelections, grid), noteSelections);
      return;
    }
    if (command === "quantize") {
      if (!noteSelections.length) return;
      commitSelectedEdit(quantizeSelectedNotes(workspace, noteSelections, grid), noteSelections);
      setNoteSelections([]);
      return;
    }
    if (command === "delete" && noteSelections.length) {
      commitSelectedEdit(deleteSelectedNotes(workspace, noteSelections), noteSelections);
      setNoteSelections([]);
    }
  }, [song, noteSelections, workspace, transport.positionBeat, grid, commitWorkspace, commitSelectedEdit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea")) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && ["c", "x", "v", "d"].includes(key)) {
        event.preventDefault();
        handlePianoCommand(({ c: "copy", x: "cut", v: "paste", d: "duplicate" } as const)[key as "c" | "x" | "v" | "d"]);
      } else if (key === "q" && noteSelections.length) {
        event.preventDefault();
        handlePianoCommand("quantize");
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && noteSelections.length) {
        event.preventDefault();
        const semitones = (event.shiftKey ? 12 : 1) * (event.key === "ArrowUp" ? 1 : -1);
        commitSelectedEdit(transposeSelectedNotes(workspace, noteSelections, semitones), noteSelections);
        auditionNote((selectedNote?.pitch ?? 60) + semitones);
        setNoteSelections([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePianoCommand, noteSelections, workspace, commitSelectedEdit, selectedNote?.pitch]);

  const saveWav = useCallback(async () => {
    setRenderingWav(true);
    try {
      await downloadWav(song, (progress, message) =>
        setStatus(`WAV ${Math.round(progress * 100)}%: ${message}`));
      setStatus("WAV書き出し完了");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "WAV書き出しに失敗しました");
    } finally {
      setRenderingWav(false);
    }
  }, [song]);

  const openProject = useCallback((id: string) => {
    const loaded = loadProject(id);
    if (!loaded) {
      setStatus("プロジェクトを読み込めませんでした");
      return;
    }
    setProject(loaded);
    setDraftArrangement(loaded.workspace.arrangement!);
    setDraftComposition(loaded.workspace.composition!);
    resetEditorState(loaded.workspace.song);
  }, [resetEditorState]);

  const openProjectDocument = useCallback((loaded: ProjectDocument) => {
    setProject(loaded);
    setDraftArrangement(loaded.workspace.arrangement!);
    setDraftComposition(loaded.workspace.composition!);
    resetEditorState(loaded.workspace.song);
    setShowProjects(false);
  }, [resetEditorState]);

  return (
    <div className="app">
      <header className="header">
        <h1>Melodialect</h1>
        <div className="view-toggle">
          <button className={view === "roll" ? "active" : ""} onClick={() => setView("roll")}>
            ピアノロール
          </button>
          <button className={view === "score" ? "active" : ""} onClick={() => setView("score")}>
            譜面
          </button>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowHelp(true)}>使い方</button>
          <button onClick={() => setShowCompositionDesign(true)}>作曲設計 v0.9</button>
          <button onClick={() => setShowProjects(true)}>プロジェクト一覧</button>
          <button disabled={pastRef.current.length === 0} onClick={undo}>↶ Undo</button>
          <button disabled={futureRef.current.length === 0} onClick={redo}>↷ Redo</button>
          <button type="button" className="primary" onClick={generateFullSong}>
            {fullGenerationFeedback ?? "♪ 全体生成"}
          </button>
          <button onClick={() => downloadMidi(song)}>MIDI</button>
          <button onClick={saveWav} disabled={renderingWav}>
            {renderingWav ? "書出中…" : "WAV"}
          </button>
          <button
            disabled={renderingStems}
            onClick={() => {
              setRenderingStems(true);
              void downloadWavStems(song, (progress, part) =>
                setStatus(`WAVステム ${part}: ${Math.round(progress * 100)}%`))
                .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "ステム書出しに失敗しました"))
                .finally(() => setRenderingStems(false));
            }}
          >{renderingStems ? "ステム書出中…" : "WAVステム"}</button>
          <button onClick={() => downloadMusicXml(song)}>MusicXML</button>
          <button onClick={() => downloadSunoText(song, dialects[settings.dialectId])}>テキスト</button>
        </div>
      </header>

      <ProjectToolbar
        title={project.title}
        recents={recents}
        variations={project.variations}
        onTitleChange={(title) => setProject((current) => ({ ...current, title }))}
        onNew={() => {
          const created = createProject("新しい曲", defaultWorkspace());
          setProject(created);
          setDraftArrangement(created.workspace.arrangement!);
          setDraftComposition(created.workspace.composition!);
          resetEditorState(created.workspace.song);
        }}
        onSave={() => {
          saveProject(project);
          setRecents(listRecentProjects());
          setStatus("保存済み");
        }}
        onOpen={openProject}
        onExport={() => downloadProject(project)}
        onImport={(file) => {
          void readProjectFile(file)
            .then((loaded) => {
              const imported = { ...loaded, id: createId(), title: loaded.title + " (読込)" };
              setProject(imported);
              setDraftArrangement(imported.workspace.arrangement!);
              setDraftComposition(imported.workspace.composition!);
              resetEditorState(imported.workspace.song);
            })
            .catch((error: unknown) =>
              setStatus(error instanceof Error ? error.message : "読み込みに失敗しました"));
        }}
        onCreateVariation={createVariation}
        onLoadVariation={(id) => {
          const variation = project.variations.find((item) => item.id === id);
          if (variation) commitWorkspace(cloneWorkspace(variation.workspace));
        }}
        onToggleFavorite={(id) =>
          setProject((current) => ({
            ...current,
            variations: current.variations.map((variation) =>
              variation.id === id ? { ...variation, favorite: !variation.favorite } : variation),
          }))
        }
      />

      <TransportBar
        transport={transport}
        playing={playing}
        totalBars={song.totalBars}
        barBeats={song.meter.barBeats}
        onChange={(next) => {
          if (next.positionBeat !== transport.positionBeat && playing) stopPlayback(false);
          setTransport(next);
        }}
        onPlayPause={playPause}
        onStop={() => stopPlayback(true)}
      />

      <StructureEditor
        sections={workspace.sectionControls!}
        selectedIndex={selectedSection}
        onSelect={setSelectedSection}
        onChange={updateStructure}
      />

      <div className="body">
        <SettingsPanel
          settings={settings}
          onChange={(nextSettings) => {
            const next = cloneWorkspace(workspace);
            next.settings = nextSettings;
            const endingChanged = next.song.ending !== nextSettings.ending;
            next.song.ending = nextSettings.ending;
            if (nextSettings.dialectId !== settings.dialectId) {
              const dialect = dialects[nextSettings.dialectId];
              if (dialect) {
                setDraftArrangement(normalizeArrangement(dialect.defaults.arrangement));
                setDraftComposition({
                  ...draftComposition,
                  mode: dialect.defaults.mode,
                });
              }
            }
            if (endingChanged && playing) stopPlayback(false);
            commitWorkspace(next, { history: false });
          }}
        />

        <main className="main">
          <EditorToolbar
            song={song}
            sectionIndex={selectedSection}
            noteSelections={noteSelections}
            chordSelections={chordSelections}
            sectionLocked={isSectionLocked(workspace.locks, selectedSection)}
            selectionLocked={selectionLocked}
            entityLocked={entityLocked}
            refreshParts={refreshParts}
            onRefreshPartsChange={setRefreshParts}
            onRegenerate={(target: RegenerationTarget) =>
              commitWorkspace(regenerateWorkspace(workspace, selectedSection, target))}
            onToggleSectionLock={() =>
              commitWorkspace({
                ...cloneWorkspace(workspace),
                locks: toggleSectionLock(workspace.locks, selectedSection),
              })}
            onMoveNotes={(semitones) => {
              if (!noteSelections.length) return;
              commitSelectedEdit(
                transposeSelectedNotes(workspace, noteSelections, semitones),
                noteSelections,
              );
              auditionNote((selectedNote?.pitch ?? 60) + semitones);
              setNoteSelections([]);
            }}
            onQuantize={() => {
              if (!noteSelections.length) return;
              commitSelectedEdit(quantizeSelectedNotes(workspace, noteSelections, grid), noteSelections);
              setNoteSelections([]);
            }}
            onDeleteNotes={() => {
              if (!noteSelections.length) return;
              commitSelectedEdit(deleteSelectedNotes(workspace, noteSelections), noteSelections);
              setNoteSelections([]);
            }}
            onToggleSelectionLock={() => {
              if (selectionBar === null) return;
              commitWorkspace({
                ...cloneWorkspace(workspace),
                locks: lockBar(
                  workspace.locks,
                  selectionSection,
                  selectedPart,
                  selectionBar,
                  !selectionLocked,
                ),
              });
            }}
            onToggleEntityLock={() => {
              let locks = workspace.locks;
              if (selectedNote && noteSelection) {
                locks = toggleNoteLock(
                  locks,
                  noteSelection.sectionIndex,
                  noteSelection.part,
                  selectedNote,
                );
              } else if (selectedChord && chordSelection) {
                locks = toggleChordLock(
                  locks,
                  chordSelection.sectionIndex,
                  selectedChord,
                );
              } else {
                return;
              }
              commitWorkspace({ ...cloneWorkspace(workspace), locks });
            }}
            onReplaceChord={(symbol) => {
              if (!chordSelection || selectedChordBar === null) return;
              try {
                commitManualEdit(
                  replaceChord(workspace, chordSelection, symbol, refreshParts),
                  chordSelection.sectionIndex,
                  "chords",
                  selectedChordBar,
                );
                setChordSelection(null);
              } catch {
                setStatus("コードは I、vi、V7、IV△7、♭VII などで入力してください");
              }
            }}
            onInsertChord={(symbol) => {
              if (!chordSelection || selectedChordBar === null) return;
              try {
                commitManualEdit(
                  insertChord(workspace, chordSelection, symbol, refreshParts),
                  chordSelection.sectionIndex,
                  "chords",
                  selectedChordBar,
                );
                setChordSelection(null);
              } catch {
                setStatus("コード記号が正しくありません");
              }
            }}
            onDeleteChords={() => {
              if (!chordSelections.length) return;
              let next = workspace;
              const ordered = [...chordSelections].sort((a, b) =>
                b.sectionIndex - a.sectionIndex || b.chordIndex - a.chordIndex);
              for (const selection of ordered) next = deleteChord(next, selection, refreshParts);
              commitWorkspace(next);
              setChordSelections([]);
            }}
            onTransposeChords={(semitones) => {
              if (!chordSelections.length) return;
              commitWorkspace(transposeSelectedChords(workspace, chordSelections, semitones, refreshParts));
              setChordSelections([]);
            }}
          />

          <div
            className="parameter-area"
            style={parameterHeight === null ? undefined : { height: parameterHeight }}
          >
            <ArrangementPanel
              arrangement={draftArrangement}
              mixer={workspace.mixer!}
              master={workspace.master!}
              composition={draftComposition}
              dirty={parameterDirty}
              canCompare={Boolean(comparisonBefore)}
              comparisonSide={comparisonSide}
              levels={levels}
              onArrangementChange={setDraftArrangement}
              onCompositionChange={setDraftComposition}
              onMixerChange={(mixer, commit) => commitAudioSettings({ mixer }, commit)}
              onMasterChange={(master, commit) => commitAudioSettings({ master }, commit)}
              onMixerPresetLoad={(mixer, master) =>
                commitAudioSettings({ mixer, master }, true)}
              onApply={applyParameterDraft}
              onCancel={() => {
                setDraftArrangement(workspace.arrangement!);
                setDraftComposition(workspace.composition!);
              }}
              onReset={resetParameterDraft}
              onCompare={toggleComparison}
              onOpenSoundFonts={() => setShowSoundFonts(true)}
            />
          </div>

          <div
            className="splitter parameter-splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label="編集パネルとピアノロールの表示領域を調整"
            title="ドラッグして編集パネルの高さを調整（ダブルクリックで初期値）"
            onPointerDown={onParameterSplitterDown}
            onDoubleClick={() => setParameterHeight(null)}
          />

          <div
            className="view-area"
            style={viewHeight === null ? undefined : { flex: "0 0 auto", height: viewHeight }}
          >
            {view === "roll" ? (
              <EditablePianoRoll
                song={song}
                playheadBeat={playheadBeat}
                noteSelections={noteSelections}
                chordSelections={chordSelections}
                grid={grid}
                onGridChange={setGrid}
                onSelectNotes={(selections) => {
                  setNoteSelections(selections);
                  if (selections[0]) setSelectedSection(selections[0].sectionIndex);
                }}
                onSelectChords={(selections) => {
                  setChordSelections(selections);
                  if (selections[0]) setSelectedSection(selections[0].sectionIndex);
                }}
                onMoveNotes={(selections, deltaBeat, deltaPitch) => {
                  if (deltaBeat === 0 && deltaPitch === 0) return;
                  commitSelectedEdit(updateSelectedNotes(workspace, selections, (note) => ({
                    start: note.start + deltaBeat,
                    pitch: note.pitch + deltaPitch,
                  })), selections);
                  setNoteSelections([]);
                }}
                onResizeNotes={(selections, deltaDuration) => {
                  if (deltaDuration === 0) return;
                  commitSelectedEdit(updateSelectedNotes(workspace, selections, (note) => ({
                    duration: Math.max(grid, note.duration + deltaDuration),
                  })), selections);
                  setNoteSelections([]);
                }}
                onSetVelocity={(selections, velocity, commit) => {
                  const next = setSelectedNoteVelocity(workspace, selections, velocity);
                  commitSelectedEdit(next, selections, { history: commit });
                }}
                onEditChordTiming={(selection, patch) => {
                  const chord = song.sections[selection.sectionIndex]?.chords[selection.chordIndex];
                  if (!chord) return;
                  commitManualEdit(
                    updateChordTiming(workspace, selection, patch, grid, refreshParts),
                    selection.sectionIndex,
                    "chords",
                    chord.bar,
                  );
                  setChordSelections([]);
                }}
                onAddNote={(sectionIndex, part, note) => {
                  const bar = Math.floor(note.start / song.meter.barBeats);
                  const next = cloneWorkspace(workspace);
                  const section = next.song.sections[sectionIndex];
                  if (!section) return;
                  section[part].push(note);
                  section[part].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
                  commitManualEdit(next, sectionIndex, part === "melody" ? "melody" : "accompaniment", bar);
                }}
                onSeek={(beat) => {
                  stopPlayback(false);
                  setTransport((current) => ({ ...current, positionBeat: beat }));
                }}
                onCommand={handlePianoCommand}
                onAudition={auditionNote}
              />
            ) : (
              <>
                <label className="lyrics-toggle">
                  <input
                    type="checkbox"
                    checked={showLyrics}
                    onChange={(event) => setShowLyrics(event.target.checked)}
                  />
                  仮歌詞を表示
                </label>
                <ScoreView
                  song={song}
                  lyrics={showLyrics ? lyrics : undefined}
                  onSeek={(beat) => setTransport((current) => ({ ...current, positionBeat: beat }))}
                />
              </>
            )}
          </div>

          <div
            className="splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label={"\u8b5c\u9762\u3068\u751f\u6210\u6839\u62e0\u306e\u8868\u793a\u9818\u57df\u3092\u8abf\u6574"}
            title={"\u30c9\u30e9\u30c3\u30b0\u3057\u3066\u8868\u793a\u9818\u57df\u306e\u9ad8\u3055\u3092\u8abf\u6574"}
            onPointerDown={onSplitterDown}
          />

          <div className="annotations">
            <button className="link" onClick={() => setShowAnnotations((value) => !value)}>
              {showAnnotations ? "▼" : "▶"} 生成根拠の解説 ({annotationRows.length})
            </button>
            {showAnnotations && (
              <ul>
                {annotationRows.map((row) => (
                  <li key={row.key}>
                    <span className="annotation-loc">{row.section} / {row.bar} 小節目</span>
                    <span className={"annotation-tag tag-" + row.ruleId}>{row.ruleId}</span>
                    {row.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>

      <footer className="timeline">
        {song.sections.map((section, index) => {
          const dialect = dialects[section.dialectId];
          const guest = section.dialectId !== song.dialectId;
          const locked = isSectionLocked(workspace.locks, index);
          return (
            <button
              key={workspace.sectionControls?.[index]?.id ?? index}
              className={"timeline-block block-" + section.plan.type +
                (selectedSection === index ? " selected" : "")}
              style={{ flexGrow: section.plan.bars }}
              title="クリックで頭出し、ダブルクリックでこのセクションをループ"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                reorderStructure(Number(event.dataTransfer.getData("text/plain")), index);
              }}
              onClick={() => {
                setSelectedSection(index);
                setTransport((current) => ({
                  ...current,
                  positionBeat: section.startBar * song.meter.barBeats,
                }));
              }}
              onDoubleClick={() => {
                setSelectedSection(index);
                setTransport((current) => ({
                  ...current,
                  positionBeat: section.startBar * song.meter.barBeats,
                  loopRange: true,
                  rangeStartBar: section.startBar,
                  rangeEndBar: section.startBar + section.plan.bars,
                }));
              }}
            >
              {locked ? "🔒 " : ""}{SECTION_LABELS[section.plan.type] ?? section.plan.type}
              <small>
                {section.plan.bars} 小節{guest && dialect ? " · " + shortName(dialect) : ""}
              </small>
            </button>
          );
        })}
        <span className="save-status">{status} · 履歴 {project.seedHistory.join(", ")}</span>
      </footer>
      <span hidden>{historyTick}</span>
      {showProjects && (
        <ProjectManager
          currentId={project.id}
          onClose={() => setShowProjects(false)}
          onOpen={openProjectDocument}
          onProjectsChanged={() => setRecents(listRecentProjects())}
        />
      )}
      {showHelp && <HelpGuide onClose={() => setShowHelp(false)} />}
      {showOnboarding && (
        <HelpGuide
          onboarding
          onClose={() => {
            localStorage.setItem(ONBOARDING_KEY, "done");
            setShowOnboarding(false);
          }}
        />
      )}
      {showCompositionDesign && (
        <CompositionDesignDialog
          workspace={workspace}
          selectedSection={selectedSection}
          noteSelections={noteSelections}
          onClose={() => setShowCompositionDesign(false)}
          onCommit={(next, message, regenerate) => {
            const applied = regenerate ? regenerateCompositionParts(next, regenerate) : next;
            commitWorkspace(normalizeWorkspace(applied));
            setStatus(message);
          }}
        />
      )}
      {showSoundFonts && (
        <SoundFontLibrary
          issues={soundFontIssues}
          onClose={() => setShowSoundFonts(false)}
          onAssign={(part: SongPart, assignment: SoundFontAssignment) => {
            const mixer = structuredClone(workspace.mixer!);
            mixer[part].soundfont = assignment;
            commitAudioSettings({ mixer }, true);
          }}
        />
      )}
    </div>
  );
}
