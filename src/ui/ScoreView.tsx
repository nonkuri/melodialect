import { useEffect, useRef } from "react";
import {
  Accidental,
  Annotation,
  AnnotationVerticalJustify,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  Voice,
} from "vexflow";
import type { NoteEvent, Song } from "../engine/types.js";
import { chordDisplayName, scaleOf } from "../engine/harmony.js";
import type { SectionLyrics } from "../engine/lyrics.js";

const SHARP_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
const FLAT_NAMES = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb"]);

const BARS_PER_LINE = 4;
const BAR_WIDTH = 230;
const FIRST_BAR_EXTRA = 70;
const LINE_HEIGHT = 130;

function pitchToVexKey(pitch: number, useFlats: boolean): string {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  const octave = Math.floor(pitch / 12) - 1;
  return `${names[pitch % 12]}/${octave}`;
}

/** 拍数 → VexFlow の音価。リズムテンプレートの値 (4, 3, 2, 1.5, 1, 0.5) に対応 */
function durationOf(beats: number): { duration: string; dotted: boolean } {
  if (beats === 4) return { duration: "w", dotted: false };
  if (beats === 3) return { duration: "h", dotted: true };
  if (beats === 2) return { duration: "h", dotted: false };
  if (beats === 1.5) return { duration: "q", dotted: true };
  if (beats === 1) return { duration: "q", dotted: false };
  if (beats === 0.5) return { duration: "8", dotted: false };
  return { duration: "q", dotted: false };
}

interface ScoredNote {
  note: NoteEvent;
  /** 仮歌詞の音節 (§4.2 手順 5)。歌詞表示が無効なら undefined */
  syllable?: string;
}

interface BarData {
  chordName: string;
  sectionLabel: string | null;
  notes: ScoredNote[];
}

/** 曲全体を小節単位に平坦化する */
function flattenBars(song: Song, useFlats: boolean, lyrics?: SectionLyrics[]): BarData[] {
  const bars: BarData[] = [];
  const scalePcs = scaleOf(song.key);
  const SECTION_LABELS: Record<string, string> = {
    intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
  };
  const barBeats = song.meter.barBeats;
  song.sections.forEach((section, sectionIndex) => {
    const syllables = lyrics?.[sectionIndex]?.syllables;
    for (let bar = 0; bar < section.plan.bars; bar++) {
      const chord = section.chords[bar]!;
      const notes: ScoredNote[] = [];
      section.melody.forEach((n, noteIndex) => {
        if (Math.floor(n.start / barBeats) === bar) {
          notes.push({ note: n, syllable: syllables?.[noteIndex] });
        }
      });
      bars.push({
        chordName: chordDisplayName(chord, useFlats, scalePcs),
        sectionLabel: bar === 0 ? (SECTION_LABELS[section.plan.type] ?? section.plan.type) : null,
        notes,
      });
    }
  });
  return bars;
}

/** メロディ+コードネーム (+仮歌詞) のリードシート表示 (§4.4)。 */
export function ScoreView({ song, lyrics }: { song: Song; lyrics?: SectionLyrics[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const useFlats = FLAT_KEYS.has(song.keyName);
    const bars = flattenBars(song, useFlats, lyrics);
    const lines = Math.ceil(bars.length / BARS_PER_LINE);
    const width = FIRST_BAR_EXTRA + BARS_PER_LINE * BAR_WIDTH + 20;
    const height = lines * LINE_HEIGHT + 30;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();

    bars.forEach((barData, barIndex) => {
      const line = Math.floor(barIndex / BARS_PER_LINE);
      const col = barIndex % BARS_PER_LINE;
      const isLineHead = col === 0;
      const staveX = isLineHead ? 10 : 10 + FIRST_BAR_EXTRA + col * BAR_WIDTH;
      const staveWidth = isLineHead ? FIRST_BAR_EXTRA + BAR_WIDTH : BAR_WIDTH;
      const y = 20 + line * LINE_HEIGHT;

      const stave = new Stave(staveX, y, staveWidth);
      if (isLineHead) {
        stave.addClef("treble");
        stave.addKeySignature(song.keyName);
        if (barIndex === 0) stave.addTimeSignature(song.meter.name);
      }
      if (barData.sectionLabel) {
        stave.setSection(barData.sectionLabel, 0);
      }
      stave.setContext(context).draw();

      if (barData.notes.length === 0) return;

      const staveNotes = barData.notes.map((sn, i) => {
        const { duration, dotted } = durationOf(sn.note.duration);
        const note = new StaveNote({
          keys: [pitchToVexKey(sn.note.pitch, useFlats)],
          duration,
        });
        if (dotted) Dot.buildAndAttach([note], { all: true });
        if (i === 0) {
          note.addModifier(
            new Annotation(barData.chordName)
              .setFont("sans-serif", 13)
              .setVerticalJustification(AnnotationVerticalJustify.TOP),
          );
        }
        if (sn.syllable) {
          note.addModifier(
            new Annotation(sn.syllable)
              .setFont("sans-serif", 10)
              .setVerticalJustification(AnnotationVerticalJustify.BOTTOM),
          );
        }
        return note;
      });

      const voice = new Voice({
        numBeats: song.meter.midiNumerator,
        beatValue: song.meter.midiDenominator,
      }).setStrict(false);
      voice.addTickables(staveNotes);
      Accidental.applyAccidentals([voice], song.keyName);
      const beams = Beam.generateBeams(staveNotes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(context, stave);
      beams.forEach((b) => b.setContext(context).draw());
    });
  }, [song, lyrics]);

  return <div className="score-scroll" ref={containerRef} />;
}
