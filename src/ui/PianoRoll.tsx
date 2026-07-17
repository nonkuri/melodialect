import { useMemo } from "react";
import type { Song } from "../engine/types.js";
import { BEATS_PER_BAR } from "../engine/types.js";

const PX_PER_BEAT = 26;
const ROW_H = 7;
const LABEL_H = 22;

const PART_COLORS: Record<string, string> = {
  melody: "#e2603a",
  piano: "#7d92d8",
  bass: "#3fa878",
};

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

interface FlatNote {
  startBeat: number;
  duration: number;
  pitch: number;
  part: "melody" | "piano" | "bass";
}

/** メロディ+伴奏をトラック色分けで表示するピアノロール (§4.4)。 */
export function PianoRoll({ song, playheadBeat }: { song: Song; playheadBeat: number | null }) {
  const { notes, minPitch, maxPitch, totalBeats } = useMemo(() => {
    const flat: FlatNote[] = [];
    for (const section of song.sections) {
      const offset = section.startBar * BEATS_PER_BAR;
      for (const [part, list] of [
        ["melody", section.melody],
        ["piano", section.piano],
        ["bass", section.bass],
      ] as const) {
        for (const n of list) {
          flat.push({ startBeat: offset + n.start, duration: n.duration, pitch: n.pitch, part });
        }
      }
    }
    const pitches = flat.map((n) => n.pitch);
    return {
      notes: flat,
      minPitch: Math.min(...pitches) - 2,
      maxPitch: Math.max(...pitches) + 2,
      totalBeats: song.totalBars * BEATS_PER_BAR,
    };
  }, [song]);

  const width = totalBeats * PX_PER_BEAT;
  const rollH = (maxPitch - minPitch + 1) * ROW_H;
  const height = LABEL_H + rollH;
  const yOf = (pitch: number) => LABEL_H + (maxPitch - pitch) * ROW_H;

  return (
    <div className="piano-roll-scroll">
      <svg width={width} height={height} role="img" aria-label="ピアノロール">
        {/* 白鍵/黒鍵の背景 */}
        {Array.from({ length: maxPitch - minPitch + 1 }, (_, i) => {
          const pitch = maxPitch - i;
          const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
          return (
            <rect
              key={pitch}
              x={0}
              y={yOf(pitch)}
              width={width}
              height={ROW_H}
              fill={isBlack ? "#22252e" : "#2a2e39"}
            />
          );
        })}
        {/* 小節線 */}
        {Array.from({ length: song.totalBars + 1 }, (_, bar) => (
          <line
            key={bar}
            x1={bar * BEATS_PER_BAR * PX_PER_BEAT}
            y1={LABEL_H}
            x2={bar * BEATS_PER_BAR * PX_PER_BEAT}
            y2={height}
            stroke={bar % 4 === 0 ? "#4a4f5e" : "#363b48"}
            strokeWidth={1}
          />
        ))}
        {/* セクション境界とラベル・コードネーム */}
        {song.sections.map((section, i) => {
          const x = section.startBar * BEATS_PER_BAR * PX_PER_BEAT;
          return (
            <g key={i}>
              <line x1={x} y1={0} x2={x} y2={height} stroke="#8891a8" strokeWidth={1.5} />
              <text x={x + 4} y={14} fill="#aeb6c8" fontSize={11} fontWeight="bold">
                {SECTION_LABELS[section.plan.type] ?? section.plan.type}
              </text>
              {section.chords.map((chord) => (
                <text
                  key={chord.bar}
                  x={(section.startBar + chord.bar) * BEATS_PER_BAR * PX_PER_BEAT + 46}
                  y={14}
                  fill="#6d7688"
                  fontSize={10}
                >
                  {chord.symbol}
                </text>
              ))}
            </g>
          );
        })}
        {/* ノート */}
        {notes.map((n, i) => (
          <rect
            key={i}
            x={n.startBeat * PX_PER_BEAT + 0.5}
            y={yOf(n.pitch) + 0.5}
            width={n.duration * PX_PER_BEAT - 1.5}
            height={ROW_H - 1}
            rx={2}
            fill={PART_COLORS[n.part]}
            opacity={n.part === "melody" ? 1 : 0.55}
          />
        ))}
        {/* 再生ヘッド */}
        {playheadBeat !== null && (
          <line
            x1={playheadBeat * PX_PER_BEAT}
            y1={0}
            x2={playheadBeat * PX_PER_BEAT}
            y2={height}
            stroke="#f5d76e"
            strokeWidth={2}
          />
        )}
      </svg>
    </div>
  );
}
