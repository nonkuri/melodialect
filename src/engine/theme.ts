/**
 * 主題の再帰 (§4.1)。
 *
 * 繰り返すセクションを「新しい素材」ではなく「主題の再現・変奏」として作る。
 *
 * 導入前の実測 (14 ダイアレクト × 10 シード、既定フロー、候補 3):
 *   繰り返す Chorus 同士で 進行の一致 6% / 旋律の律動の一致 0% / 音列の一致 0%
 *   Verse も同様 (9% / 0% / 0%)
 * 一方でセクション内は 小節反復 45% / フレーズ反復 48% と反復しており、
 * 「セクション境界で主題が破棄される」ことだけが問題だった。
 *
 * 原因は 2 つあり、どちらもここで塞ぐ。
 *  1. Chorus の再現を行う applyMotifAndChorusDesign が options.design のある
 *     ときしか走らず、既定フロー (ダイアレクト選択 → 全体生成) では
 *     一度も実行されなかった
 *  2. 進行の再現が beam search の +0.24 のソフト加点でしかなく、
 *     同じ式の tensionFit×0.9 や機能ボーナス 0.65〜0.7 に毎回負けていた
 *
 * 多様性はシード間ですでに飽和している (別シードで進行が一致するのは 5%、
 * 旋律の音列が一致するのは 0%)。ここで反復を足しても、別シードの曲は
 * 別の主題を持つため、曲間の多様性は損なわれない。
 */
import { chordAtBeat, chordFromRoman, scaleOf } from "./harmony.js";
import { registerPlanFor } from "./register.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import type {
  Annotation,
  ChordEvent,
  Dialect,
  GeneratedSection,
  KeySignature,
  NoteEvent,
  SectionPlan,
  SectionType,
  ThemeGrammar,
  ThemeReturn,
} from "./types.js";

/**
 * エンジン既定の主題規則 = 定型的なポップ。
 *
 * Chorus は律動も音程もほぼそのまま戻し (フックとして記憶に残す)、
 * Verse は律動を共有したまま音程を書き換える (歌詞違いの 2 番)。
 * Bridge・Intro・Outro は対比を担当するので作り直す。
 */
export const DEFAULT_THEME: ThemeGrammar = {
  recurrence: { verse: "vary", chorus: "vary", default: "new" },
  variation: { chorus: 0.25, verse: 0.6, default: 0.5 },
  finalLift: true,
};

export function themeGrammarFor(dialect: Dialect): ThemeGrammar {
  const source = dialect.theme;
  return {
    recurrence: { ...DEFAULT_THEME.recurrence, ...source?.recurrence },
    variation: { ...DEFAULT_THEME.variation, ...source?.variation },
    finalLift: source?.finalLift ?? DEFAULT_THEME.finalLift,
  };
}

export function recurrenceFor(grammar: ThemeGrammar, type: SectionType): ThemeReturn {
  return grammar.recurrence[type] ?? grammar.recurrence.default ?? "new";
}

function variationFor(grammar: ThemeGrammar, type: SectionType): number {
  const value = grammar.variation[type] ?? grammar.variation.default ?? 0.5;
  return Math.min(1, Math.max(0, value));
}

/** 1 セクション分の主題。同じタイプのセクションが再び来たときに参照する */
export interface SectionTheme {
  type: SectionType;
  key: KeySignature;
  phraseLengths: number[];
  bars: number;
  /** 本体の進行。終止スロットを含む生の並び */
  chords: ChordEvent[];
  melody: NoteEvent[];
}

export function captureTheme(section: GeneratedSection): SectionTheme {
  return {
    type: section.plan.type,
    key: { ...section.key },
    phraseLengths: [...section.plan.phraseLengths],
    bars: section.plan.bars,
    chords: section.chords.map((chord) => ({ ...chord, pitches: [...chord.pitches] })),
    melody: section.melody.map((note) => ({ ...note })),
  };
}

/** 転調しても同じ主題として聞こえるよう、最短の半音差で移動量を取る */
function keyDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 6) delta -= 12;
  while (delta < -6) delta += 12;
  return delta;
}

/**
 * 主題の進行をこのセクションの調で作り直す。
 *
 * 拍の割り付け (start / durationBeats / bar) は主題のものをそのまま使う。
 * ハーモニックリズムまで作り直すと、同じコードでも「別の曲」に聞こえるため。
 */
export function restateProgression(
  theme: SectionTheme,
  key: KeySignature,
  totalBeats: number,
): ChordEvent[] {
  const chords: ChordEvent[] = [];
  for (const source of theme.chords) {
    if (source.start >= totalBeats - 1e-7) break;
    const duration = Math.min(source.durationBeats, totalBeats - source.start);
    if (duration <= 1e-7) break;
    try {
      chords.push({
        ...chordFromRoman(source.symbol, source.bar, key, source.start, duration),
        origin: source.origin,
      });
    } catch {
      // 主題の記号がこの調で解釈できない場合だけ、その 1 コードを諦める。
      // ここで例外を投げると再現できないセクションが曲全体を落とす
      return [];
    }
  }
  if (!chords.length) return [];
  // 主題より長いセクションが来た場合は末尾を伸ばして被覆の穴を塞ぐ
  const last = chords.at(-1)!;
  const end = last.start + last.durationBeats;
  if (end < totalBeats - 1e-7) last.durationBeats = totalBeats - last.start;
  return chords;
}

function isChordTone(pitch: number, chord: ChordEvent): boolean {
  const pcs = chord.pitches.map((value) => value % 12);
  return pcs.includes(((pitch % 12) + 12) % 12);
}

function snapToChordTone(pitch: number, chord: ChordEvent): number {
  let best = pitch;
  let bestDistance = Infinity;
  for (const tone of chord.pitches) {
    for (let octave = -3; octave <= 3; octave++) {
      const candidate = tone + octave * 12;
      const distance = Math.abs(candidate - pitch);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  return best;
}

function stepOnScale(pitch: number, steps: number, scalePcs: number[]): number {
  if (!scalePcs.length || steps === 0) return pitch;
  const direction = steps > 0 ? 1 : -1;
  let current = pitch;
  for (let taken = 0; taken < Math.abs(steps); taken++) {
    for (let offset = 1; offset <= 12; offset++) {
      const candidate = current + direction * offset;
      if (scalePcs.includes(((candidate % 12) + 12) % 12)) {
        current = candidate;
        break;
      }
    }
  }
  return current;
}

/** 音域からはみ出した音を、オクターブ単位で窓の中へ戻す */
function foldIntoRange(pitch: number, low: number, high: number): number {
  let value = pitch;
  while (value < low) value += 12;
  while (value > high) value -= 12;
  return Math.min(high, Math.max(low, value));
}

export interface RestatedMelody {
  notes: NoteEvent[];
  annotations: Annotation[];
}

/**
 * 主題の旋律をこのセクションへ再現する。
 *
 * 律動 (start / duration) は常に主題のものを保つ。これが主題の同一性を担う。
 * mode が "vary" のときだけ、variation の割合で音程を書き換える。書き換えは
 * 「その位置のコードに合う範囲でスケール上を 1〜2 度動かす」に限る。
 * 大きく動かすと、律動だけ同じで輪郭が無関係な、かえって不自然な旋律になる。
 */
export function restateMelody(
  theme: SectionTheme,
  plan: SectionPlan,
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  meter: Meter,
  rng: Rng,
  mode: Exclude<ThemeReturn, "new">,
): RestatedMelody {
  const grammar = themeGrammarFor(dialect);
  const amount = mode === "same" ? 0 : variationFor(grammar, plan.type);
  const delta = keyDelta(theme.key.tonic, key.tonic);
  const scalePcs = scaleOf(key, dialect.melody.pitchCollection);
  const registerPlan = registerPlanFor(dialect);
  const shift = dialect.melody.registerShift?.[plan.type] ?? 0;
  const low = registerPlan.melody[0] + shift;
  const high = registerPlan.melody[1] + shift;
  const limit = plan.bars * meter.barBeats;
  const strong = new Set(meter.strongBeats);

  const notes: NoteEvent[] = [];
  /** 変奏で音程を書き換えた音。前後が変わると隣接半音の根拠が消えるので後で見る */
  const variedNotes = new Set<number>();
  for (const source of theme.melody) {
    if (source.start >= limit - 1e-7) break;
    const duration = Math.min(source.duration, limit - source.start);
    if (duration <= 1e-7) continue;
    const chord = chordAtBeat(chords, source.start);
    const onStrongBeat = strong.has(((source.start % meter.barBeats) + meter.barBeats) % meter.barBeats);
    let pitch = source.pitch + delta;

    let varied = false;
    if (amount > 0 && rng.chance(amount)) {
      // 変奏は上下 1〜2 度まで。輪郭を保ったまま「別の歌い回し」にする
      const steps = rng.chance(0.65) ? 1 : 2;
      pitch = stepOnScale(pitch, rng.chance(0.5) ? steps : -steps, scalePcs);
      varied = true;
    }
    // 強拍の持続音が和音から外れると v1.3 で潰した半音衝突が戻るため、
    // 強拍かつ長い音はコードトーンへ寄せる。ただし主題の音をそのまま
    // 使っていて、その位置の和音も主題と同じなら触らない。主題の非和声音は
    // 生成時に解決を検証済みで、ここで吸着するとダイアレクト固有の倚音・掛留が
    // 再現のたびに消える (実測で "same" 指定の Chorus が主題と一致しなくなっていた)
    const themeChord = chordAtBeat(theme.chords, source.start);
    const harmonyMoved = varied || themeChord.symbol !== chord.symbol;
    if (harmonyMoved && onStrongBeat && duration >= 1 && !isChordTone(pitch, chord)) {
      pitch = snapToChordTone(pitch, chord);
    }
    if (varied) variedNotes.add(notes.length);
    notes.push({
      start: source.start,
      duration,
      pitch: foldIntoRange(pitch, low, high),
      velocity: source.velocity,
    });
  }

  // 主題の半音階経過音は「前後の音と半音で繋がること」を生成時に検証して出した
  // もの。隣の音が変奏されるとその根拠だけが消え、音が宙に浮く。上の吸着は強拍の
  // 長い音しか見ないため、弱拍の半音がそのまま残っていた (実測 20,489 音中 33 音
  // = 0.16%。例: 主題では B→A♯→A の下降だった音が、隣が変奏されて G→A♯→G の
  // 跳躍で挟まれ、音階音でもコードトーンでも隣接半音でもない音になっていた)。
  //
  // 対象は「自分か隣が変奏された音」に限る。変奏していない音まで見ると、最終
  // セクションで終止形に差し替わった和音を理由に主題の音を書き換えてしまい、
  // finalLift の「最後の Chorus は主題そのもの」が崩れる (テストが検出した)。
  notes.forEach((note, index) => {
    if (!variedNotes.has(index) && !variedNotes.has(index - 1) && !variedNotes.has(index + 1)) return;
    const chord = chordAtBeat(chords, note.start);
    const pc = ((note.pitch % 12) + 12) % 12;
    if (scalePcs.includes(pc) || isChordTone(note.pitch, chord)) return;
    const previous = notes[index - 1];
    const next = notes[index + 1];
    const neighbours = (previous !== undefined && Math.abs(note.pitch - previous.pitch) === 1) ||
      (next !== undefined && Math.abs(note.pitch - next.pitch) === 1);
    if (neighbours) return;
    note.pitch = foldIntoRange(snapToChordTone(note.pitch, chord), low, high);
  });

  // 終止音は和音構成音を必須にする (§4.1)。最終セクションでは主題の末尾 2 和音が
  // 終止形へ差し替わるため、そのままだと v1.3 で 26%→0% にした
  // 「曲末が和音構成音ですらない」状態が主題経由で戻ってしまう。
  // 重み付き再抽選ではなく最近傍への吸着にして、"same" の同一性を壊さない
  const last = notes.at(-1);
  if (last) {
    const chord = chordAtBeat(chords, last.start);
    const themeChord = chordAtBeat(theme.chords, last.start);
    if (themeChord.symbol !== chord.symbol && !isChordTone(last.pitch, chord)) {
      last.pitch = foldIntoRange(snapToChordTone(last.pitch, chord), low, high);
    }
  }

  const annotations: Annotation[] = notes.length
    ? [{
        bar: 0,
        ruleId: "theme-restate",
        text: mode === "same"
          ? `${plan.type}の主題をそのまま再現`
          : `${plan.type}の主題を、律動を保ったまま音程だけ変奏`,
        level: "section",
        category: "melody",
      }]
    : [];
  return { notes, annotations };
}
