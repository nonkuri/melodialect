import type { ChordEvent } from "./types.js";

/**
 * 伴奏レイヤのボイシング (§4.1)。
 *
 * ここは「和音をどう並べて鳴らすか」だけを扱い、ChordEvent.pitches には
 * 一切書き戻さない。pitches は和音の定義そのもので、メロディの
 * snapToChordTone、コードネーム表示 (chordDisplayName は bassPitch と rootPc の
 * 差でスラッシュ表記を決める)、MusicXML / MIDI / テキスト書き出し、譜面表示が
 * 全部それを参照している。転回形を焼き込むと、ユーザーが指定していない
 * 分数コードが譜面に出るなどの巻き添えが起きる。
 */

export interface VoicingRequest {
  /** 和音の定義。読み取りのみ */
  chord: ChordEvent;
  /** 実際に鳴らす構成音 (ガイドトーン抽出などで間引いた後)。省略時は chord.pitches */
  tones?: number[];
  /** [最低声部の下限, 最高声部の上限] */
  window: [number, number];
  /** 直前のボイシング。声部連結の基準 */
  previous?: number[];
  /** ベース音からこの半音数以内に 3 度を重ねない */
  lowIntervalLimit: number;
  /**
   * この和音の間に鳴っている旋律のピッチ。半音・短 9 度でぶつかる転回形を避ける。
   * 音域を下へ押しやるだけでは、短 2 度が短 9 度 (オクターブ+半音) に
   * 付け替わるだけで濁りは残る。狙う音程を名指しで潰すほうが確実
   */
  avoid?: number[];
  /**
   * 終止和音。移動量最小化の重みを下げ、基本形を優先する。
   * 平滑化を徹底すると V→I のルートが 5 度跳ぶ「決まり方」まで消えるため
   */
  cadential?: boolean;
}

export interface VoicingResult {
  pitches: number[];
  /** 窓の中に候補が無く、制約を緩めて解いた。呼び出し側は注記に出すこと */
  relaxed: boolean;
}

function uniqueSorted(pitches: number[]): number[] {
  return Array.from(new Set(pitches)).sort((a, b) => a - b);
}

/** 転回形 × オクターブ移動の候補を列挙する */
function enumerate(tones: number[], window: [number, number]): number[][] {
  const ordered = uniqueSorted(tones);
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < ordered.length; inversion++) {
    const rotated = [
      ...ordered.slice(inversion),
      ...ordered.slice(0, inversion).map((pitch) => pitch + 12),
    ];
    for (let shift = -36; shift <= 36; shift += 12) {
      const candidate = rotated.map((pitch) => pitch + shift);
      if (candidate[0]! >= window[0] && candidate.at(-1)! <= window[1]) candidates.push(candidate);
    }
  }
  return candidates;
}

/**
 * 声部移動のコスト。0 半音 (静止) を最良にしない山型。
 *
 * 旧実装はオクターブ等価の最小移動量をそのまま加算していたため、
 * 動かない伴奏がもっとも高く評価された。評価関数側で重みを上げると
 * 静止した伴奏が選ばれてセクション対比と正面衝突する。
 */
function movementCost(distance: number, sameChord: boolean): number {
  if (sameChord) return distance * 0.6;
  if (distance === 0) return 0.3;
  if (distance <= 2) return (2 - distance) * 0.15;
  return (distance - 2) * 1 + Math.max(0, distance - 5) * 1.5;
}

/** ベース近傍に 3 度や 2 度を重ねると物理的に濁る (low interval limit) */
function muddiness(candidate: number[], bassPitch: number, limit: number): number {
  let penalty = 0;
  for (let index = 1; index < candidate.length; index++) {
    const interval = candidate[index]! - candidate[index - 1]!;
    if (interval > 4) continue;
    const lowest = candidate[index - 1]!;
    if (lowest < bassPitch + limit) penalty += (bassPitch + limit - lowest) * 0.35;
  }
  // ベース自身との短 9 度も避ける (オクターブ + 半音は特に耳につく)
  for (const pitch of candidate) {
    const distance = pitch - bassPitch;
    if (distance > 12 && distance % 12 === 1) penalty += 3;
  }
  return penalty;
}

/**
 * 同時に鳴る旋律との衝突。短 2 度は最も耳につき、短 9 度がそれに次ぐ。
 * 和音の構成音そのものが旋律と半音関係になることは避けられないので、
 * どの転回形に置くか (どのオクターブで鳴らすか) で緩和する。
 */
function melodyClash(candidate: number[], avoid: number[]): number {
  let penalty = 0;
  for (const pitch of candidate) {
    for (const other of avoid) {
      const distance = Math.abs(pitch - other);
      if (distance === 1) penalty += 5;
      else if (distance === 13) penalty += 3;
      else if (distance === 2) penalty += 0.6;
      else if (distance === 11 || distance === 14) penalty += 0.4;
    }
  }
  return penalty;
}

export function voiceChord(request: VoicingRequest): VoicingResult {
  const tones = uniqueSorted(request.tones ?? request.chord.pitches);
  if (!tones.length) return { pitches: [], relaxed: false };

  let window: [number, number] = [request.window[0], request.window[1]];
  let candidates = enumerate(tones, window);
  let relaxed = false;
  // 候補ゼロで黙って基本形を返すと、音域だけ変わって声部連結が消えたことに
  // 誰も気づけない。窓を段階的に広げ、広げたことを必ず呼び出し側へ返す。
  for (let attempt = 0; attempt < 3 && !candidates.length; attempt++) {
    window = [window[0] - 6, window[1] + 6];
    candidates = enumerate(tones, window);
    relaxed = true;
  }
  if (!candidates.length) return { pitches: tones, relaxed: true };

  const center = (request.window[0] + request.window[1]) / 2;
  const previous = request.previous;
  const sameChord = Boolean(
    previous?.length &&
    uniqueSorted(previous.map((pitch) => ((pitch % 12) + 12) % 12)).join() ===
      uniqueSorted(tones.map((pitch) => ((pitch % 12) + 12) % 12)).join(),
  );
  const movementWeight = request.cadential ? 0.35 : 1;

  const score = (candidate: number[]): number => {
    const mean = candidate.reduce((sum, pitch) => sum + pitch, 0) / candidate.length;
    const span = candidate.at(-1)! - candidate[0]!;
    let value = Math.abs(mean - center) * 0.3 + Math.max(0, span - 19) * 0.8;
    value += muddiness(candidate, request.chord.bassPitch, request.lowIntervalLimit);
    if (request.avoid?.length) value += melodyClash(candidate, request.avoid);
    if (request.cadential) {
      // 終止は基本形の明快さを優先する
      const rootPc = ((request.chord.rootPc % 12) + 12) % 12;
      if (((candidate[0]! % 12) + 12) % 12 !== rootPc) value += 2.5;
    }
    if (!previous?.length) return value;

    candidate.forEach((pitch, index) => {
      const targetIndex = candidate.length === 1
        ? 0
        : Math.round(index * (previous.length - 1) / (candidate.length - 1));
      value += movementCost(Math.abs(pitch - previous[targetIndex]!), sameChord) * movementWeight;
    });
    // 聴感上もっとも目立つトップノートは特に滑らかにつなぐ
    value += Math.abs(candidate.at(-1)! - previous.at(-1)!) * 0.65 * movementWeight;
    return value;
  };

  // 旧実装は reduce の中で score(best) を毎回引き直していた。
  let best = candidates[0]!;
  let bestScore = score(best);
  for (let index = 1; index < candidates.length; index++) {
    const value = score(candidates[index]!);
    if (value < bestScore) {
      best = candidates[index]!;
      bestScore = value;
    }
  }
  return { pitches: best, relaxed };
}

/** ガイドトーン (3rd / 7th / 9th) を抜き出す。ルートはベースへ任せる */
export function guideTones(chord: ChordEvent): number[] {
  const pitches = chord.pitches;
  if (pitches.length >= 5) return [pitches[1]!, pitches[3]!, pitches[4]!];
  if (pitches.length >= 4) return pitches.slice(1);
  return pitches;
}

/** ベースと重なる 5 度を省いた上声。9th 和音が重くなるのを避ける */
export function upperVoices(chord: ChordEvent): number[] {
  if (chord.pitches.length >= 5) return chord.pitches.filter((_, index) => index !== 2);
  return chord.pitches;
}
