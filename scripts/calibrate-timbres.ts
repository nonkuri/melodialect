/**
 * 内蔵音色セット (src/audio/timbrePresets.ts) の volume を実測する。
 * 使い方: npx tsx scripts/calibrate-timbres.ts
 *
 * 同じ演奏内容を「既定の GM 音色」と「プリセットの音色」で別々にオフライン合成し、
 * RMS 比と peak 比の相乗平均から volume を出す。RMS だけで合わせると減衰の速い
 * 撥弦 (三味線・箏) のアタックが暴れ、peak だけで合わせるとパッドが大きくなる。
 * 音色セットへプリセットを足したときは、このスクリプトの提案値を採用する。
 */
import { readFileSync } from "node:fs";
import { MIDIControllers, SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
import { dialects } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import { TIMBRE_PRESETS } from "../src/audio/timbrePresets.js";
import type { NoteEvent, SongPart } from "../src/engine/types.js";

const SAMPLE_RATE = 44_100;
const BLOCK = 128;
const PARTS: SongPart[] = ["melody", "piano", "guitar", "bass", "drums"];
const DEFAULTS: Record<SongPart, { program: number; drums: boolean }> = {
  melody: { program: 73, drums: false },
  piano: { program: 0, drums: false },
  guitar: { program: 24, drums: false },
  bass: { program: 33, drums: false },
  drums: { program: 0, drums: true },
};

const bytes = readFileSync(new URL("../public/audio-packs/generaluser-gs.sf3", import.meta.url));
const bank = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// 1 曲では鳴らないパートがある (ダイアレクトが「ピアノなし」を選ぶ) ので、
// 複数のダイアレクトから、そのパートの音が最も多い演奏を採る
const songs = ["ryukyu", "chromatic", "pulse", "voicing"].map((id) =>
  generateSong({ dialect: dialects[id]!, seed: 42, form: parseForm("i,v,c,v,c,o") }));
const beatSeconds = 60 / songs[0]!.bpm;
const flatten = (song: typeof songs[number], part: SongPart): NoteEvent[] => {
  const notes: NoteEvent[] = [];
  let offset = 0;
  for (const section of song.sections) {
    for (const note of section[part]) notes.push({ ...note, start: note.start + offset });
    offset += section.plan.bars * song.meter.barBeats;
  }
  return notes;
};
const notesFor = (part: SongPart): NoteEvent[] =>
  songs.map((song) => flatten(song, part)).sort((a, b) => b.length - a.length)[0]!;

interface Level { rms: number; peak: number }

async function renderRms(notes: NoteEvent[], program: number, drums: boolean): Promise<Level> {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, {
    eventsEnabled: false, effectsEnabled: false, maxBufferSize: BLOCK,
  });
  processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(bank), "gu");
  await processor.processorInitialized;
  const channel = drums ? 9 : 0;
  processor.midiChannels[channel]?.setDrums(drums);
  processor.controllerChange(channel, MIDIControllers.bankSelect, 0);
  processor.controllerChange(channel, MIDIControllers.bankSelectLSB, 0);
  processor.programChange(channel, program);

  const events = [
    ...notes.map((note) => ({ at: note.start * beatSeconds, on: true, note })),
    ...notes.map((note) => ({ at: (note.start + note.duration) * beatSeconds, on: false, note })),
  ].sort((a, b) => a.at - b.at);
  const total = Math.ceil((events[events.length - 1]!.at + 2) * SAMPLE_RATE);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  let sum = 0, count = 0, index = 0, peak = 0;
  for (let frame = 0; frame < total; frame += BLOCK) {
    const until = (frame + BLOCK) / SAMPLE_RATE;
    while (index < events.length && events[index]!.at < until) {
      const event = events[index]!;
      if (event.on) processor.noteOn(channel, event.note.pitch, event.note.velocity);
      else processor.noteOff(channel, event.note.pitch);
      index++;
    }
    left.fill(0);
    right.fill(0);
    processor.process(left, right, 0, BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      sum += left[i]! * left[i]! + right[i]! * right[i]!;
      count += 2;
      peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    }
  }
  return { rms: Math.sqrt(sum / count), peak };
}

const cache = new Map<string, Level>();
const rmsOf = async (part: SongPart, program: number, drums: boolean) => {
  const key = `${part}:${program}:${drums}`;
  if (!cache.has(key)) cache.set(key, await renderRms(notesFor(part), program, drums));
  return cache.get(key)!;
};

for (const part of PARTS) {
  const base = DEFAULTS[part];
  const level = await rmsOf(part, base.program, base.drums);
  console.log(`${part}: 既定 program ${base.program} RMS ${level.rms.toFixed(5)} peak ${level.peak.toFixed(3)} (${notesFor(part).length} 音)`);
}

for (const preset of TIMBRE_PRESETS) {
  const rows: string[] = [];
  for (const part of PARTS) {
    const base = DEFAULTS[part];
    const values = preset.parts[part];
    const reference = await rmsOf(part, base.program, base.drums);
    const measured = await rmsOf(part, values.program, Boolean(values.isDrum));
    const rmsRatio = measured.rms > 0 ? reference.rms / measured.rms : 1;
    const peakRatio = measured.peak > 0 ? reference.peak / measured.peak : 1;
    // 減衰の速い撥弦は RMS だけ合わせるとアタックが暴れ、パッドは peak だけ
    // 合わせると鳴りっぱなしで大きい。両者の相乗平均を体感の目安にする
    const ratio = Math.sqrt(rmsRatio * peakRatio);
    const suggested = Math.max(0.75, Math.min(1.25, Math.round(ratio * 20) / 20));
    rows.push(`${part}=${(values.volume ?? 1).toFixed(2)}→${suggested.toFixed(2)} (rms比 ${rmsRatio.toFixed(2)} / peak比 ${peakRatio.toFixed(2)})`);
  }
  console.log(`\n${preset.name}\n  ${rows.join("\n  ")}`);
}
