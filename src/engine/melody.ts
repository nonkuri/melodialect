import type {
  Annotation,
  ChordEvent,
  Dialect,
  KeySignature,
  NoteEvent,
  SectionPlan,
} from "./types.js";
import { BEATS_PER_BAR } from "./types.js";
import type { Rng } from "./rng.js";
import { scaleOf } from "./harmony.js";

const MELODY_LOW = 60; // C4
const MELODY_HIGH = 81; // A5
const MELODY_CENTER = 67; // G4

/** 1 小節分のリズムテンプレート (合計 4 拍) */
const RHYTHM_TEMPLATES: number[][] = [
  [1, 1, 1, 1],
  [2, 1, 1],
  [1, 1, 2],
  [2, 2],
  [1.5, 0.5, 1, 1],
  [1, 0.5, 0.5, 1, 1],
];
const FINAL_BAR_TEMPLATES: number[][] = [[4], [2, 2]];

export interface MelodyResult {
  notes: NoteEvent[];
  annotations: Annotation[];
}

function isScaleTone(pitch: number, scalePcs: number[]): boolean {
  return scalePcs.includes(((pitch % 12) + 12) % 12);
}

/** pitch から dir 方向に最も近いスケール音を返す (dir=0 なら両方向で最近傍) */
function snapToScale(pitch: number, scalePcs: number[], dir: -1 | 0 | 1): number {
  for (let d = 0; d <= 11; d++) {
    const candidates =
      dir === 0 ? [pitch + d, pitch - d] : dir === 1 ? [pitch + d] : [pitch - d];
    for (const c of candidates) {
      if (isScaleTone(c, scalePcs)) return c;
    }
  }
  return pitch;
}

/** pitch に最も近いコードトーンを返す */
function snapToChordTone(pitch: number, chord: ChordEvent): number {
  const chordPcs = chord.pitches.map((p) => p % 12);
  let best = pitch;
  let bestDist = Infinity;
  for (let cand = pitch - 6; cand <= pitch + 6; cand++) {
    if (chordPcs.includes(((cand % 12) + 12) % 12)) {
      const dist = Math.abs(cand - pitch);
      if (dist < bestDist) {
        best = cand;
        bestDist = dist;
      }
    }
  }
  return best;
}

/** スケール上で steps 度移動する */
function stepOnScale(pitch: number, steps: number, scalePcs: number[]): number {
  let p = snapToScale(pitch, scalePcs, 0);
  const dir = steps > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(steps); i++) {
    p = snapToScale(p + dir, scalePcs, dir);
  }
  return p;
}

function clampReflect(pitch: number, scalePcs: number[]): number {
  if (pitch > MELODY_HIGH) return snapToScale(pitch - 12, scalePcs, 0);
  if (pitch < MELODY_LOW) return snapToScale(pitch + 12, scalePcs, 0);
  return pitch;
}

/**
 * メロディ生成 (§4.2 手順 3)。
 * コードトーンを土台に、ダイアレクトの輪郭ルール
 * (跳躍確率・跳躍幅・跳躍後バイアス) でピッチ列を生成する。
 */
export function generateMelody(
  plan: SectionPlan,
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  rng: Rng,
  opts: { startPitch?: number } = {},
): MelodyResult {
  const scalePcs = scaleOf(key);
  const notes: NoteEvent[] = [];
  const annotations: Annotation[] = [];
  const { leapProbability, leapRangeSemitones, afterLeapBias } = dialect.melody;

  // 前セクションの最終音から続ける (サビ頭の跳躍はここからの跳躍として表現される)
  let prevPitch = opts.startPitch ?? snapToChordTone(MELODY_CENTER, chords[0]!);
  /** 跳躍直後の下降 (上昇) バイアスが残っている音数 */
  let biasRemaining = 0;
  let isFirstNote = true;

  for (let bar = 0; bar < plan.bars; bar++) {
    const chord = chords[bar]!;
    const isLastBar = bar === plan.bars - 1;
    const template = rng.pick(isLastBar ? FINAL_BAR_TEMPLATES : RHYTHM_TEMPLATES);

    let beatInBar = 0;
    for (const duration of template) {
      const isStrongBeat = beatInBar === 0 || beatInBar === 2;

      let pitch: number;
      {
        // サビ頭の第 1 音は chorusHead の跳躍確率を使う (§4.1 D4 の輪郭ルール)
        const leapP =
          isFirstNote && plan.type === "chorus"
            ? leapProbability.chorusHead
            : isFirstNote
              ? 0
              : leapProbability.default;

        if (rng.chance(leapP)) {
          // 跳躍: leapRangeSemitones の幅で移動し、その後は逆方向にバイアス
          const semis = rng.int(leapRangeSemitones[0], leapRangeSemitones[1]);
          const dir: 1 | -1 =
            prevPitch > MELODY_CENTER + 5 ? -1 : prevPitch < MELODY_CENTER - 3 ? 1 : rng.chance(0.7) ? 1 : -1;
          pitch = snapToScale(prevPitch + dir * semis, scalePcs, 0);
          biasRemaining = 3;
          annotations.push({
            bar,
            ruleId: "melodic-leap",
            text: `跳躍 (${semis} 半音、${dir > 0 ? "上行" : "下行"})。以後${afterLeapBias === "down" ? "下降" : "上昇"}バイアス`,
          });
        } else {
          // 順次進行: 1〜2 度の移動。バイアス中は方向を固定
          const steps = rng.chance(0.7) ? 1 : 2;
          let dir: number;
          if (biasRemaining > 0 && afterLeapBias !== "none") {
            dir = afterLeapBias === "down" ? -1 : 1;
            biasRemaining--;
          } else {
            dir = rng.chance(0.5) ? 1 : -1;
          }
          pitch = stepOnScale(prevPitch, dir * steps, scalePcs);
        }
      }

      if (isStrongBeat) {
        pitch = snapToChordTone(pitch, chord);
      }
      pitch = clampReflect(pitch, scalePcs);

      notes.push({
        start: bar * BEATS_PER_BAR + beatInBar,
        duration,
        pitch,
        velocity: plan.type === "chorus" ? 100 : 90,
      });

      prevPitch = pitch;
      beatInBar += duration;
      isFirstNote = false;
    }
  }

  return { notes, annotations };
}
