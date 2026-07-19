import type { Song, SongPart } from "../engine/types.js";
import type { SoundFontFallback } from "./soundfontPlayer.js";
import { getSoundFontBuffer } from "./soundfonts.js";

const PARTS: SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];

export interface SoundFontPcmResult {
  left: Float32Array;
  right: Float32Array;
  activeParts: Set<SongPart>;
  fallbacks: SoundFontFallback[];
}

interface WorkerResult {
  id: string;
  progress?: number;
  left?: Float32Array;
  right?: Float32Array;
  error?: string;
}

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function renderSoundFontPcm(
  song: Song,
  sampleRate: number,
  sampleCount: number,
  onProgress?: (progress: number) => void,
): Promise<SoundFontPcmResult> {
  const requested = new Map<string, SongPart[]>();
  for (const part of PARTS) {
    const sourceId = song.mixer?.[part]?.soundfont?.sourceId;
    if (!sourceId || sourceId === "oscillator") continue;
    requested.set(sourceId, [...(requested.get(sourceId) ?? []), part]);
  }
  const empty = (): SoundFontPcmResult => ({
    left: new Float32Array(sampleCount),
    right: new Float32Array(sampleCount),
    activeParts: new Set<SongPart>(),
    fallbacks: [] as SoundFontFallback[],
  });
  if (requested.size === 0) return empty();

  const result = empty();
  const sources: Array<{ id: string; buffer: ArrayBuffer }> = [];
  for (const [sourceId, parts] of requested) {
    try {
      sources.push({ id: sourceId, buffer: await getSoundFontBuffer(sourceId) });
      for (const part of parts) result.activeParts.add(part);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "SoundFont を読み込めませんでした";
      for (const part of parts) result.fallbacks.push({ part, sourceId, reason });
    }
  }
  if (sources.length === 0) return result;

  return new Promise((resolve) => {
    const id = createId();
    const worker = new Worker(new URL("./soundfontRender.worker.ts", import.meta.url), {
      type: "module",
    });
    const fail = (reason: string) => {
      worker.terminate();
      for (const source of sources) {
        for (const part of requested.get(source.id) ?? []) {
          result.fallbacks.push({ part, sourceId: source.id, reason });
        }
      }
      result.activeParts.clear();
      resolve(result);
    };
    worker.onerror = () => fail("SoundFont 描画Workerを起動できませんでした");
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.id !== id) return;
      if (event.data.progress !== undefined) onProgress?.(event.data.progress);
      if (event.data.error) {
        fail(event.data.error);
        return;
      }
      if (event.data.left && event.data.right) {
        worker.terminate();
        result.left = event.data.left;
        result.right = event.data.right;
        resolve(result);
      }
    };
    worker.postMessage(
      { id, song, sampleRate, sampleCount, sources },
      sources.map((source) => source.buffer),
    );
  });
}
