import type { NoteEvent, Song } from "../engine/types.js";

/**
 * SMF (Standard MIDI File) Format 1 エンコーダ (§4.5)。
 * トラック構成: [0]=メタ (テンポ・拍子・セクション/コードマーカー),
 * [1]=メロディ, [2]=ピアノ, [3]=ベース。分解能 480 ticks/beat。
 */

const TICKS_PER_BEAT = 480;

interface MidiEvent {
  tick: number;
  /** ソート時の優先度 (小さいほど先。note-off を note-on より先に) */
  order: number;
  bytes: number[];
}

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function metaEvent(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}

function buildTrack(events: MidiEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let lastTick = 0;
  for (const ev of sorted) {
    body.push(...vlq(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
  }
  body.push(...vlq(0), ...metaEvent(0x2f, [])); // End of Track
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]; // "MTrk"
}

function noteTrack(
  notes: NoteEvent[],
  channel: number,
  offsetBeats: (sectionIndex: number) => number,
  sectionIndex: number,
  events: MidiEvent[],
): void {
  for (const n of notes) {
    const start = Math.round((offsetBeats(sectionIndex) + n.start) * TICKS_PER_BEAT);
    const end = start + Math.round(n.duration * TICKS_PER_BEAT);
    events.push({ tick: start, order: 1, bytes: [0x90 | channel, n.pitch, n.velocity] });
    events.push({ tick: end, order: 0, bytes: [0x80 | channel, n.pitch, 0] });
  }
}

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

export function encodeSongToMidi(song: Song): Uint8Array {
  const barBeats = song.meter.barBeats;
  const sectionOffset = (i: number): number => song.sections[i]!.startBar * barBeats;

  // トラック 0: メタ情報
  const meta: MidiEvent[] = [];
  const usPerBeat = Math.round(60_000_000 / song.bpm);
  meta.push({
    tick: 0, order: 0,
    bytes: metaEvent(0x51, [(usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]),
  });
  meta.push({
    tick: 0, order: 0,
    bytes: metaEvent(0x58, [
      song.meter.midiNumerator,
      Math.log2(song.meter.midiDenominator),
      song.meter.midiClocks,
      8,
    ]),
  });
  meta.push({ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes("melodialect")) });

  const sectionCounts: Record<string, number> = {};
  song.sections.forEach((section, i) => {
    const label = SECTION_LABELS[section.plan.type] ?? section.plan.type;
    sectionCounts[label] = (sectionCounts[label] ?? 0) + 1;
    meta.push({
      tick: sectionOffset(i) * TICKS_PER_BEAT,
      order: 2,
      bytes: metaEvent(0x06, textBytes(`${label} ${sectionCounts[label]}`)), // マーカー
    });
    for (const chord of section.chords) {
      meta.push({
        tick: (sectionOffset(i) + chord.bar * barBeats) * TICKS_PER_BEAT,
        order: 3,
        bytes: metaEvent(0x01, textBytes(chord.symbol)), // コードシンボル (テキスト)
      });
    }
  });

  // 各パートのトラック
  const trackDefs: Array<{ name: string; channel: number; program: number; part: "melody" | "piano" | "bass" }> = [
    { name: "Melody", channel: 0, program: 73, part: "melody" }, // Flute
    { name: "Piano", channel: 1, program: 0, part: "piano" },    // Acoustic Grand
    { name: "Bass", channel: 2, program: 33, part: "bass" },     // Fingered Bass
  ];

  const tracks: number[][] = [buildTrack(meta)];
  for (const def of trackDefs) {
    const events: MidiEvent[] = [
      { tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(def.name)) },
      { tick: 0, order: 0, bytes: [0xc0 | def.channel, def.program] },
    ];
    song.sections.forEach((section, i) => {
      noteTrack(section[def.part], def.channel, sectionOffset, i, events);
    });
    tracks.push(buildTrack(events));
  }

  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...u32(6),
    ...u16(1), // Format 1
    ...u16(tracks.length),
    ...u16(TICKS_PER_BEAT),
  ];

  return Uint8Array.from([...header, ...tracks.flat()]);
}
