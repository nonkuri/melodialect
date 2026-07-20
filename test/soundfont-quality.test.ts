import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SoundBankLoader } from "spessasynth_core";
import { defaultMixer, normalizeMixer } from "../src/engine/controls.js";
import type { MixerSettings, SongPart } from "../src/engine/types.js";
import {
  GENERALUSER_SOUNDFONT_ID,
  GENERALUSER_SOUNDFONT_SHA256,
  GENERALUSER_SOUNDFONT_SIZE,
  generalUserAssignment,
} from "../src/audio/standardSoundFont.js";

const PARTS: SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];

describe("GeneralUser GS quality standard", () => {
  it("ships the pinned SF3 with the expected presets and digest", () => {
    const bytes = readFileSync(new URL("../public/audio-packs/generaluser-gs.sf3", import.meta.url));
    expect(bytes.byteLength).toBe(GENERALUSER_SOUNDFONT_SIZE);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(GENERALUSER_SOUNDFONT_SHA256);

    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const bank = SoundBankLoader.fromArrayBuffer(buffer);
    expect(bank.soundBankInfo.version.major).toBe(3);
    for (const part of PARTS) {
      const assignment = generalUserAssignment(part);
      expect(bank.presets.some((preset) =>
        preset.program === assignment.program &&
        preset.bankMSB === assignment.bankMSB &&
        preset.bankLSB === assignment.bankLSB &&
        preset.isDrum === Boolean(assignment.isDrum)), part).toBe(true);
    }
  });

  it("uses the quality pack for every new-project part", () => {
    const mixer = defaultMixer();
    for (const part of PARTS) {
      expect(mixer[part].soundfont?.sourceId).toBe(GENERALUSER_SOUNDFONT_ID);
      expect(mixer[part].soundfont).toEqual(generalUserAssignment(part));
    }
  });

  it("migrates legacy Saw assignments while preserving explicit oscillator choices", () => {
    const legacy = Object.fromEntries(PARTS.map((part) => [part, {
      mute: false,
      solo: false,
      volume: 1,
      pan: 0,
      timbre: part === "drums" ? "electronic" : "grand",
      ...(part === "drums" ? {} : {
        soundfont: {
          sourceId: "standard",
          bankMSB: 0,
          bankLSB: 0,
          program: 0,
          presetName: "Melodialect Saw",
        },
      }),
    }])) as MixerSettings;
    delete legacy.guitar.soundfont;

    const migrated = normalizeMixer(legacy);
    expect(migrated.melody.soundfont).toEqual(generalUserAssignment("melody"));
    expect(migrated.piano.soundfont).toEqual(generalUserAssignment("piano"));
    expect(migrated.bass.soundfont).toEqual(generalUserAssignment("bass"));
    expect(migrated.drums.soundfont).toEqual(generalUserAssignment("drums"));
    expect(migrated.guitar.soundfont).toBeUndefined();
  });
});
