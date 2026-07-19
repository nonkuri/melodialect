import type { ChordEvent, NoteEvent, Song, SongPart } from "../engine/types.js";
import { chordDisplayName, scaleOf } from "../engine/harmony.js";
import { generateLyrics, type SectionLyrics } from "../engine/lyrics.js";

const DIVISIONS = 12;
const PARTS: Array<[SongPart, string]> = [
  ["melody", "Melody"], ["piano", "Piano"], ["guitar", "Guitar"],
  ["bass", "Bass"], ["drums", "Drums"],
];
const STEPS = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
] as const;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function duration(value: number): number {
  return Math.max(1, Math.round(value * DIVISIONS));
}

function pitchXml(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const [step, alter] = STEPS[pc]!;
  const octave = Math.floor(pitch / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

function noteXml(note: NoteEvent, voice: number, syllable?: string): string {
  const lyric = syllable ? `<lyric number="1"><syllabic>single</syllabic><text>${escapeXml(syllable)}</text></lyric>` : "";
  return `<note>${pitchXml(note.pitch)}<duration>${duration(note.duration)}</duration><voice>${voice}</voice><velocity>${note.velocity}</velocity>${lyric}</note>`;
}

function harmonyXml(chord: ChordEvent, song: Song): string {
  const [step, alter] = STEPS[chord.rootPc]!;
  const display = chordDisplayName(chord, song.keyName.includes("b"), scaleOf(song.key));
  return `<harmony><root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ""}</root><kind text="${escapeXml(display)}">other</kind><offset>${duration(chord.start % song.meter.barBeats)}</offset></harmony>`;
}

interface BarNote { note: NoteEvent; syllable?: string }

function eventsForBar(song: Song, part: SongPart, bar: number, lyrics: SectionLyrics[]): BarNote[] {
  const barStart = bar * song.meter.barBeats;
  const section = song.sections.find((item) =>
    bar >= item.startBar && bar < item.startBar + item.plan.bars);
  if (!section) return [];
  const sectionIndex = song.sections.indexOf(section);
  const localBarStart = barStart - section.startBar * song.meter.barBeats;
  return section[part].map((note, noteIndex) => ({ note, noteIndex })).filter(({ note }) =>
    note.start >= localBarStart && note.start < localBarStart + song.meter.barBeats)
    .map(({ note, noteIndex }) => ({
      note: { ...note, start: note.start - localBarStart },
      syllable: part === "melody" ? lyrics[sectionIndex]?.syllables[noteIndex] : undefined,
    }));
}

function chordsForBar(song: Song, bar: number): ChordEvent[] {
  const section = song.sections.find((item) => bar >= item.startBar && bar < item.startBar + item.plan.bars);
  if (!section) return [];
  const localBar = bar - section.startBar;
  return section.chords.filter((chord) => chord.bar === localBar);
}

function measureXml(song: Song, part: SongPart, bar: number, first: boolean, lyrics: SectionLyrics[]): string {
  const measureDuration = duration(song.meter.barBeats);
  const attributes = first
    ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths><mode>${song.key.mode}</mode></key><time><beats>${song.meter.midiNumerator}</beats><beat-type>${song.meter.midiDenominator}</beat-type></time><clef><sign>${part === "bass" ? "F" : "G"}</sign><line>${part === "bass" ? 4 : 2}</line></clef></attributes>`
    : "";
  const harmony = part === "melody" ? chordsForBar(song, bar).map((chord) => harmonyXml(chord, song)).join("") : "";
  const notes = eventsForBar(song, part, bar, lyrics);
  if (notes.length === 0) {
    return `<measure number="${bar + 1}">${attributes}${harmony}<note><rest/><duration>${measureDuration}</duration><voice>1</voice></note></measure>`;
  }
  // Each event gets its own voice and returns to the measure origin with backup,
  // which preserves arbitrary generated polyphony without flattening overlaps.
  const voices = notes.map(({ note, syllable }, index) => {
    const start = duration(note.start);
    const forward = start > 0 ? `<forward><duration>${start}</duration></forward>` : "";
    const body = `${forward}${noteXml(note, index + 1, syllable)}`;
    const consumed = start + duration(note.duration);
    return `${body}<backup><duration>${consumed}</duration></backup>`;
  }).join("");
  return `<measure number="${bar + 1}">${attributes}${harmony}${voices}<forward><duration>${measureDuration}</duration></forward></measure>`;
}

export function buildMusicXml(song: Song): string {
  const lyrics = generateLyrics(song);
  const partList = PARTS.map(([, name], index) =>
    `<score-part id="P${index + 1}"><part-name>${name}</part-name></score-part>`).join("");
  const parts = PARTS.map(([part], index) => {
    const measures = Array.from({ length: song.totalBars }, (_, bar) => measureXml(song, part, bar, bar === 0, lyrics)).join("");
    return `<part id="P${index + 1}">${measures}</part>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>Melodialect seed ${song.seed}</work-title></work><part-list>${partList}</part-list>${parts}</score-partwise>`;
}

export function downloadMusicXml(song: Song): void {
  const blob = new Blob([buildMusicXml(song)], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `melodialect-${song.dialectId}-seed${song.seed}.musicxml`;
  anchor.click();
  URL.revokeObjectURL(url);
}
