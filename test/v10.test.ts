import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chromatic,
  dialectList,
  listUserDialects,
  removeUserDialect,
  saveUserDialect,
  validateDialectDefinition,
} from "../src/dialects/index.js";
import { duplicateDialectDefinition } from "../src/ui/DialectManager.js";
import { applyStarterPreset, createStarterWorkspace, STARTER_PRESETS } from "../src/ui/starterPresets.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

afterEach(() => {
  for (const dialect of [...listUserDialects()]) removeUserDialect(dialect.id);
  vi.unstubAllGlobals();
});

describe("v1.0 dialect schema and editor model", () => {
  it("accepts every bundled field and reports advanced field paths", () => {
    for (const dialect of dialectList) expect(validateDialectDefinition(dialect), dialect.id).toEqual([]);
    const invalid = structuredClone(chromatic);
    invalid.defaults.arrangement = { ...invalid.defaults.arrangement, swing: 2 };
    invalid.chord.transitions.I = { UNKNOWN: 1 };
    invalid.rhythm = { templates: { "4/4": [{ beats: [1], weight: 1 }] } };
    invalid.sectionRules = { verse: { phraseLengths: [0] } };
    invalid.modulation = { bridge: { probability: 2, intervals: [{ semitones: 30, weight: -1 }] } };
    const paths = validateDialectDefinition(invalid).map((issue) => issue.path);
    expect(paths).toContain("defaults.arrangement.swing");
    expect(paths).toContain("chord.transitions.I.UNKNOWN");
    expect(paths).toContain("rhythm.templates.4/4[0].beats");
    expect(paths).toContain("sectionRules.verse.phraseLengths");
    expect(paths).toContain("modulation.bridge.probability");
    expect(paths).toContain("modulation.bridge.intervals[0].semitones");
  });

  it("duplicates and saves while preserving fields outside the basic GUI", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const duplicate = duplicateDialectDefinition(chromatic);
    expect(duplicate.id).not.toBe(chromatic.id);
    expect(duplicate.rhythm).toEqual(chromatic.rhythm);
    expect(duplicate.modulation).toEqual(chromatic.modulation);
    expect(duplicate.chord.transitions).toEqual(chromatic.chord.transitions);
    saveUserDialect(duplicate);
    expect(listUserDialects().find((dialect) => dialect.id === duplicate.id)?.rhythm).toEqual(chromatic.rhythm);
  });

  it("rolls an edit back when browser storage rejects the save", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const duplicate = duplicateDialectDefinition(chromatic);
    saveUserDialect(duplicate);
    const failing = new MemoryStorage();
    failing.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    vi.stubGlobal("localStorage", failing);
    expect(() => saveUserDialect({ ...duplicate, name: "失われてはいけない変更" })).toThrow("保存容量");
    expect(listUserDialects().find((dialect) => dialect.id === duplicate.id)?.name).toBe(duplicate.name);
    vi.stubGlobal("localStorage", new MemoryStorage());
  });
});

describe("v1.0 onboarding and PWA assets", () => {
  it("builds every purpose preset into a usable sample workspace", () => {
    for (const preset of STARTER_PRESETS) {
      const settings = applyStarterPreset(preset.id);
      const workspace = createStarterWorkspace(preset.id);
      expect(workspace.settings).toEqual(settings);
      expect(workspace.song.sections.length).toBeGreaterThan(0);
      expect(workspace.song.sections.flatMap((section) => section.melody).length).toBeGreaterThan(0);
      if (preset.id === "long-arrangement") {
        const minutes = workspace.song.totalBars * workspace.song.meter.barBeats / workspace.song.bpm;
        expect(minutes).toBeGreaterThanOrEqual(4);
        expect(minutes).toBeLessThanOrEqual(5);
      }
    }
  });

  it("ships an installable manifest with normal and maskable icons", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === "512x512")).toBe(true);
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  });
});
