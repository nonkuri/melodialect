import type {
  Annotation,
  ArrangementSettings,
  ChorusVariation,
  CompositionControls,
  CompositionDesign,
  DiversityLevel,
  Mode,
  Dialect,
  EndingMode,
  GeneratedSection,
  KeySignature,
  SectionType,
  SectionControl,
  Song,
  ThemeGrammar,
  ThemeReturn,
} from "./types.js";
import { createNamedRng } from "./rng.js";
import { meterOf, DEFAULT_METER, type Meter } from "./meter.js";
import { planSection, type FormEntry } from "./structure.js";
import {
  chordAtBeat,
  chordFromRoman,
  finalCadenceLabel,
  generateProgression,
  halfCadenceLabel,
} from "./harmony.js";
import { generateMelody } from "./melody.js";
import { generateAccompaniment, renderSustainedChord } from "./accompaniment.js";
import {
  annotateChordOrigins,
  applyMotifAndChorusDesign,
  completeChordDraft,
  dialectWithCadence,
  materializeChordDraft,
} from "./design.js";

import {
  applyCompositionControls,
  dialectWithControls,
  normalizeArrangement,
  normalizeComposition,
} from "./controls.js";
import {
  attachGenerationReport,
  describeCandidateDifference,
  selectSongCandidate,
} from "./evaluation.js";
import { createArrangementPlan, settingsForArrangementPlan } from "./arrangement.js";
import { expectationFor } from "./register.js";
import {
  captureTheme,
  recurrenceFor,
  restateMelody,
  restateProgression,
  themeGrammarFor,
  type SectionTheme,
} from "./theme.js";
const NOTE_NAMES: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** 転調量 (半音) の音楽的な呼び名 (注記用) */
const MODULATION_LABELS: Record<number, string> = {
  5: " (下属調へ)",
  7: " (属調へ)",
  2: " (全音上へ)",
  [-2]: " (全音下へ)",
  [-5]: " (属調へ)",
  [-7]: " (下属調へ)",
};

export function parseKeyName(name: string): number {
  const pc = NOTE_NAMES[name];
  if (pc === undefined) throw new Error(`unknown key name: ${name}`);
  return pc;
}

export interface GenerateOptions {
  /** メインのダイアレクト。セクション別割り当てのないセクションに使われる */
  dialect: Dialect;
  seed: number;
  /** 例: "C", "F#"。省略時はダイアレクトのデフォルト */
  keyName?: string;
  bpm?: number;
  /** 拍子 (METERS のキー: "4/4" | "3/4" | "6/8" | "5/4" | "7/8")。省略時は 4/4 */
  mode?: Mode;
  meterName?: string;
  /**
   * セクション構成。省略時は Verse-Chorus-Verse-Chorus。
   * FormEntry.dialectName または resolveDialect で合作モード (§4.2) になる
   */
  form?: Array<SectionType | FormEntry>;
  /** 合作モード用: dialectName の解決。省略時はメインのみ */
  resolveDialect?: (name: string) => Dialect | undefined;
  /**
   * 終わり方 (§4.2)。"final" (既定) は終止カデンツ+コーダ 1 小節。
   * "loop" は半終止のまま曲頭へ戻るシームレスなリピート用
   */
  ending?: EndingMode;
  /** Per-section seed used for stable partial regeneration. */
  sectionSeeds?: number[];
  /** Fixed phrase lengths used while partially regenerating an existing song. */
  sectionPhraseLengths?: number[][];
  arrangement?: ArrangementSettings;
  composition?: CompositionControls;
  sectionControls?: SectionControl[];
  /** v0.9: ユーザーコード、セクション表現、モチーフ等の作曲設計。 */
  design?: CompositionDesign;
  /** v1.2: internal candidates. UI generation uses three; direct legacy calls keep one. */
  candidateCount?: number;
  diversity?: DiversityLevel;
}

/** Derive an independent deterministic seed for each section. */
function sectionSeed(seed: number, index: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/**
 * このセクションで主題をどう戻すか。
 *
 * 利用者が作曲設計で Chorus の変奏量を明示した場合は、その意思を
 * ダイアレクトの宣言より優先する。以前は同じことを生成後の
 * applyMotifAndChorusDesign が担当していたが、あちらは design が
 * 無いと走らないため、既定フローでは Chorus が一度も再現されなかった
 */
function themeModeFor(
  grammar: ThemeGrammar,
  type: SectionType,
  chorusVariation: ChorusVariation | undefined,
  isLastOfType: boolean,
): ThemeReturn {
  // "light" は作曲設計を作った時点で入る正規化の既定値であって、利用者が
  // 選んだ意思とは限らない。これを上書きとして扱うと、設計ダイアログを一度でも
  // 開いた曲でダイアレクトの theme 宣言が無言で無効化される。明示的に振り切った
  // "same" / "large" だけを上書きとして扱い、"light" はダイアレクトへ委ねる
  if (type === "chorus" && (chorusVariation === "same" || chorusVariation === "large")) {
    return chorusVariation === "same" ? "same" : "new";
  }
  const mode = recurrenceFor(grammar, type);
  // 最後の Chorus は主題の再提示に使う。ここで変奏すると、いちばん記憶に
  // 残ってほしい箇所が毎回違う旋律になる。厚みは編曲の development 曲線が担当する
  if (mode === "vary" && type === "chorus" && isLastOfType && grammar.finalLift) return "same";
  return mode;
}

/** pitch に最も近い chordPitches のコードトーン (ループ継ぎ目の調整用) */
function nearestChordTone(pitch: number, chordPitches: number[]): number {
  const pcs = chordPitches.map((p) => p % 12);
  let best = pitch;
  let bestDist = Infinity;
  for (let cand = pitch - 6; cand <= pitch + 6; cand++) {
    if (pcs.includes(((cand % 12) + 12) % 12)) {
      const dist = Math.abs(cand - pitch);
      if (dist < bestDist) {
        best = cand;
        bestDist = dist;
      }
    }
  }
  return best;
}

/** Build one deterministic candidate. Public callers normally use generateSong. */
function generateSongCandidate(options: GenerateOptions, candidateIndex: number): Song {
  const { dialect: mainDialect, seed } = options;
  const keyName = options.keyName ?? mainDialect.defaults.key;
  const controls = normalizeComposition(options.composition, options.mode ?? mainDialect.defaults.mode);
  const key: KeySignature = {
    tonic: parseKeyName(keyName),
    mode: controls.mode,
  };
  const bpm = options.bpm ?? mainDialect.defaults.bpm;
  const meter: Meter = options.meterName
    ? meterOf(options.meterName)
    : mainDialect.defaults.meter
      ? meterOf(mainDialect.defaults.meter)
      : DEFAULT_METER;
  const form: Array<SectionType | FormEntry> =
    options.form ?? ["verse", "chorus", "verse", "chorus"];
  const ending: EndingMode = options.ending ?? "final";

  // 各セクションのダイアレクトを解決 (合作モード §4.2)
  const entries = form.map((e, index) => {
    const entry: FormEntry = typeof e === "string" ? { type: e } : e;
    let sectionDialect = mainDialect;
    if (entry.dialectName) {
      const resolved = options.resolveDialect?.(entry.dialectName);
      if (!resolved) throw new Error(`unknown dialect in form: ${entry.dialectName}`);
      sectionDialect = resolved;
    }
    const expression = options.design?.sectionExpressions[index];
    const sectionControls = expression
      ? { ...controls, tension: expression.tension, density: expression.density, brightness: expression.brightness }
      : controls;
    const controlled = options.composition || expression
      ? dialectWithControls(sectionDialect, sectionControls)
      : sectionDialect;
    return {
      type: entry.type,
      dialect: dialectWithCadence(controlled, entry.type, expression?.cadence ?? "dialect"),
    };
  });
  const arrangementPlan = createArrangementPlan(
    entries.map((entry) => entry.type),
    entries.map((entry) => entry.dialect),
    options.arrangement,
    seed,
    candidateIndex,
  );

  const sections: GeneratedSection[] = [];
  // 主題の記憶 (§4.1)。同じタイプのセクションが再び来たら、ここから進行と旋律を戻す。
  // v1.4 までは進行の記号列だけを覚えて beam search へソフト加点していたが、
  // 実測で繰り返す Chorus の進行一致は 6%、旋律の一致は 0% にしかならなかった
  const themeMemory = new Map<SectionType, SectionTheme>();
  // finalLift 用。同じタイプの最後の出現だけ、変奏せずそのまま再現する
  const lastIndexOfType = new Map<SectionType, number>();
  entries.forEach(({ type }, index) => lastIndexOfType.set(type, index));
  let startBar = 0;
  let prevMelodyEnd: number | undefined;

  entries.forEach(({ type, dialect }, i) => {
    const isLastEntry = i === entries.length - 1;
    // ループモードでは最終セクションも半終止で終え、曲頭の I へ戻れるようにする
    const baseSectionSeed = options.sectionSeeds?.[i] ?? sectionSeed(seed, i);
    // 全パートを名前付きストリームで独立させる。以前は候補 0 だけが
    // 親シードを直接消費していたため、候補 0 と代替案が別の規則で作られていた
    const structureRng = createNamedRng(baseSectionSeed, "structure", i, candidateIndex);
    const modulationRng = createNamedRng(baseSectionSeed, "modulation", i, candidateIndex);
    const harmonyRng = createNamedRng(baseSectionSeed, "harmony", i, candidateIndex);
    const melodyRng = createNamedRng(baseSectionSeed, "melody", i, candidateIndex);
    const accompanimentRng = createNamedRng(baseSectionSeed, "accompaniment", i, candidateIndex);
    const isFinalSection = ending === "final" && isLastEntry;
    const sectionControl = options.sectionControls?.[i];
    // SectionControl の bars は画面に見えるコーダ込みの長さ。生成前の本体では
    // final コーダ 1 小節を差し引き、再生成のたびに小節が増えないようにする。
    const fixedPhraseLengths = sectionControl
      ? [Math.max(1, Math.round(sectionControl.bars) - (isFinalSection ? 1 : 0))]
      : options.sectionPhraseLengths?.[i];

    // 主題を戻すかどうかを、小節割りを決める前に確定させる。繰り返す
    // セクションの長さが主題と違うと、再現ではなく「途中で切れた引用」になる
    const theme = themeMemory.get(type);
    const themeMode = theme
      ? themeModeFor(themeGrammarFor(dialect), type, options.design?.chorusVariation,
        lastIndexOfType.get(type) === i)
      : "new";
    const plan = fixedPhraseLengths
      ? {
          type,
          phraseLengths: [...fixedPhraseLengths],
          bars: fixedPhraseLengths.reduce((sum, bars) => sum + bars, 0),
        }
      : theme && themeMode !== "new"
        ? { type, phraseLengths: [...theme.phraseLengths], bars: theme.bars }
        : planSection(type, dialect, structureRng);

    // 転調 (§4.1): セクションタイプ別の転調傾向 (通常は bridge)。最終セクションは主調のまま
    let sectionKey = key;
    const modAnnotations: Annotation[] = [];
    const modCfg = dialect.modulation?.[type];
    if (modCfg && !isLastEntry && modulationRng.chance(modCfg.probability)) {
      const semis = modulationRng.weighted(
        modCfg.intervals.map((iv) => [iv.semitones, iv.weight] as [number, number]),
      );
      sectionKey = { tonic: (((key.tonic + semis) % 12) + 12) % 12, mode: key.mode };
      modAnnotations.push({
        bar: 0,
        ruleId: "modulation",
        text: `転調: ${semis > 0 ? "+" : ""}${semis} 半音${MODULATION_LABELS[semis] ?? ""}`,
      });
    }

    if (sectionControl?.transpose) {
      const semis = sectionControl.transpose;
      sectionKey = {
        ...sectionKey,
        tonic: (((sectionKey.tonic + semis) % 12) + 12) % 12,
      };
      modAnnotations.push({
        bar: 0,
        ruleId: "manual-transpose",
        text: "セクション移調: " + (semis > 0 ? "+" : "") + semis + " 半音",
      });
    }
    const generatedHarmony = generateProgression(
      plan, dialect, sectionKey, meter, harmonyRng, {
        isFinalSection,
        tension: options.design?.sectionExpressions[i]?.tension ?? controls.tension,
        // Repeated sections retain a family resemblance by referencing only the
        // first section of the same type. 最初のChorusにVerse、
        // Outroに直前セクションをそのまま追従させると役割差が失われる。
        // 主題を戻すタイプでは進行ごと差し替えるが、最終セクションの終止形は
        // ここで選ばれたものを使うので、生成自体は常に通す
        referenceProgression: theme?.chords.map((chord) => chord.symbol),
      },
    );
    const previousChord = sections.at(-1)?.chords.at(-1);
    if (modAnnotations.some((annotation) => annotation.ruleId === "modulation") && previousChord &&
      generatedHarmony.chords[0]) {
      const previousPcs = new Set(previousChord.pitches.map((pitch) => pitch % 12));
      const pivots = dialect.chord.vocabulary.flatMap((symbol) => {
        try {
          const chord = chordFromRoman(symbol, 0, sectionKey,
            generatedHarmony.chords[0]!.start, generatedHarmony.chords[0]!.durationBeats);
          const common = chord.pitches.filter((pitch) => previousPcs.has(pitch % 12)).length;
          return common >= 2 ? [{ chord, common }] : [];
        } catch {
          return [];
        }
      }).sort((a, b) => b.common - a.common);
      const bestCommon = pivots[0]?.common ?? 0;
      const topPivots = pivots.filter((pivot) => pivot.common === bestCommon);
      const pivot = topPivots.length ? harmonyRng.pick(topPivots).chord : undefined;
      if (pivot) {
        generatedHarmony.chords[0] = pivot;
        generatedHarmony.annotations.push({
          bar: 0,
          ruleId: "pivot-chord",
          text: `前セクションと共通音を持つ ${pivot.symbol} を転調の橋渡しに使用`,
          level: "section",
          category: "harmony",
        });
      }
    }
    let chords = generatedHarmony.chords;
    let harmonyNotes = generatedHarmony.annotations;
    // 主題の進行を戻す。最終セクションだけは、主題が半終止で終わっている
    // (途中の Chorus だった) ため、末尾の終止形をこのセクション用に選ばれた
    // ものへ差し替える。コーダは本体の最後の和音をそのまま伸ばすので、
    // ここを主題のままにすると曲が解決しないまま終わる
    let restatedHarmony = false;
    if (theme && themeMode !== "new") {
      const restated = restateProgression(theme, sectionKey, plan.bars * meter.barBeats);
      if (restated.length) {
        if (isFinalSection) {
          const cadence = generatedHarmony.chords.slice(-2).map((chord) => chord.symbol);
          const offset = restated.length - cadence.length;
          cadence.forEach((symbol, index) => {
            const slot = restated[offset + index];
            if (!slot) return;
            try {
              restated[offset + index] = {
                ...chordFromRoman(symbol, slot.bar, sectionKey, slot.start, slot.durationBeats),
                origin: slot.origin,
              };
            } catch { /* この調で解釈できない記号は主題のまま残す */ }
          });
        }
        chords = restated;
        restatedHarmony = true;
        // 注記は実際に鳴る和音から作り直す。生成側の注記をそのまま持ち越すと、
        // 採用しなかった進行の定型句や技法を説明してしまう
        const cadenceChords = restated.slice(isFinalSection ? -2 : -1);
        harmonyNotes = [
          {
            bar: 0,
            ruleId: "theme-restate-harmony",
            text: isFinalSection
              ? `${type}の主題の進行を再現し、末尾だけ終止形へ差し替え`
              : `${type}の主題の進行をそのまま再現`,
            level: "section" as const,
            category: "harmony" as const,
          },
          {
            bar: cadenceChords[0]!.bar,
            ruleId: "cadence",
            text: isFinalSection && cadenceChords.length === 2
              ? `${finalCadenceLabel(cadenceChords.map((chord) => chord.symbol))}: ${
                cadenceChords.map((chord) => chord.symbol).join(" → ")}`
              : halfCadenceLabel(cadenceChords.at(-1)!.symbol),
          },
        ];
      }
    }
    const harmonyMode = options.design?.harmonyMode ?? "auto";
    if (harmonyMode !== "auto") {
      const sourceDraft = options.design?.chordDrafts[i];
      if (!sourceDraft?.length) throw new Error(`${i + 1}番目のセクションにコード原案がありません`);
      const orderedDraft = [...sourceDraft].sort((a, b) => a.start - b.start);
      const expected = plan.bars * meter.barBeats;
      const end = Math.max(...orderedDraft.map((slot) => slot.start + slot.durationBeats));
      if (Math.abs(end - expected) > 1e-7) {
        throw new Error(`${i + 1}番目のセクションのコード拍数が ${expected} 拍と一致しません`);
      }
      orderedDraft.forEach((slot, slotIndex) => {
        const previous = orderedDraft[slotIndex - 1];
        const expectedStart = previous ? previous.start + previous.durationBeats : 0;
        if (Math.abs(slot.start - expectedStart) > 1e-7) {
          throw new Error(slot.start < expectedStart
            ? `${i + 1}番目のセクションでコードが重複しています`
            : `${i + 1}番目のセクションでコードの拍数が不足しています`);
        }
      });
      let resolvedDraft = structuredClone(orderedDraft);
      if (harmonyMode === "complete") {
        resolvedDraft = completeChordDraft(resolvedDraft, generatedHarmony.chords, dialect, harmonyRng);
      } else if (resolvedDraft.some((slot) => !slot.symbol)) {
        throw new Error("固定コード進行に空欄があります。空欄補完モードを選んでください");
      }
      if (harmonyMode === "fixed") {
        resolvedDraft.forEach((slot) => { slot.origin = "user"; });
      }
      const materialized = materializeChordDraft(resolvedDraft, sectionKey);
      chords = materialized.chords.map((chord) => ({
        ...chord,
        bar: Math.floor(chord.start / meter.barBeats),
      }));
      harmonyNotes = [...materialized.annotations, ...annotateChordOrigins(chords, meter)];
    } else {
      chords = chords.map((chord) => ({ ...chord, origin: "generated" as const }));
      harmonyNotes = [...harmonyNotes, ...annotateChordOrigins(chords, meter)];
    }
    // 旋律の再現は、進行の再現が成立したときだけ行う。進行が別物のまま
    // 律動だけ主題から借りると、音程が全部コードトーンへ吸着し直されて
    // 主題でも新作でもないものになる
    const restated = theme && restatedHarmony && themeMode !== "new"
      ? restateMelody(theme, plan, chords, dialect, sectionKey, meter, melodyRng, themeMode)
      : null;
    const melody = restated?.notes.length
      ? { notes: restated.notes, annotations: restated.annotations }
      : generateMelody(plan, chords, dialect, sectionKey, meter, melodyRng, {
        startPitch: prevMelodyEnd,
      });
    const accomp = generateAccompaniment(
      plan, chords, dialect, sectionKey, meter, accompanimentRng, options.arrangement,
      {
        sectionIndex: i,
        candidateIndex,
        seed: baseSectionSeed,
        melody: melody.notes,
        arrangementSection: arrangementPlan.sections[i],
      },
    );

    prevMelodyEnd = melody.notes.at(-1)?.pitch;
    sections.push({
      plan,
      startBar,
      dialectId: dialect.id,
      // 評価関数は不協和をダイアレクト相対で見る。合作モードやユーザー定義
      // ダイアレクトでも解決できるよう、生成時の期待値をここへ焼き付ける
      expected: expectationFor(dialect),
      key: sectionKey,
      chords,
      melody: melody.notes,
      piano: accomp.piano,
      bass: accomp.bass,
      guitar: accomp.guitar,
      drums: accomp.drums,
      bpm: sectionControl?.bpm ?? bpm,
      annotations: [
        ...modAnnotations,
        ...harmonyNotes,
        { bar: 0, ruleId: "dialect-melody", text: `${dialect.name} の旋律輪郭・リズム語彙・モチーフ・非和声音規則を適用` },
        ...melody.annotations,
        { bar: 0, ruleId: "dialect-accompaniment", text: `${dialect.name} のグルーヴ・ボイシング・推奨パターンを伴奏へ適用` },
        ...accomp.annotations,
      ].sort(
        (a, b) => a.bar - b.bar,
      ),
    });
    // 主題は最初の 1 回だけ覚える。2 回目以降を覚え直すと、変奏の変奏が
    // 積み重なって 3 回目の Chorus が主題から離れていく
    if (!themeMemory.has(type)) themeMemory.set(type, captureTheme(sections.at(-1)!));
    startBar += plan.bars;
  });

  const lastSection = sections.at(-1);
  if (ending === "final" && lastSection) {
    // コーダ (§4.2): 終止和音を 1 小節保持して伴奏パターンを止め、唐突な終わりを避ける
    const bb = meter.barBeats;
    const codaBar = lastSection.plan.bars;
    const tailStart = codaBar * bb;
    const lastChord = lastSection.chords.at(-1)!;
    lastSection.chords.push({
      ...lastChord,
      start: tailStart,
      durationBeats: bb,
      bar: codaBar,
    });
    const finalDialect = entries.at(-1)!.dialect;
    const finalPlan = arrangementPlan.sections.at(-1);
    const finalArrangement = settingsForArrangementPlan(normalizeArrangement({
      ...finalDialect.defaults.arrangement,
      ...options.arrangement,
    }), finalPlan);
    // コーダも通常の伴奏と同じボイシング規則を通す。ここで独自に音を積むと
    // 音域配分から外れ、最後の 1 小節だけ跳ね上がる。
    const coda = renderSustainedChord(lastChord, {
      dialect: finalDialect,
      arrangement: finalArrangement,
      melody: lastSection.melody,
      start: tailStart,
      durationBeats: bb,
    });
    lastSection.piano.push(...coda.piano);
    lastSection.guitar.push(...coda.guitar);
    lastSection.bass.push(...coda.bass);
    lastSection.annotations.push({
      bar: codaBar,
      ruleId: "final-hold",
      text: "コーダ: 終止和音を 1 小節保持して終わる",
    });
    lastSection.plan.bars += 1;
    startBar += 1;
  } else if (ending === "loop" && lastSection) {
    // ループ継ぎ目 (§4.2): 最後のメロディ音を最終コードのコードトーンのうち
    // 曲頭の音に最も近いものへ寄せ、リピート時に順次進行でつながるようにする
    const firstNote = sections[0]!.melody[0];
    const lastNote = lastSection.melody.at(-1);
    if (firstNote && lastNote) {
      const chord = chordAtBeat(lastSection.chords, lastNote.start);
      lastNote.pitch = nearestChordTone(firstNote.pitch, chord.pitches);
    }
    lastSection.annotations.push({
      bar: lastSection.plan.bars - 1,
      ruleId: "loop-seam",
      text: "ループ継ぎ目: 半終止のまま曲頭の I へ戻る (リピート用)",
    });
  }

  const song: Song = {
    arrangement: normalizeArrangement({
      ...mainDialect.defaults.arrangement,
      ...options.arrangement,
    }),
    arrangementPlan,
    dialectId: mainDialect.id,
    seed,
    ending,
    key,
    keyName,
    bpm,
    meter,
    sections,
    totalBars: startBar,
  };
  const controlled = options.composition || options.design?.sectionExpressions
    ? applyCompositionControls(song, controls, options.design?.sectionExpressions, (id) =>
        entries.find((entry) => entry.dialect.id === id)?.dialect ?? mainDialect)
    : song;
  return options.design ? applyMotifAndChorusDesign(controlled, options.design) : controlled;
}

function diversityFor(options: GenerateOptions): DiversityLevel {
  if (options.diversity) return options.diversity;
  const surprise = options.composition?.surprise ?? 0.5;
  return surprise < 0.34 ? "stable" : surprise > 0.66 ? "adventurous" : "standard";
}

/** Generate distinct deterministic alternatives without requiring a UI choice. */
export function generateSongCandidates(
  options: GenerateOptions,
  count = options.candidateCount ?? 3,
): Song[] {
  const candidateCount = Math.max(1, Math.min(8, Math.round(count)));
  const diversity = diversityFor(options);
  const candidates: Song[] = [];
  const fingerprints = new Set<string>();
  // A bounded oversampling pass lets the shared API omit perceptually duplicate
  // candidates without making generation time unbounded for restrictive dialects.
  for (let attempt = 0; attempt < candidateCount * 3 && candidates.length < candidateCount; attempt++) {
    const candidate = attachGenerationReport(
      generateSongCandidate(options, attempt), attempt, candidateCount, diversity,
    );
    const fingerprint = candidate.generationReport!.fingerprint.combined;
    const candidateParts = candidate.generationReport!.fingerprint;
    const tooSimilar = candidates.some((existing) => {
      const existingParts = existing.generationReport!.fingerprint;
      const differentFields = (["harmony", "melody", "bass", "accompaniment"] as const)
        .filter((field) => candidateParts[field] !== existingParts[field]).length;
      return differentFields <= 1;
    });
    if (fingerprints.has(fingerprint) || tooSimilar) continue;
    fingerprints.add(fingerprint);
    candidates.push(candidate);
  }
  candidates.forEach((candidate, index) =>
    attachGenerationReport(candidate, index, candidates.length, diversity));
  const reference = candidates[0];
  candidates.forEach((candidate) => {
    candidate.generationReport!.differenceTags = describeCandidateDifference(candidate, reference);
  });
  return candidates;
}

/** 生成パイプライン全体 (§4.2)。同じオプション+シードなら常に同じ曲を返す。 */
export function generateSong(options: GenerateOptions): Song {
  const diversity = diversityFor(options);
  return selectSongCandidate(
    generateSongCandidates(options, options.candidateCount ?? 1),
    options.seed,
    diversity,
  );
}
