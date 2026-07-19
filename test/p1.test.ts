import { describe, expect, it } from "vitest";
import { chromatic } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import { DEFAULT_ARRANGEMENT, DEFAULT_COMPOSITION, defaultMixer } from "../src/engine/controls.js";
import { beatToSeconds, secondsToBeat } from "../src/audio/player.js";
import { createProject, emptyLocks, parseProject } from "../src/ui/project.js";

describe("P1 arrangement and controls", () => {
  it("ピアノパターン、ギター、ドラムを決定的に生成する", () => {
    const arrangement = {
      ...DEFAULT_ARRANGEMENT,
      pianoPattern: "arpeggio" as const,
      guitarPattern: "strum" as const,
      drumPattern: "rock" as const,
      swing: 0.5,
      humanize: 0.3,
      velocityScale: 1.2,
    };
    const song = generateSong({ dialect: chromatic, seed: 42, arrangement });
    expect(song).toEqual(generateSong({ dialect: chromatic, seed: 42, arrangement }));
    expect(song.sections.some((section) => section.guitar.length > 0)).toBe(true);
    expect(song.sections.some((section) => section.drums.length > 0)).toBe(true);
    expect(song.sections[0]!.piano.some((note) => note.start % 1 !== 0)).toBe(true);
  });

  it("調性、メロディ音域、密度を反映する", () => {
    const composition = {
      ...DEFAULT_COMPOSITION,
      mode: "minor" as const,
      melodyLow: 60,
      melodyHigh: 67,
      density: 0.15,
      syncopation: 0.9,
    };
    const controlled = generateSong({ dialect: chromatic, seed: 42, composition });
    const baseline = generateSong({ dialect: chromatic, seed: 42 });
    const notes = controlled.sections.flatMap((section) => section.melody);
    expect(controlled.key.mode).toBe("minor");
    expect(notes.every((note) => note.pitch >= 60 && note.pitch <= 67)).toBe(true);
    expect(notes.length).toBeLessThan(baseline.sections.flatMap((section) => section.melody).length);
  });

  it("同種セクションでも小節数、移調、テンポを個別に持てる", () => {
    const sectionControls = [
      { id: "v1", type: "verse" as const, dialectId: "chromatic", bars: 5, transpose: 0, bpm: 96 },
      { id: "v2", type: "verse" as const, dialectId: "chromatic", bars: 7, transpose: 5, bpm: 132 },
    ];
    const song = generateSong({ dialect: chromatic, seed: 9, form: ["verse", "verse"], sectionControls, ending: "loop" });
    expect(song.sections[0]!.plan.bars).toBe(5);
    expect(song.sections[1]!.plan.bars).toBe(7);
    expect(song.sections[0]!.bpm).toBe(96);
    expect(song.sections[1]!.bpm).toBe(132);
    expect(song.sections[1]!.key.tonic).toBe((song.key.tonic + 5) % 12);
    const boundaryBeat = 5 * song.meter.barBeats;
    expect(beatToSeconds(song, boundaryBeat)).toBeCloseTo(boundaryBeat * 60 / 96);
    expect(secondsToBeat(song, beatToSeconds(song, boundaryBeat + 4))).toBeCloseTo(boundaryBeat + 4);
  });

  it("旧プロジェクトをP1設定付きへ移行する", () => {
    const song = generateSong({ dialect: chromatic, seed: 3, form: ["verse"] });
    const workspace = {
      settings: {
        dialectId: "chromatic", keyName: "C", bpm: 120, seed: 3, meterName: "4/4",
        form: "v", sectionDialects: [""], ending: "final" as const,
      },
      song,
      locks: emptyLocks(),
      sectionSeeds: [],
    };
    const project = createProject("migration", workspace);
    const raw = JSON.parse(JSON.stringify(project));
    delete raw.workspace.arrangement;
    delete raw.workspace.song.arrangement;
    delete raw.workspace.mixer;
    delete raw.workspace.composition;
    delete raw.workspace.sectionControls;
    const migrated = parseProject(raw);
    expect(migrated.workspace.arrangement).toEqual(DEFAULT_ARRANGEMENT);
    expect(migrated.workspace.mixer).toEqual(defaultMixer());
    expect(migrated.workspace.sectionControls).toHaveLength(song.sections.length);
  });
});
