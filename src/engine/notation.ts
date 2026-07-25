/**
 * 拍数を「記譜上の音価」に直す共通規則 (§4.2)。
 * 譜面表示 (VexFlow) と MusicXML 書き出しで同じ判定を使う。
 *
 * 内部表現は 4 分音符 = 1 beat の実時間なので、3 連符は 1/3・2/3 拍という
 * 割り切れない値になる。記譜では 3:2 の連符として書くため、実拍を 1.5 倍した
 * 値を音価にし、連符括弧 (MusicXML では time-modification) を別に付ける。
 */

const TRIPLET_UNIT = 1 / 3;

/** 音価の対応表。単独の音符で書けるものだけを持つ */
export const NOTE_VALUES: { beats: number; vex: string; xml: string; dotted: boolean }[] = [
  { beats: 4, vex: "w", xml: "whole", dotted: false },
  { beats: 3, vex: "h", xml: "half", dotted: true },
  { beats: 2, vex: "h", xml: "half", dotted: false },
  { beats: 1.5, vex: "q", xml: "quarter", dotted: true },
  { beats: 1, vex: "q", xml: "quarter", dotted: false },
  { beats: 0.75, vex: "8", xml: "eighth", dotted: true },
  { beats: 0.5, vex: "8", xml: "eighth", dotted: false },
  { beats: 0.375, vex: "16", xml: "16th", dotted: true },
  { beats: 0.25, vex: "16", xml: "16th", dotted: false },
];

/**
 * 3 連符に属する音価か。1/3 の整数倍でありながら 1/2 の整数倍ではないもの
 * (1/3, 2/3, 4/3 拍など) を 3 連符とみなす。1 拍や 1.5 拍は除かれる。
 */
export function isTripletDuration(beats: number): boolean {
  const units = beats / TRIPLET_UNIT;
  return Math.abs(units - Math.round(units)) < 0.01 &&
    Math.abs(beats * 2 - Math.round(beats * 2)) > 0.01;
}

/**
 * 実拍に対応する音価。3 連符は実拍の 1.5 倍で引く (2/3 拍 → 4 分音符)。
 * 表にない値 (変拍子の 5 拍など) は最も近い音価へ丸める。1 音 1 符で描き
 * タイを使わない方式なので、この丸めは避けられない。
 */
export function noteValueOf(beats: number): typeof NOTE_VALUES[number] {
  const notated = isTripletDuration(beats) ? beats * 1.5 : beats;
  return NOTE_VALUES.reduce((closest, entry) =>
    Math.abs(entry.beats - notated) < Math.abs(closest.beats - notated) ? entry : closest);
}

/**
 * 連続した 3 連符音符を、合計が拍の整数倍になる単位でまとめて添字を返す。
 * シャッフル (2/3 + 1/3) なら 2 音で 1 グループ。
 */
export function tripletGroups(durations: number[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let sum = 0;
  durations.forEach((beats, index) => {
    if (!isTripletDuration(beats)) {
      current = [];
      sum = 0;
      return;
    }
    current.push(index);
    sum += beats;
    if (Math.abs(sum - Math.round(sum)) < 0.01) {
      if (current.length > 1) groups.push(current);
      current = [];
      sum = 0;
    }
  });
  return groups;
}
