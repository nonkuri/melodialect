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
import { registerPlanFor } from "./register.js";

/** フレーズ途中の跳躍確率は default に対するこの倍率 (§6.2 の意味付け) */
const WITHIN_PHRASE_LEAP_FACTOR = 0.35;
/** 終止音の度数の既定の好み。ダイアレクトの melody.finalDegree で上書きできる */
const DEFAULT_FINAL_DEGREE: Record<string, number> = { "1": 3, "3": 2, "5": 2, "7": 0.5 };

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

/**
 * 音域の外へ出た音を、音階上の音のままオクターブで窓へ折り返す。
 *
 * 1 回だけ折り返す実装では、窓から 1 オクターブ以上外れた音が窓の外に残り、
 * ダイアレクトが宣言した旋律音域が実測で 4〜5 半音下へはみ出していた。
 * 伴奏のボイシング窓はこの宣言を基準に配分されるため、はみ出しはそのまま
 * 伴奏と旋律の衝突になる。収まるまで折り返し、それでも収まらない
 * (窓が極端に狭い) 場合だけ端で止める
 */
function clampReflect(pitch: number, scalePcs: number[], low: number, high: number): number {
  let value = pitch;
  for (let guard = 0; guard < 12 && (value > high || value < low); guard++) {
    value = snapToScale(value + (value > high ? -12 : 12), scalePcs, 0);
  }
  return Math.max(low, Math.min(high, value));
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
  if (contour === "angular") {
    // 汎用のランダム歩行では「角張った輪郭」が平均化されてしまうため、
    // 2〜3度の移動と方向反転を明示した非対称パターンを使う。
    const directions: Array<-1 | 1> = [1, -1, 1, -1, -1, 1, -1, 1];
    const steps = [2, 1, 3, 2, 1, 2, 3, 1];
    return {
      dir: directions[noteIndex % directions.length]!,
      steps: steps[noteIndex % steps.length]!,
    };
  }
  if (contour === "voice-led" || contour === "floating") {
    const towardCenter: -1 | 1 = pitch > center ? -1 : 1;
    return { dir: rng.chance(0.7) ? towardCenter : (towardCenter === 1 ? -1 : 1), steps: 1 };
  }
  if (contour === "syncopated-narrow" || contour === "stepwise" || contour === "pedal") {
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

/**
 * フレーズ末尾に息継ぎを作る。末尾から 1 拍以上が無音になるまで
 * 後ろのスロットを休符に変える。歌としての呼吸がないと、音符が
 * 途切れず続く「機械的な旋律」になる (実測で発音占有率 92.6%)。
 *
 * アウフタクトとは排他。carvePickups は末尾スロットが 1 拍以上あることを
 * 要求するので、両方を同じ小節に適用すると先取音が成立しなくなる。
 */
function carveBreath(slots: Slot[], barStart: number, barBeats: number): Slot[] | null {
  const carved = slots.map((slot) => ({ ...slot }));
  let silence = 0;
  let index = carved.length - 1;
  for (; index >= 0 && silence < 1 - 1e-9; index--) {
    const slot = carved[index]!;
    if (!slot.rest) silence += slot.duration;
    slot.rest = true;
  }
  // 小節が丸ごと休符になるなら息継ぎではなく空白。適用しない
  if (index < 0 || carved.every((slot) => slot.rest)) return null;
  const sounding = carved.filter((slot) => !slot.rest);
  if (!sounding.length) return null;
  // 休符に変えた分、直前の音を伸ばして「歌い終わってから息を吸う」形にする
  const last = sounding.at(-1)!;
  const restStart = barStart + barBeats - silence;
  last.duration = Math.max(last.duration, restStart - last.offset);
  return carved;
}

/**
 * 非和声音の「意図」(§4.1)。
 *
 * 掛留は「前のコードの音を強拍で保持し、次で下に解決する」ことが定義そのもので、
 * 倚音・半音階経過音も同様に解決とセットでしか成立しない。強拍で一律に
 * コードトーンへ吸着させると技法そのものが消えるが、それでも注記だけは
 * 出続けてしまう。この製品は生成根拠の表示が売りなので、注記と実際の音が
 * 食い違うのは音の問題より重い。
 *
 * そこで注記はその場では出さず intent に保留し、次の音が本当に解決したかを
 * 検証してから push する。解決しなかった場合は音のほうを取り消す
 * (fallbackPitch に書き戻す) ので、注記が嘘になる経路が構造的に存在しない。
 */
interface PendingIntent {
  /** notes[] のどの音が非和声音なのか */
  noteIndex: number;
  /** 解決が確認できたときだけ push する注記 */
  annotation: Annotation;
  /** 解決しなかったときに書き戻すコードトーン */
  fallbackPitch: number;
  /** 解決音に求める進行方向。undefined なら方向は問わない */
  direction?: -1 | 1;
  /** この拍を過ぎたら解決失敗とみなす */
  deadline: number;
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

  // 音域はダイアレクトが所有する (§4.1)。伴奏側の窓もここを基準に配分される
  const registerPlan = registerPlanFor(dialect);
  const shift = dialect.melody.registerShift?.[plan.type] ?? 0;
  const low = registerPlan.melody[0] + shift;
  const high = registerPlan.melody[1] + shift;
  // 中心は窓の下寄り。真ん中に置くと旋律全体が上ずる
  const center = Math.round(low + (high - low) * 0.33);

  // リズム語彙 (§4.1): ダイアレクト定義があればそれを、なければ内蔵テンプレート
  const rhythmCfg = dialect.rhythm ?? {};
  const templates =
    rhythmCfg.templates?.[meter.name] ?? BUILTIN_TEMPLATES[meter.name] ?? BUILTIN_TEMPLATES["4/4"]!;
  const finalTemplates =
    rhythmCfg.finalTemplates?.[meter.name] ?? BUILTIN_FINAL[meter.name] ?? BUILTIN_FINAL["4/4"]!;
  const densityBias = plan.type === "chorus" ? (rhythmCfg.chorusDensityBias ?? 0) : 0;
  const anacrusisP = rhythmCfg.anacrusisProbability ?? 0;
  const breathP = rhythmCfg.breathProbability ?? 0;

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

  /** 解決待ちの非和声音。解決を確認してから注記を出す */
  let intent: PendingIntent | null = null;
  /**
   * 直近で「解決した」と認定した音の位置。終止音の着地でこの音を動かすと、
   * 既に出した注記のほうが嘘になる (解決方向が反転しうる)
   */
  let resolutionIndex = -1;

  /**
   * 直前の非和声音が本当に解決したかを判定する。
   * 解決していれば注記を出し、していなければ音のほうを取り消す。
   */
  const settleIntent = (resolvedPitch: number, start: number): void => {
    if (!intent) return;
    const pending = intent;
    intent = null;
    const dissonant = notes[pending.noteIndex]!;
    const chord = chordAtBeat(chords, start);
    const landedOnChordTone = isChordTone(resolvedPitch, chord);
    const movedCorrectly = pending.direction === undefined ||
      Math.sign(resolvedPitch - dissonant.pitch) === pending.direction;
    if (start <= pending.deadline + 1e-9 && landedOnChordTone && movedCorrectly) {
      annotations.push(pending.annotation);
      resolutionIndex = notes.length; // この直後に push される音が解決音
      return;
    }
    // 解決しなかった非和声音は、宙に浮いたまま残さず取り消す
    dissonant.pitch = pending.fallbackPitch;
  };

  /** セクション末やフレーズ末で見捨てられた intent を回収する */
  const abandonIntent = (): void => {
    if (!intent) return;
    notes[intent.noteIndex]!.pitch = intent.fallbackPitch;
    intent = null;
  };

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
      abandonIntent();
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

      // フレーズ末尾の処理 (§4.1)。アウフタクトと息継ぎは排他で、
      // 先に判定したアウフタクトを優先する。carvePickups は末尾スロットが
      // 1 拍以上あることを要求するため、休符化と同居させると成立しない
      let phraseEndGesture: "none" | "anacrusis" | "breath" = "none";
      if (isLastBarOfPhrase && hasNextPhrase) {
        if (anacrusisP > 0 && rng.chance(anacrusisP)) phraseEndGesture = "anacrusis";
        else if (breathP > 0 && rng.chance(breathP)) phraseEndGesture = "breath";
      }
      if (phraseEndGesture === "anacrusis") {
        const carved = carvePickups(slots, barStart, bb);
        if (carved) {
          slots = carved;
          annotations.push({
            bar,
            ruleId: "anacrusis",
            text: "アウフタクト: 次フレーズのコードを先取りする 8 分音符 2 つ",
          });
        }
      } else if (phraseEndGesture === "breath") {
        const carved = carveBreath(slots, barStart, bb);
        if (carved) {
          slots = carved;
          annotations.push({
            bar,
            ruleId: "phrase-breath",
            text: "息継ぎ: フレーズ末尾を伸ばして 1 拍空け、次のフレーズと切り分ける",
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
        /** この音が新しく生む非和声音の意図。ピッチ確定後に intent へ登録する */
        let pendingSuspension: Omit<PendingIntent, "noteIndex" | "deadline"> | null = null;
        let pendingChromatic: Omit<PendingIntent, "noteIndex" | "deadline"> | null = null;
        let pendingAppoggiatura: Omit<PendingIntent, "noteIndex" | "deadline"> | null = null;

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
        } else if (
          !isFirstNote &&
          !isLastNoteOfSection &&
          suspensionP > 0 &&
          chord.start !== prevChordStart &&
          !isChordTone(prevPitch, chord) &&
          rng.chance(suspensionP)
        ) {
          // 掛留 (サスペンション §4.1): 前のコードの音を保持し、次で下に解決。
          // 注記は解決を確認してから出す (settleIntent)
          pitch = prevPitch;
          skipChordSnap = true;
          forcedStepDir = -1;
          pendingSuspension = {
            annotation: {
              bar,
              ruleId: "suspension",
              text: "掛留: 前のコードの音を保持してから下に解決",
            },
            fallbackPitch: clampReflect(snapToChordTone(prevPitch, chord), scalePcs, low, high),
            direction: -1,
          };
        } else if (
          pedalPitch !== null &&
          (
            isPhraseHead ||
            (prevPitch !== pedalPitch && (
              (strong && rng.chance(0.58)) ||
              (chord.start !== prevChordStart && rng.chance(0.55)) ||
              rng.chance(0.18)
            )) ||
            (prevPitch === pedalPitch && rng.chance(
              strong || chord.start !== prevChordStart ? 0.34 : 0.12,
            ))
          )
        ) {
          // 逆ペダル: 常時同音にせず、弱拍で隣接音へ離れ、強拍・和声境界・
          // フレーズ頭で固定音へ戻す。固定音の存在感と歌としての呼吸を両立する。
          pitch = pedalPitch;
          skipChordSnap = true;
        } else if (!isFirstNote && repeatProb > 0 && rng.chance(repeatProb)) {
          // 同音連打 (Modal): 直前の音を繰り返す。
          // コード変化をまたぐ反復は、実測で 1065 回中 367 回が「解決も
          // 説明もされない非和声音」として宙に浮いていた。掛留を使う
          // ダイアレクトなら掛留として解決させ、そうでなければ和音に乗せる。
          const crossesChordChange = chord.start !== prevChordStart;
          if (crossesChordChange && !isChordTone(prevPitch, chord)) {
            const landing = clampReflect(snapToChordTone(prevPitch, chord), scalePcs, low, high);
            if (suspensionP > 0 && !isLastNoteOfSection) {
              pitch = prevPitch;
              skipChordSnap = true;
              forcedStepDir = -1;
              pendingSuspension = {
                annotation: {
                  bar,
                  ruleId: "suspension",
                  text: "掛留: 同音を保持したままコードが変わり、次で下に解決",
                },
                fallbackPitch: landing,
                direction: -1,
              };
            } else {
              pitch = landing;
              skipChordSnap = true;
            }
          } else {
            pitch = prevPitch;
            skipChordSnap = true;
          }
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
                pendingChromatic = {
                  annotation: {
                    bar,
                    ruleId: "chromatic-passing",
                    text: "半音階経過音 (弱拍で半音移動→同方向に解決)",
                  },
                  fallbackPitch: clampReflect(
                    snapToChordTone(prevPitch + dir, chord), scalePcs, low, high,
                  ),
                  direction: dir as -1 | 1,
                };
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
            // 倚音 (§4.1): 強拍にコードトーンの上隣接音を置き、次でコードトーンへ解決。
            // 9th 和音では上隣接音そのものがコードトーンになりうる。その場合は
            // 解決すべき不協和が存在しないので、倚音としては扱わない
            const neighbour = stepOnScale(target, 1, scalePcs);
            if (isChordTone(neighbour, chord)) {
              pitch = target;
            } else {
              pitch = neighbour;
              pendingResolve = clampReflect(target, scalePcs, low, high);
              pendingAppoggiatura = {
                annotation: {
                  bar,
                  ruleId: "appoggiatura",
                  text: "倚音: 強拍の上隣接音からコードトーンへ解決",
                },
                fallbackPitch: clampReflect(target, scalePcs, low, high),
                direction: -1,
              };
            }
          } else {
            pitch = target;
          }
        }
        pitch = clampReflect(pitch, scalePcs, low, high);

        // 直前の非和声音がこの音で解決したかを判定してから次へ進む
        settleIntent(pitch, slot.offset);

        notes.push({ start: slot.offset, duration: slot.duration, pitch, velocity });
        const newIntent = pendingSuspension ?? pendingChromatic ?? pendingAppoggiatura;
        if (newIntent) {
          intent = {
            ...newIntent,
            noteIndex: notes.length - 1,
            // 解決は次の音まで。それ以上引き延ばすと聴感上ただ外れた音になる
            deadline: slot.offset + slot.duration + bb,
          };
        }
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
      // 休符だらけのフレーズをモチーフにすると輪郭が痩せる。
      // 発音スロットが半分未満なら捕捉をやり直す
      const sounding = capturedSlots.filter((slot) => !slot.rest).length;
      if (sounding * 2 >= capturedSlots.length) {
        motif = { bars: phrase.bars, headPitch: captureHead, slots: capturedSlots };
      }
    }
  });

  abandonIntent();
  // 最後の音が非和声音の解決そのものなら動かさない。すでにコードトーンで、
  // かつ解決したと注記済みなので、度数の好みで選び直す価値より整合性が優先
  if (resolutionIndex !== notes.length - 1) {
    landFinalNote(notes, chords, scalePcs, dialect, rng, low, high, annotations);
  }
  return { notes, annotations };
}

/**
 * 生成後にメロディを加工した場合の再着地 (§4.1)。
 * 作曲コントロールの密度・シンコペーションは音を間引いたり分割したりするので、
 * 生成時に保証した「終止音は和音構成音」が壊れうる。加工の後にもう一度通す。
 */
export function relandFinalNote(
  notes: NoteEvent[],
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  rng: Rng,
  registerShift = 0,
): void {
  // 壊れていない終止音は引き直さない。ここは加工で崩れた着地を直すための
  // 経路で、無条件に重み付き再抽選をすると、主題を再現したセクションの
  // 最後の 1 音だけが毎回別の音になり「同じサビ」が成立しなくなる
  const last = notes.at(-1);
  if (last && chords.length && isChordTone(last.pitch, chordAtBeat(chords, last.start))) return;
  const plan = registerPlanFor(dialect);
  landFinalNote(
    notes, chords, scaleOf(key, dialect.melody.pitchCollection), dialect, rng,
    plan.melody[0] + registerShift, plan.melody[1] + registerShift, [],
  );
}

/**
 * 終止音の着地 (§4.1)。
 *
 * 実測では曲末の 26% が和音構成音ですらなく、「終わった気がしない」直接の
 * 原因になっていた。ただし主音を 100% 強制すると 14 ダイアレクトが全部
 * 同じ終わり方になる。3 度や 5 度で終わるのは正常な終止で、
 * harmonic-lament や modal-irregular は開いた終止が持ち味でもある。
 *
 * そこで「和音構成音であることは必須、どの度数に着地するかは
 * ダイアレクトの melody.finalDegree による重み付け」という二段構えにする。
 */
function landFinalNote(
  notes: NoteEvent[],
  chords: ChordEvent[],
  scalePcs: number[],
  dialect: Dialect,
  rng: Rng,
  low: number,
  high: number,
  annotations: Annotation[],
): void {
  const last = notes.at(-1);
  if (!last) return;
  const chord = chordAtBeat(chords, last.start);
  const weights = dialect.melody.finalDegree ?? DEFAULT_FINAL_DEGREE;
  const previous = notes.at(-2)?.pitch ?? last.pitch;

  // 和音構成音を、旋律音域に収まるオクターブすべてに展開する
  const candidates: Array<[number, number]> = [];
  chord.pitches.forEach((tone, index) => {
    const degree = index === 0 ? "1" : index === 1 ? "3" : index === 2 ? "5" : index === 3 ? "7" : "9";
    const weight = weights[degree] ?? 0.25;
    if (weight <= 0) return;
    for (let pitch = low; pitch <= high; pitch++) {
      if (((pitch - tone) % 12 + 12) % 12 !== 0) continue;
      // 直前の音から遠いほど不自然。旋律の流れを壊さない範囲で選ぶ
      const distance = Math.abs(pitch - previous);
      candidates.push([pitch, weight * Math.exp(-distance / 4)]);
    }
  });
  if (!candidates.length) {
    last.pitch = clampReflect(snapToChordTone(last.pitch, chord), scalePcs, low, high);
    return;
  }
  const landed = rng.weighted(candidates);
  if (landed === last.pitch) return;
  const wasChordTone = isChordTone(last.pitch, chord);
  last.pitch = landed;
  annotations.push({
    bar: Math.max(0, chord.bar),
    ruleId: "final-landing",
    text: wasChordTone
      ? `終止音を和音構成音の中から選び直した (${chord.symbol} 上)`
      : `終止音が ${chord.symbol} の構成音から外れていたため着地させた`,
    level: "section",
    category: "melody",
  });
}
