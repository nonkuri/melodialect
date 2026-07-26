/**
 * 内蔵音色セットの検証。
 *
 * 宣言した program が音源に無いと、SpessaSynth は黙って別の音へフォールバックする。
 * 「設定したのに違う音が鳴る」は仕様違反なので、付属の GeneralUser GS を実際に
 * 読んで、全プリセットが存在することを確かめる。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SoundBankLoader } from "spessasynth_core";
import { normalizeMixer } from "../src/engine/controls.js";
import { GENERALUSER_SOUNDFONT_ID } from "../src/audio/standardSoundFont.js";
import {
  TIMBRE_PRESETS,
  applyTimbrePreset,
  findTimbrePreset,
  matchTimbreSet,
  timbreSetName,
} from "../src/audio/timbrePresets.js";
import type { SongPart } from "../src/engine/types.js";

const PARTS: SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];

describe("内蔵音色セット", () => {
  it("id と名前が重複せず、5 パート分の音色を持つ", () => {
    expect(TIMBRE_PRESETS.length).toBeGreaterThan(0);
    expect(new Set(TIMBRE_PRESETS.map((preset) => preset.id)).size).toBe(TIMBRE_PRESETS.length);
    expect(new Set(TIMBRE_PRESETS.map((preset) => preset.name)).size).toBe(TIMBRE_PRESETS.length);
    for (const preset of TIMBRE_PRESETS) {
      for (const part of PARTS) {
        const values = preset.parts[part];
        expect(values, `${preset.id} の ${part}`).toBeDefined();
        expect(values.program).toBeGreaterThanOrEqual(0);
        expect(values.program).toBeLessThanOrEqual(127);
        // ミキサーの音量は 0〜1.5。範囲外は normalizeMixer で丸められて宣言が消える
        expect(values.volume ?? 1).toBeGreaterThan(0);
        expect(values.volume ?? 1).toBeLessThanOrEqual(1.5);
        // 打楽器キットはドラムパートだけ。旋律パートに割り当てると音階が壊れる
        expect(Boolean(values.isDrum), `${preset.id} の ${part}`).toBe(part === "drums");
      }
      expect(findTimbrePreset(preset.id)).toBe(preset);
    }
  });

  it("適用してもミュート・ソロ・パンは残り、音色と音量だけ変わる", () => {
    const mixer = normalizeMixer(undefined);
    mixer.piano.mute = true;
    mixer.guitar.solo = true;
    mixer.melody.pan = -0.5;
    const preset = findTimbrePreset("ryukyu-sanshin")!;
    const next = applyTimbrePreset(mixer, preset);

    expect(next.piano.mute).toBe(true);
    expect(next.guitar.solo).toBe(true);
    expect(next.melody.pan).toBe(-0.5);
    for (const part of PARTS) {
      expect(next[part].soundfont).toMatchObject({
        sourceId: GENERALUSER_SOUNDFONT_ID,
        program: preset.parts[part].program,
        presetName: preset.parts[part].presetName,
      });
      expect(next[part].volume).toBe(preset.parts[part].volume ?? 1);
    }
    // 元のミキサーは書き換えない
    expect(mixer.melody.soundfont?.program).toBe(73);
  });

  it("いま当たっている音色セットをミキサーから逆算できる", () => {
    const standard = normalizeMixer(undefined);
    expect(matchTimbreSet(standard)).toEqual({ kind: "standard" });
    expect(timbreSetName(matchTimbreSet(standard))).toBe("標準（GeneralUser GS）");

    for (const preset of TIMBRE_PRESETS) {
      const applied = applyTimbrePreset(standard, preset);
      expect(matchTimbreSet(applied), preset.id).toEqual({ kind: "preset", preset });
      // 音量やパンを触っても音色セットの判定は変わらない
      applied.melody.volume = 0.3;
      applied.piano.pan = -0.8;
      applied.guitar.mute = true;
      expect(matchTimbreSet(applied), preset.id).toEqual({ kind: "preset", preset });
    }
  });

  it("1 パートでも別音色に差し替えるとカスタム扱いになる", () => {
    const mixer = applyTimbrePreset(normalizeMixer(undefined), findTimbrePreset("jazz-combo")!);
    mixer.bass.soundfont = { ...mixer.bass.soundfont!, program: 38, presetName: "Synth Bass 1" };
    expect(matchTimbreSet(mixer)).toEqual({ kind: "custom" });
    expect(timbreSetName(matchTimbreSet(mixer))).toBe("カスタム（パートごとに指定）");
  });

  it("全パートの SoundFont を外すと内蔵オシレーター表示になる", () => {
    const mixer = normalizeMixer(undefined);
    for (const part of PARTS) mixer[part].soundfont = undefined;
    expect(matchTimbreSet(mixer)).toEqual({ kind: "oscillator" });
    expect(timbreSetName(matchTimbreSet(mixer))).toBe("内蔵オシレーターのみ");
  });

  it("全プリセットが付属の GeneralUser GS に実在する", () => {
    const bytes = readFileSync(new URL("../public/audio-packs/generaluser-gs.sf3", import.meta.url));
    const bank = SoundBankLoader.fromArrayBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const available = new Map(bank.presets.map((preset) =>
      [`${preset.bankMSB}:${preset.program}:${preset.isDrum}`, preset.name]));
    for (const preset of TIMBRE_PRESETS) {
      for (const part of PARTS) {
        const values = preset.parts[part];
        const key = `0:${values.program}:${Boolean(values.isDrum)}`;
        expect(available.get(key), `${preset.id} の ${part} (program ${values.program})`)
          .toBe(values.presetName);
      }
    }
  });
});
