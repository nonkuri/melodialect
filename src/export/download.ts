import type { Song } from "../engine/types.js";
import { encodeSongToMidi } from "./midi.js";

/** ブラウザから MIDI ファイルをダウンロードする (§4.5)。 */
export function downloadMidi(song: Song): void {
  const bytes = encodeSongToMidi(song);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `melodialect-${song.dialectId}-seed${song.seed}.mid`;
  a.click();
  URL.revokeObjectURL(url);
}
