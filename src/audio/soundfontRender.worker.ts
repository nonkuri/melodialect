import {
  MIDIControllers,
  SoundBankLoader,
  SpessaSynthProcessor,
} from "spessasynth_core";
import type { NoteEvent, Song, SongPart, SoundFontAssignment } from "../engine/types.js";
import {
  AUDIO_PARTS,
  SOUNDFONT_PART_CHANNEL,
  isPartAudible,
  soundFontChannelConfig,
} from "./mix.js";

const PARTS = AUDIO_PARTS;
const BLOCK_SIZE = 128;

interface RenderRequest {
  id: string;
  song: Song;
  sampleRate: number;
  sampleCount: number;
  sources: Array<{ id: string; buffer: ArrayBuffer }>;
}

interface ScheduledEvent {
  frame: number;
  channel: number;
  pitch: number;
  velocity: number;
  on: boolean;
}

function beatToSeconds(song: Song, beat: number): number {
  const barBeats = song.meter.barBeats;
  let seconds = 0;
  for (const section of song.sections) {
    const start = section.startBar * barBeats;
    const end = start + section.plan.bars * barBeats;
    if (beat <= start) break;
    const covered = Math.min(beat, end) - start;
    if (covered > 0) seconds += covered * 60 / (section.bpm ?? song.bpm);
    if (beat < end) break;
  }
  return seconds;
}

function notesForPart(section: Song["sections"][number], part: SongPart): NoteEvent[] {
  if (part === "guitar" || part === "drums") return section[part] ?? [];
  return section[part];
}

function configureChannel(
  processor: SpessaSynthProcessor,
  part: SongPart,
  assignment: SoundFontAssignment,
  volume: number,
  pan: number,
): void {
  const config = soundFontChannelConfig(part, assignment, volume, pan);
  const channel = config.channel;
  processor.midiChannels[channel]?.setDrums(config.drums);
  processor.controllerChange(channel, MIDIControllers.bankSelect, config.bankMSB);
  processor.controllerChange(channel, MIDIControllers.bankSelectLSB, config.bankLSB);
  processor.controllerChange(channel, MIDIControllers.mainVolume, config.volume);
  processor.controllerChange(channel, MIDIControllers.pan, config.pan);
  processor.programChange(channel, config.program);
}

function createEvents(song: Song, sourceId: string, sampleRate: number): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  for (const section of song.sections) {
    const sectionBeat = section.startBar * song.meter.barBeats;
    for (const part of PARTS) {
      const mix = song.mixer?.[part];
      if (mix?.soundfont?.sourceId !== sourceId || !isPartAudible(song.mixer, part)) continue;
      for (const note of notesForPart(section, part)) {
        const startBeat = sectionBeat + note.start;
        const endBeat = startBeat + note.duration;
        const channel = SOUNDFONT_PART_CHANNEL[part];
        events.push({
          frame: Math.max(0, Math.round(beatToSeconds(song, startBeat) * sampleRate)),
          channel,
          pitch: note.pitch,
          velocity: note.velocity,
          on: true,
        });
        events.push({
          frame: Math.max(0, Math.round(beatToSeconds(song, endBeat) * sampleRate)),
          channel,
          pitch: note.pitch,
          velocity: 0,
          on: false,
        });
      }
    }
  }
  return events.sort((a, b) => a.frame - b.frame || Number(a.on) - Number(b.on));
}

async function render(request: RenderRequest): Promise<[Float32Array, Float32Array]> {
  const left = new Float32Array(request.sampleCount);
  const right = new Float32Array(request.sampleCount);
  for (let sourceIndex = 0; sourceIndex < request.sources.length; sourceIndex++) {
    const source = request.sources[sourceIndex]!;
    const processor = new SpessaSynthProcessor(request.sampleRate, {
      eventsEnabled: false,
      effectsEnabled: false,
      maxBufferSize: BLOCK_SIZE,
    });
    processor.setSystemParameter("voiceCap", 128);
    processor.soundBankManager.addSoundBank(
      SoundBankLoader.fromArrayBuffer(source.buffer),
      source.id,
    );
    await processor.processorInitialized;
    for (const part of PARTS) {
      const mix = request.song.mixer?.[part];
      if (mix?.soundfont?.sourceId === source.id) {
        configureChannel(processor, part, mix.soundfont, mix.volume, mix.pan);
      }
    }

    const events = createEvents(request.song, source.id, request.sampleRate);
    const sourceLeft = new Float32Array(request.sampleCount);
    const sourceRight = new Float32Array(request.sampleCount);
    let eventIndex = 0;
    for (let frame = 0; frame < request.sampleCount; frame += BLOCK_SIZE) {
      while (eventIndex < events.length && events[eventIndex]!.frame <= frame) {
        const event = events[eventIndex++]!;
        if (event.on) processor.noteOn(event.channel, event.pitch, event.velocity);
        else processor.noteOff(event.channel, event.pitch);
      }
      processor.process(
        sourceLeft,
        sourceRight,
        frame,
        Math.min(BLOCK_SIZE, request.sampleCount - frame),
      );
      if (frame % (BLOCK_SIZE * 256) === 0) {
        self.postMessage({
          id: request.id,
          progress: (sourceIndex + frame / request.sampleCount) / request.sources.length,
        });
      }
    }
    for (let index = 0; index < request.sampleCount; index++) {
      left[index] = left[index]! + sourceLeft[index]!;
      right[index] = right[index]! + sourceRight[index]!;
    }
  }
  return [left, right];
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  void render(request).then(([left, right]) => {
    self.postMessage({ id: request.id, progress: 1, left, right }, [left.buffer, right.buffer]);
  }).catch((error: unknown) => {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : "SoundFont のオフライン描画に失敗しました",
    });
  });
};
