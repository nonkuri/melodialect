import { describe, expect, it } from "vitest";
import { generateSong } from "../src/engine/song.js";
import { generateLyrics } from "../src/engine/lyrics.js";
import { chromatic, twilight } from "../src/dialects/index.js";
import { encodeWav, type AudioBufferLike } from "../src/export/wav.js";
import { buildSunoText } from "../src/export/text.js";
import { buildMusicXml } from "../src/export/musicxml.js";
import { blue } from "../src/dialects/index.js";
import { parseForm } from "../src/engine/structure.js";
import { isTripletDuration, noteValueOf, tripletGroups } from "../src/engine/notation.js";

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

describe("連符の記譜 (§4.2)", () => {
  it("3 連符だけを 3 連符と判定する", () => {
    expect(isTripletDuration(1 / 3)).toBe(true);
    expect(isTripletDuration(2 / 3)).toBe(true);
    expect(isTripletDuration(1)).toBe(false);
    expect(isTripletDuration(1.5)).toBe(false);
    expect(isTripletDuration(0.5)).toBe(false);
    expect(isTripletDuration(0.25)).toBe(false);
  });

  it("3 連符は実拍の 1.5 倍の音価で書く (2/3 拍 → 4 分音符)", () => {
    expect(noteValueOf(2 / 3).xml).toBe("quarter");
    expect(noteValueOf(1 / 3).xml).toBe("eighth");
    expect(noteValueOf(0.75)).toMatchObject({ xml: "eighth", dotted: true });
    expect(noteValueOf(0.25).xml).toBe("16th");
  });

  it("シャッフルの 2/3+1/3 が 1 つの連符にまとまる", () => {
    expect(tripletGroups([2 / 3, 1 / 3, 1, 2 / 3, 1 / 3])).toEqual([[0, 1], [3, 4]]);
    // 拍の整数倍で閉じないまま途切れた並びは連符にしない
    expect(tripletGroups([2 / 3, 1, 1])).toEqual([]);
  });

  it("記譜音価の合計が各小節の拍数と一致する (Blue のシャッフル)", () => {
    const song = generateSong({
      dialect: blue, seed: 5, keyName: blue.defaults.key, bpm: blue.defaults.bpm,
      form: parseForm("v,c"), ending: "final",
    });
    const barBeats = song.meter.barBeats;
    let checked = 0;
    for (const section of song.sections) {
      const bars = new Map<number, number>();
      for (const note of section.melody) {
        const bar = Math.floor(note.start / barBeats + 1e-9);
        // NOTE_VALUES.beats は付点込みの実拍。連符は 3:2 で圧縮して鳴る
        const value = noteValueOf(note.duration);
        const written = value.beats * (isTripletDuration(note.duration) ? 2 / 3 : 1);
        bars.set(bar, (bars.get(bar) ?? 0) + written);
      }
      for (const [, total] of bars) {
        checked++;
        // 休符を含む小節は合計が小節長未満になりうるが、超えてはいけない
        expect(total).toBeLessThanOrEqual(barBeats + 1e-6);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("MusicXML が 3 連符に time-modification を付ける", () => {
    const song = generateSong({
      dialect: blue, seed: 5, keyName: blue.defaults.key, bpm: blue.defaults.bpm,
      form: parseForm("v,c"), ending: "final",
    });
    const xml = buildMusicXml(song);
    const hasTriplet = song.sections.some((section) =>
      section.melody.some((note) => isTripletDuration(note.duration)));
    expect(hasTriplet).toBe(true);
    expect(xml).toContain("<actual-notes>3</actual-notes><normal-notes>2</normal-notes>");
    expect(xml).toContain("<type>quarter</type>");
  });
});
