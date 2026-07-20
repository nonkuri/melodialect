import type { Song } from "./engine/types.js";
import { METERS } from "./engine/meter.js";
import { renderWavBlob } from "./export/wav.js";

declare global {
  interface Window {
    __MELODIALECT_QA__?: {
      renderWavSmokeTest: () => Promise<{ bytes: number; header: string; elapsedMs: number; progressUpdates: number }>;
    };
  }
}

/** Opt-in browser QA hook used by the release matrix; never touches saved user data. */
export function installQaHooks(): void {
  if (!new URLSearchParams(window.location.search).has("qa")) return;
  window.__MELODIALECT_QA__ = {
    async renderWavSmokeTest() {
      const song: Song = {
        dialectId: "qa",
        seed: 1,
        ending: "loop",
        key: { tonic: 0, mode: "major" },
        keyName: "C",
        bpm: 240,
        meter: METERS["4/4"]!,
        totalBars: 1,
        sections: [{
          plan: { type: "verse", phraseLengths: [1], bars: 1 },
          startBar: 0,
          dialectId: "qa",
          key: { tonic: 0, mode: "major" },
          bpm: 240,
          chords: [],
          melody: [{ start: 0, duration: 1, pitch: 60, velocity: 90 }],
          piano: [], guitar: [], bass: [], drums: [], annotations: [],
        }],
      };
      let progressUpdates = 0;
      const started = performance.now();
      const blob = await renderWavBlob(song, () => { progressUpdates += 1; });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const header = `${String.fromCharCode(...bytes.slice(0, 4))}/${String.fromCharCode(...bytes.slice(8, 12))}`;
      return {
        bytes: blob.size,
        header,
        elapsedMs: performance.now() - started,
        progressUpdates,
      };
    },
  };
}
