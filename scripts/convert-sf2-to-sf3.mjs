import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { SoundBankLoader } from "spessasynth_core";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/convert-sf2-to-sf3.mjs <input.sf2> <output.sf3>");
  process.exit(2);
}

function encodeVorbis(audioData, sampleRate) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "f32le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "-i", "pipe:0",
      "-map_metadata", "-1",
      "-c:a", "libvorbis",
      "-q:a", "8",
      "-f", "ogg",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    ffmpeg.stdout.on("data", (chunk) => output.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => errors.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(new Uint8Array(Buffer.concat(output)));
      else reject(new Error(Buffer.concat(errors).toString("utf8") || `ffmpeg exited with ${code}`));
    });
    ffmpeg.stdin.on("error", reject);
    ffmpeg.stdin.end(Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength));
  });
}

const bytes = await readFile(inputPath);
const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const bank = SoundBankLoader.fromArrayBuffer(source);
let lastPercent = -1;
await bank.setSampleFormat({
  format: "compressed",
  compressionFunction: encodeVorbis,
  progressFunction(progress) {
    const percent = Math.floor(progress * 100);
    if (percent !== lastPercent) {
      lastPercent = percent;
      console.log(`Compressing samples: ${percent}%`);
    }
  },
});
const result = bank.writeSF2({ software: "Melodialect / SpessaSynth" });
await writeFile(outputPath, new Uint8Array(result));
console.log(`Wrote ${outputPath} (${result.byteLength} bytes)`);
