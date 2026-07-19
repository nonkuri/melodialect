import { afterEach, describe, expect, it, vi } from "vitest";
import { chromatic } from "../src/dialects/index.js";
import { DEFAULT_ARRANGEMENT, DEFAULT_COMPOSITION, defaultMixer } from "../src/engine/controls.js";
import { generateSong } from "../src/engine/song.js";
import {
  analyzePcm,
  estimatePeakPolyphony,
  linearToDb,
  MIX_QUALITY_TARGETS,
  PART_LEVEL_TARGETS_DBFS,
  TIMBRE_REFERENCE_RMS,
} from "../src/audio/quality.js";
import {
  TIMBRE_LEVELS,
  beatToSeconds,
  estimatePartLevels,
  playbackBeatAtElapsed,
} from "../src/audio/player.js";
import { isPartAudible, soundFontChannelConfig } from "../src/audio/mix.js";
import { buildMusicXml } from "../src/export/musicxml.js";
import {
  applyControlChanges,
  copySelectedNotes,
  pasteNotes,
  quantizeSelectedNotes,
  transposeSelectedChords,
  transposeSelectedNotes,
  updateChordTiming,
  type NoteSelection,
} from "../src/ui/editor.js";
import {
  createBackup,
  createProject,
  deleteProject,
  emptyLocks,
  listProjectSnapshots,
  listProjects,
  listTrash,
  parseProject,
  restoreBackup,
  restoreProject,
  saveProject,
  toggleNoteLock,
  type WorkspaceState,
} from "../src/ui/project.js";
import {
  normalizeSeekBeat,
  pianoRollFollowScroll,
  seekBeatFromPointer,
} from "../src/ui/playbackViewport.js";

describe("playback viewport", () => {
  it("lets pointer seeking reach the exact beginning and end", () => {
    expect(seekBeatFromPointer(100, 100, 500, 128)).toBe(0);
    expect(seekBeatFromPointer(110, 100, 500, 128)).toBe(0);
    expect(seekBeatFromPointer(600, 100, 500, 128)).toBe(128);
    expect(normalizeSeekBeat(-0.1, 128)).toBe(0);
  });

  it("moves the piano roll immediately when the playhead leaves its viewport", () => {
    expect(pianoRollFollowScroll(20, 400, 800, 4000)).toBe(0);
    expect(pianoRollFollowScroll(650, 0, 800, 4000)).toBe(0);
    expect(pianoRollFollowScroll(900, 0, 800, 4000)).toBe(620);
    expect(pianoRollFollowScroll(3990, 3000, 800, 4000)).toBe(3200);
  });
});

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function workspace(seed = 41): WorkspaceState {
  const song = generateSong({ dialect: chromatic, seed, form: ["verse", "chorus"] });
  return {
    settings: {
      dialectId: "chromatic",
      keyName: "C",
      bpm: 120,
      seed,
      meterName: "4/4",
      form: "v,c",
      sectionDialects: ["", ""],
      ending: "final",
      mode: "major",
    },
    song,
    locks: emptyLocks(),
    sectionSeeds: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("v0.6 project protection and migrations", () => {
  it("version 1 fixture is explicitly migrated to version 2 defaults", () => {
    const old = createProject("v1 fixture", workspace());
    const fixture = JSON.parse(JSON.stringify(old));
    fixture.version = 1;
    delete fixture.workspace.master;
    delete fixture.workspace.song.master;
    delete fixture.workspace.mixer;
    delete fixture.workspace.song.mixer;
    delete fixture.workspace.composition;
    const migrated = parseProject(fixture);
    expect(migrated.version).toBe(2);
    expect(migrated.workspace.master).toEqual({ volume: 0.8, limiter: true });
    expect(migrated.workspace.mixer).toEqual(defaultMixer());
    expect(migrated.workspace.composition).toEqual(DEFAULT_COMPOSITION);
  });

  it("keeps generations, trash restore, and bulk backup round-trippable", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    const first = saveProject(createProject("first", workspace()), { createGeneration: false });
    const changed = structuredClone(first);
    changed.workspace.settings.seed += 1;
    saveProject(changed);
    expect(listProjectSnapshots(first.id)).toHaveLength(1);
    deleteProject(first.id);
    expect(listProjects()).toHaveLength(0);
    expect(listTrash()).toHaveLength(1);
    expect(restoreProject(first.id)?.id).toBe(first.id);
    const backup = createBackup();
    storage.clear();
    expect(restoreBackup(backup)).toBe(1);
    expect(listProjects()[0]?.title).toBe("first");
  });

  it("preserves a manually locked note across a parameter rebuild", () => {
    const current = workspace();
    const locked = current.song.sections[0]!.melody[0]!;
    current.locks = toggleNoteLock(current.locks, 0, "melody", locked);
    const rebuilt = applyControlChanges(
      current,
      { ...DEFAULT_ARRANGEMENT, pianoPattern: "arpeggio" },
      { ...DEFAULT_COMPOSITION, density: 1 },
    );
    expect(rebuilt.song.sections[0]!.melody).toContainEqual(locked);
  });
});

describe("v0.7 output and audio quality", () => {
  it("returns a resumed loop to the song beginning after the first pass", () => {
    const song = workspace().song;
    const endBeat = song.totalBars * song.meter.barBeats;
    const resumedAt = endBeat / 2;
    const firstPassSeconds = beatToSeconds(song, endBeat) - beatToSeconds(song, resumedAt);
    expect(playbackBeatAtElapsed(song, firstPassSeconds + 0.01, resumedAt, endBeat, true, 0))
      .toBeLessThan(0.1);
  });
  it("exports five MusicXML parts, harmony and meter metadata", () => {
    const song = workspace().song;
    const xml = buildMusicXml(song);
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml.match(/<score-part id=/g)).toHaveLength(5);
    expect(xml.match(/<part id=/g)).toHaveLength(5);
    expect(xml).toContain("<harmony>");
    expect(xml).toContain(`<beats>${song.meter.midiNumerator}</beats>`);
  });

  it("reports peak/RMS, clipping and a safe gain recommendation", () => {
    const report = analyzePcm([Float32Array.from([0, 0.5, -1.2, 0.25])]);
    expect(report.peak).toBeCloseTo(1.2);
    expect(report.clippedSamples).toBe(1);
    expect(report.recommendedGain).toBeLessThan(1);
    expect(report.peakDbfs).toBeGreaterThan(0);
  });

  it("estimates generated polyphony against the fixed voice cap", () => {
    const report = estimatePeakPolyphony(workspace().song);
    expect(report.peak).toBeGreaterThan(0);
    expect(report.peak).toBeLessThanOrEqual(MIX_QUALITY_TARGETS.voiceCap);
    expect(report.exceedsVoiceCap).toBe(false);
  });

  it("keeps built-in timbres within one decibel after calibration", () => {
    for (const [part, timbres] of Object.entries(TIMBRE_REFERENCE_RMS)) {
      const normalized = Object.entries(timbres).map(([name, rms]) =>
        linearToDb(rms * TIMBRE_LEVELS[part as keyof typeof TIMBRE_LEVELS][name]!));
      expect(Math.max(...normalized) - Math.min(...normalized)).toBeLessThan(1);
      expect(PART_LEVEL_TARGETS_DBFS[part as keyof typeof PART_LEVEL_TARGETS_DBFS].peakMax).toBeLessThan(0);
    }
  });

  it("applies mute, solo, volume and pan consistently after a SoundFont switch", () => {
    const song = workspace().song;
    song.mixer = defaultMixer();
    song.mixer!.melody.volume = 0.75;
    song.mixer!.melody.pan = -0.5;
    const config = soundFontChannelConfig("melody", song.mixer!.melody.soundfont!, 0.75, -0.5);
    expect(config.volume).toBe(64);
    expect(config.pan).toBe(32);
    const before = estimatePartLevels(song, 0);
    song.mixer!.piano.solo = true;
    expect(isPartAudible(song.mixer, "melody")).toBe(false);
    expect(isPartAudible(song.mixer, "piano")).toBe(true);
    const soloed = estimatePartLevels(song, 0);
    expect(soloed.melody.peak).toBe(0);
    expect(before.melody.peak).toBeGreaterThan(0);
    song.mixer!.piano.mute = true;
    expect(isPartAudible(song.mixer, "piano")).toBe(false);
  });
});

describe("v0.8 multi-note and chord editing", () => {
  it("transposes and quantizes multiple selected notes without changing the source", () => {
    const current = workspace();
    const selections: NoteSelection[] = [
      { sectionIndex: 0, part: "melody", noteIndex: 0 },
      { sectionIndex: 0, part: "melody", noteIndex: 1 },
    ];
    const originalPitches = selections.map((selection) =>
      current.song.sections[selection.sectionIndex]![selection.part][selection.noteIndex]!.pitch);
    const moved = transposeSelectedNotes(current, selections, 12);
    expect(originalPitches.map((pitch) => pitch + 12)).toEqual(
      moved.song.sections[0]!.melody.slice(0, 2).map((note) => note.pitch).sort((a, b) => a - b),
    );
    expect(current.song.sections[0]!.melody[0]!.pitch).toBe(originalPitches[0]);
    const quantized = quantizeSelectedNotes(current, selections, 0.5);
    expect(quantized.song.sections[0]!.melody.slice(0, 2).every((note) => note.start % 0.5 === 0)).toBe(true);
  });

  it("copies notes between sections and edits chord timing/transposition", () => {
    const current = workspace();
    const selection: NoteSelection = { sectionIndex: 0, part: "melody", noteIndex: 0 };
    const clipboard = copySelectedNotes(current.song, [selection]);
    const secondStart = current.song.sections[1]!.startBar * current.song.meter.barBeats;
    const pasted = pasteNotes(current, clipboard, secondStart + 0.5);
    expect(pasted.song.sections[1]!.melody).toContainEqual({
      start: 0.5,
      duration: clipboard[0]!.duration,
      pitch: clipboard[0]!.pitch,
      velocity: clipboard[0]!.velocity,
    });
    const chord = { sectionIndex: 0, chordIndex: 0 };
    const root = current.song.sections[0]!.chords[0]!.rootPc;
    const transposed = transposeSelectedChords(current, [chord], 1, []);
    expect(transposed.song.sections[0]!.chords[0]!.rootPc).toBe((root + 1) % 12);
    const timed = updateChordTiming(current, chord, { durationBeats: 2 }, 0.25, []);
    expect(timed.song.sections[0]!.chords[0]!.durationBeats).toBeGreaterThan(0);
  });
});
