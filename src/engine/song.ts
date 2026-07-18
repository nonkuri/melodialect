import type { Annotation, Dialect, GeneratedSection, KeySignature, SectionType, Song } from "./types.js";
import { createRng } from "./rng.js";
import { meterOf, DEFAULT_METER, type Meter } from "./meter.js";
import { planSection, type FormEntry } from "./structure.js";
import { generateProgression } from "./harmony.js";
import { generateMelody } from "./melody.js";
import { generateAccompaniment } from "./accompaniment.js";

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
  meterName?: string;
  /**
   * セクション構成。省略時は Verse-Chorus-Verse-Chorus。
   * FormEntry.dialectName または resolveDialect で合作モード (§4.2) になる
   */
  form?: Array<SectionType | FormEntry>;
  /** 合作モード用: dialectName の解決。省略時はメインのみ */
  resolveDialect?: (name: string) => Dialect | undefined;
}

/** 生成パイプライン全体 (§4.2)。同じオプション+シードなら常に同じ曲を返す。 */
export function generateSong(options: GenerateOptions): Song {
  const { dialect: mainDialect, seed } = options;
  const rng = createRng(seed);
  const keyName = options.keyName ?? mainDialect.defaults.key;
  const key: KeySignature = {
    tonic: parseKeyName(keyName),
    mode: mainDialect.defaults.mode,
  };
  const bpm = options.bpm ?? mainDialect.defaults.bpm;
  const meter: Meter = options.meterName ? meterOf(options.meterName) : DEFAULT_METER;
  const form: Array<SectionType | FormEntry> =
    options.form ?? ["verse", "chorus", "verse", "chorus"];

  // 各セクションのダイアレクトを解決 (合作モード §4.2)
  const entries = form.map((e) => {
    const entry: FormEntry = typeof e === "string" ? { type: e } : e;
    let sectionDialect = mainDialect;
    if (entry.dialectName) {
      const resolved = options.resolveDialect?.(entry.dialectName);
      if (!resolved) throw new Error(`unknown dialect in form: ${entry.dialectName}`);
      sectionDialect = resolved;
    }
    return { type: entry.type, dialect: sectionDialect };
  });

  const sections: GeneratedSection[] = [];
  let startBar = 0;
  let prevMelodyEnd: number | undefined;

  entries.forEach(({ type, dialect }, i) => {
    const isFinalSection = i === entries.length - 1;
    const plan = planSection(type, dialect, rng);

    // 転調 (§4.1): セクションタイプ別の転調傾向 (通常は bridge)。最終セクションは主調のまま
    let sectionKey = key;
    const modAnnotations: Annotation[] = [];
    const modCfg = dialect.modulation?.[type];
    if (modCfg && !isFinalSection && rng.chance(modCfg.probability)) {
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

    const { chords, annotations: harmonyNotes } = generateProgression(
      plan, dialect, sectionKey, meter, rng, { isFinalSection },
    );
    const melody = generateMelody(plan, chords, dialect, sectionKey, meter, rng, {
      startPitch: prevMelodyEnd,
    });
    const accomp = generateAccompaniment(plan, chords, dialect, sectionKey, meter, rng);

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
      annotations: [...modAnnotations, ...harmonyNotes, ...melody.annotations, ...accomp.annotations].sort(
        (a, b) => a.bar - b.bar,
      ),
    });
    startBar += plan.bars;
  });

  return {
    dialectId: mainDialect.id,
    seed,
    key,
    keyName,
    bpm,
    meter,
    sections,
    totalBars: startBar,
  };
}
