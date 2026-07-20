import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { BasicSoundBank } from "spessasynth_core";

function deterministicSampleBank() {
  const bytes = new Uint8Array(BasicSoundBank.getSampleSoundBankFile());
  const marker = new TextEncoder().encode("ICRD");
  // SpessaSynth embeds the current second in ICRD. Keep the checked-in asset
  // byte-for-byte stable so every prebuild does not create a binary diff.
  const fixedDate = new TextEncoder().encode("2026-07-19T21:31:21Z");
  const markerAt = bytes.findIndex((_, index) =>
    marker.every((value, offset) => bytes[index + offset] === value));
  if (markerAt >= 0) {
    const fieldLength = bytes[markerAt + 4] |
      (bytes[markerAt + 5] << 8) |
      (bytes[markerAt + 6] << 16) |
      (bytes[markerAt + 7] << 24);
    const valueAt = markerAt + 8;
    bytes.fill(0, valueAt, valueAt + fieldLength);
    bytes.set(fixedDate.slice(0, Math.max(0, fieldLength - 1)), valueAt);
  }
  return bytes;
}

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/docs/", import.meta.url), { recursive: true });
const qualityPack = await readFile(
  new URL("../public/audio-packs/generaluser-gs.sf3", import.meta.url),
);
const qualityPackHash = createHash("sha256").update(qualityPack).digest("hex");
if (qualityPack.byteLength !== 10_556_570 ||
    qualityPackHash !== "5e7262fa50cbabbc9fcd02571f2bf1d2d4b51fc124bf8bfa38203a8ba6f3fd56") {
  throw new Error("GeneralUser GS quality pack is missing or does not match the pinned release");
}
await copyFile(
  new URL("../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js", import.meta.url),
  new URL("../public/spessasynth_processor.min.js", import.meta.url),
);
await writeFile(
  new URL("../public/melodialect-standard.sf2", import.meta.url),
  deterministicSampleBank(),
);
await writeFile(
  new URL("../public/SOUNDFONT-NOTICE.txt", import.meta.url),
  "Melodialect Standard SF2 is generated from spessasynth_core (Apache-2.0).\n" +
    "It contains a tiny synthesized waveform and no third-party recordings.\n",
  "utf8",
);
await copyFile(
  new URL("../docs/USER_GUIDE.md", import.meta.url),
  new URL("../public/docs/USER_GUIDE.md", import.meta.url),
);
