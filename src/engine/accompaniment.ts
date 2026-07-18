import type { Annotation, ChordEvent, Dialect, KeySignature, NoteEvent, SectionPlan } from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { scaleOf } from "./harmony.js";

export interface AccompanimentResult {
  piano: NoteEvent[];
  bass: NoteEvent[];
  annotations: Annotation[];
}

/**
 * 伴奏生成 (§4.2 手順 4)。ピアノ (ブロックコード) とベース (ルート+経過音)。
 * 拍子ごとにパターンを変える: 4/4 = 2 分刻み、3/4 = ワルツ (ベース+後拍和音)、
 * 6/8 = 付点 4 分の 2 拍子。
 */
export function generateAccompaniment(
  plan: SectionPlan,
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  meter: Meter,
  rng: Rng,
): AccompanimentResult {
  const piano: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  const annotations: Annotation[] = [];
  const scalePcs = scaleOf(key);
  const melodicBass = dialect.melody.contour === "stepwise"; // Chromatic: メロディックベース (§4.1 D2)

  for (let bar = 0; bar < plan.bars; bar++) {
    const chord = chords[bar]!;
    const barStart = bar * meter.barBeats;
    const nextChord = chords[bar + 1];
    const target = nextChord ? nextChord.bassPitch : chord.bassPitch;
    const wantsPassing = melodicBass && nextChord && target !== chord.bassPitch;

    if (meter.name === "3/4") {
      // ワルツ: 1 拍目ベース、2・3 拍目に和音
      for (const beat of [1, 2]) {
        for (const pitch of chord.pitches) {
          piano.push({ start: barStart + beat, duration: 1, pitch, velocity: 68 });
        }
      }
      if (wantsPassing) {
        bass.push({ start: barStart, duration: 2, pitch: chord.bassPitch, velocity: 88 });
        bass.push({
          start: barStart + 2, duration: 1,
          pitch: passingTone(chord.bassPitch, target, scalePcs), velocity: 80,
        });
      } else {
        bass.push({ start: barStart, duration: 3, pitch: chord.bassPitch, velocity: 88 });
      }
    } else if (meter.name === "6/8") {
      // 複合 2 拍子: 付点 4 分ごとに和音とベース
      for (const beat of [0, 1.5]) {
        for (const pitch of chord.pitches) {
          piano.push({ start: barStart + beat, duration: 1.5, pitch, velocity: 70 });
        }
      }
      bass.push({ start: barStart, duration: 1.5, pitch: chord.bassPitch, velocity: 88 });
      bass.push({
        start: barStart + 1.5, duration: 1.5,
        pitch: wantsPassing ? passingTone(chord.bassPitch, target, scalePcs) : chord.bassPitch,
        velocity: 82,
      });
    } else {
      // 4/4: ブロックコードを 2 分音符で 2 回
      for (const half of [0, 2]) {
        for (const pitch of chord.pitches) {
          piano.push({ start: barStart + half, duration: 2, pitch, velocity: 72 });
        }
      }
      bass.push({ start: barStart, duration: 2, pitch: chord.bassPitch, velocity: 88 });
      if (wantsPassing) {
        // 4 拍目に次のコードへの経過音を入れる (対旋律的な動き)
        bass.push({ start: barStart + 2, duration: 1, pitch: chord.bassPitch, velocity: 84 });
        bass.push({
          start: barStart + 3, duration: 1,
          pitch: passingTone(chord.bassPitch, target, scalePcs), velocity: 80,
        });
      } else {
        bass.push({ start: barStart + 2, duration: 2, pitch: chord.bassPitch, velocity: 84 });
      }
    }

    if (wantsPassing && bar === 0) {
      annotations.push({
        bar,
        ruleId: "melodic-bass",
        text: "ベースに経過音を挿入 (メロディックベース)",
      });
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
