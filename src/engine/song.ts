import type {
  Annotation,
  ArrangementSettings,
  CompositionControls,
  CompositionDesign,
  Mode,
  Dialect,
  EndingMode,
  GeneratedSection,
  KeySignature,
  SectionType,
  SectionControl,
  Song,
} from "./types.js";
import { createRng } from "./rng.js";
import { meterOf, DEFAULT_METER, type Meter } from "./meter.js";
import { planSection, type FormEntry } from "./structure.js";
import { chordAtBeat, generateProgression } from "./harmony.js";
import { generateMelody } from "./melody.js";
import { generateAccompaniment } from "./accompaniment.js";
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
  /** 拍子 ("4/4" | "3/4" | "6/8")。省略時は 4/4 */
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
}

/** Derive an independent deterministic seed for each section. */
function sectionSeed(seed: number, index: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
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

/** 生成パイプライン全体 (§4.2)。同じオプション+シードなら常に同じ曲を返す。 */
export function generateSong(options: GenerateOptions): Song {
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

  const sections: GeneratedSection[] = [];
  let startBar = 0;
  let prevMelodyEnd: number | undefined;

  entries.forEach(({ type, dialect }, i) => {
    const isLastEntry = i === entries.length - 1;
    // ループモードでは最終セクションも半終止で終え、曲頭の I へ戻れるようにする
    const rng = createRng(options.sectionSeeds?.[i] ?? sectionSeed(seed, i));
    const isFinalSection = ending === "final" && isLastEntry;
    const sectionControl = options.sectionControls?.[i];
    // SectionControl の bars は画面に見えるコーダ込みの長さ。生成前の本体では
    // final コーダ 1 小節を差し引き、再生成のたびに小節が増えないようにする。
    const fixedPhraseLengths = sectionControl
      ? [Math.max(1, Math.round(sectionControl.bars) - (isFinalSection ? 1 : 0))]
      : options.sectionPhraseLengths?.[i];
    const plan = fixedPhraseLengths
      ? {
          type,
          phraseLengths: [...fixedPhraseLengths],
          bars: fixedPhraseLengths.reduce((sum, bars) => sum + bars, 0),
        }
      : planSection(type, dialect, rng);

    // 転調 (§4.1): セクションタイプ別の転調傾向 (通常は bridge)。最終セクションは主調のまま
    let sectionKey = key;
    const modAnnotations: Annotation[] = [];
    const modCfg = dialect.modulation?.[type];
    if (modCfg && !isLastEntry && rng.chance(modCfg.probability)) {
      const semis = rng.weighted(
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
      plan, dialect, sectionKey, meter, rng, { isFinalSection },
    );
    let chords = generatedHarmony.chords;
    let harmonyNotes = generatedHarmony.annotations;
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
        resolvedDraft = completeChordDraft(resolvedDraft, generatedHarmony.chords, dialect, rng);
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
    const melody = generateMelody(plan, chords, dialect, sectionKey, meter, rng, {
      startPitch: prevMelodyEnd,
    });
    const accomp = generateAccompaniment(plan, chords, dialect, sectionKey, meter, rng, options.arrangement);

    prevMelodyEnd = melody.notes.at(-1)?.pitch;
    sections.push({
      plan,
      startBar,
      dialectId: dialect.id,
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
    const finalArrangement = normalizeArrangement({
      ...finalDialect.defaults.arrangement,
      ...options.arrangement,
    });
    if (finalArrangement.pianoPattern !== "off") {
      const tones = finalArrangement.pianoPattern === "bossa" && lastChord.pitches.length >= 5
        ? [lastChord.pitches[1]!, lastChord.pitches[3]!, lastChord.pitches[4]!]
        : finalArrangement.pianoPattern === "bossa" && lastChord.pitches.length >= 4
          ? lastChord.pitches.slice(1)
          : lastChord.pitches;
      for (const pitch of tones) {
        lastSection.piano.push({ start: tailStart, duration: bb, pitch, velocity: 64 });
      }
    }
    if (finalArrangement.guitarPattern !== "off") {
      const tones = finalArrangement.guitarPattern === "bossa" && lastChord.pitches.length >= 4
        ? lastChord.pitches.slice(1)
        : lastChord.pitches;
      tones.forEach((pitch, index) => lastSection.guitar.push({
        start: tailStart + index * 0.014,
        duration: Math.max(0.1, bb - index * 0.014),
        pitch: pitch + 12,
        velocity: 62 - Math.min(index, 3),
      }));
    }
    lastSection.bass.push({
      start: tailStart, duration: bb, pitch: lastChord.bassPitch, velocity: 78,
    });
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
    ? applyCompositionControls(song, controls, options.design?.sectionExpressions)
    : song;
  return options.design ? applyMotifAndChorusDesign(controlled, options.design) : controlled;
}
