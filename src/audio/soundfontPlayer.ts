import { WorkletSynthesizer } from "spessasynth_lib";
import type { NoteEvent, Song, SongPart, SoundFontAssignment } from "../engine/types.js";
import type { SoundFontPreset } from "./soundfonts.js";
import { getSoundFontBuffer } from "./soundfonts.js";
import { beatToSeconds } from "./player.js";
import {
  AUDIO_PARTS,
  SOUNDFONT_PART_CHANNEL,
  isPartAudible,
  soundFontChannelConfig,
} from "./mix.js";

const PARTS = AUDIO_PARTS;

export interface SoundFontFallback {
  part: SongPart;
  sourceId: string;
  reason: string;
}

export interface SoundFontSession {
  synths: WorkletSynthesizer[];
  synthByPart: Partial<Record<SongPart, WorkletSynthesizer>>;
  activeParts: Set<SongPart>;
  fallbacks: SoundFontFallback[];
  destroy(): void;
}

const registeredContexts = new WeakSet<BaseAudioContext>();

async function registerProcessor(context: BaseAudioContext): Promise<void> {
  if (registeredContexts.has(context)) return;
  await context.audioWorklet.addModule(
    new URL("spessasynth_processor.min.js", document.baseURI).toString(),
  );
  registeredContexts.add(context);
}

function configureChannel(
  synth: WorkletSynthesizer,
  part: SongPart,
  assignment: SoundFontAssignment,
  volume: number,
  pan: number,
): void {
  const config = soundFontChannelConfig(part, assignment, volume, pan);
  const channel = config.channel;
  synth.midiChannels[channel]?.setDrums(config.drums);
  // MIDI bank MSB/LSB, volume and pan use their standard controller numbers.
  synth.controllerChange(channel, 0, config.bankMSB);
  synth.controllerChange(channel, 32, config.bankLSB);
  synth.controllerChange(channel, 7, config.volume);
  synth.controllerChange(channel, 10, config.pan);
  synth.programChange(channel, config.program);
}

export async function createSoundFontSession(
  context: AudioContext,
  song: Song,
  destination: AudioNode,
): Promise<SoundFontSession> {
  const assignments = new Map<string, SongPart[]>();
  for (const part of PARTS) {
    const assignment = song.mixer?.[part]?.soundfont;
    if (!assignment || assignment.sourceId === "oscillator") continue;
    const parts = assignments.get(assignment.sourceId) ?? [];
    parts.push(part);
    assignments.set(assignment.sourceId, parts);
  }
  const synths: WorkletSynthesizer[] = [];
  const synthByPart: Partial<Record<SongPart, WorkletSynthesizer>> = {};
  const activeParts = new Set<SongPart>();
  const fallbacks: SoundFontFallback[] = [];
  if (assignments.size === 0) {
    return { synths, synthByPart, activeParts, fallbacks, destroy() {} };
  }
  try {
    await registerProcessor(context);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AudioWorkletを起動できませんでした";
    for (const [sourceId, parts] of assignments) {
      for (const part of parts) fallbacks.push({ part, sourceId, reason });
    }
    return { synths, synthByPart, activeParts, fallbacks, destroy() {} };
  }

  for (const [sourceId, parts] of assignments) {
    let synth: WorkletSynthesizer | null = null;
    try {
      const buffer = await getSoundFontBuffer(sourceId);
      synth = new WorkletSynthesizer(context, {
        eventsEnabled: false,
      });
      synth.setSystemParameter("voiceCap", 96);
      synth.connect(destination);
      await synth.soundBankManager.addSoundBank(buffer, sourceId);
      await synth.isReady;
      for (const part of parts) {
        const mix = song.mixer?.[part];
        const assignment = mix?.soundfont;
        if (!mix || !assignment) continue;
        configureChannel(synth, part, assignment, mix.volume, mix.pan);
        synthByPart[part] = synth;
        activeParts.add(part);
      }
      synths.push(synth);
    } catch (error) {
      synth?.destroy();
      const reason = error instanceof Error ? error.message : "SoundFontを読み込めませんでした";
      for (const part of parts) fallbacks.push({ part, sourceId, reason });
    }
  }

  return {
    synths,
    synthByPart,
    activeParts,
    fallbacks,
    destroy() {
      for (const synth of synths) synth.destroy();
    },
  };
}

export function scheduleSoundFontRange(
  session: SoundFontSession,
  song: Song,
  contextTime: number,
  startBeat: number,
  endBeat: number,
): void {
  for (const section of song.sections) {
    const offset = section.startBar * song.meter.barBeats;
    const lists: Record<SongPart, NoteEvent[]> = {
      melody: section.melody,
      piano: section.piano,
      guitar: section.guitar ?? [],
      bass: section.bass,
      drums: section.drums ?? [],
    };
    for (const part of PARTS) {
      const synth = session.synthByPart[part];
      const mix = song.mixer?.[part];
      if (!synth || !isPartAudible(song.mixer, part)) continue;
      const channel = SOUNDFONT_PART_CHANNEL[part];
      for (const note of lists[part]) {
        const absoluteStart = offset + note.start;
        const absoluteEnd = absoluteStart + note.duration;
        if (absoluteEnd <= startBeat || absoluteStart >= endBeat) continue;
        const clippedStart = Math.max(startBeat, absoluteStart);
        const clippedEnd = Math.min(endBeat, absoluteEnd);
        const onTime = contextTime + beatToSeconds(song, clippedStart) - beatToSeconds(song, startBeat);
        const offTime = contextTime + beatToSeconds(song, clippedEnd) - beatToSeconds(song, startBeat);
        synth.noteOn(channel, note.pitch, note.velocity, { time: onTime });
        synth.noteOff(channel, note.pitch, { time: offTime });
      }
    }
  }
}

export async function previewSoundFontNote(
  sourceId: string,
  preset: SoundFontPreset,
  pitch: number,
  velocity: number,
  duration: number,
): Promise<void> {
  const context = new AudioContext();
  try {
    await registerProcessor(context);
    const synth = new WorkletSynthesizer(context, { eventsEnabled: false });
    synth.setSystemParameter("voiceCap", 24);
    const gain = context.createGain();
    gain.gain.value = 0.55;
    gain.connect(context.destination);
    synth.connect(gain);
    await synth.soundBankManager.addSoundBank(await getSoundFontBuffer(sourceId), sourceId);
    await synth.isReady;
    const assignment: SoundFontAssignment = {
      sourceId,
      bankMSB: preset.bankMSB,
      bankLSB: preset.bankLSB,
      program: preset.program,
      isDrum: preset.isDrum,
    };
    configureChannel(synth, "melody", assignment, 1, 0);
    await context.resume();
    const start = context.currentTime + 0.05;
    synth.noteOn(0, pitch, velocity, { time: start });
    synth.noteOff(0, pitch, { time: start + duration });
    window.setTimeout(() => {
      synth.destroy();
      void context.close();
    }, (duration + 0.5) * 1000);
  } catch (error) {
    void context.close();
    throw error;
  }
}
