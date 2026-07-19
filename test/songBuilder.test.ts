import { describe, expect, it } from "vitest";
import { DEFAULT_ARRANGEMENT } from "../src/engine/controls.js";
import {
  buildSong,
  resolveFullGenerationSectionControls,
  resolveFullGenerationSeed,
} from "../src/ui/songBuilder.js";

describe("full-song generation seed", () => {
  it("uses a seed explicitly selected after the current song was generated", () => {
    expect(resolveFullGenerationSeed(123, 42, () => 0.9)).toBe(123);
  });

  it("chooses a new seed when generating again with the current seed", () => {
    expect(resolveFullGenerationSeed(42, 42, () => 0.5)).toBe(500_000);
  });

  it("never returns the current seed when the random candidate collides", () => {
    expect(resolveFullGenerationSeed(42, 42, () => 0.000_042)).toBe(43);
    expect(resolveFullGenerationSeed(999_999, 999_999, () => 0.999_999)).toBe(0);
  });

  it("builds the song and every section with the newly selected main dialect", () => {
    const song = buildSong({
      dialectId: "modal-irregular",
      keyName: "G",
      mode: "major",
      bpm: 104,
      seed: 42,
      meterName: "4/4",
      form: "v,c",
      sectionDialects: ["", ""],
      ending: "final",
    });
    expect(song.dialectId).toBe("modal-irregular");
    expect(song.sections.every((section) => section.dialectId === "modal-irregular")).toBe(true);
  });

  it("updates inherited section tempos and keeps explicit per-section tempos", () => {
    const settings = {
      dialectId: "chromatic-cliche",
      keyName: "C",
      mode: "major" as const,
      bpm: 120,
      seed: 42,
      meterName: "4/4",
      form: "v,c",
      sectionDialects: ["", ""],
      ending: "final" as const,
    };
    const controls = [
      { id: "v", type: "verse" as const, dialectId: "chromatic-cliche", bars: 8, transpose: 0, bpm: 96 },
      { id: "c", type: "chorus" as const, dialectId: "chromatic-cliche", bars: 8, transpose: 0, bpm: 132 },
    ];

    const resolved = resolveFullGenerationSectionControls(settings, controls, 96);
    const song = buildSong(settings, {
      arrangement: { ...DEFAULT_ARRANGEMENT, pianoPattern: "arpeggio" },
      sectionControls: resolved,
    });

    expect(resolved?.map((control) => control.bpm)).toEqual([120, 132]);
    expect(song.sections.map((section) => section.bpm)).toEqual([120, 132]);
    expect(song.arrangement?.pianoPattern).toBe("arpeggio");
  });

  it("drops stale section controls after the main dialect changes", () => {
    const controls = [
      { id: "v", type: "verse" as const, dialectId: "chromatic-cliche", bars: 8, transpose: 0, bpm: 96 },
    ];
    expect(resolveFullGenerationSectionControls({
      dialectId: "modal-irregular",
      keyName: "G",
      mode: "major",
      bpm: 104,
      seed: 42,
      meterName: "4/4",
      form: "v",
      sectionDialects: [""],
      ending: "final",
    }, controls, 96)).toBeUndefined();
  });
});
