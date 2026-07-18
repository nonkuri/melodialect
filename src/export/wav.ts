import type { Song } from "../engine/types.js";
import { scheduleSong } from "../audio/player.js";

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
export async function renderWavBlob(song: Song): Promise<Blob> {
  const totalBeats = song.totalBars * song.meter.barBeats;
  const totalSec = (totalBeats / song.bpm) * 60 + TAIL_SEC;
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * totalSec), SAMPLE_RATE);
  scheduleSong(ctx, song, 0.05);
  const buffer = await ctx.startRendering();
  return new Blob([encodeWav(buffer)], { type: "audio/wav" });
}

export async function downloadWav(song: Song): Promise<void> {
  const blob = await renderWavBlob(song);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `melodialect-${song.dialectId}-seed${song.seed}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}
