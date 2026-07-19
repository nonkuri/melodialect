import type {
  Annotation,
  ArrangementSettings,
  ChordEvent,
  Dialect,
  KeySignature,
  NoteEvent,
  SectionPlan,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";
import { scaleOf } from "./harmony.js";

import { normalizeArrangement } from "./controls.js";
export interface AccompanimentResult {
  piano: NoteEvent[];
  bass: NoteEvent[];
  annotations: Annotation[];
  guitar: NoteEvent[];
  drums: NoteEvent[];
}

/**
 * 伴奏生成 (§4.2 手順 4)。ピアノ (ブロックコード) とベース (ルート+経過音)。
 * ハーモニックリズム対応: コードイベントの start/durationBeats に従って
 * セグメント単位でパターンを敷く。拍子ごとにパターンを変える:
 * 4/4 = 2 分刻み、3/4 = ワルツ (ベース+後拍和音)、6/8 = 付点 4 分の 2 拍子。
 */
export function generateAccompaniment(
  plan: SectionPlan,
  chords: ChordEvent[],
  dialect: Dialect,
  key: KeySignature,
  meter: Meter,
  rng: Rng,
  arrangement?: ArrangementSettings,
): AccompanimentResult {
  const piano: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  const annotations: Annotation[] = [];
  const scalePcs = scaleOf(key);
  const melodicBass = dialect.melody.contour === "stepwise"; // Chromatic: メロディックベース (§4.1 D2)
  const guitar: NoteEvent[] = [];
  const drums: NoteEvent[] = [];
  let annotated = false;

  chords.forEach((chord, ci) => {
    const next = chords[ci + 1];
    const target = next ? next.bassPitch : chord.bassPitch;
    const seg = chord.durationBeats;
    const wantsPassing = melodicBass && next && target !== chord.bassPitch && seg >= 2;

    if (wantsPassing && !annotated) {
      annotations.push({
        bar: chord.bar,
        ruleId: "melodic-bass",
        text: "ベースに経過音を挿入 (メロディックベース)",
      });
      annotated = true;
    }

    if (meter.name === "3/4") {
      // 小節に揃ったセグメントはワルツ、半端なセグメントはブロックコード
      if (chord.start % 3 === 0 && seg % 3 === 0) {
        const barsInSeg = seg / 3;
        for (let b = 0; b < barsInSeg; b++) {
          const barStart = chord.start + b * 3;
          const isLastBarOfSeg = b === barsInSeg - 1;
          for (const beat of [1, 2]) {
            for (const pitch of chord.pitches) {
              piano.push({ start: barStart + beat, duration: 1, pitch, velocity: 68 });
            }
          }
          if (wantsPassing && isLastBarOfSeg) {
            bass.push({ start: barStart, duration: 2, pitch: chord.bassPitch, velocity: 88 });
            bass.push({
              start: barStart + 2, duration: 1,
              pitch: passingTone(chord.bassPitch, target, scalePcs), velocity: 80,
            });
          } else {
            bass.push({ start: barStart, duration: 3, pitch: chord.bassPitch, velocity: 88 });
          }
        }
      } else {
        for (const pitch of chord.pitches) {
          piano.push({ start: chord.start, duration: seg, pitch, velocity: 68 });
        }
        bass.push({ start: chord.start, duration: seg, pitch: chord.bassPitch, velocity: 88 });
      }
    } else if (meter.name === "6/8") {
      // 複合 2 拍子: 付点 4 分 (1.5 beats) ごとに和音とベース
      for (let t = 0; t < seg - 1e-9; t += 1.5) {
        const dur = Math.min(1.5, seg - t);
        for (const pitch of chord.pitches) {
          piano.push({ start: chord.start + t, duration: dur, pitch, velocity: 70 });
        }
        const isLastPulse = t + 1.5 >= seg - 1e-9;
        bass.push({
          start: chord.start + t, duration: dur,
          pitch: wantsPassing && isLastPulse
            ? passingTone(chord.bassPitch, target, scalePcs)
            : chord.bassPitch,
          velocity: t === 0 ? 88 : 82,
        });
      }
    } else {
      // 4/4: ブロックコードを 2 分音符刻みで敷く
      for (let t = 0; t < seg - 1e-9; t += 2) {
        const dur = Math.min(2, seg - t);
        for (const pitch of chord.pitches) {
          piano.push({ start: chord.start + t, duration: dur, pitch, velocity: 72 });
        }
      }
      if (wantsPassing) {
        // セグメント末尾 1 拍に次のコードへの経過音 (対旋律的な動き)
        for (let t = 0; t < seg - 2 - 1e-9; t += 2) {
          bass.push({ start: chord.start + t, duration: 2, pitch: chord.bassPitch, velocity: t === 0 ? 88 : 84 });
        }
        const tailStart = chord.start + seg - 2;
        bass.push({ start: tailStart, duration: 1, pitch: chord.bassPitch, velocity: 84 });
        bass.push({
          start: tailStart + 1, duration: 1,
          pitch: passingTone(chord.bassPitch, target, scalePcs), velocity: 80,
        });
      } else {
        for (let t = 0; t < seg - 1e-9; t += 2) {
          const dur = Math.min(2, seg - t);
          bass.push({ start: chord.start + t, duration: dur, pitch: chord.bassPitch, velocity: t === 0 ? 88 : 84 });
        }
      }
    }
  });

  const config = normalizeArrangement(arrangement);
  if (config.pianoPattern !== "block") {
    piano.splice(0, piano.length, ...generatePianoPattern(chords, config.pianoPattern));
  }
  guitar.push(...generateGuitar(chords, config.guitarPattern));
  drums.push(...generateDrums(plan.bars, meter, config.drumPattern));
  const sectionBeats = plan.bars * meter.barBeats;
  for (const notes of [piano, bass, guitar, drums]) {
    applyGroove(notes, config, rng, sectionBeats);
  }
  return { piano, bass, guitar, drums, annotations };
}


function generatePianoPattern(
  chords: ChordEvent[],
  pattern: ArrangementSettings["pianoPattern"],
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (const chord of chords) {
    if (pattern === "arpeggio") {
      for (let offset = 0, index = 0; offset < chord.durationBeats - 1e-9; offset += 0.5, index++) {
        notes.push({
          start: chord.start + offset,
          duration: Math.min(0.48, chord.durationBeats - offset),
          pitch: chord.pitches[index % chord.pitches.length]!,
          velocity: index % chord.pitches.length === 0 ? 76 : 68,
        });
      }
    } else if (pattern === "eighth") {
      for (let offset = 0; offset < chord.durationBeats - 1e-9; offset += 0.5) {
        for (const pitch of chord.pitches) {
          notes.push({
            start: chord.start + offset,
            duration: Math.min(0.42, chord.durationBeats - offset),
            pitch,
            velocity: offset % 1 === 0 ? 72 : 64,
          });
        }
      }
    } else {
      for (let offset = 0; offset < chord.durationBeats - 1e-9; offset += 2) {
        const duration = Math.min(2, chord.durationBeats - offset);
        const order = offset % 4 === 0 ? chord.pitches : [...chord.pitches].reverse();
        order.forEach((pitch, index) => {
          notes.push({
            start: chord.start + offset + index * 0.03,
            duration: Math.max(0.25, duration - index * 0.03),
            pitch,
            velocity: index === 0 ? 73 : 66,
          });
        });
      }
    }
  }
  return notes;
}

function generateGuitar(
  chords: ChordEvent[],
  pattern: ArrangementSettings["guitarPattern"],
): NoteEvent[] {
  if (pattern === "off") return [];
  const notes: NoteEvent[] = [];
  for (const chord of chords) {
    const pitches = chord.pitches.map((pitch) => pitch + 12);
    if (pattern === "arpeggio") {
      for (let offset = 0, index = 0; offset < chord.durationBeats - 1e-9; offset += 0.5, index++) {
        notes.push({
          start: chord.start + offset,
          duration: Math.min(0.45, chord.durationBeats - offset),
          pitch: pitches[index % pitches.length]!,
          velocity: 67,
        });
      }
      continue;
    }
    const pulse = pattern === "syncopated" ? 1 : 2;
    const firstOffset = pattern === "syncopated" ? 0.5 : 0;
    for (let offset = firstOffset; offset < chord.durationBeats - 1e-9; offset += pulse) {
      pitches.forEach((pitch, index) => {
        notes.push({
          start: chord.start + offset + index * 0.018,
          duration: Math.min(pattern === "syncopated" ? 0.7 : 1.4, chord.durationBeats - offset),
          pitch,
          velocity: offset === firstOffset ? 73 : 66,
        });
      });
    }
  }
  return notes;
}

function generateDrums(
  bars: number,
  meter: Meter,
  pattern: ArrangementSettings["drumPattern"],
): NoteEvent[] {
  if (pattern === "off") return [];
  const notes: NoteEvent[] = [];
  const bb = meter.barBeats;
  const hit = (start: number, pitch: number, velocity: number) =>
    notes.push({ start, duration: 0.12, pitch, velocity });
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * bb;
    if (meter.name === "6/8") {
      for (let t = 0; t < bb; t += 0.5) hit(start + t, 42, t === 0 ? 78 : 62);
      hit(start, 36, 96);
      hit(start + 1.5, 38, 88);
      continue;
    }
    const hatStep = pattern === "bossa" ? 1 : 0.5;
    for (let t = 0; t < bb; t += hatStep) hit(start + t, 42, t % 1 === 0 ? 70 : 58);
    hit(start, 36, 98);
    if (bb >= 3) hit(start + 2, pattern === "bossa" ? 37 : 38, 88);
    if (pattern === "rock" && bb >= 4) {
      hit(start + 1, 38, 86);
      hit(start + 3, 38, 92);
      hit(start + 2.5, 36, 82);
    } else if (pattern === "bossa" && bb >= 4) {
      hit(start + 1.5, 36, 76);
      hit(start + 3, 37, 78);
    }
  }
  return notes;
}

function applyGroove(
  notes: NoteEvent[],
  config: ArrangementSettings,
  rng: Rng,
  sectionBeats: number,
): void {
  for (const note of notes) {
    const eighth = Math.round(note.start * 2);
    const swingDelay = eighth % 2 === 1 ? config.swing * 0.16 : 0;
    const jitter = config.humanize > 0 ? (rng.next() * 2 - 1) * config.humanize * 0.035 : 0;
    note.start = Math.max(0, Math.min(sectionBeats - 0.02, note.start + swingDelay + jitter));
    note.duration = Math.max(0.03, Math.min(note.duration, sectionBeats - note.start));
    const velocityJitter = config.humanize > 0
      ? Math.round((rng.next() * 2 - 1) * config.humanize * 10)
      : 0;
    note.velocity = Math.max(
      1,
      Math.min(127, Math.round(note.velocity * config.velocityScale) + velocityJitter),
    );
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
/** from と to の間の経過音。半音差 2 なら半音階、それ以外はスケール上の中間音 */
function passingTone(from: number, to: number, scalePcs: number[]): number {
  const dir = to > from ? 1 : -1;
  const dist = Math.abs(to - from);
  if (dist === 2) return from + dir; // 半音階経過音
  if (dist <= 1) return from;
  // スケール上で to に向かって 1 歩手前の音
  for (let p = to - dir; p !== from; p -= dir) {
    if (scalePcs.includes(((p % 12) + 12) % 12)) return p;
  }
  return from + dir;
}
