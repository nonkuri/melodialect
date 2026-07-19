import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent, Song } from "../engine/types.js";
import { dialects, shortName } from "../dialects/index.js";
import { TransportPlayer } from "../audio/player.js";
import { downloadMidi } from "../export/download.js";
import { downloadWav } from "../export/wav.js";
import { downloadSunoText } from "../export/text.js";
import { generateLyrics } from "../engine/lyrics.js";
import { SettingsPanel, type Settings } from "./SettingsPanel.js";
import { ScoreView } from "./ScoreView.js";
import { EditablePianoRoll } from "./EditablePianoRoll.js";
import { ProjectToolbar } from "./ProjectToolbar.js";
import { TransportBar, type TransportState } from "./TransportBar.js";
import { EditorToolbar } from "./EditorToolbar.js";
import { buildSong } from "./songBuilder.js";
import {
  addNote,
  deleteChord,
  deleteNote,
  insertChord,
  quantizeNote,
  regenerateWorkspace,
  replaceChord,
  updateNote,
  type ChordSelection,
  type NoteSelection,
  type RegenerationTarget,
} from "./editor.js";
import {
  cloneWorkspace,
  createId,
  createProject,
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
  type LockPart,
  type ProjectDocument,
  type RecentProject,
  type Variation,
  type WorkspaceState,
} from "./project.js";

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

function defaultSettings(): Settings {
  const dialect = dialects.chromatic!;
  return {
    dialectId: dialect.id,
    keyName: dialect.defaults.key,
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
  return {
    settings,
    song: buildSong(settings),
    locks: emptyLocks(),
    sectionSeeds: [],
  };
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
  const [noteSelection, setNoteSelection] = useState<NoteSelection | null>(null);
  const [chordSelection, setChordSelection] = useState<ChordSelection | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [view, setView] = useState<"roll" | "score">("roll");
  const [showLyrics, setShowLyrics] = useState(false);
  const [renderingWav, setRenderingWav] = useState(false);
  const [status, setStatus] = useState("自動保存");
  const [historyTick, setHistoryTick] = useState(0);
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
  const playerRef = useRef<TransportPlayer | null>(null);
  if (playerRef.current === null) playerRef.current = new TransportPlayer();
  const player = playerRef.current;
  const pastRef = useRef<WorkspaceState[]>([]);
  const futureRef = useRef<WorkspaceState[]>([]);

  const stopPlayback = useCallback((reset = false) => {
    player.stop();
    setPlaying(false);
    setPlayheadBeat(null);
    if (reset) setTransport((current) => ({ ...current, positionBeat: 0 }));
  }, [player]);

  const commitWorkspace = useCallback((
    next: WorkspaceState,
    options: { history?: boolean; seedHistory?: boolean } = {},
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
  }, [project.workspace, stopPlayback]);

  const resetEditorState = useCallback((nextSong: Song) => {
    stopPlayback(true);
    pastRef.current = [];
    futureRef.current = [];
    setHistoryTick((value) => value + 1);
    setSelectedSection(0);
    setNoteSelection(null);
    setChordSelection(null);
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
      } catch {
        setStatus("自動保存に失敗");
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
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);

  useEffect(() => () => player.stop(), [player]);

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
    const bb = song.meter.barBeats;
    const rangeStart = transport.rangeStartBar * bb;
    const rangeEnd = transport.rangeEndBar * bb;
    const atSongEnd = transport.positionBeat >= song.totalBars * bb - 1e-9;
    const outsideLoop = transport.positionBeat < rangeStart ||
      transport.positionBeat >= rangeEnd;
    const requestedStart = atSongEnd
      ? transport.loopRange ? rangeStart : 0
      : transport.loopRange && outsideLoop ? rangeStart : transport.positionBeat;
    player.play(
      song,
      () => {
        setPlaying(false);
        setPlayheadBeat(null);
        setTransport((current) => ({ ...current, positionBeat: 0 }));
      },
      {
        startBeat: requestedStart,
        endBeat: transport.loopRange ? rangeEnd : undefined,
        loop: transport.loopRange || song.ending === "loop",
        metronome: transport.metronome,
        countInBars: transport.countIn ? 1 : 0,
      },
    );
    setPlaying(true);
  }, [player, song, transport]);

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
    const generated = buildSong(settings);
    const next = { ...cloneWorkspace(workspace), song: generated, locks: emptyLocks(), sectionSeeds: [] };
    setProject((current) => ({
      ...current,
      variations: addVariationSnapshot(
        current,
        workspace,
        "生成 " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
      ),
    }));
    commitWorkspace(next, { seedHistory: true });
    setSelectedSection(0);
    setNoteSelection(null);
    setChordSelection(null);
    setTransport((current) => ({ ...current, positionBeat: 0, rangeEndBar: generated.totalBars }));
  }, [settings, workspace, addVariationSnapshot, commitWorkspace]);

  const createVariation = useCallback(() => {
    const nextSeed = Math.floor(Math.random() * 1_000_000);
    const nextSettings = { ...settings, seed: nextSeed };
    const nextWorkspace: WorkspaceState = {
      settings: nextSettings,
      song: buildSong(nextSettings),
      locks: emptyLocks(),
      sectionSeeds: [],
    };
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
    resetEditorState(nextWorkspace.song);
  }, [settings, workspace, addVariationSnapshot, commitWorkspace, resetEditorState]);

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

  const saveWav = useCallback(async () => {
    setRenderingWav(true);
    try {
      await downloadWav(song);
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
    resetEditorState(loaded.workspace.song);
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
          <button disabled={pastRef.current.length === 0} onClick={undo}>↶ Undo</button>
          <button disabled={futureRef.current.length === 0} onClick={redo}>↷ Redo</button>
          <button className="primary" onClick={generateFullSong}>♪ 全体生成</button>
          <button onClick={() => downloadMidi(song)}>MIDI</button>
          <button onClick={saveWav} disabled={renderingWav}>
            {renderingWav ? "書出中…" : "WAV"}
          </button>
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

      <div className="body">
        <SettingsPanel
          settings={settings}
          onChange={(nextSettings) =>
            commitWorkspace({ ...cloneWorkspace(workspace), settings: nextSettings }, { history: false })}
        />

        <main className="main">
          <EditorToolbar
            song={song}
            sectionIndex={selectedSection}
            noteSelection={noteSelection}
            chordSelection={chordSelection}
            sectionLocked={isSectionLocked(workspace.locks, selectedSection)}
            selectionLocked={selectionLocked}
            entityLocked={entityLocked}
            onRegenerate={(target: RegenerationTarget) =>
              commitWorkspace(regenerateWorkspace(workspace, selectedSection, target))}
            onToggleSectionLock={() =>
              commitWorkspace({
                ...cloneWorkspace(workspace),
                locks: toggleSectionLock(workspace.locks, selectedSection),
              })}
            onMoveNote={(semitones) => {
              if (!noteSelection) return;
              const note = song.sections[noteSelection.sectionIndex]?.[noteSelection.part][noteSelection.noteIndex];
              if (note) editNote(noteSelection, { pitch: note.pitch + semitones });
            }}
            onQuantize={() => {
              if (!noteSelection) return;
              const bar = noteBar(song, noteSelection);
              if (bar !== null) {
                commitManualEdit(
                  quantizeNote(workspace, noteSelection),
                  noteSelection.sectionIndex,
                  selectionPart(noteSelection),
                  bar,
                );
                setNoteSelection(null);
              }
            }}
            onDeleteNote={() => {
              if (!noteSelection) return;
              const bar = noteBar(song, noteSelection);
              if (bar !== null) {
                commitManualEdit(
                  deleteNote(workspace, noteSelection),
                  noteSelection.sectionIndex,
                  selectionPart(noteSelection),
                  bar,
                );
                setNoteSelection(null);
              }
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
                  replaceChord(workspace, chordSelection, symbol),
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
                  insertChord(workspace, chordSelection, symbol),
                  chordSelection.sectionIndex,
                  "chords",
                  selectedChordBar,
                );
                setChordSelection(null);
              } catch {
                setStatus("コード記号が正しくありません");
              }
            }}
            onDeleteChord={() => {
              if (!chordSelection || selectedChordBar === null) return;
              commitManualEdit(
                deleteChord(workspace, chordSelection),
                chordSelection.sectionIndex,
                "chords",
                selectedChordBar,
              );
              setChordSelection(null);
            }}
          />

          <div className="view-area">
            {view === "roll" ? (
              <EditablePianoRoll
                song={song}
                playheadBeat={playheadBeat}
                noteSelection={noteSelection}
                chordSelection={chordSelection}
                onSelectNote={(selection) => {
                  setNoteSelection(selection);
                  if (selection) setSelectedSection(selection.sectionIndex);
                }}
                onSelectChord={(selection) => {
                  setChordSelection(selection);
                  if (selection) setSelectedSection(selection.sectionIndex);
                }}
                onEditNote={editNote}
                onAddNote={(sectionIndex, note) => {
                  const bar = Math.floor(note.start / song.meter.barBeats);
                  commitManualEdit(addNote(workspace, sectionIndex, note), sectionIndex, "melody", bar);
                }}
                onSeek={(beat) => {
                  stopPlayback(false);
                  setTransport((current) => ({ ...current, positionBeat: beat }));
                }}
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
              key={index}
              className={"timeline-block block-" + section.plan.type +
                (selectedSection === index ? " selected" : "")}
              style={{ flexGrow: section.plan.bars }}
              title="クリックで頭出し、ダブルクリックでこのセクションをループ"
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
    </div>
  );
}
