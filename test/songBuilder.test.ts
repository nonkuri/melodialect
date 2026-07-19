import { describe, expect, it } from "vitest";
import { buildSong, resolveFullGenerationSeed } from "../src/ui/songBuilder.js";

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
});
