import { normalizeArrangement, normalizeComposition } from "../engine/controls.js";
import { dialects } from "../dialects/index.js";
import { buildSong } from "./songBuilder.js";
import { emptyLocks, normalizeWorkspace, type WorkspaceState } from "./project.js";
import type { Settings } from "./SettingsPanel.js";

export interface StarterPreset {
  id: string;
  label: string;
  description: string;
  settings: Settings;
}

function settings(
  dialectId: string,
  values: Pick<Settings, "form" | "seed"> & Partial<Pick<Settings, "keyName" | "mode" | "bpm" | "meterName" | "ending">>,
): Settings {
  const dialect = dialects[dialectId]!;
  const sections = values.form.split(",").filter(Boolean);
  return {
    dialectId,
    keyName: values.keyName ?? dialect.defaults.key,
    mode: values.mode ?? dialect.defaults.mode,
    bpm: values.bpm ?? dialect.defaults.bpm,
    meterName: values.meterName ?? dialect.defaults.meter ?? "4/4",
    form: values.form,
    seed: values.seed,
    sectionDialects: sections.map(() => ""),
    ending: values.ending ?? "final",
  };
}

export const STARTER_PRESETS: StarterPreset[] = [
  {
    id: "first-song",
    label: "まず1曲を完成",
    description: "短いVerse/Chorus。生成、再生、編集、保存をすぐ試せます。",
    settings: settings("chromatic-cliche", { form: "v,c", seed: 42, bpm: 96 }),
  },
  {
    id: "gentle-ballad",
    label: "静かなバラード",
    description: "ゆっくりした歌心とピアノ中心の伴奏から始めます。",
    settings: settings("twilight-ballad", { form: "i,v,c,c,o", seed: 308, bpm: 76 }),
  },
  {
    id: "groove-sketch",
    label: "グルーヴを作る",
    description: "Bossaのシンコペーションと拡張和音を短い構成で試します。",
    settings: settings("bossa-syncopation", { form: "i,v,c,o", seed: 124, bpm: 124 }),
  },
  {
    id: "long-arrangement",
    label: "4〜5分のフル構成",
    description: "編集・ミックス・ステム書き出し向けの長い構成です。",
    settings: settings("compound-flow", { form: "i,v,c,v,c,b,c,o", seed: 680, bpm: 42, meterName: "6/8" }),
  },
];

export function applyStarterPreset(id: string): Settings {
  const preset = STARTER_PRESETS.find((item) => item.id === id) ?? STARTER_PRESETS[0]!;
  return structuredClone(preset.settings);
}

export function createStarterWorkspace(id = "first-song"): WorkspaceState {
  const presetSettings = applyStarterPreset(id);
  const dialect = dialects[presetSettings.dialectId]!;
  const arrangement = normalizeArrangement(dialect.defaults.arrangement);
  const composition = normalizeComposition(undefined, presetSettings.mode);
  return normalizeWorkspace({
    settings: presetSettings,
    song: buildSong(presetSettings, { arrangement, composition }),
    arrangement,
    composition,
    locks: emptyLocks(),
    sectionSeeds: [],
  });
}
