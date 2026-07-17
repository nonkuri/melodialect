import type {
  Annotation,
  ChordEvent,
  ChordQuality,
  Dialect,
  KeySignature,
  ParsedRoman,
  SectionPlan,
} from "./types.js";
import type { Rng } from "./rng.js";
import { applyCliche } from "./techniques.js";

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

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
};

/** "♭VII", "ii7", "IV△7" などのローマ数字表記をパースする */
export function parseRoman(symbol: string): ParsedRoman {
  const m = symbol.match(/^(♭|b)?([iIvV]+)(°|dim)?(△7|maj7|M7|7)?$/);
  if (!m) throw new Error(`invalid roman numeral: ${symbol}`);
  const [, flatMark, numeral, dimMark, seventh] = m;
  const degree = DEGREE_MAP[numeral!.toLowerCase()];
  if (degree === undefined) throw new Error(`invalid roman numeral: ${symbol}`);
  const isMinorTriad = numeral === numeral!.toLowerCase();

  let quality: ChordQuality;
  if (dimMark) {
    quality = "dim";
  } else if (seventh === "7") {
    quality = isMinorTriad ? "min7" : "dom7";
  } else if (seventh) {
    quality = "maj7";
  } else {
    quality = isMinorTriad ? "min" : "maj";
  }
  return { degree, flat: Boolean(flatMark), quality };
}

export function scaleOf(key: KeySignature): number[] {
  const base = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
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

export function chordFromRoman(symbol: string, bar: number, key: KeySignature): ChordEvent {
  const parsed = parseRoman(symbol);
  const rootPc = romanRootPc(parsed, key);
  const root = pcToPitch(rootPc, 48); // C3 付近にボイシング
  const pitches = QUALITY_INTERVALS[parsed.quality].map((iv) => root + iv);
  const bassPitch = pcToPitch(rootPc, 36); // C2 付近
  return { bar, symbol, rootPc, quality: parsed.quality, pitches, bassPitch };
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "", min: "m", dom7: "7", maj7: "△7", min7: "m7", dim: "dim",
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

/**
 * コード進行生成 (§4.2 手順 2)。
 * マルコフ遷移表 + カデンツ制約で 1 小節 1 コードを生成し、
 * ダイアレクトの名前付き技法 (クリシェ) を適用する。
 */
export function generateProgression(
  plan: SectionPlan,
  dialect: Dialect,
  key: KeySignature,
  rng: Rng,
  opts: { isFinalSection: boolean },
): ProgressionResult {
  const { vocabulary, transitions } = dialect.chord;
  const symbols: string[] = [];
  let current = "I";
  symbols.push(current);

  for (let bar = 1; bar < plan.bars; bar++) {
    const table = transitions[current];
    let nextSymbol: string;
    if (table && Object.keys(table).length > 0) {
      nextSymbol = rng.weighted(Object.entries(table));
    } else {
      const candidates = vocabulary.filter((s) => s !== current);
      nextSymbol = rng.pick(candidates.length > 0 ? candidates : vocabulary);
    }
    symbols.push(nextSymbol);
    current = nextSymbol;
  }

  // カデンツ制約: セクション末尾を V7 で締める (最終セクションは V7 → I の全終止)
  if (opts.isFinalSection && plan.bars >= 2) {
    symbols[plan.bars - 2] = "V7";
    symbols[plan.bars - 1] = "I";
  } else if (plan.bars >= 1) {
    symbols[plan.bars - 1] = "V7";
  }

  const chords = symbols.map((s, bar) => chordFromRoman(s, bar, key));
  const annotations: Annotation[] = [];

  // 名前付き技法の適用 (技法レジストリ方式 §6.2)
  for (const name of dialect.chord.cliches) {
    applyCliche(name, chords, annotations, key, rng, plan);
  }

  // 借用和音の注記は技法適用後の最終的なコードに対して付与する
  // (スラッシュ表記 "I/♭7" 等は技法側で注記済みなので除外)
  chords.forEach((chord, bar) => {
    if (!chord.symbol.includes("/") && parseRoman(chord.symbol).flat) {
      annotations.push({
        bar,
        ruleId: "modal-interchange",
        text: `${chord.symbol} は同主短調からの借用和音 (モーダル・インターチェンジ)`,
      });
    }
  });

  return { chords, annotations };
}
