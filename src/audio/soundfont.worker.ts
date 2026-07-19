/// <reference lib="webworker" />
import { SoundBankLoader } from "spessasynth_core";

interface RequestMessage {
  id: string;
  buffer: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, buffer } = event.data;
  try {
    self.postMessage({ id, progress: 0.2 });
    const bank = SoundBankLoader.fromArrayBuffer(buffer);
    self.postMessage({ id, progress: 0.8 });
    const presets = bank.presets.map((preset) => ({
      name: preset.name || `Bank ${preset.bankMSB}:${preset.bankLSB} Program ${preset.program}`,
      bankMSB: preset.bankMSB,
      bankLSB: preset.bankLSB,
      program: preset.program,
      isDrum: preset.isDrum,
    }));
    self.postMessage({
      id,
      progress: 1,
      result: {
        name: bank.soundBankInfo.name || "SoundFont",
        presets,
      },
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "SoundFontを解析できませんでした",
    });
  }
};
