import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent, Song, SongPart } from "../engine/types.js";
import { chordDisplayName, scaleOf } from "../engine/harmony.js";
import type { ChordSelection, NotePart, NoteSelection } from "./editor.js";
import { pianoRollFollowScroll } from "./playbackViewport.js";

const LABEL_H = 32;
const VELOCITY_H = 76;

const PART_COLORS: Record<SongPart, string> = {
  melody: "#e2603a",
  guitar: "#d9a441",
  drums: "#c56fd5",
  piano: "#7d92d8",
  bass: "#3fa878",
};

const PART_LABELS: Record<SongPart, string> = {
  melody: "メロディ",
  piano: "ピアノ",
  guitar: "ギター",
  bass: "ベース",
  drums: "ドラム",
};

const PARTS = ["melody", "piano", "guitar", "bass", "drums"] as const;

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

interface FlatNote extends NoteSelection {
  startBeat: number;
  localStart: number;
  duration: number;
  pitch: number;
  velocity: number;
}

export type PianoRollCommand = "copy" | "cut" | "paste" | "duplicate" | "delete" | "quantize";

function noteKey(note: NoteSelection): string {
  return `${note.sectionIndex}:${note.part}:${note.noteIndex}`;
}

function chordKey(chord: ChordSelection): string {
  return `${chord.sectionIndex}:${chord.chordIndex}`;
}

export function EditablePianoRoll({
  song,
  playheadBeat,
  noteSelections,
  chordSelections,
  grid,
  onGridChange,
  onSelectNotes,
  onSelectChords,
  onMoveNotes,
  onResizeNotes,
  onSetVelocity,
  onEditChordTiming,
  onAddNote,
  onSeek,
  onCommand,
  onAudition,
}: {
  song: Song;
  playheadBeat: number | null;
  noteSelections: NoteSelection[];
  chordSelections: ChordSelection[];
  grid: number;
  onGridChange: (grid: number) => void;
  onSelectNotes: (selections: NoteSelection[]) => void;
  onSelectChords: (selections: ChordSelection[]) => void;
  onMoveNotes: (selections: NoteSelection[], deltaBeat: number, deltaPitch: number) => void;
  onResizeNotes: (selections: NoteSelection[], deltaDuration: number) => void;
  onSetVelocity: (selections: NoteSelection[], velocity: number, commit: boolean) => void;
  onEditChordTiming: (selection: ChordSelection, patch: { start?: number; durationBeats?: number }) => void;
  onAddNote: (sectionIndex: number, part: NotePart, note: NoteEvent) => void;
  onSeek: (beat: number) => void;
  onCommand: (command: PianoRollCommand) => void;
  onAudition: (pitch: number, velocity?: number) => void;
}) {
  const [pxPerBeat, setPxPerBeat] = useState(32);
  const [rowHeight, setRowHeight] = useState(10);
  const [visibleParts, setVisibleParts] = useState<Set<SongPart>>(() => new Set(PARTS));
  const [activePart, setActivePart] = useState<NotePart>("melody");
  const [autoScroll, setAutoScroll] = useState(true);
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const barBeats = song.meter.barBeats;
  const { notes, minPitch, maxPitch, totalBeats } = useMemo(() => {
    const flat: FlatNote[] = [];
    song.sections.forEach((section, sectionIndex) => {
      const offset = section.startBar * barBeats;
      for (const part of PARTS) {
        if (!visibleParts.has(part)) continue;
        section[part].forEach((note, noteIndex) => {
          flat.push({
            sectionIndex,
            part,
            noteIndex,
            startBeat: offset + note.start,
            localStart: note.start,
            duration: note.duration,
            pitch: note.pitch,
            velocity: note.velocity,
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
  }, [song, barBeats, visibleParts]);

  const selectedNoteKeys = useMemo(() => new Set(noteSelections.map(noteKey)), [noteSelections]);
  const selectedChordKeys = useMemo(() => new Set(chordSelections.map(chordKey)), [chordSelections]);
  const width = Math.max(720, totalBeats * pxPerBeat);
  const rollHeight = (maxPitch - minPitch + 1) * rowHeight;
  const velocityTop = LABEL_H + rollHeight + 8;
  const height = velocityTop + VELOCITY_H;
  const yOf = (pitch: number) => LABEL_H + (maxPitch - pitch) * rowHeight;
  const useFlats = song.keyName.includes("b") || song.keyName.includes("♭");

  useLayoutEffect(() => {
    if (!autoScroll || playheadBeat === null || !scrollRef.current) return;
    const x = playheadBeat * pxPerBeat;
    const element = scrollRef.current;
    const nextScrollLeft = pianoRollFollowScroll(
      x,
      element.scrollLeft,
      element.clientWidth,
      element.scrollWidth,
    );
    if (Math.abs(nextScrollLeft - element.scrollLeft) >= 0.5) {
      element.scrollLeft = nextScrollLeft;
    }
  }, [playheadBeat, autoScroll, pxPerBeat]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close, { once: true });
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, beat: 0, pitch: 60 };
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      x,
      y,
      beat: Math.max(0, Math.min(totalBeats, x / pxPerBeat)),
      pitch: Math.max(0, Math.min(127, maxPitch - Math.floor((y - LABEL_H) / rowHeight))),
    };
  };

  const togglePart = (part: SongPart) => {
    const next = new Set(visibleParts);
    next.has(part) ? next.delete(part) : next.add(part);
    setVisibleParts(next);
    onSelectNotes(noteSelections.filter((selection) => next.has(selection.part)));
  };

  return (
    <div className="roll-editor">
      <div className="roll-controls">
        <label>横ズーム<input type="range" min="14" max="80" value={pxPerBeat} onChange={(event) => setPxPerBeat(Number(event.target.value))} /></label>
        <label>縦ズーム<input type="range" min="6" max="18" value={rowHeight} onChange={(event) => setRowHeight(Number(event.target.value))} /></label>
        <label>グリッド<select value={grid} onChange={(event) => onGridChange(Number(event.target.value))}>
          <option value={1}>1/4</option><option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option><option value={1 / 3}>三連符</option>
        </select></label>
        <label>追加パート<select value={activePart} onChange={(event) => setActivePart(event.target.value as NotePart)}>
          {PARTS.map((part) => <option value={part} key={part}>{PART_LABELS[part]}</option>)}
        </select></label>
        <div className="part-filters" aria-label="表示パート">
          {PARTS.map((part) => (
            <button
              key={part}
              className={visibleParts.has(part) ? "active" : ""}
              style={{ borderColor: PART_COLORS[part] }}
              onClick={() => togglePart(part)}
            >{PART_LABELS[part]}</button>
          ))}
        </div>
        <label><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />再生位置を追従</label>
      </div>

      <div className="piano-roll-scroll" ref={scrollRef}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="application"
          aria-label="複数選択対応ピアノロール"
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onPointerDown={(event) => {
            const target = event.target as SVGElement;
            if (target.dataset.entity) return;
            const start = pointFromEvent(event);
            if (start.y < LABEL_H || start.y > velocityTop) return;
            setBox({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
            const move = (moveEvent: PointerEvent) => {
              const point = pointFromEvent(moveEvent);
              setBox({ x1: start.x, y1: start.y, x2: point.x, y2: point.y });
            };
            const up = (upEvent: PointerEvent) => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              const end = pointFromEvent(upEvent);
              const dragged = Math.abs(end.x - start.x) > 4 || Math.abs(end.y - start.y) > 4;
              if (dragged) {
                const left = Math.min(start.x, end.x);
                const right = Math.max(start.x, end.x);
                const top = Math.min(start.y, end.y);
                const bottom = Math.max(start.y, end.y);
                const hit = notes.filter((note) => {
                  const x = note.startBeat * pxPerBeat;
                  const y = yOf(note.pitch);
                  return x + note.duration * pxPerBeat >= left && x <= right &&
                    y + rowHeight >= top && y <= bottom;
                }).map(({ startBeat: _start, localStart: _local, duration: _duration, pitch: _pitch, velocity: _velocity, ...selection }) => selection);
                onSelectNotes(event.ctrlKey || event.metaKey ? [...noteSelections, ...hit] : hit);
                onSelectChords([]);
              } else {
                onSeek(Math.round(start.beat / grid) * grid);
                if (!event.ctrlKey && !event.metaKey) {
                  onSelectNotes([]);
                  onSelectChords([]);
                }
              }
              setBox(null);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onDoubleClick={(event) => {
            const target = event.target as SVGElement;
            if (target.dataset.entity) return;
            const point = pointFromEvent(event);
            if (point.y < LABEL_H || point.y > velocityTop) return;
            const beat = Math.round(point.beat / grid) * grid;
            const sectionIndex = song.sections.findIndex((section) => {
              const start = section.startBar * barBeats;
              return beat >= start && beat < start + section.plan.bars * barBeats;
            });
            const section = song.sections[sectionIndex];
            if (!section) return;
            const note = {
              start: beat - section.startBar * barBeats,
              duration: Math.max(grid, activePart === "drums" ? grid : 1),
              pitch: point.pitch,
              velocity: section.plan.type === "chorus" ? 100 : 90,
            };
            onAddNote(sectionIndex, activePart, note);
            onAudition(note.pitch, note.velocity);
          }}
        >
          <rect x={0} y={0} width={width} height={LABEL_H} fill="#1b1e27" />
          {Array.from({ length: maxPitch - minPitch + 1 }, (_, index) => {
            const pitch = maxPitch - index;
            const black = [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
            return <rect key={pitch} x={0} y={yOf(pitch)} width={width} height={rowHeight} fill={black ? "#22252e" : "#2a2e39"} />;
          })}
          {Array.from({ length: Math.ceil(totalBeats / grid) + 1 }, (_, index) => {
            const beat = index * grid;
            const isBar = Math.abs(beat % barBeats) < 1e-7;
            const isBeat = Math.abs(beat % 1) < 1e-7;
            return <line key={index} x1={beat * pxPerBeat} y1={LABEL_H} x2={beat * pxPerBeat} y2={velocityTop - 4}
              stroke={isBar ? "#4a4f5e" : isBeat ? "#343946" : "#2d313c"} strokeWidth={isBar ? 1 : 0.5} />;
          })}

          {song.sections.map((section, sectionIndex) => {
            const sectionX = section.startBar * barBeats * pxPerBeat;
            return (
              <g key={sectionIndex}>
                <line x1={sectionX} y1={0} x2={sectionX} y2={velocityTop} stroke="#8891a8" strokeWidth={1.5} />
                <text x={sectionX + 4} y={12} fill="#aeb6c8" fontSize={10} fontWeight="bold">
                  {SECTION_LABELS[section.plan.type] ?? section.plan.type}
                </text>
                {section.chords.map((chord, chordIndex) => {
                  const selection = { sectionIndex, chordIndex };
                  const selected = selectedChordKeys.has(chordKey(selection));
                  const x = (section.startBar * barBeats + chord.start) * pxPerBeat;
                  const chordWidth = Math.max(18, chord.durationBeats * pxPerBeat - 2);
                  return (
                    <g
                      key={chordIndex}
                      data-entity="chord"
                      className="roll-chord"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const additive = event.ctrlKey || event.metaKey;
                        onSelectChords(additive
                          ? selected ? chordSelections.filter((item) => chordKey(item) !== chordKey(selection)) : [...chordSelections, selection]
                          : [selection]);
                        onSelectNotes([]);
                        const startX = event.clientX;
                        const resize = event.clientX >= (event.currentTarget.getBoundingClientRect().right - 8);
                        const moveStart = event.clientX <= (event.currentTarget.getBoundingClientRect().left + 8) && chordIndex > 0;
                        const up = (upEvent: PointerEvent) => {
                          window.removeEventListener("pointerup", up);
                          const delta = Math.round(((upEvent.clientX - startX) / pxPerBeat) / grid) * grid;
                          if (resize) onEditChordTiming(selection, { durationBeats: chord.durationBeats + delta });
                          else if (moveStart) onEditChordTiming(selection, { start: chord.start + delta });
                        };
                        window.addEventListener("pointerup", up);
                      }}
                    >
                      <rect data-entity="chord" x={x + 0.5} y={15} width={chordWidth} height={15} rx={2}
                        fill={selected ? "#695d2b" : "#303644"} stroke={selected ? "#f5d76e" : "#596174"} />
                      <text data-entity="chord" x={x + 4} y={26} fill={selected ? "#fff2a8" : "#c1c8d8"} fontSize={9}>
                        {chord.symbol} · {chordDisplayName(chord, useFlats, scaleOf(section.key))}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {notes.map((note) => {
            const selection: NoteSelection = { sectionIndex: note.sectionIndex, part: note.part, noteIndex: note.noteIndex };
            const selected = selectedNoteKeys.has(noteKey(selection));
            return (
              <rect
                key={noteKey(selection)}
                data-entity="note"
                x={note.startBeat * pxPerBeat + 0.5}
                y={yOf(note.pitch) + 0.5}
                width={Math.max(3, note.duration * pxPerBeat - 1)}
                height={Math.max(3, rowHeight - 1)}
                rx={2}
                fill={PART_COLORS[note.part]}
                stroke={selected ? "#fff3b0" : "none"}
                strokeWidth={selected ? 2 : 0}
                opacity={note.part === "melody" ? 1 : 0.7}
                className="roll-note"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const additive = event.ctrlKey || event.metaKey;
                  const dragSelections = selected ? noteSelections : [selection];
                  onSelectNotes(additive
                    ? selected ? noteSelections.filter((item) => noteKey(item) !== noteKey(selection)) : [...noteSelections, selection]
                    : dragSelections);
                  onSelectChords([]);
                  const startX = event.clientX;
                  const startY = event.clientY;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const resize = event.clientX >= bounds.right - 7;
                  const up = (upEvent: PointerEvent) => {
                    window.removeEventListener("pointerup", up);
                    const deltaBeat = Math.round(((upEvent.clientX - startX) / pxPerBeat) / grid) * grid;
                    if (resize) {
                      onResizeNotes(dragSelections, deltaBeat);
                    } else {
                      const deltaPitch = -Math.round((upEvent.clientY - startY) / rowHeight);
                      onMoveNotes(dragSelections, deltaBeat, deltaPitch);
                      if (deltaPitch !== 0) onAudition(note.pitch + deltaPitch, note.velocity);
                    }
                  };
                  window.addEventListener("pointerup", up);
                }}
              />
            );
          })}

          <rect x={0} y={velocityTop} width={width} height={VELOCITY_H} fill="#181b23" />
          <text x={6} y={velocityTop + 13} fill="#9ba4b8" fontSize={10}>VELOCITY</text>
          {notes.map((note) => {
            const selection = { sectionIndex: note.sectionIndex, part: note.part, noteIndex: note.noteIndex };
            const selected = selectedNoteKeys.has(noteKey(selection));
            const barHeight = note.velocity / 127 * (VELOCITY_H - 18);
            return (
              <rect
                key={`velocity-${noteKey(selection)}`}
                data-entity="velocity"
                x={note.startBeat * pxPerBeat + 1}
                y={velocityTop + VELOCITY_H - barHeight}
                width={Math.max(3, Math.min(9, note.duration * pxPerBeat - 2))}
                height={barHeight}
                fill={PART_COLORS[note.part]}
                opacity={selected ? 1 : 0.45}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const targets = selected ? noteSelections : [selection];
                  onSelectNotes(targets);
                  const update = (pointer: { clientY: number }) => {
                    const rect = svgRef.current!.getBoundingClientRect();
                    const localY = pointer.clientY - rect.top - velocityTop;
                    const velocity = Math.max(1, Math.min(127, Math.round((1 - localY / VELOCITY_H) * 127)));
                    onSetVelocity(targets, velocity, false);
                    return velocity;
                  };
                  let latestVelocity = update(event);
                  const trackedMove = (moveEvent: PointerEvent) => { latestVelocity = update(moveEvent); };
                  const up = () => {
                    window.removeEventListener("pointermove", trackedMove);
                    window.removeEventListener("pointerup", up);
                    onSetVelocity(targets, latestVelocity, true);
                  };
                  window.addEventListener("pointermove", trackedMove);
                  window.addEventListener("pointerup", up);
                }}
              />
            );
          })}

          {box && <rect x={Math.min(box.x1, box.x2)} y={Math.min(box.y1, box.y2)}
            width={Math.abs(box.x2 - box.x1)} height={Math.abs(box.y2 - box.y1)}
            fill="rgba(104, 151, 255, .18)" stroke="#75a0ff" strokeDasharray="4 3" pointerEvents="none" />}
          {playheadBeat !== null && <line x1={playheadBeat * pxPerBeat} y1={0} x2={playheadBeat * pxPerBeat} y2={height}
            stroke="#f5d76e" strokeWidth={2} pointerEvents="none" />}
        </svg>
      </div>

      {menu && (
        <div className="roll-context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button onClick={() => onCommand("copy")}>コピー <kbd>Ctrl+C</kbd></button>
          <button onClick={() => onCommand("cut")}>切り取り <kbd>Ctrl+X</kbd></button>
          <button onClick={() => onCommand("paste")}>貼り付け <kbd>Ctrl+V</kbd></button>
          <button onClick={() => onCommand("duplicate")}>複製 <kbd>Ctrl+D</kbd></button>
          <button onClick={() => onCommand("quantize")}>クオンタイズ <kbd>Q</kbd></button>
          <button onClick={() => onCommand("delete")}>削除 <kbd>Del</kbd></button>
        </div>
      )}
    </div>
  );
}
