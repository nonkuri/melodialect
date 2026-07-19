import { useMemo } from "react";
import type { NoteEvent, Song } from "../engine/types.js";
import type { ChordSelection, NoteSelection } from "./editor.js";

const PX_PER_BEAT = 26;
const ROW_H = 9;
const LABEL_H = 24;
const GRID = 0.25;

const PART_COLORS = {
  melody: "#e2603a",
  piano: "#7d92d8",
  bass: "#3fa878",
} as const;

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

interface FlatNote extends NoteSelection {
  startBeat: number;
  localStart: number;
  duration: number;
  pitch: number;
}

function sameNote(a: NoteSelection | null, b: NoteSelection): boolean {
  return Boolean(a &&
    a.sectionIndex === b.sectionIndex &&
    a.part === b.part &&
    a.noteIndex === b.noteIndex);
}

export function EditablePianoRoll({
  song,
  playheadBeat,
  noteSelection,
  chordSelection,
  onSelectNote,
  onSelectChord,
  onEditNote,
  onAddNote,
  onSeek,
}: {
  song: Song;
  playheadBeat: number | null;
  noteSelection: NoteSelection | null;
  chordSelection: ChordSelection | null;
  onSelectNote: (selection: NoteSelection | null) => void;
  onSelectChord: (selection: ChordSelection | null) => void;
  onEditNote: (selection: NoteSelection, patch: Partial<NoteEvent>) => void;
  onAddNote: (sectionIndex: number, note: NoteEvent) => void;
  onSeek: (beat: number) => void;
}) {
  const barBeats = song.meter.barBeats;
  const { notes, minPitch, maxPitch, totalBeats } = useMemo(() => {
    const flat: FlatNote[] = [];
    song.sections.forEach((section, sectionIndex) => {
      const offset = section.startBar * barBeats;
      for (const part of ["melody", "piano", "bass"] as const) {
        section[part].forEach((note, noteIndex) => {
          flat.push({
            sectionIndex,
            part,
            noteIndex,
            startBeat: offset + note.start,
            localStart: note.start,
            duration: note.duration,
            pitch: note.pitch,
          });
        });
      }
    });
    const pitches = flat.map((note) => note.pitch);
    return {
      notes: flat,
      minPitch: Math.min(48, ...pitches) - 2,
      maxPitch: Math.max(84, ...pitches) + 2,
      totalBeats: song.totalBars * barBeats,
    };
  }, [song, barBeats]);

  const width = Math.max(720, totalBeats * PX_PER_BEAT);
  const rollH = (maxPitch - minPitch + 1) * ROW_H;
  const height = LABEL_H + rollH;
  const yOf = (pitch: number) => LABEL_H + (maxPitch - pitch) * ROW_H;

  const beatFromEvent = (event: React.MouseEvent<SVGSVGElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(totalBeats, (event.clientX - rect.left) / PX_PER_BEAT));
  };

  return (
    <div className="piano-roll-scroll">
      <svg
        width={width}
        height={height}
        role="application"
        aria-label="編集可能なピアノロール"
        onClick={(event) => {
          const target = event.target as SVGElement;
          if (target.dataset.entity) return;
          onSeek(Math.round(beatFromEvent(event) / GRID) * GRID);
          onSelectNote(null);
          onSelectChord(null);
        }}
        onDoubleClick={(event) => {
          const target = event.target as SVGElement;
          if (target.dataset.entity) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const beat = Math.round(beatFromEvent(event) / GRID) * GRID;
          const pitch = Math.max(
            0,
            Math.min(127, maxPitch - Math.floor((event.clientY - rect.top - LABEL_H) / ROW_H)),
          );
          const sectionIndex = song.sections.findIndex((section) => {
            const start = section.startBar * barBeats;
            return beat >= start && beat < start + section.plan.bars * barBeats;
          });
          const section = song.sections[sectionIndex];
          if (!section || event.clientY - rect.top < LABEL_H) return;
          onAddNote(sectionIndex, {
            start: beat - section.startBar * barBeats,
            duration: 1,
            pitch,
            velocity: section.plan.type === "chorus" ? 100 : 90,
          });
        }}
      >
        {Array.from({ length: maxPitch - minPitch + 1 }, (_, index) => {
          const pitch = maxPitch - index;
          const black = [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
          return (
            <rect
              key={pitch}
              x={0}
              y={yOf(pitch)}
              width={width}
              height={ROW_H}
              fill={black ? "#22252e" : "#2a2e39"}
            />
          );
        })}
        {Array.from({ length: Math.ceil(totalBeats / GRID) + 1 }, (_, index) => {
          const beat = index * GRID;
          const isBar = Math.abs(beat % barBeats) < 1e-9;
          const isBeat = Math.abs(beat % 1) < 1e-9;
          return (
            <line
              key={index}
              x1={beat * PX_PER_BEAT}
              y1={LABEL_H}
              x2={beat * PX_PER_BEAT}
              y2={height}
              stroke={isBar ? "#4a4f5e" : isBeat ? "#343946" : "#2d313c"}
              strokeWidth={isBar ? 1 : 0.5}
            />
          );
        })}
        {song.sections.map((section, sectionIndex) => {
          const x = section.startBar * barBeats * PX_PER_BEAT;
          return (
            <g key={sectionIndex}>
              <line x1={x} y1={0} x2={x} y2={height} stroke="#8891a8" strokeWidth={1.5} />
              <text x={x + 4} y={15} fill="#aeb6c8" fontSize={11} fontWeight="bold">
                {SECTION_LABELS[section.plan.type] ?? section.plan.type}
              </text>
              {section.chords.map((chord, chordIndex) => {
                const selected = chordSelection?.sectionIndex === sectionIndex &&
                  chordSelection.chordIndex === chordIndex;
                return (
                  <text
                    key={chordIndex}
                    data-entity="chord"
                    x={(section.startBar * barBeats + chord.start) * PX_PER_BEAT + 44}
                    y={15}
                    fill={selected ? "#f5d76e" : "#778197"}
                    fontSize={10}
                    fontWeight={selected ? "bold" : "normal"}
                    className="roll-chord"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectChord({ sectionIndex, chordIndex });
                      onSelectNote(null);
                    }}
                  >
                    {chord.symbol}
                  </text>
                );
              })}
            </g>
          );
        })}
        {notes.map((note) => {
          const selection: NoteSelection = {
            sectionIndex: note.sectionIndex,
            part: note.part,
            noteIndex: note.noteIndex,
          };
          const selected = sameNote(noteSelection, selection);
          return (
            <rect
              key={`${note.sectionIndex}-${note.part}-${note.noteIndex}`}
              data-entity="note"
              x={note.startBeat * PX_PER_BEAT + 0.5}
              y={yOf(note.pitch) + 0.5}
              width={Math.max(3, note.duration * PX_PER_BEAT - 1)}
              height={ROW_H - 1}
              rx={2}
              fill={PART_COLORS[note.part]}
              stroke={selected ? "#fff3b0" : "none"}
              strokeWidth={selected ? 2 : 0}
              opacity={note.part === "melody" ? 1 : 0.55}
              className="roll-note"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectNote(selection);
                onSelectChord(null);
                const startX = event.clientX;
                const startY = event.clientY;
                const bounds = event.currentTarget.getBoundingClientRect();
                const resize = event.clientX >= bounds.right - 7;
                const pointerUp = (up: PointerEvent) => {
                  window.removeEventListener("pointerup", pointerUp);
                  const deltaBeat = Math.round(((up.clientX - startX) / PX_PER_BEAT) / GRID) * GRID;
                  if (resize) {
                    onEditNote(selection, { duration: Math.max(GRID, note.duration + deltaBeat) });
                  } else {
                    onEditNote(selection, {
                      start: note.localStart + deltaBeat,
                      pitch: note.pitch - Math.round((up.clientY - startY) / ROW_H),
                    });
                  }
                };
                window.addEventListener("pointerup", pointerUp);
              }}
            />
          );
        })}
        {playheadBeat !== null && (
          <line
            x1={playheadBeat * PX_PER_BEAT}
            y1={0}
            x2={playheadBeat * PX_PER_BEAT}
            y2={height}
            stroke="#f5d76e"
            strokeWidth={2}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}
