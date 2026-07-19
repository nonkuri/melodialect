import type { Song } from "../engine/types.js";
import { generateSong } from "../engine/song.js";
import { parseForm } from "../engine/structure.js";
import { dialects } from "../dialects/index.js";
import type { Settings } from "./SettingsPanel.js";

export interface BuildOverrides {
  seed?: number;
  sectionSeeds?: number[];
  sectionPhraseLengths?: number[][];
}

/** Build a song from UI settings while keeping engine-specific wiring in one place. */
export function buildSong(settings: Settings, overrides: BuildOverrides = {}): Song {
  const dialect = dialects[settings.dialectId];
  if (!dialect) throw new Error(`unknown dialect: ${settings.dialectId}`);
  const entries = parseForm(settings.form).map((entry, index) => ({
    ...entry,
    dialectName: settings.sectionDialects[index] || entry.dialectName,
  }));
  return generateSong({
    dialect,
    seed: overrides.seed ?? settings.seed,
    keyName: settings.keyName,
    bpm: settings.bpm,
    meterName: settings.meterName,
    form: entries,
    resolveDialect: (name) => dialects[name],
    ending: settings.ending,
    sectionSeeds: overrides.sectionSeeds,
    sectionPhraseLengths: overrides.sectionPhraseLengths,
  });
}
