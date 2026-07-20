import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dialects } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import type { SectionControl, SectionType } from "../src/engine/types.js";

interface Baseline { normalMs: number; maximumMs: number; heapDeltaMb: number }
const baseline = JSON.parse(readFileSync(new URL("../test/fixtures/performance-baseline.json", import.meta.url), "utf8")) as Baseline;

function measure<T>(run: () => T): { value: T; elapsedMs: number; heapDeltaMb: number } {
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const value = run();
  return {
    value,
    elapsedMs: performance.now() - started,
    heapDeltaMb: Math.max(0, process.memoryUsage().heapUsed - before) / 1024 / 1024,
  };
}

const normal = measure(() => generateSong({
  dialect: dialects["chromatic-cliche"]!, seed: 42, form: ["verse", "chorus"], ending: "final",
}));
const types: SectionType[] = ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"];
const controls: SectionControl[] = types.map((type, index) => ({
  id: `perf-${index}`, type, dialectId: "extended-voicing", bars: 10, transpose: 0, bpm: 64,
}));
const maximum = measure(() => generateSong({
  dialect: dialects["extended-voicing"]!, seed: 680, form: types, ending: "loop", sectionControls: controls,
  bpm: 64,
}));
const result = {
  normalMs: Number(normal.elapsedMs.toFixed(2)),
  maximumMs: Number(maximum.elapsedMs.toFixed(2)),
  heapDeltaMb: Number(Math.max(normal.heapDeltaMb, maximum.heapDeltaMb).toFixed(2)),
  normalBars: normal.value.totalBars,
  maximumBars: maximum.value.totalBars,
  maximumMinutes: Number((maximum.value.totalBars * maximum.value.meter.barBeats * 60 / maximum.value.bpm / 60).toFixed(2)),
};
console.log(JSON.stringify(result));
const regressions = [
  ["normalMs", result.normalMs, baseline.normalMs],
  ["maximumMs", result.maximumMs, baseline.maximumMs],
  ["heapDeltaMb", result.heapDeltaMb, baseline.heapDeltaMb],
] as const;
for (const [name, current, reference] of regressions) {
  if (current > reference * 4 + 10) {
    console.error(`${name} regressed: ${current} > baseline ${reference} (4x tolerance + 10)`);
    process.exitCode = 1;
  }
}
