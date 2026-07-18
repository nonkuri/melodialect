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
 * ハーモニックリズム対応: コードイベントの start/durationBeats に従って
 * セグメント単位でパターンを敷く。拍子ごとにパターンを変える:
 * 4/4 = 2 分刻み、3/4 = ワルツ (ベース+後拍和音)、6/8 = 付点 4 分の 2 拍子。
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
  let annotated = false;

  chords.forEach((chord, ci) => {
    const next = chords[ci + 1];
    const target = next ? next.bassPitch : chord.bassPitch;
    const seg = chord.durationBeats;
    const wantsPassing = melodicBass && next && target !== chord.bassPitch && seg >= 2;

    if (wantsPassing && !annotated) {
      annotations.push({
        bar: chord.bar,
        ruleId: "melodic-bass",
        text: "ベースに経過音を挿入 (メロディックベース)",
      });
      annotated = true;
    }

    if (meter.name === "3/4") {
      // 小節に揃ったセグメントはワルツ、半端なセグメントはブロックコード
      if (chord.start % 3 === 0 && seg % 3 === 0) {
        const barsInSeg = seg / 3;
        for (let b = 0; b < barsInSeg; b++) {
          const barStart = chord.start + b * 3;
          const isLastBarOfSeg = b === barsInSeg - 1;
          for (const beat of [1, 2]) {
            for (const pitch of chord.pitches) {
              piano.push({ start: barStart + beat, duration: 1, pitch, velocity: 68 });
            }
          }
          if (wantsPassing && isLastBarOfSeg) {
            bass.push({ start: barStart, duration: 2, pitch: chord.bassPitch, velocity: 88 });
            bass.push({
              start: barStart + 2, duration: 1,
              pitch: passingTone(chord.bassPitch, target, scalePcs), velocity: 80,
            });
          } else {
            bass.push({ start: barStart, duration: 3, pitch: chord.bassPitch, velocity: 88 });
          }
        }
      } else {
        for (const pitch of chord.pitches) {
          piano.push({ start: chord.start, duration: seg, pitch, velocity: 68 });
        }
        bass.push({ start: chord.start, duration: seg, pitch: chord.bassPitch, velocity: 88 });
      }
    } else if (meter.name === "6/8") {
      // 複合 2 拍子: 付点 4 分 (1.5 beats) ごとに和音とベース
      for (let t = 0; t < seg - 1e-9; t += 1.5) {
        const dur = Math.min(1.5, seg - t);
        for (const pitch of chord.pitches) {
          piano.push({ start: chord.start + t, duration: dur, pitch, velocity: 70 });
        }
        const isLastPulse = t + 1.5 >= seg - 1e-9;
        bass.push({
          start: chord.start + t, duration: dur,
          pitch: wantsPassing && isLastPulse
            ? passingTone(chord.bassPitch, target, scalePcs)
            : chord.bassPitch,
          velocity: t === 0 ? 88 : 82,
        });
      }
    } else {
      // 4/4: ブロックコードを 2 分音符刻みで敷く
      for (let t = 0; t < seg - 1e-9; t += 2) {
        const dur = Math.min(2, seg - t);
        for (const pitch of chord.pitches) {
          piano.push({ start: chord.start + t, duration: dur, pitch, velocity: 72 });
        }
      }
      if (wantsPassing) {
        // セグメント末尾 1 拍に次のコードへの経過音 (対旋律的な動き)
        for (let t = 0; t < seg - 2 - 1e-9; t += 2) {
          bass.push({ start: chord.start + t, duration: 2, pitch: chord.bassPitch, velocity: t === 0 ? 88 : 84 });
        }
        const tailStart = chord.start + seg - 2;
        bass.push({ start: tailStart, duration: 1, pitch: chord.bassPitch, velocity: 84 });
        bass.push({
          start: tailStart + 1, duration: 1,
          pitch: passingTone(chord.bassPitch, target, scalePcs), velocity: 80,
        });
      } else {
        for (let t = 0; t < seg - 1e-9; t += 2) {
          const dur = Math.min(2, seg - t);
          bass.push({ start: chord.start + t, duration: dur, pitch: chord.bassPitch, velocity: t === 0 ? 88 : 84 });
        }
      }
    }
  });

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
