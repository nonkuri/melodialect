import type { Annotation, ChordEvent, Dialect, KeySignature, NoteEvent, SectionPlan } from "./types.js";
import { BEATS_PER_BAR } from "./types.js";
import type { Rng } from "./rng.js";
import { scaleOf } from "./harmony.js";

export interface AccompanimentResult {
  piano: NoteEvent[];
  bass: NoteEvent[];
  annotations: Annotation[];
}

/**
 * 伴奏生成 (§4.2 手順 4)。M1 はピアノ (2 分音符のブロックコード) と
 * ベース (1・3 拍ルート + 経過音) の 2 パート。
 */
export function generateAccompaniment(
  plan: SectionPlan,
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  rng: Rng,
): AccompanimentResult {
  const piano: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  const annotations: Annotation[] = [];
  const scalePcs = scaleOf(key);
  const melodicBass = dialect.melody.contour === "stepwise"; // Paul: メロディックベース (§4.1 D2)

  for (let bar = 0; bar < plan.bars; bar++) {
    const chord = chords[bar]!;
    const barStart = bar * BEATS_PER_BAR;

    // ピアノ: ブロックコードを 2 分音符で 2 回
    for (const half of [0, 2]) {
      for (const pitch of chord.pitches) {
        piano.push({ start: barStart + half, duration: 2, pitch, velocity: 72 });
      }
    }

    // ベース: 1 拍目・3 拍目にベース音
    bass.push({ start: barStart, duration: 2, pitch: chord.bassPitch, velocity: 88 });
    const nextChord = chords[bar + 1];
    const target = nextChord ? nextChord.bassPitch : chord.bassPitch;

    if (melodicBass && nextChord && target !== chord.bassPitch) {
      // 4 拍目に次のコードへの経過音を入れる (対旋律的な動き)
      bass.push({ start: barStart + 2, duration: 1, pitch: chord.bassPitch, velocity: 84 });
      const passing = passingTone(chord.bassPitch, target, scalePcs);
      bass.push({ start: barStart + 3, duration: 1, pitch: passing, velocity: 80 });
      if (bar === 0) {
        annotations.push({
          bar,
          ruleId: "melodic-bass",
          text: "ベースに経過音を挿入 (メロディックベース)",
        });
      }
    } else {
      bass.push({ start: barStart + 2, duration: 2, pitch: chord.bassPitch, velocity: 84 });
    }
  }

  return { piano, bass, annotations };
}

/** from と to の間の経過音。半音差 2 なら半音階、それ以外はスケール上の中間音 */
function passingTone(from: number, to: number, scalePcs: number[]): number {
  const dir = to > from ? 1 : -1;
  const dist = Math.abs(to - from);
  if (dist === 2) return from + dir; // 半音階経過音
  if (dist <= 1) return from;
  // スケール上で to に向かって 1 歩手前の音
  for (let p = to - dir; p !== from; p -= dir) {
    if (scalePcs.includes(((p % 12) + 12) % 12)) return p;
  }
  return from + dir;
}
