import type { Annotation, ChordEvent, KeySignature, SectionPlan } from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { chordFromRoman, parseRoman, pcToPitch } from "./harmony.js";

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
  meter: Meter,
) => void;

const registry = new Map<string, ClicheFn>();

function replaceChordSymbol(chords: ChordEvent[], index: number, symbol: string, key: KeySignature): void {
  const current = chords[index];
  if (!current) return;
  chords[index] = chordFromRoman(
    symbol,
    current.bar,
    key,
    current.start,
    current.durationBeats,
  );
}

export function registerCliche(name: string, fn: ClicheFn): void {
  registry.set(name, fn);
}

/** ユーザー定義ダイアレクトが安全に参照できる、実装済み技法名。 */
export function registeredClicheNames(): string[] {
  return [...registry.keys()].sort();
}

export function applyCliche(
  name: string,
  chords: ChordEvent[],
  annotations: Annotation[],
  key: KeySignature,
  rng: Rng,
  plan: SectionPlan,
  meter: Meter,
): void {
  const fn = registry.get(name);
  if (!fn) throw new Error(`unknown cliche technique: ${name}`);
  fn(chords, annotations, key, rng, plan, meter);
}

/**
 * 半音階クリシェ (Chromatic / §4.1 D2):
 * ベースラインが半音ずつ下降する 4 小節 (例: C → C/B → C/B♭ → F/A)。
 * フレーズ頭に確率的に挿入する。ハーモニックリズムで先頭 4 小節が
 * 1 小節 1 コードになっていない場合は適用しない。
 */
registerCliche("descending-bass", (chords, annotations, key, rng, plan, meter) => {
  if (plan.bars < 4 || !rng.chance(0.6)) return;
  const bb = meter.barBeats;
  for (let i = 0; i < 4; i++) {
    const c = chords[i];
    if (!c || c.start !== i * bb || c.durationBeats !== bb) return;
  }

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
    chords[i] = {
      ...p.base,
      start: i * bb,
      durationBeats: bb,
      bar: i,
      symbol: p.symbol,
      bassPitch: p.bassPitch,
    };
    annotations.push({
      bar: i,
      ruleId: "chromatic-cliche",
      text: `${p.symbol}: 半音階クリシェ (ベースが半音下降)`,
    });
  });
});

/**
 * オーケストラル・ポップ向けの転回ベース。
 * Verse系は I△7 → V7/3 → vi7 → iii7/3 (1–7–6–5)、
 * Chorusは vi7 → iii7/3 → IV△7 → I△7/3 (6–5–4–3) と下降させる。
 * 元のハーモニックリズムが1小節2コードでも、冒頭4小節を技法単位で組み直す。
 */
registerCliche("orchestral-inversions", (chords, annotations, key, rng, plan, meter) => {
  if (plan.bars < 6 || !rng.chance(0.82)) return;
  const bb = meter.barBeats;
  const cutoff = 4 * bb;
  const tonicBass = pcToPitch(key.tonic, 36);
  const isChorus = plan.type === "chorus";
  const lineLabel = isChorus ? "6–5–4–3" : "1–7–6–5";
  const specifications = isChorus
    ? [
        { roman: "vi7", display: "vi7", bassPitch: tonicBass - 3 },
        { roman: "iii7", display: "iii7/3", bassPitch: tonicBass - 5 },
        { roman: "IV△7", display: "IV△7", bassPitch: tonicBass - 7 },
        { roman: "I△7", display: "I△7/3", bassPitch: tonicBass - 8 },
      ]
    : [
        { roman: "I△7", display: "I△7", bassPitch: tonicBass },
        { roman: "V7", display: "V7/3", bassPitch: tonicBass - 1 },
        { roman: "vi7", display: "vi7", bassPitch: tonicBass - 3 },
        { roman: "iii7", display: "iii7/3", bassPitch: tonicBass - 5 },
      ];
  const head = specifications.map((specification, bar) => ({
    ...chordFromRoman(specification.roman, bar, key, bar * bb, bb),
    symbol: specification.display,
    bassPitch: specification.bassPitch,
  }));
  const tail = chords
    .filter((chord) => chord.start + chord.durationBeats > cutoff)
    .map((chord) => chord.start < cutoff
      ? {
          ...chord,
          start: cutoff,
          durationBeats: chord.start + chord.durationBeats - cutoff,
          bar: 4,
        }
      : chord);
  chords.splice(0, chords.length, ...head, ...tail);

  // 技法で置き換えた範囲に対する元の定型句注記は、実際の進行と一致しないため除く。
  for (let index = annotations.length - 1; index >= 0; index--) {
    if (annotations[index]!.ruleId === "chord-idiom" && annotations[index]!.bar < 4) {
      annotations.splice(index, 1);
    }
  }
  specifications.forEach((specification, bar) => annotations.push({
    bar,
    ruleId: "orchestral-inversion-line",
    text: `${specification.display}: 上声を保ちながら転回ベースを${lineLabel}と下降`,
  }));
});

/** 12 小節ブルース。最後のカデンツは生成器が決めた終止/半終止を保持する。 */
registerCliche("twelve-bar-blues", (chords, annotations, key, _rng, plan, meter) => {
  if (plan.bars < 12) return;
  const bb = meter.barBeats;
  const firstBlock = chords.slice(0, 12);
  if (firstBlock.length < 12 || firstBlock.some((chord, i) =>
    chord.start !== i * bb || chord.durationBeats !== bb)) return;

  const finalResolvesToTonic = (() => {
    try {
      return parseRoman(firstBlock.at(-1)!.symbol).degree === 1;
    } catch {
      return false;
    }
  })();
  const pattern = ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7"];
  const limit = finalResolvesToTonic ? 10 : 11;
  for (let i = 0; i < limit; i++) replaceChordSymbol(chords, i, pattern[i]!, key);
  annotations.push({
    bar: 0,
    ruleId: "twelve-bar-blues",
    text: "12小節ブルース: I7×4 → IV7×2 → I7×2 → V7 → IV7 → ターンアラウンド",
  });
});

/** 短調の定番下降バス i→VII→VI→V7。 */
registerCliche("lament-bass", (chords, annotations, key, _rng, plan, meter) => {
  if (plan.bars < 4) return;
  const bb = meter.barBeats;
  const cutoff = 4 * bb;
  const tail = chords
    .filter((chord) => chord.start + chord.durationBeats > cutoff)
    .map((chord) => chord.start < cutoff
      ? {
          ...chord,
          start: cutoff,
          durationBeats: chord.start + chord.durationBeats - cutoff,
          bar: 4,
        }
      : chord);
  const head = ["i", "VII", "VI", "V7"].map((symbol, bar) =>
    chordFromRoman(symbol, bar, key, bar * bb, bb));
  chords.splice(0, chords.length, ...head, ...tail);
  annotations.push({
    bar: 0,
    ruleId: "lament-bass",
    text: "ラメント・バス: i → VII → VI → V7 と低音が順次下降",
  });
});
