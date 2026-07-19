import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";

const sampleRate = 44_100;
const durationSeconds = 5 * 60;
const blockSize = 128;
const voices = 32;
const bytes = await readFile(new URL("../public/melodialect-standard.sf2", import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const processor = new SpessaSynthProcessor(sampleRate, {
  eventsEnabled: false,
  effectsEnabled: false,
  maxBufferSize: blockSize,
});
processor.setSystemParameter("voiceCap", 128);
processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(buffer), "standard");
await processor.processorInitialized;

const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);
const totalFrames = durationSeconds * sampleRate;
const phraseFrames = sampleRate * 2;
let previousPhrase = -1;
let peak = 0;
let peakVoices = 0;
const started = performance.now();
for (let frame = 0; frame < totalFrames; frame += blockSize) {
  const phrase = Math.floor(frame / phraseFrames);
  if (phrase !== previousPhrase) {
    for (let index = 0; index < voices; index++) {
      if (previousPhrase >= 0) processor.noteOff(index % 4, 48 + index % 24);
      processor.noteOn(index % 4, 48 + index % 24, 80 + index % 32);
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
