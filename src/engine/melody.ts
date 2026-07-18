import type {
  Annotation,
  ChordEvent,
  Dialect,
  KeySignature,
  NoteEvent,
  SectionPlan,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { scaleOf } from "./harmony.js";

const MELODY_LOW = 60; // C4
const MELODY_HIGH = 81; // A5
const MELODY_CENTER = 67; // G4
/** フレーズ途中の跳躍確率は default に対するこの倍率 (§6.2 の意味付け) */
const WITHIN_PHRASE_LEAP_FACTOR = 0.35;

/** 拍子ごとの 1 小節分リズムテンプレート (合計 = meter.barBeats) */
const RHYTHM_TEMPLATES: Record<string, number[][]> = {
  "4/4": [
    [1, 1, 1, 1],
    [2, 1, 1],
    [1, 1, 2],
    [2, 2],
    [1.5, 0.5, 1, 1],
    [1, 0.5, 0.5, 1, 1],
  ],
  "3/4": [
    [1, 1, 1],
    [2, 1],
    [1, 2],
    [1.5, 1.5],
    [1, 0.5, 0.5, 1],
  ],
  "6/8": [
    [1.5, 1.5],
    [0.5, 0.5, 0.5, 1.5],
    [1, 0.5, 1.5],
    [1.5, 0.5, 0.5, 0.5],
    [1.5, 1, 0.5],
  ],
};
const FINAL_BAR_TEMPLATES: Record<string, number[][]> = {
  "4/4": [[4], [2, 2]],
  "3/4": [[3], [2, 1]],
  "6/8": [[3], [1.5, 1.5]],
};

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

/** フレーズの開始小節の集合 (phraseLengths の累積) */
function phraseStartBars(plan: SectionPlan): Set<number> {
  const set = new Set<number>();
  let bar = 0;
  for (const len of plan.phraseLengths) {
    set.add(bar);
    bar += len;
  }
  return set;
}

/**
 * メロディ生成 (§4.2 手順 3)。
 * コードトーンを土台に、ダイアレクトの輪郭ルール
 * (跳躍確率・跳躍幅・跳躍後バイアス・同音連打・逆ペダル) でピッチ列を生成する。
 */
export function generateMelody(
  plan: SectionPlan,
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  meter: Meter,
  rng: Rng,
  opts: { startPitch?: number } = {},
): MelodyResult {
  const scalePcs = scaleOf(key);
  const notes: NoteEvent[] = [];
  const annotations: Annotation[] = [];
  const { leapProbability, leapRangeSemitones, afterLeapBias, pedalPoint } = dialect.melody;
  const repeatProb = dialect.melody.repeatNoteProbability ?? 0;
  const phraseStarts = phraseStartBars(plan);

  // 前セクションの最終音から続ける (サビ頭の跳躍はここからの跳躍として表現される)
  let prevPitch = opts.startPitch ?? snapToChordTone(MELODY_CENTER, chords[0]!);

  // 逆ペダルポイント (Pedal): セクション最初のコードの上位コードトーン (B4 付近) に固定
  let pedalPitch: number | null = null;
  if (pedalPoint) {
    pedalPitch = clampReflect(snapToChordTone(71, chords[0]!), scalePcs);
    annotations.push({
      bar: 0,
      ruleId: "inverted-pedal",
      text: `逆ペダルポイント: メロディを固定しコード進行のみ変化させる`,
    });
  }

  /** 跳躍直後の下降 (上昇) バイアスが残っている音数 */
  let biasRemaining = 0;
  let isFirstNote = true;

  const templates = RHYTHM_TEMPLATES[meter.name] ?? RHYTHM_TEMPLATES["4/4"]!;
  const finalTemplates = FINAL_BAR_TEMPLATES[meter.name] ?? FINAL_BAR_TEMPLATES["4/4"]!;

  for (let bar = 0; bar < plan.bars; bar++) {
    const chord = chords[bar]!;
    const isLastBar = bar === plan.bars - 1;
    const template = rng.pick(isLastBar ? finalTemplates : templates);

    let beatInBar = 0;
    let isFirstNoteOfBar = true;
    for (const duration of template) {
      const isStrongBeat = meter.strongBeats.includes(beatInBar);
      const isPhraseHead = isFirstNoteOfBar && phraseStarts.has(bar);

      // 跳躍確率: サビ頭 > フレーズ頭 > フレーズ途中 (§4.1 D4)
      const leapP = isFirstNote
        ? plan.type === "chorus"
          ? leapProbability.chorusHead
          : leapProbability.default
        : isPhraseHead
          ? leapProbability.default
          : leapProbability.default * WITHIN_PHRASE_LEAP_FACTOR;

      let pitch: number;
      let skipChordSnap = false;

      if (pedalPitch !== null && !isPhraseHead && rng.chance(0.62)) {
        // 逆ペダル: コードが変わってもメロディはペダル音に留まる
        pitch = pedalPitch;
        skipChordSnap = true;
      } else if (!isFirstNote && repeatProb > 0 && rng.chance(repeatProb)) {
        // 同音連打 (Modal): 直前の音を繰り返す
        pitch = prevPitch;
        skipChordSnap = true;
      } else if (rng.chance(leapP)) {
        // 跳躍: leapRangeSemitones の幅で移動し、着地はコードトーンに合わせる
        const semis = rng.int(leapRangeSemitones[0], leapRangeSemitones[1]);
        const dir: 1 | -1 =
          prevPitch > MELODY_CENTER + 5 ? -1
          : prevPitch < MELODY_CENTER - 3 ? 1
          : rng.chance(0.7) ? 1 : -1;
        pitch = snapToChordTone(prevPitch + dir * semis, chord);
        skipChordSnap = true;
        if (afterLeapBias !== "none") biasRemaining = 3;
        const actual = Math.abs(pitch - prevPitch);
        annotations.push({
          bar,
          ruleId: "melodic-leap",
          text: `跳躍 (${actual} 半音、${pitch > prevPitch ? "上行" : "下行"})${
            afterLeapBias !== "none"
              ? `。以後${afterLeapBias === "down" ? "下降" : "上昇"}バイアス`
              : ""
          }`,
        });
      } else if (isFirstNote) {
        // セクション最初の音 (跳躍しない場合) はコードトーンに乗せる
        pitch = snapToChordTone(prevPitch, chord);
        skipChordSnap = true;
      } else {
        // 順次進行: 1〜2 度の移動。跳躍後バイアス中は方向を固定
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

      if (isStrongBeat && !skipChordSnap) {
        pitch = snapToChordTone(pitch, chord);
      }
      pitch = clampReflect(pitch, scalePcs);

      notes.push({
        start: bar * meter.barBeats + beatInBar,
        duration,
        pitch,
        velocity: plan.type === "chorus" ? 100 : 90,
      });

      prevPitch = pitch;
      beatInBar += duration;
      isFirstNote = false;
      isFirstNoteOfBar = false;
    }
  }

  return { notes, annotations };
}
