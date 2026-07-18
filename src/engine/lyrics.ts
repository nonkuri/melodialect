import type { Song } from "./types.js";
import { BEATS_PER_BAR } from "./types.js";
import { createRng } from "./rng.js";

/**
 * 仮歌詞生成 (§4.2 手順 5)。
 * メロディの音数に合わせて日本語のダミー音節を割り当てる。
 * 意味のある歌詞ではなく、Suno 等へ渡す際や譜面の歌詞欄の
 * プレースホルダとして使う。シードから決定的に生成される。
 */

/** 開音節のプール (歌いやすい音を中心に) */
const SYLLABLES = [
  "ら", "り", "る", "れ", "ろ",
  "な", "に", "の", "ね",
  "か", "こ", "き",
  "ま", "み", "も", "め",
  "さ", "そ", "し",
  "た", "と", "て",
  "は", "ひ", "ほ",
  "や", "ゆ", "よ", "わ",
];

export interface SectionLyrics {
  /** メロディの各音に対応する音節 (長い音は「ー」付き) */
  syllables: string[];
  /** フレーズごとにまとめた行 */
  lines: string[];
}

/** 各セクションのメロディに音節を割り当てる */
export function generateLyrics(song: Song): SectionLyrics[] {
  return song.sections.map((section, sectionIndex) => {
    const rng = createRng((song.seed * 31 + sectionIndex * 7 + 1) >>> 0);

    // フレーズ境界 (拍単位) を求めて行分けに使う
    const phraseStartBeats: number[] = [];
    let bar = 0;
    for (const len of section.plan.phraseLengths) {
      phraseStartBeats.push(bar * BEATS_PER_BAR);
      bar += len;
    }

    const syllables: string[] = [];
    const lines: string[] = [];
    let currentLine: string[] = [];
    let phraseIndex = 0;
    let wordRemaining = 0;

    for (const note of section.melody) {
      // 次のフレーズに入ったら行を確定
      const nextPhraseStart = phraseStartBeats[phraseIndex + 1];
      if (nextPhraseStart !== undefined && note.start >= nextPhraseStart) {
        lines.push(currentLine.join(""));
        currentLine = [];
        phraseIndex++;
        wordRemaining = 0;
      }

      // 2〜4 音節の「単語」ごとに区切りを入れる
      if (wordRemaining === 0) {
        wordRemaining = rng.int(2, 4);
        if (currentLine.length > 0) currentLine.push(" ");
      }

      let syl = rng.pick(SYLLABLES);
      if (note.duration >= 2) syl += "ー"; // 長い音は伸ばす
      syllables.push(syl);
      currentLine.push(syl);
      wordRemaining--;
    }
    if (currentLine.length > 0) lines.push(currentLine.join(""));

    return { syllables, lines };
  });
}
