import type { Song, SongPart } from "../engine/types.js";
import { beatToSeconds, scheduleSong } from "../audio/player.js";
import { SOUNDFONT_OUTPUT_GAIN } from "../audio/mix.js";
import { renderSoundFontPcm } from "../audio/soundfontOffline.js";

/**
 * WAV 書き出し (§4.5)。OfflineAudioContext で再生と同じシンセを
 * レンダリングし、44.1kHz / 16bit ステレオの WAV にエンコードする。
 */

/** テスト可能にするための AudioBuffer 互換インターフェース */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** PCM 16bit WAV へのエンコード (依存なし) */
export function encodeWav(buffer: AudioBufferLike): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const dataLength = buffer.length * channels * 2;
  const out = new ArrayBuffer(44 + dataLength);
  const view = new DataView(out);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンクサイズ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  const channelData = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch]![i]!));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

const SAMPLE_RATE = 44100;
/** 曲末尾の余韻 (秒) */
const TAIL_SEC = 1;

/** 曲全体を WAV Blob にレンダリングする */
export type WavRenderProgress = (progress: number, message: string) => void;

function mixedAudioBuffer(
  oscillator: AudioBufferLike,
  soundfont: [Float32Array, Float32Array],
  song: Song,
): AudioBufferLike {
  const channels = [new Float32Array(oscillator.length), new Float32Array(oscillator.length)];
  const master = song.master?.volume ?? 0.8;
  for (let channel = 0; channel < 2; channel++) {
    const oscillatorData = oscillator.getChannelData(Math.min(channel, oscillator.numberOfChannels - 1));
    const soundfontData = soundfont[channel]!;
    for (let index = 0; index < oscillator.length; index++) {
      const mixed = oscillatorData[index]! +
        soundfontData[index]! * SOUNDFONT_OUTPUT_GAIN * master;
      // The realtime graph uses a limiter. A smooth saturation here keeps mixed
      // oscillator/SoundFont exports equally resistant to inter-sample clipping.
      channels[channel]![index] = song.master?.limiter ?? true ? Math.tanh(mixed) : mixed;
    }
  }
  return {
    numberOfChannels: 2,
    length: oscillator.length,
    sampleRate: oscillator.sampleRate,
    getChannelData: (channel) => channels[channel]!,
  };
}

/** Render the same oscillator/SoundFont assignments used by realtime playback. */
export async function renderWavBlob(
  song: Song,
  onProgress?: WavRenderProgress,
): Promise<Blob> {
  const totalBeats = song.totalBars * song.meter.barBeats;
  const totalSec = beatToSeconds(song, totalBeats) + TAIL_SEC;
  const sampleCount = Math.ceil(SAMPLE_RATE * totalSec);
  onProgress?.(0.02, "音源を準備中");
  const soundfont = await renderSoundFontPcm(song, SAMPLE_RATE, sampleCount, (progress) =>
    onProgress?.(0.05 + progress * 0.75, "SoundFont を描画中"));
  const oscillatorSong = structuredClone(song);
  for (const part of soundfont.activeParts) {
    if (oscillatorSong.mixer?.[part]) oscillatorSong.mixer[part].mute = true;
  }
  const ctx = new OfflineAudioContext(2, sampleCount, SAMPLE_RATE);
  scheduleSong(ctx, oscillatorSong, 0.05);
  onProgress?.(0.82, "内蔵音源を描画中");
  const buffer = await ctx.startRendering();
  onProgress?.(0.94, "WAV をエンコード中");
  const mixed = mixedAudioBuffer(buffer, [soundfont.left, soundfont.right], song);
  const blob = new Blob([encodeWav(mixed)], { type: "audio/wav" });
  onProgress?.(1, soundfont.fallbacks.length ? "一部を内蔵音源で書き出しました" : "完了");
  return blob;
}

export async function renderWavStem(song: Song, part: SongPart): Promise<Blob> {
  const stem = structuredClone(song);
  if (stem.mixer) {
    for (const [id, settings] of Object.entries(stem.mixer) as Array<[SongPart, typeof stem.mixer[SongPart]]>) {
      settings.mute = id !== part;
      settings.solo = false;
    }
  }
  return renderWavBlob(stem);
}

export async function downloadWavStems(
  song: Song,
  onProgress?: (progress: number, part: SongPart) => void,
): Promise<void> {
  const parts: SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    onProgress?.(index / parts.length, part);
    const blob = await renderWavStem(song, part);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `melodialect-${song.dialectId}-seed${song.seed}-${part}.wav`;
    anchor.click();
    URL.revokeObjectURL(url);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  onProgress?.(1, parts[parts.length - 1]!);
}

export async function downloadWav(song: Song, onProgress?: WavRenderProgress): Promise<void> {
  const blob = await renderWavBlob(song, onProgress);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `melodialect-${song.dialectId}-seed${song.seed}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}
