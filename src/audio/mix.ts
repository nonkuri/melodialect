import type { MixerSettings, Song, SongPart, SoundFontAssignment } from "../engine/types.js";

export const AUDIO_PARTS: readonly SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];
export const SOUNDFONT_PART_CHANNEL: Readonly<Record<SongPart, number>> = {
  melody: 0,
  piano: 1,
  guitar: 2,
  bass: 3,
  drums: 9,
};

export interface SoundFontChannelConfig {
  channel: number;
  drums: boolean;
  bankMSB: number;
  bankLSB: number;
  program: number;
  volume: number;
  pan: number;
}

export function soundFontChannelConfig(
  part: SongPart,
  assignment: SoundFontAssignment,
  volume: number,
  pan: number,
): SoundFontChannelConfig {
  return {
    channel: SOUNDFONT_PART_CHANNEL[part],
    drums: Boolean(assignment.isDrum || part === "drums"),
    bankMSB: Math.max(0, Math.min(127, Math.round(assignment.bankMSB))),
    bankLSB: Math.max(0, Math.min(127, Math.round(assignment.bankLSB))),
    program: Math.max(0, Math.min(127, Math.round(assignment.program))),
    volume: Math.round(Math.max(0, Math.min(1, volume / 1.5)) * 127),
    pan: Math.round((Math.max(-1, Math.min(1, pan)) + 1) * 63.5),
  };
}

export function isPartAudible(
  mixer: MixerSettings | Song["mixer"],
  part: SongPart,
  excluded: ReadonlySet<SongPart> = new Set(),
): boolean {
  if (excluded.has(part) || mixer?.[part]?.mute) return false;
  const hasSolo = AUDIO_PARTS.some((candidate) => mixer?.[candidate]?.solo);
  return !hasSolo || Boolean(mixer?.[part]?.solo);
}
