import { afterEach, describe, expect, it, vi } from "vitest";
import { dialects } from "../src/dialects/index.js";
import type { Settings } from "../src/ui/SettingsPanel.js";
import { buildSong } from "../src/ui/songBuilder.js";
import {
  addNote,
  regenerateWorkspace,
  replaceChord,
  updateNote,
} from "../src/ui/editor.js";
import {
  createProject,
  emptyLocks,
  isBarLocked,
  isNoteLocked,
  lockBar,
  parseProject,
  toggleNoteLock,
  toggleSectionLock,
  type WorkspaceState,
} from "../src/ui/project.js";

function settings(): Settings {
  const dialect = dialects.chromatic!;
  return {
    dialectId: dialect.id,
    keyName: "C",
    bpm: 100,
    seed: 42,
    meterName: "4/4",
    form: "v,c",
    sectionDialects: ["", ""],
    ending: "final",
  };
}

function workspace(): WorkspaceState {
  const value = settings();
  return {
    settings: value,
    song: buildSong(value),
    locks: emptyLocks(),
    sectionSeeds: [],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("P0 project and editing", () => {
  it("プロジェクトJSONを検証して復元できる", () => {
    const project = createProject("テスト曲", workspace());
    const parsed = parseProject(JSON.parse(JSON.stringify(project)));
    expect(parsed.title).toBe("テスト曲");
    expect(parsed.workspace.song).toEqual(project.workspace.song);
    expect(parsed.seedHistory).toEqual([42]);
  });

  it("部分再生成は対象外セクションと対象外パートを変更しない", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.314159);
    const before = workspace();
    const untouched = structuredClone(before.song.sections[1]);
    const chords = structuredClone(before.song.sections[0]!.chords);
    const after = regenerateWorkspace(before, 0, "melody");
    expect(after.song.sections[1]).toEqual(untouched);
    expect(after.song.sections[0]!.chords).toEqual(chords);
    expect(after.song.sections[0]!.melody).not.toEqual(before.song.sections[0]!.melody);
    expect(after.sectionSeeds[0]).toBeGreaterThan(0);
  });

  it("セクションロックと小節ロックを部分再生成が尊重する", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.271828);
    const before = workspace();
    const sectionLocked = {
      ...before,
      locks: toggleSectionLock(before.locks, 0),
    };
    expect(regenerateWorkspace(sectionLocked, 0, "all")).toBe(sectionLocked);

    const barLocked = {
      ...before,
      locks: lockBar(before.locks, 0, "melody", 0),
    };
    const originalBar = before.song.sections[0]!.melody.filter((note) => note.start < 4);
    const regenerated = regenerateWorkspace(barLocked, 0, "melody");
    const resultBar = regenerated.song.sections[0]!.melody.filter((note) => note.start < 4);
    expect(resultBar).toEqual(originalBar);
    expect(isBarLocked(regenerated.locks, 0, "melody", 0)).toBe(true);
  });

  it("個別ノートロックを保ったままメロディを変奏できる", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.161803);
    const before = workspace();
    const lockedNote = before.song.sections[0]!.melody[0]!;
    before.locks = toggleNoteLock(before.locks, 0, "melody", lockedNote);
    expect(isNoteLocked(before.locks, 0, "melody", lockedNote)).toBe(true);
    const after = regenerateWorkspace(before, 0, "melody");
    expect(after.song.sections[0]!.melody).toContainEqual(lockedNote);
  });

  it("ノートの追加・移動とコード置換ができる", () => {
    const before = workspace();
    const added = addNote(before, 0, {
      start: 0.25,
      duration: 0.5,
      pitch: 72,
      velocity: 90,
    });
    expect(added.song.sections[0]!.melody).toContainEqual({
      start: 0.25,
      duration: 0.5,
      pitch: 72,
      velocity: 90,
    });
    const noteIndex = added.song.sections[0]!.melody.findIndex((note) => note.pitch === 72);
    const moved = updateNote(
      added,
      { sectionIndex: 0, part: "melody", noteIndex },
      { pitch: 74, start: 0.5 },
    );
    expect(moved.song.sections[0]!.melody.some((note) =>
      note.pitch === 74 && note.start === 0.5)).toBe(true);

    const replaced = replaceChord(
      before,
      { sectionIndex: 0, chordIndex: 0 },
      "vi",
    );
    expect(replaced.song.sections[0]!.chords[0]!.symbol).toBe("vi");
    expect(replaced.song.sections[0]!.piano).not.toEqual(before.song.sections[0]!.piano);
  });
});
