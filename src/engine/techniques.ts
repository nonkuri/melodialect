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

/** "♭VII△7" → "♭VII"。品質を差し替える技法が土台の度数だけを取り出すために使う。 */
function numeralOf(symbol: string): string | undefined {
  return symbol.match(/^(?:♭♭|bb|♭|b|♯♯|♯|#)?[iIvV]+/)?.[0];
}

/**
 * 終止形は和声計画が決めたものなので、技法は末尾 2 和音へ触らない。
 * ここを侵すと注記に出したカデンツと実際の進行が食い違う
 */
function cadenceGuard(chords: ChordEvent[]): number {
  return Math.max(0, chords.length - 2);
}

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

/**
 * 掛留とその解決。1 拍以上ある和音を前半 sus4 / 後半もとの和音へ二分し、
 * 3 度が遅れて現れる響きを作る。カデンツの 2 和音には触らない
 */
registerCliche("suspension-resolution", (chords, annotations, key, rng) => {
  const applied: Array<{ bar: number; symbol: string }> = [];
  // 掛留は和音の装飾なので、セクション冒頭の和音 (調とダイアレクトの顔を示す)
  // とカデンツの間だけに置く
  for (let index = cadenceGuard(chords) - 1; index >= 1; index--) {
    const chord = chords[index]!;
    // すでに sus、転回ベース付き、二分すると短すぎる和音は対象外
    if (chord.durationBeats < 2 || /sus/.test(chord.symbol) || chord.symbol.includes("/")) continue;
    const numeral = numeralOf(chord.symbol);
    if (!numeral || !rng.chance(0.4)) continue;
    const half = chord.durationBeats / 2;
    chords.splice(index, 1,
      chordFromRoman(`${numeral}sus4`, chord.bar, key, chord.start, half),
      chordFromRoman(chord.symbol, chord.bar, key, chord.start + half, half));
    applied.push({ bar: chord.bar, symbol: chord.symbol });
  }
  applied.reverse().forEach(({ bar, symbol }) => annotations.push({
    bar,
    ruleId: "suspension-resolution",
    text: `${numeralOf(symbol)}sus4 → ${symbol}: 4 度を掛留し、3 度を遅らせて解決`,
  }));
});

/**
 * 裏コード。I へ解決する V7 を ♭II7 へ置き換え、ベースを半音上から落とす。
 * 終止形の V7 は和声計画の宣言なので対象にせず、途中の V7 だけを扱う
 */
registerCliche("tritone-substitution", (chords, annotations, key, rng) => {
  for (let index = 0; index < cadenceGuard(chords) - 1; index++) {
    const chord = chords[index]!;
    const next = chords[index + 1]!;
    if (chord.symbol.includes("/")) continue;
    let current: ReturnType<typeof parseRoman>;
    let following: ReturnType<typeof parseRoman>;
    try {
      current = parseRoman(chord.symbol);
      following = parseRoman(next.symbol);
    } catch {
      continue;
    }
    if (current.flat || current.degree !== 5) continue;
    if (current.quality !== "dom7" && current.quality !== "dom9") continue;
    if (following.degree !== 1 || following.flat) continue;
    if (!rng.chance(0.6)) continue;
    replaceChordSymbol(chords, index, "♭II7", key);
    annotations.push({
      bar: chord.bar,
      ruleId: "tritone-substitution",
      text: `${chord.symbol} → ♭II7: 裏コードへ置換し、ベースを半音上から ${next.symbol} へ落とす`,
    });
  }
});

/**
 * 平行移動。冒頭 3 スロットを同じ品質のまま長 2 度ずつ下げ、
 * 機能進行ではなく響きの平行移動で始める
 */
registerCliche("parallel-planing", (chords, annotations, key, rng) => {
  if (chords.length < 5 || !rng.chance(0.55)) return;
  const line = key.mode === "major"
    ? ["I△7", "♭VII△7", "♭VI△7"]
    : ["i7", "VII△7", "VI△7"];
  line.forEach((symbol, index) => replaceChordSymbol(chords, index, symbol, key));
  annotations.push({
    bar: 0,
    ruleId: "parallel-planing",
    text: `${line.join(" → ")}: 和音の形を保ったまま全音ずつ平行移動`,
  });
});

/**
 * ペダル上の和声変化。冒頭フレーズの間だけベースを主音に固定し、
 * 上の和音だけを動かす。ベース音以外は書き換えない
 */
registerCliche("pedal-shift", (chords, annotations, key, rng, plan, meter) => {
  const window = Math.min(4, plan.phraseLengths[0] ?? 4) * meter.barBeats;
  const tonicBass = pcToPitch(key.tonic, 36);
  const applied: number[] = [];
  for (let index = 0; index < cadenceGuard(chords); index++) {
    const chord = chords[index]!;
    if (chord.start >= window) break;
    if (chord.bassPitch === tonicBass || chord.symbol.includes("/")) continue;
    if (!rng.chance(0.8)) continue;
    chord.bassPitch = tonicBass;
    chord.symbol = `${chord.symbol}/1`;
    applied.push(chord.bar);
  }
  if (!applied.length) return;
  annotations.push({
    bar: applied[0]!,
    ruleId: "pedal-shift",
    text: `${applied.map((bar) => bar + 1).join("・")}小節: ベースを主音に固定し、上の和音だけを動かす`,
  });
});

/**
 * 旋法の明暗を一度だけ入れ替える。長調では IV を同主短調の iv へ、
 * 短調では iv を IV へ差し替え、進行の途中に色の変化を作る
 */
registerCliche("modal-brightening", (chords, annotations, key, rng) => {
  const brighten = key.mode === "minor";
  const candidates: number[] = [];
  for (let index = 1; index < cadenceGuard(chords); index++) {
    const chord = chords[index]!;
    if (chord.symbol.includes("/")) continue;
    try {
      const parsed = parseRoman(chord.symbol);
      if (parsed.degree !== 4 || parsed.flat) continue;
      const isMinorChord = parsed.quality === "min" || parsed.quality === "min7" || parsed.quality === "min9";
      if (brighten === isMinorChord) candidates.push(index);
    } catch { /* 解釈できない記号は対象外 */ }
  }
  if (!candidates.length || !rng.chance(0.7)) return;
  const index = candidates[rng.int(0, candidates.length - 1)]!;
  const before = chords[index]!.symbol;
  const after = brighten ? "IV" : "iv";
  replaceChordSymbol(chords, index, after, key);
  annotations.push({
    bar: chords[index]!.bar,
    ruleId: "modal-brightening",
    text: brighten
      ? `${before} → ${after}: 短調の 4 度を長和音へ変え、一瞬だけ明るくする`
      : `${before} → ${after}: 4 度を同主短調から借り、一瞬だけ翳らせる`,
  });
});

/**
 * リフの固定枠。冒頭 2 小節のコード列をセルとして、カデンツ手前まで反復する。
 * セル境界に和音の切れ目がない (2 小節をまたぐ和音がある) 場合は適用しない
 */
registerCliche("riff-anchor", (chords, annotations, key, rng, plan, meter) => {
  const cell = meter.barBeats * 2;
  if (plan.bars < 6 || chords.length < 4 || !rng.chance(0.75)) return;
  const protectedStart = chords[cadenceGuard(chords)]?.start;
  if (protectedStart === undefined || protectedStart < cell * 2) return;
  const head = chords.filter((chord) => chord.start + chord.durationBeats <= cell + 1e-9);
  // セルを埋め切らない (2 小節をまたぐ和音がある) 場合、複製すると被覆に穴が空く
  const covered = head.reduce((sum, chord) => sum + chord.durationBeats, 0);
  if (!head.length || head[0]!.start !== 0 || Math.abs(covered - cell) > 1e-9) return;
  const repeats = Math.floor((protectedStart - cell) / cell);
  if (repeats < 1) return;
  const copiedUntil = cell + repeats * cell;
  // 反復区間の終わりが和音の切れ目と一致しないと、コード被覆に穴が空く
  if (!chords.some((chord) => Math.abs(chord.start - copiedUntil) < 1e-9)) return;
  const rebuilt: ChordEvent[] = [...head];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const offset = repeat * cell;
    for (const chord of head) {
      rebuilt.push({
        ...chord,
        start: chord.start + offset,
        bar: chord.bar + (offset / meter.barBeats),
      });
    }
  }
  rebuilt.push(...chords.filter((chord) => chord.start >= copiedUntil - 1e-9));
  chords.splice(0, chords.length, ...rebuilt);
  annotations.push({
    bar: 0,
    ruleId: "riff-anchor",
    text: `${head.map((chord) => chord.symbol).join(" → ")}: 2 小節のリフを ${repeats + 1} 回反復して土台にする`,
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
