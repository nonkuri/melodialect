import type {
  Annotation,
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

/** "♭VII", "ii7", "IV△7" などのローマ数字表記をパースする */
export function parseRoman(symbol: string): ParsedRoman {
  const m = symbol.match(
    /^(♭|b)?([iIvV]+)(ø7|°7|°|dim|sus2|sus4|add9|△9|maj9|M9|9|△7|maj7|M7|7)?$/,
  );
  if (!m) throw new Error(`invalid roman numeral: ${symbol}`);
  const [, flatMark, numeral, suffix] = m;
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
  } else if (suffix === "9") {
    quality = isMinorTriad ? "min9" : "dom9";
  } else if (suffix === "△9" || suffix === "maj9" || suffix === "M9") {
    quality = "maj9";
  } else if (suffix === "7") {
    quality = isMinorTriad ? "min7" : "dom7";
  } else if (suffix) {
    quality = "maj7";
  } else {
    quality = isMinorTriad ? "min" : "maj";
  }
  return { degree, flat: Boolean(flatMark), quality };
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
  const parsed = parseRoman(symbol);
  const rootPc = romanRootPc(parsed, key);
  const root = pcToPitch(rootPc, 48); // C3 付近にボイシング
  const pitches = QUALITY_INTERVALS[parsed.quality].map((iv) => root + iv);
  const bassPitch = pcToPitch(rootPc, 36); // C2 付近
  return { start, durationBeats, bar, symbol, rootPc, quality: parsed.quality, pitches, bassPitch };
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
  let name = root + QUALITY_SUFFIX[chord.quality];
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
  opts: { isFinalSection: boolean },
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

  const idioms = sectionRule?.idioms ?? dialect.chord.idioms ?? [];
  const idiomP = sectionRule?.idiomProbability ?? dialect.chord.idiomProbability ?? 0;

  let i = 1;
  while (i < bodySlots) {
    // 定型句 (イディオム): 3〜4 コードのまとまりをそのまま挿入する (§4.1)
    let placed = false;
    if (idioms.length > 0 && rng.chance(idiomP)) {
      const idiom = rng.weighted<WeightedProgression>(idioms.map((d) => [d, d.weight]));
      // 現在の和音から始まる定型句では先頭を重ねない。従来は冒頭の I を
      // 生成済みなのに I→I→vi… と置き、定型句の推進力を損ねていた。
      const placement = idiom.symbols[0] === current
        ? idiom.symbols.slice(1)
        : idiom.symbols;
      if (placement.length > 0 && i + placement.length <= bodySlots) {
        placement.forEach((s, j) => {
          symbols[i + j] = s;
        });
        annotations.push({
          bar: slots[i]!.bar,
          ruleId: "chord-idiom",
          text: `定型句: ${idiom.symbols.join(" → ")}`,
        });
        i += placement.length;
        current = idiom.symbols.at(-1)!;
        placed = true;
      }
    }
    if (!placed) {
      const table = transitions[current];
      let nextSymbol: string;
      if (table && Object.keys(table).length > 0) {
        nextSymbol = rng.weighted(Object.entries(table));
      } else {
        const candidates = vocabulary.filter((s) => s !== current);
        nextSymbol = rng.pick(candidates.length > 0 ? candidates : vocabulary);
      }
      symbols[i] = nextSymbol;
      current = nextSymbol;
      i += 1;
    }
  }

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
