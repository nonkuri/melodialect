import { describe, expect, it } from "vitest";
import { generateSong } from "../src/engine/song.js";
import { chromatic } from "../src/dialects/index.js";
import { encodeSongToMidi } from "../src/export/midi.js";

describe("MIDI (SMF) エクスポート", () => {
  const song = generateSong({ dialect: chromatic, seed: 42 });
  const bytes = encodeSongToMidi(song);

  it("MThd ヘッダー: Format 1 / 6 トラック / 480 ticks", () => {
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64]); // "MThd"
    expect(Array.from(bytes.slice(4, 8))).toEqual([0, 0, 0, 6]);
    expect((bytes[8]! << 8) | bytes[9]!).toBe(1); // format
    expect((bytes[10]! << 8) | bytes[11]!).toBe(6); // tracks
    expect((bytes[12]! << 8) | bytes[13]!).toBe(480); // division
  });

  it("MTrk チャンクが 6 つあり長さが整合する", () => {
    let offset = 14;
    let count = 0;
    while (offset < bytes.length) {
      expect(Array.from(bytes.slice(offset, offset + 4))).toEqual([0x4d, 0x54, 0x72, 0x6b]);
      const len =
        (bytes[offset + 4]! << 24) | (bytes[offset + 5]! << 16) |
        (bytes[offset + 6]! << 8) | bytes[offset + 7]!;
      offset += 8 + len;
      count++;
    }
    expect(offset).toBe(bytes.length);
    expect(count).toBe(6);
  });

  it("各トラックは End of Track (FF 2F 00) で終わる", () => {
    let offset = 14;
    while (offset < bytes.length) {
      const len =
        (bytes[offset + 4]! << 24) | (bytes[offset + 5]! << 16) |
        (bytes[offset + 6]! << 8) | bytes[offset + 7]!;
      const end = offset + 8 + len;
      expect(Array.from(bytes.slice(end - 3, end))).toEqual([0xff, 0x2f, 0x00]);
      offset = end;
    }
  });

  it("同じ曲からは同じバイト列が生成される", () => {
    expect(encodeSongToMidi(generateSong({ dialect: chromatic, seed: 42 }))).toEqual(bytes);
  });
});
