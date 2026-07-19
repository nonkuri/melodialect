import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { BasicSoundBank } from "spessasynth_core";

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/docs/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js", import.meta.url),
  new URL("../public/spessasynth_processor.min.js", import.meta.url),
);
await writeFile(
  new URL("../public/melodialect-standard.sf2", import.meta.url),
  new Uint8Array(BasicSoundBank.getSampleSoundBankFile()),
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
