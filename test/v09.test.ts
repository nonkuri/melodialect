import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chromatic,
  listUserDialects,
  removeUserDialect,
  saveUserDialect,
  validateDialectDefinition,
} from "../src/dialects/index.js";
import {
  captureFixedMotif,
  parseChordDraftText,
  reharmonizeChordDrafts,
} from "../src/engine/design.js";
import { generateSong } from "../src/engine/song.js";
import { DEFAULT_METER } from "../src/engine/meter.js";
import type { ChordDraftSlot, CompositionDesign } from "../src/engine/types.js";
import { buildMusicXml } from "../src/export/musicxml.js";
import { buildSunoText } from "../src/export/text.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const expression = {
  tension: 0.5,
  density: 0.5,
  brightness: 0.5,
  cadence: "dialect" as const,
};

function fourBarDraft(withBlank = false): ChordDraftSlot[] {
  return ["I", "vi", withBlank ? "" : "IV", "V7"].map((symbol, index) => ({
    symbol,
    start: index * 4,
    durationBeats: 4,
    origin: "user" as const,
  }));
}

function design(mode: CompositionDesign["harmonyMode"], draft: ChordDraftSlot[]): CompositionDesign {
  return {
    harmonyMode: mode,
    chordDrafts: [draft],
    chorusVariation: "light",
    sectionExpressions: [expression],
  };
}

afterEach(() => {
  removeUserDialect("user-v09-test");
  vi.unstubAllGlobals();
});

describe("v0.9 chord-constrained dialect generation", () => {
  it("reports invalid symbols, overlaps, missing beats and non-forced musical warnings", () => {
    const parsed = parseChordDraftText(
      "I@0:8 | WHAT@4:4 | V7@12:2",
      16,
      DEFAULT_METER,
      chromatic,
      { tonic: 0, mode: "major" },
      true,
    );
    expect(parsed.diagnostics.some((item) => item.code === "symbol" && item.severity === "error")).toBe(true);
    expect(parsed.diagnostics.some((item) => item.code === "overlap" && item.severity === "error")).toBe(true);
    expect(parsed.diagnostics.some((item) => item.code === "duration" && item.message.includes("不足"))).toBe(true);
    expect(parsed.diagnostics.some((item) => item.code === "cadence" && item.severity === "warning")).toBe(true);
  });

  it("keeps user chords fixed while generating melody and accompaniment from the dialect", () => {
    const song = generateSong({
      dialect: chromatic,
      seed: 90,
      form: ["verse"],
      ending: "loop",
      sectionControls: [{ id: "v", type: "verse", dialectId: chromatic.id, bars: 4, transpose: 0, bpm: 96 }],
      design: design("fixed", fourBarDraft()),
    });
    expect(song.sections[0]!.chords.map((chord) => chord.symbol)).toEqual(["I", "vi", "IV", "V7"]);
    expect(song.sections[0]!.chords.every((chord) => chord.origin === "user")).toBe(true);
    expect(song.sections[0]!.melody.length).toBeGreaterThan(0);
    expect(song.sections[0]!.piano.length).toBeGreaterThan(0);
    expect(song.sections[0]!.annotations.some((item) => item.ruleId === "user-chord")).toBe(true);
    expect(song.sections[0]!.annotations.some((item) => item.ruleId === "dialect-melody")).toBe(true);
    expect(song.sections[0]!.annotations.some((item) => item.ruleId === "dialect-accompaniment")).toBe(true);
  });

  it("fills only blank chord slots and marks their origin separately", () => {
    const song = generateSong({
      dialect: chromatic,
      seed: 91,
      form: ["verse"],
      ending: "loop",
      sectionControls: [{ id: "v", type: "verse", dialectId: chromatic.id, bars: 4, transpose: 0, bpm: 96 }],
      design: design("complete", fourBarDraft(true)),
    });
    expect(song.sections[0]!.chords[0]!.symbol).toBe("I");
    expect(song.sections[0]!.chords[1]!.symbol).toBe("vi");
    expect(song.sections[0]!.chords[2]!.symbol).not.toBe("");
    expect(song.sections[0]!.chords[2]!.origin).toBe("completed");
    expect(song.sections[0]!.annotations.some((item) => item.ruleId === "chord-completion")).toBe(true);
  });

  it("creates a reversible reharmonization candidate without mutating the original", () => {
    const original = [fourBarDraft(), fourBarDraft()];
    const snapshot = structuredClone(original);
    const candidate = reharmonizeChordDrafts(original, [chromatic, chromatic], 42);
    expect(original).toEqual(snapshot);
    expect(candidate).not.toBe(original);
    expect(candidate.flat().every((slot) => slot.symbol.length > 0)).toBe(true);
  });

  it("supports stable final-section length when the visible bar count includes the coda", () => {
    const song = generateSong({
      dialect: chromatic,
      seed: 5,
      form: ["chorus"],
      ending: "final",
      sectionControls: [{ id: "c", type: "chorus", dialectId: chromatic.id, bars: 8, transpose: 0, bpm: 96 }],
    });
    expect(song.totalBars).toBe(8);
    expect(song.sections[0]!.plan.bars).toBe(8);
  });
});

describe("v0.9 motif, lyrics and dialect extensibility", () => {
  it("fixes a selected motif and can keep later Choruses the same", () => {
    const sectionControls = [
      { id: "c1", type: "chorus" as const, dialectId: chromatic.id, bars: 4, transpose: 0, bpm: 96 },
      { id: "c2", type: "chorus" as const, dialectId: chromatic.id, bars: 4, transpose: 0, bpm: 96 },
    ];
    const source = generateSong({ dialect: chromatic, seed: 7, form: ["chorus", "chorus"], ending: "loop", sectionControls });
    const motif = captureFixedMotif(source, 0, [0, 1, 2]);
    expect(motif).not.toBeNull();
    const song = generateSong({
      dialect: chromatic,
      seed: 8,
      form: ["chorus", "chorus"],
      ending: "loop",
      sectionControls,
      design: {
        harmonyMode: "auto",
        chordDrafts: [[], []],
        chorusVariation: "same",
        sectionExpressions: [expression, expression],
        motif: motif!,
      },
    });
    expect(song.sections[1]!.melody).toEqual(song.sections[0]!.melody);
    expect(song.sections.every((section) => section.annotations.some((item) => item.ruleId === "fixed-motif"))).toBe(true);
  });

  it("exports edited lyrics to both MusicXML and text", () => {
    const song = generateSong({ dialect: chromatic, seed: 10, form: ["verse"], ending: "loop" });
    const syllables = song.sections[0]!.melody.map((_, index) => index === 0 ? "テ&スト" : "ら");
    song.lyrics = [{ language: "ja", syllables, lines: ["編集済みの歌詞"] }];
    expect(buildMusicXml(song)).toContain("<text>テ&amp;スト</text>");
    expect(buildSunoText(song, chromatic)).toContain("編集済みの歌詞");
  });

  it("validates, stores and lists a safe user dialect with field-level errors", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const invalid = structuredClone(chromatic) as unknown as Record<string, unknown>;
    invalid.id = "Bad ID";
    expect(validateDialectDefinition(invalid).some((issue) => issue.path === "id")).toBe(true);

    const custom = structuredClone(chromatic);
    custom.id = "user-v09-test";
    custom.name = "User V09 Test";
    saveUserDialect(custom);
    expect(listUserDialects().map((dialect) => dialect.id)).toContain("user-v09-test");
  });
});
