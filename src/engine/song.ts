import type { Dialect, GeneratedSection, KeySignature, SectionType, Song } from "./types.js";
import { createRng } from "./rng.js";
import { planStructure } from "./structure.js";
import { generateProgression } from "./harmony.js";
import { generateMelody } from "./melody.js";
import { generateAccompaniment } from "./accompaniment.js";

const NOTE_NAMES: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

export function parseKeyName(name: string): number {
  const pc = NOTE_NAMES[name];
  if (pc === undefined) throw new Error(`unknown key name: ${name}`);
  return pc;
}

export interface GenerateOptions {
  dialect: Dialect;
  seed: number;
  /** 例: "C", "F#"。省略時はダイアレクトのデフォルト */
  keyName?: string;
  bpm?: number;
  /** セクション構成。省略時は Verse-Chorus-Verse-Chorus */
  form?: SectionType[];
}

/** 生成パイプライン全体 (§4.2)。同じオプション+シードなら常に同じ曲を返す。 */
export function generateSong(options: GenerateOptions): Song {
  const { dialect, seed } = options;
  const rng = createRng(seed);
  const key: KeySignature = {
    tonic: parseKeyName(options.keyName ?? dialect.defaults.key),
    mode: dialect.defaults.mode,
  };
  const bpm = options.bpm ?? dialect.defaults.bpm;
  const form = options.form ?? ["verse", "chorus", "verse", "chorus"];

  const plans = planStructure(form, dialect, rng);
  const sections: GeneratedSection[] = [];
  let startBar = 0;
  let prevMelodyEnd: number | undefined;

  plans.forEach((plan, i) => {
    const isFinalSection = i === plans.length - 1;
    const { chords, annotations: harmonyNotes } = generateProgression(
      plan, dialect, key, rng, { isFinalSection },
    );
    const melody = generateMelody(plan, chords, dialect, key, rng, {
      startPitch: prevMelodyEnd,
    });
    const accomp = generateAccompaniment(plan, chords, dialect, key, rng);

    prevMelodyEnd = melody.notes.at(-1)?.pitch;
    sections.push({
      plan,
      startBar,
      chords,
      melody: melody.notes,
      piano: accomp.piano,
      bass: accomp.bass,
      annotations: [...harmonyNotes, ...melody.annotations, ...accomp.annotations].sort(
        (a, b) => a.bar - b.bar,
      ),
    });
    startBar += plan.bars;
  });

  return {
    dialectId: dialect.id,
    seed,
    key,
    bpm,
    sections,
    totalBars: startBar,
  };
}
