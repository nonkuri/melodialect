import type {
  ArrangementSettings,
  CompositionControls,
  MixerSettings,
  SectionControl,
  Song,
} from "../engine/types.js";
import { generateSong } from "../engine/song.js";
import { parseForm } from "../engine/structure.js";
import { dialects } from "../dialects/index.js";
import type { Settings } from "./SettingsPanel.js";

export interface BuildOverrides {
  seed?: number;
  sectionSeeds?: number[];
  sectionPhraseLengths?: number[][];
  arrangement?: ArrangementSettings;
  composition?: CompositionControls;
  mixer?: MixerSettings;
  sectionControls?: SectionControl[];
}

/**
 * Keep a seed the user explicitly selected, but advance it when Generate is
 * pressed again for the currently generated song.
 */
export function resolveFullGenerationSeed(
  requestedSeed: number,
  currentSongSeed: number,
  random: () => number = Math.random,
): number {
  if (requestedSeed !== currentSongSeed) return requestedSeed;
  const candidate = Math.floor(random() * 1_000_000);
  return candidate === currentSongSeed ? (candidate + 1) % 1_000_000 : candidate;
}

/** Build a song from UI settings while keeping engine-specific wiring in one place. */
export function buildSong(settings: Settings, overrides: BuildOverrides = {}): Song {
  const dialect = dialects[settings.dialectId];
  if (!dialect) throw new Error("unknown dialect: " + settings.dialectId);
  const controls = overrides.sectionControls;
  const parsed = parseForm(settings.form);
  const entries = parsed.map((entry, index) => ({
    ...entry,
    dialectName: controls?.[index]?.dialectId ||
      settings.sectionDialects[index] ||
      entry.dialectName,
  }));
  const song = generateSong({
    dialect,
    seed: overrides.seed ?? settings.seed,
    keyName: settings.keyName,
    mode: settings.mode,
    bpm: settings.bpm,
    meterName: settings.meterName,
    form: entries,
    resolveDialect: (name) => dialects[name],
    ending: settings.ending,
    sectionSeeds: overrides.sectionSeeds,
    sectionPhraseLengths: overrides.sectionPhraseLengths,
    arrangement: overrides.arrangement,
    composition: overrides.composition,
    sectionControls: overrides.sectionControls,
  });
  song.mixer = overrides.mixer;
  return song;
}
