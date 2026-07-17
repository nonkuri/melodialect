/**
 * M1 検証用 CLI (§9 M1)。
 * 使い方: npm run generate -- [--seed 42] [--key C] [--bpm 96] [--form v,c,v,c] [--out out]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dialects } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import { encodeSongToMidi } from "../src/export/midi.js";
import { BEATS_PER_BAR } from "../src/engine/types.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const seed = Number(arg("seed", "42"));
const dialectName = arg("dialect", "paul");
const outDir = arg("out", "out");
const formStr = arg("form", "v,c,v,c");

const dialect = dialects[dialectName];
if (!dialect) {
  console.error(`unknown dialect: ${dialectName} (available: ${Object.keys(dialects).join(", ")})`);
  process.exit(1);
}

const song = generateSong({
  dialect,
  seed,
  keyName: arg("key", dialect.defaults.key),
  bpm: Number(arg("bpm", String(dialect.defaults.bpm))),
  form: parseForm(formStr),
});

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
console.log(`=== melodialect: ${dialect.name} ===`);
console.log(`key: ${NOTE_NAMES[song.key.tonic]} ${song.key.mode} / bpm: ${song.bpm} / seed: ${song.seed}`);
console.log(`total: ${song.totalBars} bars\n`);

for (const section of song.sections) {
  console.log(`[${section.plan.type}] (${section.plan.bars} bars, phrase: ${section.plan.phraseLengths.join("+")})`);
  console.log(`  chords: ${section.chords.map((c) => c.symbol).join(" | ")}`);
  console.log(`  melody: ${section.melody.length} notes`);
  for (const a of section.annotations) {
    console.log(`  bar ${a.bar + 1}: [${a.ruleId}] ${a.text}`);
  }
  console.log();
}

mkdirSync(outDir, { recursive: true });
const fileName = `melodialect-${dialectName}-seed${seed}.mid`;
const outPath = join(outDir, fileName);
writeFileSync(outPath, encodeSongToMidi(song));

const totalBeats = song.totalBars * BEATS_PER_BAR;
const durationSec = (totalBeats / song.bpm) * 60;
console.log(`wrote ${outPath} (${song.totalBars} bars, ${durationSec.toFixed(1)} sec)`);
