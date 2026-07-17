import type { Annotation, ChordEvent, KeySignature, SectionPlan } from "./types.js";
import type { Rng } from "./rng.js";
import { chordFromRoman, pcToPitch } from "./harmony.js";

/**
 * 技法レジストリ (§6.2)。
 * 技法アルゴリズムはここに名前付きで登録し、ダイアレクト JSON の
 * `chord.cliches` から名前で参照する。JSON だけでは新しい技法は定義できない。
 */
export type ClicheFn = (
  chords: ChordEvent[],
  annotations: Annotation[],
  key: KeySignature,
  rng: Rng,
  plan: SectionPlan,
) => void;

const registry = new Map<string, ClicheFn>();

export function registerCliche(name: string, fn: ClicheFn): void {
  registry.set(name, fn);
}

export function applyCliche(
  name: string,
  chords: ChordEvent[],
  annotations: Annotation[],
  key: KeySignature,
  rng: Rng,
  plan: SectionPlan,
): void {
  const fn = registry.get(name);
  if (!fn) throw new Error(`unknown cliche technique: ${name}`);
  fn(chords, annotations, key, rng, plan);
}

/**
 * 半音階クリシェ (Paul / §4.1 D2):
 * ベースラインが半音ずつ下降する 4 小節 (例: C → C/B → C/B♭ → F/A)。
 * フレーズ頭に確率的に挿入する。
 */
registerCliche("descending-bass", (chords, annotations, key, rng, plan) => {
  if (plan.bars < 4 || !rng.chance(0.6)) return;

  const tonicBass = pcToPitch(key.tonic, 36);
  const tonic = chordFromRoman("I", 0, key);
  const subdominant = chordFromRoman("IV", 3, key);

  // bar0: I / bar1: I (長7度ベース) / bar2: I (短7度ベース) / bar3: IV (第3音ベース)
  const patterns: Array<{ base: ChordEvent; symbol: string; bassPitch: number }> = [
    { base: tonic, symbol: "I", bassPitch: tonicBass },
    { base: tonic, symbol: "I/7", bassPitch: tonicBass - 1 },
    { base: tonic, symbol: "I/♭7", bassPitch: tonicBass - 2 },
    { base: subdominant, symbol: "IV/3", bassPitch: tonicBass - 3 },
  ];

  patterns.forEach((p, i) => {
    chords[i] = { ...p.base, bar: i, symbol: p.symbol, bassPitch: p.bassPitch };
    annotations.push({
      bar: i,
      ruleId: "chromatic-cliche",
      text: `${p.symbol}: 半音階クリシェ (ベースが半音下降)`,
    });
  });
});
