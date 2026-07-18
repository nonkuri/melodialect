import { describe, expect, it } from "vitest";
import { generateSong } from "../src/engine/song.js";
import { generateLyrics } from "../src/engine/lyrics.js";
import { chromatic, twilight } from "../src/dialects/index.js";
import { encodeWav, type AudioBufferLike } from "../src/export/wav.js";
import { buildSunoText } from "../src/export/text.js";

function fakeBuffer(samples: number[][], sampleRate = 44100): AudioBufferLike {
  return {
    numberOfChannels: samples.length,
    length: samples[0]!.length,
    sampleRate,
    getChannelData: (ch) => Float32Array.from(samples[ch]!),
  };
}

describe("WAV エンコード (§4.5)", () => {
  it("ヘッダーが正しい RIFF/WAVE 構造になっている", () => {
    const buf = encodeWav(fakeBuffer([[0, 0.5, -0.5, 1], [0, 0.25, -0.25, -1]]));
    const view = new DataView(buf);
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // ステレオ
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16); // 16bit
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2); // データ長
    expect(buf.byteLength).toBe(44 + 16);
  });

  it("サンプル値が 16bit に量子化され ±1 でクリップされる", () => {
    const buf = encodeWav(fakeBuffer([[1, -1, 2, -2]]));
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0x7fff); // クリップ
    expect(view.getInt16(50, true)).toBe(-0x8000); // クリップ
  });
});

describe("仮歌詞 (§4.2 手順 5)", () => {
  const song = generateSong({ dialect: chromatic, seed: 42 });

  it("メロディの音数と音節数が一致する", () => {
    const lyrics = generateLyrics(song);
    expect(lyrics.length).toBe(song.sections.length);
    lyrics.forEach((l, i) => {
      expect(l.syllables.length).toBe(song.sections[i]!.melody.length);
    });
  });

  it("同じ曲からは同じ歌詞が生成される (決定性)", () => {
    expect(generateLyrics(song)).toEqual(generateLyrics(song));
  });

  it("行はフレーズ数に対応する", () => {
    const lyrics = generateLyrics(song);
    lyrics.forEach((l, i) => {
      expect(l.lines.length).toBe(song.sections[i]!.plan.phraseLengths.length);
    });
  });
});

describe("Suno 用テキスト出力 (§4.5)", () => {
  it("スタイル・歌詞・コード進行を含む", () => {
    const song = generateSong({ dialect: twilight, seed: 7 });
    const text = buildSunoText(song, twilight);
    expect(text).toContain("Style Prompt");
    expect(text).toContain("city pop ballad");
    expect(text).toContain("Key: F major, Tempo: 72 BPM");
    expect(text).toContain("[Verse 1]");
    expect(text).toContain("[Chorus 1]");
    expect(text).toContain("Chord Progression");
    expect(text).toContain("seed: 7");
  });
});
