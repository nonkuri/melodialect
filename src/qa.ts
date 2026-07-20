import type { Song } from "./engine/types.js";
import { METERS } from "./engine/meter.js";
import { DEFAULT_MASTER, defaultMixer } from "./engine/controls.js";
import { renderWavBlob } from "./export/wav.js";

interface WavSmokeResult {
  bytes: number;
  header: string;
  elapsedMs: number;
  progressUpdates: number;
  finalMessage: string;
}

declare global {
  interface Window {
    __MELODIALECT_QA__?: {
      renderWavSmokeTest: () => Promise<WavSmokeResult>;
      renderGeneralUserWavSmokeTest: () => Promise<WavSmokeResult>;
    };
  }
}

async function renderSmokeSong(song: Song): Promise<WavSmokeResult> {
  let progressUpdates = 0;
  let finalMessage = "";
  const started = performance.now();
  const blob = await renderWavBlob(song, (progress, message) => {
    progressUpdates += 1;
    if (progress === 1) finalMessage = message;
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = `${String.fromCharCode(...bytes.slice(0, 4))}/${String.fromCharCode(...bytes.slice(8, 12))}`;
  return {
    bytes: blob.size,
    header,
    elapsedMs: performance.now() - started,
    progressUpdates,
    finalMessage,
  };
}

function qaSong(): Song {
  return {
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
      melody: [{ start: 0, duration: 1, pitch: 72, velocity: 90 }],
      piano: [], guitar: [], bass: [], drums: [], annotations: [],
    }],
  };
}

/** Opt-in browser QA hook used by the release matrix; never touches saved user data. */
export function installQaHooks(): void {
  if (!new URLSearchParams(window.location.search).has("qa")) return;
  window.__MELODIALECT_QA__ = {
    async renderWavSmokeTest() {
      return renderSmokeSong(qaSong());
    },
    async renderGeneralUserWavSmokeTest() {
      const song = qaSong();
      song.mixer = defaultMixer();
      song.master = { ...DEFAULT_MASTER };
      const section = song.sections[0]!;
      section.piano = [48, 52, 55].map((pitch) => ({ start: 0, duration: 2, pitch, velocity: 82 }));
      section.guitar = [60, 64, 67].map((pitch) => ({ start: 2, duration: 1.5, pitch, velocity: 78 }));
      section.bass = [{ start: 0, duration: 2, pitch: 36, velocity: 90 }];
      section.drums = [
        { start: 0, duration: 0.25, pitch: 36, velocity: 100 },
        { start: 1, duration: 0.25, pitch: 38, velocity: 96 },
        { start: 2, duration: 0.25, pitch: 42, velocity: 84 },
      ];
      return renderSmokeSong(song);
    },
  };
}
