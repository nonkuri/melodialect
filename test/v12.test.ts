import { describe, expect, it } from "vitest";
import { chromatic, dialects, validateDialectDefinition } from "../src/dialects/index.js";
import {
  chordAtBeat,
  chordDisplayName,
  chordFromRoman,
  parseChordSymbol,
} from "../src/engine/harmony.js";
import { bassProfileFor } from "../src/engine/bass.js";
import {
  fingerprintSong,
  selectSongCandidate,
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

  it("keeps chorus and outro accompaniment in-key and inside safe density bounds", () => {
    const uniqueDialects = [...new Map(Object.values(dialects).map((dialect) =>
      [dialect.id, dialect])).values()];
    const parts = ["piano", "guitar"] as const;
    const density = (section: ReturnType<typeof generateSongCandidates>[number]["sections"][number]) =>
      (section.piano.length + section.guitar.length + section.bass.length + section.drums.length) /
      section.plan.bars;
    for (const dialect of uniqueDialects) {
      const candidates = generateSongCandidates({
        dialect,
        seed: 1701,
        form: ["intro", "verse", "chorus", "outro"],
        ending: "final",
      }, 3);
      const baseline = candidates[0]!;
      const selected = selectSongCandidate(candidates, 1701, "standard");
      for (const candidate of candidates) {
        expect(candidate.arrangementPlan?.sections.every((section) =>
          section.registerShift % 12 === 0)).toBe(true);
        for (const section of candidate.sections.filter((item) =>
          item.plan.type === "chorus" || item.plan.type === "outro")) {
          let fitted = 0;
          let total = 0;
          for (const part of parts) {
            for (const note of section[part]) {
              const chord = chordAtBeat(section.chords, note.start);
              const chordPcs = new Set(chord.pitches.map((pitch) => pitch % 12));
              fitted += chordPcs.has(note.pitch % 12) ? 1 : 0;
              total += 1;
            }
          }
          expect(total === 0 ? 1 : fitted / total).toBeGreaterThan(0.9);
        }
        const lastSection = candidate.sections.at(-1)!;
        const lastPlan = candidate.arrangementPlan!.sections.at(-1)!;
        const codaStart = (lastSection.plan.bars - 1) * candidate.meter.barBeats;
        if (!lastPlan.pianoActive) {
          expect(lastSection.piano.some((note) => note.start >= codaStart)).toBe(false);
        }
        if (!lastPlan.guitarActive) {
          expect(lastSection.guitar.some((note) => note.start >= codaStart)).toBe(false);
        }
      }
      for (const type of ["chorus", "outro"] as const) {
        const reference = baseline.sections.find((section) => section.plan.type === type)!;
        const result = selected.sections.find((section) => section.plan.type === type)!;
        const ratio = density(result) / density(reference);
        expect(ratio).toBeGreaterThanOrEqual(type === "chorus" ? 0.68 : 0.48);
        expect(ratio).toBeLessThanOrEqual(type === "chorus" ? 1.42 : 1.25);
        if (type === "outro" && reference.drums.length > 0) {
          expect(result.drums.length).toBeGreaterThan(0);
        }
      }
    }
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
