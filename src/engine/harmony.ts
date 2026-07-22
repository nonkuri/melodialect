import type {
  Annotation,
  ChordSymbolAst,
  ChordEvent,
  ChordQuality,
  Dialect,
  KeySignature,
  ParsedRoman,
  PitchCollection,
  SectionPlan,
  WeightedProgression,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { applyCliche } from "./techniques.js";

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

const PITCH_COLLECTIONS: Record<PitchCollection, readonly number[]> = {
  major: MAJOR_SCALE,
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "natural-minor": NATURAL_MINOR_SCALE,
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "major-pentatonic": [0, 2, 4, 7, 9],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

const DEGREE_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
};

const ACCIDENTAL_VALUE: Record<string, -2 | -1 | 0 | 1 | 2> = {
  "": 0, "♭": -1, b: -1, "♭♭": -2, bb: -2, "♯": 1, "#": 1, "♯♯": 2,
};

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  dom9: [0, 4, 7, 10, 14],
  halfDim7: [0, 3, 6, 10],
};

/** Parse extended Roman symbols while keeping parseRoman backward compatible. */
export function parseChordSymbol(symbol: string): ChordSymbolAst {
  const m = symbol.match(
    /^(♭♭|bb|♭|b|♯♯|♯|#)?([iIvV]+)(ø7|°7|°|dim|sus2|sus4|add9|△13|maj13|M13|13|△11|maj11|M11|11|△9|maj9|M9|9|△7|maj7|M7|7|6)?((?:[♭♯#b](?:5|9|11|13))*)(?:\/(♭♭|bb|♭|b|♯♯|♯|#)?([iIvV]+|[1-7]))?$/,
  );
  if (!m) throw new Error(`invalid roman numeral: ${symbol}`);
  const [, accidentalText = "", numeral, suffix, alterationText = "", slashAccidental = "", slashTarget] = m;
  const degree = DEGREE_MAP[numeral!.toLowerCase()];
  if (degree === undefined) throw new Error(`invalid roman numeral: ${symbol}`);
  const isMinorTriad = numeral === numeral!.toLowerCase();

  let quality: ChordQuality;
  if (suffix === "ø7") {
    quality = "halfDim7";
  } else if (suffix === "°" || suffix === "°7" || suffix === "dim") {
    quality = "dim";
  } else if (suffix === "sus2" || suffix === "sus4" || suffix === "add9") {
    quality = suffix;
  } else if (suffix === "6") {
    quality = isMinorTriad ? "min" : "maj";
  } else if (suffix === "9") {
    quality = isMinorTriad ? "min9" : "dom9";
  } else if (suffix === "△9" || suffix === "maj9" || suffix === "M9") {
    quality = "maj9";
  } else if (suffix === "11" || suffix === "13") {
    quality = isMinorTriad ? "min7" : "dom7";
  } else if (suffix === "△11" || suffix === "maj11" || suffix === "M11" ||
    suffix === "△13" || suffix === "maj13" || suffix === "M13") {
    quality = "maj7";
  } else if (suffix === "7") {
    quality = isMinorTriad ? "min7" : "dom7";
  } else if (suffix) {
    quality = "maj7";
  } else {
    quality = isMinorTriad ? "min" : "maj";
  }
  const extensionMatch = suffix?.match(/(6|7|9|11|13)$/);
  const alterations = Array.from(alterationText.matchAll(/([♭b♯#])(5|9|11|13)/g)).map((entry) => ({
    degree: Number(entry[2]),
    accidental: (entry[1] === "♭" || entry[1] === "b" ? -1 : 1) as -1 | 1,
  }));
  const slashDegree = slashTarget
    ? /^[1-7]$/.test(slashTarget) ? Number(slashTarget) : DEGREE_MAP[slashTarget.toLowerCase()]
    : undefined;
  const slash = slashDegree
    ? { accidental: ACCIDENTAL_VALUE[slashAccidental] ?? 0, degree: slashDegree }
    : undefined;
  return {
    accidental: ACCIDENTAL_VALUE[accidentalText] ?? 0,
    degree,
    quality,
    extension: extensionMatch ? Number(extensionMatch[1]) : undefined,
    alterations: alterations.length ? alterations : undefined,
    bass: slashTarget && /^[1-7]$/.test(slashTarget) ? slash : undefined,
    secondaryOf: slashTarget && !/^[1-7]$/.test(slashTarget) ? slash : undefined,
  };
}

/** "♭VII", "ii7", "IV△7" などのローマ数字表記をパースする */
export function parseRoman(symbol: string): ParsedRoman {
  const ast = parseChordSymbol(symbol);
  return { degree: ast.degree, flat: ast.accidental < 0, quality: ast.quality };
}

export function scaleOf(key: KeySignature, collection?: PitchCollection): number[] {
  const base = collection
    ? PITCH_COLLECTIONS[collection]
    : key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  return base.map((offset) => (key.tonic + offset) % 12);
}

/** ローマ数字のルートのピッチクラスを求める */
export function romanRootPc(parsed: ParsedRoman, key: KeySignature): number {
  const base = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  const offset = base[parsed.degree - 1]! + (parsed.flat ? -1 : 0);
  return (((key.tonic + offset) % 12) + 12) % 12;
}

function astRootPc(ast: ChordSymbolAst, key: KeySignature): number {
  if (ast.secondaryOf) {
    const target = romanRootPc({
      degree: ast.secondaryOf.degree,
      flat: ast.secondaryOf.accidental < 0,
      quality: "maj",
    }, key);
    return (target + 7 + 12) % 12;
  }
  const base = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  return (((key.tonic + base[ast.degree - 1]! + ast.accidental) % 12) + 12) % 12;
}

function intervalsForAst(ast: ChordSymbolAst): number[] {
  const intervals = [...QUALITY_INTERVALS[ast.quality]];
  if (ast.extension === 6 && !intervals.includes(9)) intervals.push(9);
  if (ast.extension && ast.extension >= 9 && !intervals.includes(14)) intervals.push(14);
  if (ast.extension && ast.extension >= 11 && !intervals.includes(17)) intervals.push(17);
  if (ast.extension && ast.extension >= 13 && !intervals.includes(21)) intervals.push(21);
  for (const alteration of ast.alterations ?? []) {
    const natural = alteration.degree === 5 ? 7 : alteration.degree === 9 ? 14
      : alteration.degree === 11 ? 17 : 21;
    const existing = intervals.findIndex((interval) => interval % 12 === natural % 12);
    if (existing >= 0) intervals[existing] = natural + alteration.accidental;
    else intervals.push(natural + alteration.accidental);
  }
  return Array.from(new Set(intervals)).sort((a, b) => a - b);
}

/** ピッチクラスを [low, low+11] のオクターブ内の MIDI ノートにする */
export function pcToPitch(pc: number, low: number): number {
  const p = low + ((((pc - low) % 12) + 12) % 12);
  return p;
}

export function chordFromRoman(
  symbol: string,
  bar: number,
  key: KeySignature,
  start = 0,
  durationBeats = 0,
): ChordEvent {
  const ast = parseChordSymbol(symbol);
  const rootPc = astRootPc(ast, key);
  const root = pcToPitch(rootPc, 48); // C3 付近にボイシング
  const pitches = intervalsForAst(ast).map((iv) => root + iv);
  const bassPc = ast.bass
    ? romanRootPc({ degree: ast.bass.degree, flat: ast.bass.accidental < 0, quality: "maj" }, key)
    : rootPc;
  const bassPitch = pcToPitch(bassPc, 36); // C2 付近
  return { start, durationBeats, bar, symbol, rootPc, quality: ast.quality, pitches, bassPitch, ast };
}

/** beat 時点で鳴っているコードを返す (ハーモニックリズム対応の検索) */
export function chordAtBeat(chords: ChordEvent[], beat: number): ChordEvent {
  let current = chords[0]!;
  for (const c of chords) {
    if (c.start <= beat + 1e-9) current = c;
    else break;
  }
  return current;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "", min: "m", dom7: "7", maj7: "△7", min7: "m7", dim: "dim",
  sus2: "sus2", sus4: "sus4", add9: "add9", maj9: "△9", min9: "m9",
  dom9: "9", halfDim7: "m7♭5",
};

/**
 * 実音のコードネーム表示 (譜面用 §4.4)。例: "C", "Am7", "F/A", "B♭"。
 * scalePcs を渡すと、スケール外のスラッシュベース音は下降半音階の慣例に
 * 従ってフラットで綴る (例: C メジャーで C/A# ではなく C/B♭)
 */
export function chordDisplayName(
  chord: ChordEvent,
  useFlats: boolean,
  scalePcs?: number[],
): string {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  const root = names[chord.rootPc]!;
  const ast = chord.ast;
  let suffix = QUALITY_SUFFIX[chord.quality];
  if (ast?.extension === 6) suffix = chord.quality === "min" ? "m6" : "6";
  else if (ast?.extension && ast.extension >= 11) {
    suffix = chord.quality === "min7" || chord.quality === "min9" ? `m${ast.extension}`
      : chord.quality === "maj7" || chord.quality === "maj9" ? `△${ast.extension}`
        : String(ast.extension);
  }
  if (ast?.alterations?.length) {
    suffix += ast.alterations.map((alteration) =>
      `${alteration.accidental < 0 ? "♭" : "♯"}${alteration.degree}`).join("");
  }
  let name = root + suffix;
  const bassPc = ((chord.bassPitch % 12) + 12) % 12;
  if (bassPc !== chord.rootPc) {
    const bassNames =
      scalePcs && !scalePcs.includes(bassPc) ? FLAT_NAMES : names;
    name += `/${bassNames[bassPc]}`;
  }
  return name;
}

export interface ProgressionResult {
  chords: ChordEvent[];
  annotations: Annotation[];
}

/** コードスロット: ハーモニックリズムで決まる 1 コード分の時間枠 */
interface ChordSlot {
  start: number;
  duration: number;
  bar: number;
}

/** 語彙からトニックに相当するシンボルを探す ("I" が無い語彙は "I△7" 等で始める) */
function tonicSymbolOf(dialect: Dialect): string {
  if (dialect.chord.vocabulary.includes("I")) return "I";
  const found = dialect.chord.vocabulary.find((s) => {
    try {
      const p = parseRoman(s);
      return p.degree === 1 && !p.flat;
    } catch {
      return false;
    }
  });
  return found ?? "I";
}

/**
 * ハーモニックリズム (§4.1) に従ってスロット列を決める。
 * "0.5" = 2 小節 1 コード、"1" = 1 小節 1 コード、"2" = 1 小節 2 コード。
 * 末尾 cadenceBars 小節はカデンツ用に必ず 1 小節 1 コードで確保する。
 */
function planChordSlots(
  plan: SectionPlan,
  dialect: Dialect,
  meter: Meter,
  rng: Rng,
  cadenceBars: number,
): ChordSlot[] {
  const bb = meter.barBeats;
  const sectionRule = dialect.sectionRules?.[plan.type];
  const hr =
    sectionRule?.harmonicRhythm ??
    dialect.chord.harmonicRhythm?.[plan.type] ??
    dialect.chord.harmonicRhythm?.["default"] ??
    { "1": 1 };
  const bodyEnd = plan.bars - cadenceBars;
  const slots: ChordSlot[] = [];

  let bar = 0;
  while (bar < bodyEnd) {
    const entries = Object.entries(hr).filter(([k, w]) => {
      if (w <= 0) return false;
      if (k === "0.5" && bar + 2 > bodyEnd) return false;
      return true;
    }) as Array<[string, number]>;
    const pattern = entries.length > 0 ? rng.weighted(entries) : "1";

    if (pattern === "0.5") {
      slots.push({ start: bar * bb, duration: 2 * bb, bar });
      bar += 2;
    } else if (pattern === "2") {
      slots.push({ start: bar * bb, duration: bb / 2, bar });
      slots.push({ start: bar * bb + bb / 2, duration: bb / 2, bar });
      bar += 1;
    } else {
      slots.push({ start: bar * bb, duration: bb, bar });
      bar += 1;
    }
  }
  for (; bar < plan.bars; bar++) {
    slots.push({ start: bar * bb, duration: bb, bar });
  }
  return slots;
}

/** 終止形の注記ラベル (§4.1)。V→I 全終止、IV→I 変格終止、V→vi 偽終止など */
function finalCadenceLabel(pair: string[]): string {
  try {
    const from = parseRoman(pair[0]!);
    const to = parseRoman(pair[1]!);
    if (to.degree === 1 && !to.flat) {
      if (from.degree === 5 && !from.flat) return "全終止 (V→I)";
      if (from.degree === 4 && !from.flat) return "変格終止 (IV→I)";
      if (from.degree === 7 && from.flat) return "モーダル終止 (♭VII→I)";
      if (from.degree === 4 && from.flat === false && from.quality === "min") return "変格終止";
    }
    if (to.degree === 6) return "偽終止 (V→vi)";
  } catch {
    /* 表示だけの分類なので失敗しても無視 */
  }
  return "終止";
}

function halfCadenceLabel(symbol: string): string {
  try {
    const p = parseRoman(symbol);
    if (p.degree === 5 && !p.flat) return "半終止 (V で開いたまま次へ)";
    if (p.degree === 4 && !p.flat) return "変格系の半終止 (IV 止まり)";
    if (p.degree === 7 && p.flat) return "モーダルな半終止 (♭VII 止まり)";
  } catch {
    /* ignore */
  }
  return `半終止 (${symbol})`;
}

type HarmonicFunction = "tonic" | "predominant" | "dominant" | "color";

function harmonicFunctionOf(symbol: string): HarmonicFunction {
  try {
    const ast = parseChordSymbol(symbol);
    if (ast.secondaryOf || ast.degree === 5 || ast.degree === 7) return "dominant";
    if (ast.degree === 2 || ast.degree === 4) return "predominant";
    if (ast.degree === 1 || ast.degree === 3 || ast.degree === 6) return "tonic";
  } catch {
    // Validation reports malformed vocabulary separately; the planner treats it as color.
  }
  return "color";
}

function harmonicTension(symbol: string): number {
  const fn = harmonicFunctionOf(symbol);
  let value = fn === "dominant" ? 0.9 : fn === "predominant" ? 0.58 : fn === "tonic" ? 0.2 : 0.68;
  try {
    const ast = parseChordSymbol(symbol);
    if (ast.accidental !== 0 || ast.secondaryOf) value += 0.12;
    if ((ast.extension ?? 0) >= 9 || ast.alterations?.length) value += 0.08;
  } catch { /* keep the functional fallback */ }
  return Math.min(1, value);
}

interface HarmonicPath {
  symbols: string[];
  score: number;
  idioms: Array<{ index: number; symbols: string[] }>;
}

function desiredTension(position: number, sectionType: SectionPlan["type"], amount: number): number {
  const sectionBias = sectionType === "chorus" ? 0.1 : sectionType === "bridge" ? 0.16
    : sectionType === "intro" || sectionType === "outro" ? -0.08 : 0;
  const arc = position < 0.25 ? 0.18 + position
    : position < 0.75 ? 0.35 + position * 0.35
      : 0.62 + position * 0.25;
  return Math.max(0.08, Math.min(0.95, arc + sectionBias + (amount - 0.5) * 0.28));
}

function functionalPathScore(
  previous: string,
  next: string,
  transitionWeight: number,
  position: number,
  plan: SectionPlan,
  tension: number,
  reference?: string[],
): number {
  const desired = desiredTension(position, plan.type, tension);
  const tensionFit = 1 - Math.abs(harmonicTension(next) - desired);
  const previousFunction = harmonicFunctionOf(previous);
  const nextFunction = harmonicFunctionOf(next);
  const functionalBonus =
    previousFunction === "predominant" && nextFunction === "dominant" ? 0.65
      : previousFunction === "dominant" && nextFunction === "tonic" ? 0.7
        : previousFunction === "tonic" && nextFunction === "predominant" ? 0.35 : 0;
  const repetitionPenalty = previous === next ? 0.9 : 0;
  const referenceSymbol = reference?.[Math.min(reference.length - 1, Math.floor(position * reference.length))];
  const relationship = referenceSymbol
    ? plan.type === "bridge"
      ? referenceSymbol === next ? -0.18 : 0.08
      : referenceSymbol === next ? 0.24 : 0
    : 0;
  return Math.log(Math.max(0.005, transitionWeight)) * 0.42 + tensionFit * 0.9 +
    functionalBonus + relationship - repetitionPenalty;
}

/** Destination-aware beam search over the dialect vocabulary and its idioms. */
function planFunctionalProgression(
  bodySlots: number,
  tonic: string,
  dialect: Dialect,
  plan: SectionPlan,
  rng: Rng,
  tension: number,
  reference?: string[],
): HarmonicPath {
  const idioms = dialect.sectionRules?.[plan.type]?.idioms ?? dialect.chord.idioms ?? [];
  const idiomProbability = dialect.sectionRules?.[plan.type]?.idiomProbability ??
    dialect.chord.idiomProbability ?? 0;
  let frontier: HarmonicPath[] = [{ symbols: [tonic], score: 0, idioms: [] }];
  const complete: HarmonicPath[] = [];
  const beamWidth = 12;

  while (frontier.length) {
    const expanded: HarmonicPath[] = [];
    for (const path of frontier) {
      if (path.symbols.length >= bodySlots) {
        complete.push(path);
        continue;
      }
      const previous = path.symbols.at(-1)!;
      const position = path.symbols.length / Math.max(1, bodySlots);
      const table = dialect.chord.transitions[previous] ?? {};
      for (const symbol of dialect.chord.vocabulary) {
        const transitionWeight = table[symbol] ?? 0.015;
        expanded.push({
          symbols: [...path.symbols, symbol],
          score: path.score + functionalPathScore(
            previous, symbol, transitionWeight, position, plan, tension, reference,
          ) + rng.next() * 0.18,
          idioms: path.idioms,
        });
      }
      for (const idiom of idioms) {
        const placement = idiom.symbols[0] === previous ? idiom.symbols.slice(1) : idiom.symbols;
        if (!placement.length || path.symbols.length + placement.length > bodySlots) continue;
        let score = path.score + Math.log1p(idiom.weight) * 0.55 + idiomProbability * 0.8;
        let from = previous;
        placement.forEach((symbol, offset) => {
          const transitionWeight = dialect.chord.transitions[from]?.[symbol] ?? 0.03;
          score += functionalPathScore(
            from, symbol, transitionWeight,
            (path.symbols.length + offset) / Math.max(1, bodySlots), plan, tension, reference,
          );
          from = symbol;
        });
        expanded.push({
          symbols: [...path.symbols, ...placement],
          score: score + rng.next() * 0.18,
          idioms: [...path.idioms, { index: path.symbols.length, symbols: idiom.symbols }],
        });
      }
    }
    if (!expanded.length) break;
    frontier = expanded.sort((a, b) => b.score - a.score).slice(0, beamWidth);
  }
  const choices = (complete.length ? complete : frontier)
    .sort((a, b) => b.score - a.score).slice(0, 4);
  const bestScore = choices[0]?.score ?? 0;
  return rng.weighted(choices.map((path) => [path, Math.exp(path.score - bestScore) + 0.05]));
}

/**
 * コード進行生成 (§4.2 手順 2)。
 * ハーモニックリズムでスロットを割り、定型句 (イディオム) 挿入+マルコフ遷移で埋め、
 * ダイアレクト別のカデンツで締める。最後に名前付き技法 (クリシェ) を適用する。
 */
export function generateProgression(
  plan: SectionPlan,
  dialect: Dialect,
  key: KeySignature,
  meter: Meter,
  rng: Rng,
  opts: {
    isFinalSection: boolean;
    tension?: number;
    referenceProgression?: string[];
  },
): ProgressionResult {
  const { vocabulary, transitions } = dialect.chord;
  const sectionRule = dialect.sectionRules?.[plan.type];
  const annotations: Annotation[] = [];
  const tonic = tonicSymbolOf(dialect);

  const cadenceBars = opts.isFinalSection ? Math.min(2, plan.bars) : Math.min(1, plan.bars);
  const slots = planChordSlots(plan, dialect, meter, rng, cadenceBars);
  const cadenceSlots = cadenceBars; // カデンツ小節は必ず 1 小節 1 スロット
  const bodySlots = slots.length - cadenceSlots;

  const symbols: string[] = new Array(slots.length);
  symbols[0] = tonic;
  let current = tonic;

  const planned = planFunctionalProgression(
    bodySlots, tonic, dialect, plan, rng, opts.tension ?? 0.5, opts.referenceProgression,
  );
  planned.symbols.forEach((symbol, index) => { symbols[index] = symbol; });
  current = planned.symbols.at(-1) ?? tonic;
  planned.idioms.forEach((idiom) => annotations.push({
    bar: slots[Math.min(idiom.index, slots.length - 1)]!.bar,
    ruleId: "chord-idiom",
    text: `定型句: ${idiom.symbols.join(" → ")}`,
    level: "event",
    category: "harmony",
  }));
  annotations.push({
    bar: 0,
    ruleId: "functional-harmony-plan",
    text: `${plan.type}の終止先から逆算し、和声機能と緊張の流れを整えた候補を選択`,
    level: "section",
    category: "harmony",
  });

  // カデンツ (§4.1): 最終セクションは 2 コードの終止形、途中セクションは半終止
  if (opts.isFinalSection && cadenceSlots >= 2) {
    const options = sectionRule?.cadences?.final ?? dialect.chord.cadences?.final ?? [
      { symbols: ["V7", tonic], weight: 1 },
    ];
    const pair = rng.weighted<WeightedProgression>(options.map((c) => [c, c.weight])).symbols;
    symbols[slots.length - 2] = pair[0]!;
    symbols[slots.length - 1] = pair[1]!;
    annotations.push({
      bar: slots[slots.length - 2]!.bar,
      ruleId: "cadence",
      text: `${finalCadenceLabel(pair)}: ${pair.join(" → ")}`,
    });
  } else if (cadenceSlots >= 1) {
    const options = sectionRule?.cadences?.half ?? dialect.chord.cadences?.half ?? [
      { symbols: ["V7"], weight: 1 },
    ];
    const pick = rng.weighted<WeightedProgression>(options.map((c) => [c, c.weight])).symbols;
    symbols[slots.length - 1] = pick[0]!;
    annotations.push({
      bar: slots[slots.length - 1]!.bar,
      ruleId: "cadence",
      text: halfCadenceLabel(pick[0]!),
    });
  }

  const chords = slots.map((slot, idx) =>
    chordFromRoman(symbols[idx]!, slot.bar, key, slot.start, slot.duration),
  );

  // 名前付き技法の適用 (技法レジストリ方式 §6.2)
  for (const name of [...dialect.chord.cliches, ...(sectionRule?.cliches ?? [])]) {
    applyCliche(name, chords, annotations, key, rng, plan, meter);
  }

  // 借用和音の注記は技法適用後の最終的なコードに対して付与する
  // (スラッシュ表記 "I/♭7" 等は技法側で注記済みなので除外)
  chords.forEach((chord) => {
    if (!chord.symbol.includes("/") && parseRoman(chord.symbol).flat) {
      annotations.push({
        bar: chord.bar,
        ruleId: "modal-interchange",
        text: `${chord.symbol} は同主短調からの借用和音 (モーダル・インターチェンジ)`,
      });
    }
  });

  return { chords, annotations };
}
