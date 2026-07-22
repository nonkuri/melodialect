import { describe, expect, it } from "vitest";
import { chromatic, validateDialectDefinition } from "../src/dialects/index.js";
import {
  chordDisplayName,
  chordFromRoman,
  parseChordSymbol,
} from "../src/engine/harmony.js";
import { bassProfileFor } from "../src/engine/bass.js";
import {
  fingerprintSong,
  validateGeneratedSong,
} from "../src/engine/evaluation.js";
import { createNamedRng, deriveSeed } from "../src/engine/rng.js";
import { generateSongCandidates, type GenerateOptions } from "../src/engine/song.js";
import { ACCOMPANIMENT_PATTERN_LIBRARY } from "../src/engine/arrangement.js";
import { buildSongCandidates } from "../src/ui/songBuilder.js";
import type { Settings } from "../src/ui/SettingsPanel.js";

const compactOptions: GenerateOptions = {
  dialect: chromatic,
  seed: 20260722,
  form: ["verse", "chorus"],
  ending: "loop" as const,
  sectionPhraseLengths: [[4], [4]],
};

describe("v1.2 deterministic candidate foundation", () => {
  it("derives stable, independent random streams from part and candidate names", () => {
    expect(deriveSeed(42, "bass", 1, 2)).toBe(deriveSeed(42, "bass", 1, 2));
    expect(deriveSeed(42, "bass", 1, 2)).not.toBe(deriveSeed(42, "piano", 1, 2));
    expect(deriveSeed(42, "bass", 1, 2)).not.toBe(deriveSeed(42, "bass", 1, 3));
    const firstRng = createNamedRng(42, "bass", 1, 2);
    const secondRng = createNamedRng(42, "bass", 1, 2);
    const bass = Array.from({ length: 8 }, () => firstRng.next());
    const bassAgain = Array.from({ length: 8 }, () => secondRng.next());
    expect(bassAgain).toEqual(bass);
  });

  it("returns reproducible, valid and deduplicated alternatives", () => {
    const first = generateSongCandidates(compactOptions, 3);
    const second = generateSongCandidates(compactOptions, 3);
    expect(first).toHaveLength(3);
    expect(first.map((song) => song.generationReport?.fingerprint))
      .toEqual(second.map((song) => song.generationReport?.fingerprint));
    expect(new Set(first.map((song) => fingerprintSong(song).combined)).size).toBe(first.length);
    expect(first.every((song) => song.generationReport?.metrics.valid)).toBe(true);
    expect(first.every((song) => song.generationReport?.selectedFrom === first.length)).toBe(true);
  });

  it("measures several seeds without broken or duplicate candidates", () => {
    let violations = 0;
    let duplicates = 0;
    for (const seed of [11, 29, 47, 83]) {
      const songs = generateSongCandidates({ ...compactOptions, seed, form: ["verse"] }, 3);
      violations += songs.reduce((sum, song) => sum + validateGeneratedSong(song).length, 0);
      duplicates += songs.length - new Set(songs.map((song) => fingerprintSong(song).combined)).size;
    }
    expect(violations).toBe(0);
    expect(duplicates).toBe(0);
  });

  it("rejects extreme melodic or bass leaps before selection", () => {
    const song = structuredClone(generateSongCandidates(compactOptions, 1)[0]!);
    const section = song.sections[0]!;
    section.bass = [
      { start: 0, duration: 1, pitch: 36, velocity: 80 },
      { start: 1, duration: 1, pitch: 72, velocity: 80 },
    ];
    expect(validateGeneratedSong(song)).toContain("1番目のbassに極端な跳躍があります");
  });
});

describe("v1.2 harmony, bass and accompaniment planning", () => {
  it("parses secondary dominants, alterations, extensions and slash basses into AST", () => {
    expect(parseChordSymbol("V13♭9/ii")).toMatchObject({
      degree: 5,
      quality: "dom7",
      extension: 13,
      alterations: [{ degree: 9, accidental: -1 }],
      secondaryOf: { degree: 2, accidental: 0 },
    });
    const dominant = chordFromRoman("V13♭9/ii", 0, { tonic: 0, mode: "major" });
    expect(dominant.rootPc).toBe(9); // A is V of D (ii in C)
    expect(chordDisplayName(dominant, false)).toBe("A13♭9");

    const slash = chordFromRoman("I/♭7", 0, { tonic: 0, mode: "major" });
    expect(slash.ast?.bass).toEqual({ degree: 7, accidental: -1 });
    expect(slash.bassPitch % 12).toBe(10);
  });

  it("records functional harmony, bass path and arrangement intent at section level", () => {
    const song = generateSongCandidates({
      ...compactOptions,
      arrangement: {
        pianoPattern: "syncopated",
        guitarPattern: "interlocking",
        drumPattern: "basic",
        swing: 0,
        humanize: 0,
        velocityScale: 1,
        accompanimentDensity: 0.8,
        development: 0.8,
        autoArrange: true,
      },
    }, 2)[1]!;
    const rules = new Set(song.sections.flatMap((section) =>
      section.annotations.map((annotation) => annotation.ruleId)));
    expect(rules.has("functional-harmony-plan")).toBe(true);
    expect(rules.has("bass-path-plan")).toBe(true);
    expect(rules.has("arrangement-plan")).toBe(true);
    expect(song.arrangementPlan?.sections.some((section) => section.fillBars.length > 0)).toBe(true);
    expect(song.generationReport?.summary.some((reason) => reason.level === "song")).toBe(true);
    expect(song.generationReport?.summary.some((reason) => reason.level === "section")).toBe(true);
  });

  it("supports dialect-owned bass grammar and data-driven accompaniment presets", () => {
    const dialect = structuredClone(chromatic);
    dialect.bass = {
      roles: { verse: ["ostinato"], chorus: ["counterline"] },
      activity: 0.7,
      enclosureRatio: 0.4,
      resolveLeapRatio: 0.9,
      range: [35, 55],
    };
    expect(validateDialectDefinition(dialect).filter((issue) => issue.path.startsWith("bass")))
      .toEqual([]);
    expect(bassProfileFor(dialect)).toMatchObject({
      activity: 0.7,
      enclosureRatio: 0.4,
      resolveLeapRatio: 0.9,
      range: [35, 55],
    });
    expect(ACCOMPANIMENT_PATTERN_LIBRARY.some((pattern) =>
      pattern.instrument === "piano" && pattern.beats.length > 1 && pattern.voices === "guide"))
      .toBe(true);
    expect(ACCOMPANIMENT_PATTERN_LIBRARY.some((pattern) => pattern.anticipation !== undefined))
      .toBe(true);
  });
});

describe("v1.2 optional candidate UI boundary", () => {
  it("builds optional A/B candidates without changing the selected seed", () => {
    const settings: Settings = {
      dialectId: chromatic.id,
      keyName: "C",
      bpm: 100,
      seed: 31415,
      meterName: "4/4",
      form: "v,c",
      sectionDialects: ["", ""],
      ending: "loop",
    };
    const candidates = buildSongCandidates(settings, {
      sectionPhraseLengths: [[4], [4]],
    }, 3);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((song) => song.seed === settings.seed)).toBe(true);
    expect(candidates.slice(1).every((song) =>
      (song.generationReport?.differenceTags?.length ?? 0) > 0)).toBe(true);
  });
});
