import type { SongPart, SoundFontAssignment } from "../engine/types.js";

export const LITE_SOUNDFONT_ID = "standard";
export const GENERALUSER_SOUNDFONT_ID = "generaluser-gs";
export const GENERALUSER_SOUNDFONT_VERSION = "2.0.3";
export const GENERALUSER_SOUNDFONT_ASSET = "audio-packs/generaluser-gs.sf3";
export const GENERALUSER_SOUNDFONT_SIZE = 10_556_570;
export const GENERALUSER_SOUNDFONT_SHA256 =
  "5e7262fa50cbabbc9fcd02571f2bf1d2d4b51fc124bf8bfa38203a8ba6f3fd56";

const GENERALUSER_DEFAULTS: Readonly<Record<SongPart, Omit<SoundFontAssignment, "sourceId">>> = {
  melody: {
    bankMSB: 0,
    bankLSB: 0,
    program: 73,
    presetName: "Flute",
  },
  piano: {
    bankMSB: 0,
    bankLSB: 0,
    program: 0,
    presetName: "Grand Piano",
  },
  guitar: {
    bankMSB: 0,
    bankLSB: 0,
    program: 24,
    presetName: "Nylon Guitar",
  },
  bass: {
    bankMSB: 0,
    bankLSB: 0,
    program: 33,
    presetName: "Finger Bass",
  },
  drums: {
    bankMSB: 0,
    bankLSB: 0,
    program: 0,
    isDrum: true,
    presetName: "Standard 1",
  },
};

export function generalUserAssignment(part: SongPart): SoundFontAssignment {
  return {
    sourceId: GENERALUSER_SOUNDFONT_ID,
    ...GENERALUSER_DEFAULTS[part],
  };
}

export function generalUserAssignments(): Record<SongPart, SoundFontAssignment> {
  return {
    melody: generalUserAssignment("melody"),
    piano: generalUserAssignment("piano"),
    guitar: generalUserAssignment("guitar"),
    bass: generalUserAssignment("bass"),
    drums: generalUserAssignment("drums"),
  };
}

export function isLegacyStandardAssignment(
  assignment: SoundFontAssignment | undefined,
): boolean {
  return assignment?.sourceId === LITE_SOUNDFONT_ID &&
    assignment.program === 0 &&
    assignment.presetName === "Melodialect Saw";
}
