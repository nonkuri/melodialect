import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { MIDIControllers, SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";

const sampleRate = 44_100;
const durationSeconds = 5 * 60;
const blockSize = 128;
const voices = 32;
const bytes = await readFile(new URL("../public/audio-packs/generaluser-gs.sf3", import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const processor = new SpessaSynthProcessor(sampleRate, {
  eventsEnabled: false,
  effectsEnabled: false,
  maxBufferSize: blockSize,
});
processor.setSystemParameter("voiceCap", 128);
processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(buffer), "generaluser-gs");
await processor.processorInitialized;

const parts = [
  { channel: 0, program: 73, low: 60, span: 24, drums: false },
  { channel: 1, program: 0, low: 48, span: 24, drums: false },
  { channel: 2, program: 24, low: 48, span: 24, drums: false },
  { channel: 3, program: 33, low: 36, span: 18, drums: false },
  { channel: 9, program: 0, low: 35, span: 12, drums: true },
];
for (const part of parts) {
  processor.midiChannels[part.channel]?.setDrums(part.drums);
  processor.controllerChange(part.channel, MIDIControllers.bankSelect, 0);
  processor.controllerChange(part.channel, MIDIControllers.bankSelectLSB, 0);
  processor.programChange(part.channel, part.program);
}

const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);
const totalFrames = durationSeconds * sampleRate;
const phraseFrames = sampleRate * 2;
let previousPhrase = -1;
const activeNotes = [];
let peak = 0;
let peakVoices = 0;
const started = performance.now();
for (let frame = 0; frame < totalFrames; frame += blockSize) {
  const phrase = Math.floor(frame / phraseFrames);
  if (phrase !== previousPhrase) {
    for (const note of activeNotes) processor.noteOff(note.channel, note.pitch);
    activeNotes.length = 0;
    for (let index = 0; index < voices; index++) {
      const part = parts[index % parts.length];
      const pitch = part.low + index % part.span;
      processor.noteOn(part.channel, pitch, 80 + index % 32);
      activeNotes.push({ channel: part.channel, pitch });
    }
    previousPhrase = phrase;
  }
  left.fill(0);
  right.fill(0);
  processor.process(left, right, 0, Math.min(blockSize, totalFrames - frame));
  peakVoices = Math.max(peakVoices, processor.voiceCount);
  for (const sample of left) peak = Math.max(peak, Math.abs(sample));
}
const elapsedMs = performance.now() - started;
const result = {
  soundFont: "GeneralUser GS 2.0.3 SF3",
  renderedSeconds: durationSeconds,
  elapsedMs: Math.round(elapsedMs),
  realtimeFactor: Number((durationSeconds * 1000 / elapsedMs).toFixed(1)),
  requestedVoices: voices,
  peakVoices,
  voiceCap: processor.systemParameters.voiceCap,
  peak: Number(peak.toFixed(4)),
};
console.log(JSON.stringify(result));
if (peak <= 0 || peakVoices > processor.systemParameters.voiceCap || elapsedMs > durationSeconds * 1000) {
  process.exitCode = 1;
}
