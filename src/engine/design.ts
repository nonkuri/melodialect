import type {
  Annotation,
  CadenceChoice,
  ChordDraftSlot,
  ChordEvent,
  CompositionControls,
  CompositionDesign,
  Dialect,
  FixedMotif,
  GeneratedSection,
  KeySignature,
  NoteEvent,
  SectionExpression,
  Song,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { chordAtBeat, chordFromRoman, parseChordSymbol, parseRoman } from "./harmony.js";
import { createRng } from "./rng.js";

export interface DraftDiagnostic {
  severity: "error" | "warning";
  code: "duration" | "overlap" | "duplicate" | "symbol" | "key" | "cadence" | "dialect";
  message: string;
  token?: number;
}

export interface ParsedChordDraft {
  slots: ChordDraftSlot[];
  diagnostics: DraftDiagnostic[];
}

const EPSILON = 1e-7;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

function sectionHasFinalHold(section: GeneratedSection): boolean {
  return section.annotations.some((annotation) => annotation.ruleId === "final-hold");
}

/** 現在の曲を、再利用可能なキー相対ローマ数字の下書きへ変換する。 */
export function chordDraftsFromSong(song: Song): ChordDraftSlot[][] {
  return song.sections.map((section) => {
    const bodyBeats = (section.plan.bars - (sectionHasFinalHold(section) ? 1 : 0)) * song.meter.barBeats;
    return section.chords
      .filter((chord) => chord.start < bodyBeats - EPSILON)
      .map((chord) => ({
        symbol: chord.symbol.includes("/") ? chord.symbol.split("/")[0]! : chord.symbol,
        start: chord.start,
        durationBeats: Math.min(chord.durationBeats, bodyBeats - chord.start),
        origin: chord.origin === "completed" || chord.origin === "reharmonized"
          ? chord.origin
          : "user",
      }));
  });
}

export function defaultSectionExpression(controls?: CompositionControls): SectionExpression {
  return {
    tension: clamp01(controls?.tension ?? 0.5),
    density: clamp01(controls?.density ?? 0.5),
    brightness: clamp01(controls?.brightness ?? 0.5),
    cadence: "dialect",
  };
}

export function normalizeCompositionDesign(
  value: Partial<CompositionDesign> | undefined,
  song: Song,
  controls?: CompositionControls,
): CompositionDesign {
  const fallbackDrafts = chordDraftsFromSong(song);
  const drafts = value?.chordDrafts?.length === song.sections.length
    ? structuredClone(value.chordDrafts)
    : fallbackDrafts;
  const expressions = song.sections.map((_, index) => ({
    ...defaultSectionExpression(controls),
    ...value?.sectionExpressions?.[index],
    tension: clamp01(value?.sectionExpressions?.[index]?.tension ?? controls?.tension ?? 0.5),
    density: clamp01(value?.sectionExpressions?.[index]?.density ?? controls?.density ?? 0.5),
    brightness: clamp01(value?.sectionExpressions?.[index]?.brightness ?? controls?.brightness ?? 0.5),
  }));
  return {
    harmonyMode: value?.harmonyMode ?? "auto",
    chordDrafts: drafts,
    originalChordDrafts: value?.originalChordDrafts?.length === song.sections.length
      ? structuredClone(value.originalChordDrafts)
      : undefined,
    chorusVariation: value?.chorusVariation ?? "light",
    sectionExpressions: expressions,
    motif: value?.motif ? structuredClone(value.motif) : undefined,
  };
}

export function formatChordDraft(slots: ChordDraftSlot[]): string {
  return slots.map((slot) => `${slot.symbol || "_"}@${Number(slot.start.toFixed(3))}:${Number(slot.durationBeats.toFixed(3))}`)
    .join(" | ");
}

/**
 * `I:4 | _:4`（連続配置）と `I@0:4 | V7@4:4`（明示位置）の両方を受理する。
 * エラーと、調性・終止・ダイアレクト語彙上の警告を分離して返す。
 */
export function parseChordDraftText(
  text: string,
  expectedBeats: number,
  meter: Meter,
  dialect: Dialect,
  key: KeySignature,
  isFinalSection: boolean,
): ParsedChordDraft {
  const diagnostics: DraftDiagnostic[] = [];
  const slots: ChordDraftSlot[] = [];
  const tokens = text.split(/[|,\n]+/).map((token) => token.trim()).filter(Boolean);
  let cursor = 0;

  tokens.forEach((token, tokenIndex) => {
    const match = token.match(/^(.*?)(?:@\s*(-?\d+(?:\.\d+)?))?(?::\s*(\d+(?:\.\d+)?))?$/);
    const rawSymbol = (match?.[1] ?? "").trim();
    const symbol = ["_", "?", "-", "—"].includes(rawSymbol) ? "" : rawSymbol;
    const start = match?.[2] === undefined ? cursor : Number(match[2]);
    const duration = match?.[3] === undefined ? meter.barBeats : Number(match[3]);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) {
      diagnostics.push({ severity: "error", code: "duration", token: tokenIndex, message: `${tokenIndex + 1}番目の開始位置または拍数が不正です` });
      return;
    }
    if (symbol) {
      try {
        const parsed = parseRoman(symbol);
        if (!dialect.chord.vocabulary.includes(symbol)) {
          diagnostics.push({ severity: "warning", code: "dialect", token: tokenIndex, message: `${symbol} は ${dialect.name} の推奨コード語彙外です` });
        }
        if (parsed.degree === 1 && ((key.mode === "minor" && parsed.quality === "maj") ||
            (key.mode === "major" && parsed.quality === "min"))) {
          diagnostics.push({ severity: "warning", code: "key", token: tokenIndex, message: `${symbol} は現在の${key.mode === "major" ? "長調" : "短調"}トニックと異なる響きです` });
        }
      } catch {
        diagnostics.push({ severity: "error", code: "symbol", token: tokenIndex, message: `${symbol} は不正なローマ数字コードです` });
      }
    }
    slots.push({ symbol, start, durationBeats: duration, origin: "user" });
    cursor = start + duration;
  });

  const ordered = [...slots].sort((a, b) => a.start - b.start || a.durationBeats - b.durationBeats);
  for (let index = 0; index < ordered.length; index++) {
    const slot = ordered[index]!;
    const previous = ordered[index - 1];
    if (previous && Math.abs(previous.start - slot.start) < EPSILON) {
      diagnostics.push({ severity: "error", code: "duplicate", message: `${slot.start}拍目にコードが重複しています` });
    } else if (previous && previous.start + previous.durationBeats > slot.start + EPSILON) {
      diagnostics.push({ severity: "error", code: "overlap", message: `${slot.start}拍目でコードが重なっています` });
    } else if ((!previous && slot.start > EPSILON) ||
        (previous && previous.start + previous.durationBeats < slot.start - EPSILON)) {
      diagnostics.push({ severity: "error", code: "duration", message: `${slot.start}拍目の前に未指定の時間があります。空欄は _ で入力してください` });
    }
  }
  const end = Math.max(0, ...slots.map((slot) => slot.start + slot.durationBeats));
  if (Math.abs(end - expectedBeats) > EPSILON) {
    diagnostics.push({
      severity: "error",
      code: "duration",
      message: end < expectedBeats
        ? `拍数が ${Number((expectedBeats - end).toFixed(3))} 拍不足しています`
        : `拍数が ${Number((end - expectedBeats).toFixed(3))} 拍超過しています`,
    });
  }
  if (isFinalSection) {
    const last = [...ordered].reverse().find((slot) => slot.symbol);
    if (last) {
      try {
        if (parseRoman(last.symbol).degree !== 1) {
          diagnostics.push({ severity: "warning", code: "cadence", message: `終止セクションが ${last.symbol} で終わるため、主和音への解決感が弱くなります` });
        }
      } catch { /* symbol error is already reported */ }
    }
  }
  if (slots.length === 0) {
    diagnostics.push({ severity: "error", code: "duration", message: "コード進行が空です" });
  }
  return { slots: ordered, diagnostics };
}

function transitionWeight(dialect: Dialect, from: string | undefined, to: string): number {
  return from ? (dialect.chord.transitions[from]?.[to] ?? 0.02) : 0.15;
}

/** 空欄を前後の遷移、生成候補（定型句・終止を含む）、ダイアレクト語彙から補完する。 */
export function completeChordDraft(
  draft: ChordDraftSlot[],
  generated: ChordEvent[],
  dialect: Dialect,
  rng: Rng,
): ChordDraftSlot[] {
  const result = structuredClone(draft);
  for (let index = 0; index < result.length; index++) {
    const slot = result[index]!;
    if (slot.symbol) continue;
    const previous = [...result.slice(0, index)].reverse().find((item) => item.symbol)?.symbol;
    const next = result.slice(index + 1).find((item) => item.symbol)?.symbol;
    const generatedSymbol = generated.length ? chordAtBeat(generated, slot.start).symbol : undefined;
    const candidates = Array.from(new Set([
      ...(generatedSymbol ? [generatedSymbol] : []),
      ...dialect.chord.vocabulary,
    ])).filter((symbol) => {
      try { parseRoman(symbol); return true; } catch { return false; }
    });
    const weighted = candidates.map((symbol) => {
      let weight = 0.2 + transitionWeight(dialect, previous, symbol) * 5;
      if (next) weight += transitionWeight(dialect, symbol, next) * 4;
      if (symbol === generatedSymbol) weight += 3;
      return [symbol, weight] as [string, number];
    });
    slot.symbol = rng.weighted(weighted);
    slot.origin = "completed";
  }
  return result;
}

export function materializeChordDraft(
  draft: ChordDraftSlot[],
  key: KeySignature,
): { chords: ChordEvent[]; annotations: Annotation[] } {
  const annotations: Annotation[] = [];
  const chords = draft.map((slot) => {
    if (!slot.symbol) throw new Error("コード進行に未補完の空欄があります");
    const chord = chordFromRoman(slot.symbol, 0, key, slot.start, slot.durationBeats);
    chord.bar = 0;
    chord.origin = slot.origin;
    return chord;
  });
  return { chords, annotations };
}

export function annotateChordOrigins(chords: ChordEvent[], meter: Meter): Annotation[] {
  return chords.map((chord) => {
    const origin = chord.origin ?? "generated";
    const labels = {
      generated: ["dialect-chord", "ダイアレクトから生成"],
      user: ["user-chord", "ユーザー入力を固定"],
      completed: ["chord-completion", "空欄をダイアレクトの前後関係・語彙から補完"],
      reharmonized: ["reharmonization", "原案をダイアレクトらしくリハーモナイズ"],
    } as const;
    const [ruleId, label] = labels[origin];
    return { bar: Math.floor(chord.start / meter.barBeats), ruleId, text: `${label}: ${chord.symbol}` };
  });
}

const SUBSTITUTIONS: Record<number, number[]> = {
  1: [6, 3], 2: [4], 3: [1, 6], 4: [2, 6], 5: [7, 2], 6: [1, 4], 7: [5],
};

function melodyCompatibility(
  symbol: string,
  slot: ChordDraftSlot,
  key: KeySignature | undefined,
  melody: NoteEvent[] | undefined,
): number {
  if (!key || !melody?.length) return 0;
  let chord: ChordEvent;
  try { chord = chordFromRoman(symbol, 0, key, slot.start, slot.durationBeats); }
  catch { return -1; }
  const notes = melody.filter((note) => note.start >= slot.start - EPSILON &&
    note.start < slot.start + slot.durationBeats - EPSILON);
  if (!notes.length) return 0;
  const pcs = new Set(chord.pitches.map((pitch) => pitch % 12));
  return notes.reduce((score, note) => {
    const fit = pcs.has(note.pitch % 12) ? 1 : Math.abs(note.start - Math.round(note.start)) < EPSILON ? 0.25 : 0.55;
    return score + fit;
  }, 0) / notes.length;
}

function bassConnectionCompatibility(
  symbol: string,
  previous: string | undefined,
  next: string | undefined,
  key: KeySignature | undefined,
): number {
  if (!key) return 0;
  try {
    const root = chordFromRoman(symbol, 0, key).rootPc;
    const neighbors = [previous, next].filter((value): value is string => Boolean(value))
      .map((value) => chordFromRoman(value, 0, key).rootPc);
    if (!neighbors.length) return 0;
    const movement = neighbors.reduce((sum, neighbor) => {
      const distance = Math.abs(root - neighbor);
      return sum + Math.min(distance, 12 - distance);
    }, 0) / neighbors.length;
    return 1 - movement / 6;
  } catch {
    return -0.5;
  }
}

function sourceSimilarity(source: string, candidate: string): number {
  try {
    const from = parseChordSymbol(source);
    const to = parseChordSymbol(candidate);
    const degreeDistance = Math.abs(from.degree - to.degree);
    const qualityMatch = from.quality === to.quality ? 0.25 : 0;
    const accidentalMatch = from.accidental === to.accidental ? 0.15 : 0;
    return Math.max(0, 0.75 - degreeDistance * 0.12 + qualityMatch + accidentalMatch);
  } catch {
    return 0;
  }
}

/** 原案を保持したまま、代理・借用・定型句・終止候補から比較用の候補を作る。 */
export function reharmonizeChordDrafts(
  drafts: ChordDraftSlot[][],
  sectionDialects: Dialect[],
  seed: number,
  finalEnding = true,
  musicalContext?: Array<{ key: KeySignature; melody: NoteEvent[] }>,
): ChordDraftSlot[][] {
  return drafts.map((source, sectionIndex) => {
    const dialect = sectionDialects[sectionIndex] ?? sectionDialects[0]!;
    const rng = createRng((seed ^ Math.imul(sectionIndex + 1, 0x9e3779b1)) >>> 0);
    const result = structuredClone(source);
    for (let index = 1; index < result.length - 1; index++) {
      const current = result[index]!;
      if (!current.symbol || !rng.chance(0.55)) continue;
      let degree = 0;
      try { degree = parseRoman(current.symbol).degree; } catch { continue; }
      const substituteDegrees = SUBSTITUTIONS[degree] ?? [];
      const candidates = dialect.chord.vocabulary.filter((symbol) => {
        if (symbol === current.symbol) return false;
        try {
          const parsed = parseRoman(symbol);
          return substituteDegrees.includes(parsed.degree) ||
            (dialect.chord.borrowedChords && parsed.flat);
        } catch { return false; }
      });
      if (!candidates.length) continue;
      const previous = result[index - 1]?.symbol;
      const next = result[index + 1]?.symbol;
      const context = musicalContext?.[sectionIndex];
      const sourceSymbol = current.symbol;
      current.symbol = rng.weighted(candidates.map((symbol) => [
        symbol,
        0.2 + transitionWeight(dialect, previous, symbol) * 4 +
          (next ? transitionWeight(dialect, symbol, next) * 3 : 0) +
          melodyCompatibility(symbol, current, context?.key, context?.melody) * 2.5 +
          bassConnectionCompatibility(symbol, previous, next, context?.key) * 1.2 +
          sourceSimilarity(sourceSymbol, symbol) * 0.8,
      ] as [string, number]));
      current.origin = "reharmonized";
    }

    const idioms = dialect.sectionRules?.chorus?.idioms ?? dialect.chord.idioms ?? [];
    if (idioms.length && result.length >= 4 && rng.chance(dialect.chord.idiomProbability ?? 0.35)) {
      const idiom = rng.weighted(idioms.map((item) => [item, item.weight] as const));
      const start = Math.max(0, Math.min(result.length - idiom.symbols.length, 1));
      idiom.symbols.forEach((symbol, offset) => {
        const slot = result[start + offset];
        if (slot) Object.assign(slot, { symbol, origin: "reharmonized" as const });
      });
    }
    // 候補の末尾にはダイアレクト固有の終止形を明示的に反映する。
    if (sectionIndex === drafts.length - 1 && finalEnding && result.length >= 2) {
      const cadences = dialect.chord.cadences?.final ?? [{ symbols: ["V7", "I"], weight: 1 }];
      const cadence = rng.weighted(cadences.map((item) => [item, item.weight] as const));
      const pair = cadence.symbols.slice(-2);
      if (pair.length === 2) {
        result[result.length - 2]!.symbol = pair[0]!;
        result[result.length - 2]!.origin = "reharmonized";
        result[result.length - 1]!.symbol = pair[1]!;
        result[result.length - 1]!.origin = "reharmonized";
      }
    } else if (sectionIndex < drafts.length - 1 && result.length) {
      const cadences = dialect.chord.cadences?.half ?? [{ symbols: ["V7"], weight: 1 }];
      const cadence = rng.weighted(cadences.map((item) => [item, item.weight] as const));
      const symbol = cadence.symbols.at(-1);
      if (symbol) {
        result[result.length - 1]!.symbol = symbol;
        result[result.length - 1]!.origin = "reharmonized";
      }
    }
    return result;
  });
}

/** セクションごとの終止選択を、一時的なダイアレクト定義へ反映する。 */
export function dialectWithCadence(source: Dialect, type: GeneratedSection["plan"]["type"], choice: CadenceChoice): Dialect {
  if (choice === "dialect") return source;
  const dialect = structuredClone(source);
  const finalSymbols: Record<Exclude<CadenceChoice, "dialect">, string[]> = {
    authentic: ["V7", "I"], plagal: ["IV", "I"], deceptive: ["V7", "vi"],
    modal: ["♭VII", "I"], half: ["I", "V7"],
  };
  const halfSymbols: Record<Exclude<CadenceChoice, "dialect">, string[]> = {
    authentic: ["V7"], plagal: ["IV"], deceptive: ["V7"], modal: ["♭VII"], half: ["V7"],
  };
  const cadence = {
    final: [{ symbols: finalSymbols[choice], weight: 1 }],
    half: [{ symbols: halfSymbols[choice], weight: 1 }],
  };
  dialect.chord.cadences = cadence;
  dialect.sectionRules ??= {};
  dialect.sectionRules[type] = { ...dialect.sectionRules[type], cadences: cadence };
  return dialect;
}

function keyDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 6) delta -= 12;
  while (delta < -6) delta += 12;
  return delta;
}

function cloneChorusMelody(source: GeneratedSection, target: GeneratedSection, mode: "same" | "light", barBeats: number): NoteEvent[] {
  const delta = keyDelta(source.key.tonic, target.key.tonic);
  const limit = target.plan.bars * barBeats;
  return source.melody.filter((note) => note.start < limit).map((note, index) => {
    const lightPitch = mode === "light" && index % 4 === 3 ? (index % 8 === 3 ? 2 : -2) : 0;
    const start = mode === "light" && index % 6 === 4
      ? Math.min(note.start + 0.125, Math.max(note.start, limit - 0.125))
      : note.start;
    return {
      ...note,
      start,
      duration: Math.min(note.duration, Math.max(0.125, limit - start)),
      pitch: note.pitch + delta + lightPitch,
    };
  });
}

/** 固定モチーフと Chorus 間の同一／軽い変奏／大きな変奏を生成結果へ適用する。 */
export function applyMotifAndChorusDesign(song: Song, design: CompositionDesign): Song {
  const next = structuredClone(song);
  const choruses = next.sections.map((section, index) => ({ section, index }))
    .filter(({ section }) => section.plan.type === "chorus");
  const first = choruses[0]?.section;
  if (first && design.chorusVariation !== "large") {
    const variation = design.chorusVariation;
    choruses.slice(1).forEach(({ section }) => {
      section.melody = cloneChorusMelody(first, section, variation, next.meter.barBeats);
      section.annotations.push({
        bar: 0,
        ruleId: "chorus-variation",
        text: variation === "same" ? "Chorus間: 同じ旋律を再使用" : "Chorus間: リズムと音程を軽く変奏",
      });
    });
  } else if (design.chorusVariation === "large") {
    choruses.slice(1).forEach(({ section }) => section.annotations.push({
      bar: 0, ruleId: "chorus-variation", text: "Chorus間: ダイアレクト規則から大きく変奏",
    }));
  }

  const motif = design.motif;
  if (!motif?.notes.length) return next;
  next.sections.filter((section) => section.plan.type === motif.sectionType).forEach((section) => {
    const delta = keyDelta(motif.sourceTonic, section.key.tonic);
    const anchor = motif.anchorBeat ?? 0;
    section.melody = [
      ...section.melody.filter((note) =>
        note.start < anchor - EPSILON || note.start >= anchor + motif.lengthBeats - EPSILON),
      ...motif.notes.map((note) => ({
        start: anchor + note.offset,
        duration: note.duration,
        pitch: motif.rootPitch + delta + note.interval,
        velocity: note.velocity,
      })),
    ].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    section.annotations.push({
      bar: 0, ruleId: "fixed-motif", text: "ユーザーが選択したモチーフを固定して再使用",
    });
  });
  return next;
}

export function captureFixedMotif(song: Song, sectionIndex: number, noteIndexes: number[]): FixedMotif | null {
  const section = song.sections[sectionIndex];
  const notes = noteIndexes.map((index) => section?.melody[index]).filter((note): note is NoteEvent => Boolean(note));
  if (!section || !notes.length) return null;
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const start = notes[0]!.start;
  const rootPitch = notes[0]!.pitch;
  const end = Math.max(...notes.map((note) => note.start + note.duration));
  return {
    sectionType: section.plan.type,
    sourceTonic: section.key.tonic,
    rootPitch,
    anchorBeat: start,
    lengthBeats: end - start,
    notes: notes.map((note) => ({
      offset: note.start - start,
      duration: note.duration,
      interval: note.pitch - rootPitch,
      velocity: note.velocity,
    })),
  };
}

export interface SectionContrast {
  register: number;
  density: number;
  brightness: number;
}

/** UI 可視化用。曲内の最大値を 1 としたセクション対比。 */
export function analyzeSectionContrast(song: Song): SectionContrast[] {
  const raw = song.sections.map((section) => ({
    register: section.melody.length
      ? section.melody.reduce((sum, note) => sum + note.pitch, 0) / section.melody.length
      : 0,
    density: section.melody.length / Math.max(1, section.plan.bars),
    brightness: section.melody.length
      ? section.melody.reduce((sum, note) => sum + note.velocity + Math.max(0, note.pitch - 60) * 1.5, 0) / section.melody.length
      : 0,
  }));
  const normalize = (key: keyof SectionContrast, value: number) => {
    const values = raw.map((item) => item[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max - min < EPSILON ? 0.5 : (value - min) / (max - min);
  };
  return raw.map((item) => ({
    register: normalize("register", item.register),
    density: normalize("density", item.density),
    brightness: normalize("brightness", item.brightness),
  }));
}
