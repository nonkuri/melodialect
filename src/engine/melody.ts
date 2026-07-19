import type {
  Annotation,
  ChordEvent,
  Dialect,
  KeySignature,
  MelodicContour,
  NoteEvent,
  RhythmTemplate,
  SectionPlan,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { chordAtBeat, scaleOf } from "./harmony.js";

const MELODY_LOW = 60; // C4
const MELODY_HIGH = 81; // A5
const MELODY_CENTER = 67; // G4
/** フレーズ途中の跳躍確率は default に対するこの倍率 (§6.2 の意味付け) */
const WITHIN_PHRASE_LEAP_FACTOR = 0.35;

/**
 * 内蔵リズムテンプレート。ダイアレクトが rhythm.templates を持たない場合の
 * フォールバック (§4.1 リズム語彙)。beats の負値は休符。
 */
const BUILTIN_TEMPLATES: Record<string, RhythmTemplate[]> = {
  "4/4": [
    { beats: [1, 1, 1, 1], weight: 1 },
    { beats: [2, 1, 1], weight: 1 },
    { beats: [1, 1, 2], weight: 1 },
    { beats: [2, 2], weight: 1 },
    { beats: [1.5, 0.5, 1, 1], weight: 1 },
    { beats: [1, 0.5, 0.5, 1, 1], weight: 1 },
  ],
  "3/4": [
    { beats: [1, 1, 1], weight: 1 },
    { beats: [2, 1], weight: 1 },
    { beats: [1, 2], weight: 1 },
    { beats: [1.5, 1.5], weight: 1 },
    { beats: [1, 0.5, 0.5, 1], weight: 1 },
  ],
  "6/8": [
    { beats: [1.5, 1.5], weight: 1 },
    { beats: [0.5, 0.5, 0.5, 1.5], weight: 1 },
    { beats: [1, 0.5, 1.5], weight: 1 },
    { beats: [1.5, 0.5, 0.5, 0.5], weight: 1 },
    { beats: [1.5, 1, 0.5], weight: 1 },
  ],
};
const BUILTIN_FINAL: Record<string, RhythmTemplate[]> = {
  "4/4": [{ beats: [4], weight: 1 }, { beats: [2, 2], weight: 1 }],
  "3/4": [{ beats: [3], weight: 1 }, { beats: [2, 1], weight: 1 }],
  "6/8": [{ beats: [3], weight: 1 }, { beats: [1.5, 1.5], weight: 1 }],
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

function isChordTone(pitch: number, chord: ChordEvent): boolean {
  return chord.pitches.map((p) => p % 12).includes(((pitch % 12) + 12) % 12);
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

/** from → to のスケール度数差 (符号付き) */
function scaleStepsBetween(from: number, to: number, scalePcs: number[]): number {
  let a = snapToScale(from, scalePcs, 0);
  const b = snapToScale(to, scalePcs, 0);
  if (a === b) return 0;
  const dir: 1 | -1 = b > a ? 1 : -1;
  let steps = 0;
  while (a !== b && Math.abs(steps) < 24) {
    a = snapToScale(a + dir, scalePcs, dir);
    steps += dir;
  }
  return steps;
}

function clampReflect(pitch: number, scalePcs: number[], low: number, high: number): number {
  if (pitch > high) return snapToScale(pitch - 12, scalePcs, 0);
  if (pitch < low) return snapToScale(pitch + 12, scalePcs, 0);
  return pitch;
}

const CONTOUR_LABELS: Record<MelodicContour, string> = {
  stepwise: "順次進行を中心に滑らかにつなぐ",
  repetitive: "同音反復を軸に語るように進む",
  pedal: "固定音を保ちながら和声だけを動かす",
  "leap-then-descend": "跳躍後に下降して着地する",
  angular: "方向を切り替えながら角張って進む",
  "syncopated-narrow": "狭い音域で細かく往復する",
  ostinato: "短い音型を機械的に反復する",
  floating: "音域中央の周囲を漂う",
  arch: "フレーズ前半で上昇し後半で下降する",
  "call-response": "上行する呼びかけと下降する応答を交互に置く",
  descending: "下降方向を優先して緊張を深める",
  interlocking: "短い上下動を噛み合わせて反復する",
  "voice-led": "共通音と近接音を優先して滑らかに移る",
};

function contourMovement(
  contour: MelodicContour,
  progress: number,
  noteIndex: number,
  pitch: number,
  center: number,
  rng: Rng,
): { dir: -1 | 1; steps: number } {
  if (contour === "arch") {
    return { dir: progress < 0.5 ? 1 : -1, steps: 1 };
  }
  if (contour === "call-response") {
    return { dir: Math.floor(progress * 4) % 2 === 0 ? 1 : -1, steps: noteIndex % 4 === 3 ? 2 : 1 };
  }
  if (contour === "descending") {
    return { dir: rng.chance(0.82) ? -1 : 1, steps: rng.chance(0.82) ? 1 : 2 };
  }
  if (contour === "interlocking") {
    const directions: Array<-1 | 1> = [1, -1, 1, -1, -1, 1];
    return { dir: directions[noteIndex % directions.length]!, steps: noteIndex % 3 === 2 ? 2 : 1 };
  }
  if (contour === "voice-led" || contour === "floating") {
    const towardCenter: -1 | 1 = pitch > center ? -1 : 1;
    return { dir: rng.chance(0.7) ? towardCenter : (towardCenter === 1 ? -1 : 1), steps: 1 };
  }
  if (contour === "syncopated-narrow" || contour === "stepwise") {
    return { dir: rng.chance(0.5) ? 1 : -1, steps: 1 };
  }
  return { dir: rng.chance(0.5) ? 1 : -1, steps: rng.chance(0.7) ? 1 : 2 };
}

/** リズムスロット: テンプレートを小節内の (開始位置, 長さ, 休符, アウフタクト) に展開したもの */
interface Slot {
  offset: number;
  duration: number;
  rest: boolean;
  pickup?: boolean;
}

function buildSlots(beats: number[], barStart: number): Slot[] {
  const slots: Slot[] = [];
  let t = barStart;
  for (const b of beats) {
    slots.push({ offset: t, duration: Math.abs(b), rest: b < 0 });
    t += Math.abs(b);
  }
  return slots;
}

/**
 * テンプレート選択。サビでは chorusDensityBias に応じて音数の多い
 * テンプレートの重みを上げる (§4.1 セクション対比)
 */
function pickTemplate(list: RhythmTemplate[], rng: Rng, densityBias: number): number[] {
  if (densityBias <= 0 || list.length <= 1) {
    return rng.weighted(list.map((t) => [t.beats, t.weight] as [number[], number]));
  }
  const counts = list.map((t) => t.beats.filter((b) => b > 0).length);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const entries = list.map((t, i) => {
    const w = t.weight * (1 + densityBias * ((counts[i]! - avg) / Math.max(avg, 1)));
    return [t.beats, Math.max(0.05, w)] as [number[], number];
  });
  return rng.weighted(entries);
}

/**
 * 最終小節の末尾 1 拍を 8 分音符 2 つのアウフタクト (次フレーズへの先取音) に
 * 作り替える。作れない形なら null
 */
function carvePickups(slots: Slot[], barStart: number, barBeats: number): Slot[] | null {
  const last = slots[slots.length - 1];
  if (!last || last.duration < 1) return null;
  const head = slots.slice(0, -1);
  if (last.duration > 1) {
    head.push({ ...last, duration: last.duration - 1 });
  }
  const pickupStart = barStart + barBeats - 1;
  head.push({ offset: pickupStart, duration: 0.5, rest: false, pickup: true });
  head.push({ offset: pickupStart + 0.5, duration: 0.5, rest: false, pickup: true });
  return head;
}

/** モチーフ (§4.1): 最初のフレーズのリズムと輪郭 (頭の音からのスケール度数差) を記憶する */
interface MotifSlot {
  offsetInPhrase: number;
  duration: number;
  rest: boolean;
  step: number;
}
interface Motif {
  bars: number;
  headPitch: number;
  slots: MotifSlot[];
}

/**
 * メロディ生成 (§4.2 手順 3)。
 * フレーズ単位で生成し、ダイアレクトのリズム語彙・モチーフ反復・輪郭ルール
 * (跳躍確率・跳躍幅・跳躍後バイアス・同音連打・逆ペダル)・非和声音
 * (倚音・掛留・半音階経過音)・セクション別レジスタでピッチ列を組み立てる。
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
  const scalePcs = scaleOf(key, dialect.melody.pitchCollection);
  const notes: NoteEvent[] = [];
  const annotations: Annotation[] = [{
    bar: 0,
    ruleId: "melodic-contour",
    text: `旋律輪郭: ${CONTOUR_LABELS[dialect.melody.contour]}`,
  }];
  const { leapProbability, leapRangeSemitones, afterLeapBias, pedalPoint } = dialect.melody;
  const repeatProb = dialect.melody.repeatNoteProbability ?? 0;
  const nct = dialect.melody.nonChordTones ?? {};
  const appoggiaturaP = nct.appoggiatura ?? 0;
  const suspensionP = nct.suspension ?? 0;
  const chromaticP = nct.chromaticPassing ?? 0;
  const motifP = pedalPoint ? 0 : (dialect.melody.motif?.repeatProbability ?? 0);

  // セクション別レジスタシフト (§4.1 セクション対比)
  const shift = dialect.melody.registerShift?.[plan.type] ?? 0;
  const low = MELODY_LOW + shift;
  const high = MELODY_HIGH + shift;
  const center = MELODY_CENTER + shift;

  // リズム語彙 (§4.1): ダイアレクト定義があればそれを、なければ内蔵テンプレート
  const rhythmCfg = dialect.rhythm ?? {};
  const templates =
    rhythmCfg.templates?.[meter.name] ?? BUILTIN_TEMPLATES[meter.name] ?? BUILTIN_TEMPLATES["4/4"]!;
  const finalTemplates =
    rhythmCfg.finalTemplates?.[meter.name] ?? BUILTIN_FINAL[meter.name] ?? BUILTIN_FINAL["4/4"]!;
  const densityBias = plan.type === "chorus" ? (rhythmCfg.chorusDensityBias ?? 0) : 0;
  const anacrusisP = rhythmCfg.anacrusisProbability ?? 0;

  const bb = meter.barBeats;
  const velocity = plan.type === "chorus" ? 100 : 90;
  const isStrong = (offset: number): boolean =>
    meter.strongBeats.some((sb) => Math.abs(sb - (offset % bb)) < 1e-9);

  // フレーズ境界 (§4.2)
  const phrases: Array<{ startBar: number; bars: number }> = [];
  {
    let b = 0;
    for (const len of plan.phraseLengths) {
      phrases.push({ startBar: b, bars: len });
      b += len;
    }
  }

  let prevPitch = opts.startPitch ?? snapToChordTone(center, chords[0]!);
  let prevChordStart = -1;
  let isFirstNote = true;

  // 逆ペダルポイント (Pedal): セクション最初のコードの上位コードトーン (B4 付近) に固定
  let pedalPitch: number | null = null;
  if (pedalPoint) {
    pedalPitch = clampReflect(snapToChordTone(71, chords[0]!), scalePcs, low, high);
    annotations.push({
      bar: 0,
      ruleId: "inverted-pedal",
      text: `逆ペダルポイント: メロディを固定しコード進行のみ変化させる`,
    });
  }

  /** 跳躍直後の下降 (上昇) バイアスが残っている音数 */
  let biasRemaining = 0;
  /** 倚音の解決先 (次の音を強制的にこのピッチにする) */
  let pendingResolve: number | null = null;
  /** 掛留・半音階経過音の解決方向 (次の音のステップ方向を強制) */
  let forcedStepDir: -1 | 1 | 0 = 0;

  let motif: Motif | null = null;

  phrases.forEach((phrase, phraseIdx) => {
    const phraseStartBeat = phrase.startBar * bb;
    const phraseEndBar = phrase.startBar + phrase.bars;
    const hasNextPhrase = phraseIdx < phrases.length - 1;

    // モチーフ反復 (§4.1): 冒頭フレーズのリズムと輪郭を再利用する
    if (
      motif !== null &&
      phraseIdx > 0 &&
      motif.bars === phrase.bars &&
      motifP > 0 &&
      rng.chance(motifP)
    ) {
      const headChord = chordAtBeat(chords, phraseStartBeat);
      let head = snapToChordTone(prevPitch, headChord);
      head = clampReflect(head, scalePcs, low, high);
      const transposed = head !== motif.headPitch;
      annotations.push({
        bar: phrase.startBar,
        ruleId: "motif-repeat",
        text: `モチーフ反復: 冒頭フレーズのリズムと輪郭を再利用${transposed ? " (移調反復=シークエンス)" : ""}`,
      });
      for (const ms of motif.slots) {
        const start = phraseStartBeat + ms.offsetInPhrase;
        if (ms.rest) continue;
        let pitch = stepOnScale(head, ms.step, scalePcs);
        if (isStrong(start)) {
          pitch = snapToChordTone(pitch, chordAtBeat(chords, start));
        }
        pitch = clampReflect(pitch, scalePcs, low, high);
        notes.push({ start, duration: ms.duration, pitch, velocity });
        prevPitch = pitch;
      }
      prevChordStart = chordAtBeat(chords, phraseStartBeat + (phrase.bars - 0.001) * bb).start;
      isFirstNote = false;
      biasRemaining = 0;
      pendingResolve = null;
      forcedStepDir = 0;
      return;
    }

    // 新規フレーズ生成
    const capture = motif === null;
    const capturedSlots: MotifSlot[] = [];
    let captureHead: number | null = null;
    let phraseNoteIndex = 0;

    for (let bar = phrase.startBar; bar < phraseEndBar; bar++) {
      const barStart = bar * bb;
      const isLastBarOfSection = bar === plan.bars - 1;
      const isLastBarOfPhrase = bar === phraseEndBar - 1;
      const beats = pickTemplate(isLastBarOfSection ? finalTemplates : templates, rng, densityBias);
      let slots = buildSlots(beats, barStart);

      // アウフタクト (§4.1): フレーズ最終小節の末尾を次フレーズへの先取音にする
      if (isLastBarOfPhrase && hasNextPhrase && anacrusisP > 0 && rng.chance(anacrusisP)) {
        const carved = carvePickups(slots, barStart, bb);
        if (carved) {
          slots = carved;
          annotations.push({
            bar,
            ruleId: "anacrusis",
            text: "アウフタクト: 次フレーズのコードを先取りする 8 分音符 2 つ",
          });
        }
      }

      let isFirstNoteOfBar = true;
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si]!;
        if (slot.rest) {
          if (capture) {
            capturedSlots.push({
              offsetInPhrase: slot.offset - phraseStartBeat,
              duration: slot.duration,
              rest: true,
              step: 0,
            });
          }
          continue;
        }

        const chord = chordAtBeat(chords, slot.offset);
        const strong = isStrong(slot.offset);
        const isPhraseHead = isFirstNoteOfBar && bar === phrase.startBar;
        const isLastNoteOfSection =
          isLastBarOfSection && !slots.slice(si + 1).some((s) => !s.rest);

        let pitch: number;
        let skipChordSnap = false;

        if (slot.pickup) {
          // アウフタクト: 次のコード (次小節頭) のコードトーンへ順次に向かう
          const nextChord = chordAtBeat(chords, barStart + bb);
          const target = clampReflect(
            snapToChordTone(prevPitch, nextChord), scalePcs, low, high,
          );
          const isSecondPickup = si === slots.length - 1;
          pitch = isSecondPickup
            ? target
            : stepOnScale(target, prevPitch <= target ? -1 : 1, scalePcs);
          skipChordSnap = true;
        } else if (pendingResolve !== null) {
          // 倚音の解決: 強拍の非和声音から予約したコードトーンへ
          pitch = pendingResolve;
          pendingResolve = null;
          skipChordSnap = true;
        } else if (pedalPitch !== null && !isPhraseHead && rng.chance(0.62)) {
          // 逆ペダル: コードが変わってもメロディはペダル音に留まる
          pitch = pedalPitch;
          skipChordSnap = true;
        } else if (
          !isFirstNote &&
          !isLastNoteOfSection &&
          suspensionP > 0 &&
          chord.start !== prevChordStart &&
          !isChordTone(prevPitch, chord) &&
          rng.chance(suspensionP)
        ) {
          // 掛留 (サスペンション §4.1): 前のコードの音を保持し、次で下に解決
          pitch = prevPitch;
          skipChordSnap = true;
          forcedStepDir = -1;
          annotations.push({
            bar,
            ruleId: "suspension",
            text: "掛留: 前のコードの音を保持してから下に解決",
          });
        } else if (!isFirstNote && repeatProb > 0 && rng.chance(repeatProb)) {
          // 同音連打 (Modal): 直前の音を繰り返す
          pitch = prevPitch;
          skipChordSnap = true;
        } else {
          // 跳躍確率: サビ頭 > フレーズ頭 > フレーズ途中 (§4.1 D4)
          const leapP = isFirstNote
            ? plan.type === "chorus"
              ? leapProbability.chorusHead
              : leapProbability.default
            : isPhraseHead
              ? leapProbability.default
              : leapProbability.default * WITHIN_PHRASE_LEAP_FACTOR;

          if (rng.chance(leapP)) {
            // 跳躍: leapRangeSemitones の幅で移動し、着地はコードトーンに合わせる
            const semis = rng.int(leapRangeSemitones[0], leapRangeSemitones[1]);
            const dir: 1 | -1 =
              prevPitch > center + 5 ? -1
              : prevPitch < center - 3 ? 1
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
            // 順次進行: 1〜2 度の移動。掛留/半音階の解決・跳躍後バイアス中は方向を固定
            let dir: number;
            let contourSteps = 1;
            if (forcedStepDir !== 0) {
              dir = forcedStepDir;
              forcedStepDir = 0;
            } else if (biasRemaining > 0 && afterLeapBias !== "none") {
              dir = afterLeapBias === "down" ? -1 : 1;
              biasRemaining--;
            } else {
              const progress = (slot.offset - phraseStartBeat) / Math.max(phrase.bars * bb, 1);
              const movement = contourMovement(
                dialect.melody.contour,
                progress,
                phraseNoteIndex,
                prevPitch,
                center,
                rng,
              );
              dir = movement.dir;
              contourSteps = movement.steps;
            }

            if (chromaticP > 0 && !strong && rng.chance(chromaticP)) {
              // 半音階経過音 (§4.1): 弱拍で半音移動し、同方向のスケール音に解決
              pitch = prevPitch + dir;
              skipChordSnap = true;
              if (!isScaleTone(pitch, scalePcs)) {
                forcedStepDir = dir as -1 | 1;
                annotations.push({
                  bar,
                  ruleId: "chromatic-passing",
                  text: "半音階経過音 (弱拍で半音移動→同方向に解決)",
                });
              }
            } else {
              pitch = stepOnScale(prevPitch, dir * contourSteps, scalePcs);
            }
          }
        }

        if (strong && !skipChordSnap) {
          const target = snapToChordTone(pitch, chord);
          if (
            appoggiaturaP > 0 &&
            !isFirstNote &&
            !isLastNoteOfSection &&
            rng.chance(appoggiaturaP)
          ) {
            // 倚音 (§4.1): 強拍にコードトーンの上隣接音を置き、次でコードトーンへ解決
            pitch = stepOnScale(target, 1, scalePcs);
            pendingResolve = clampReflect(target, scalePcs, low, high);
            annotations.push({
              bar,
              ruleId: "appoggiatura",
              text: "倚音: 強拍の上隣接音からコードトーンへ解決",
            });
          } else {
            pitch = target;
          }
        }
        pitch = clampReflect(pitch, scalePcs, low, high);

        notes.push({ start: slot.offset, duration: slot.duration, pitch, velocity });
        phraseNoteIndex++;

        if (capture) {
          if (captureHead === null) captureHead = pitch;
          capturedSlots.push({
            offsetInPhrase: slot.offset - phraseStartBeat,
            duration: slot.duration,
            rest: false,
            step: scaleStepsBetween(captureHead, pitch, scalePcs),
          });
        }

        prevPitch = pitch;
        prevChordStart = chord.start;
        isFirstNote = false;
        isFirstNoteOfBar = false;
      }
    }

    if (capture && captureHead !== null) {
      motif = { bars: phrase.bars, headPitch: captureHead, slots: capturedSlots };
    }
  });

  return { notes, annotations };
}
