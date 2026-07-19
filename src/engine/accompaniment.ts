import type {
  Annotation,
  ArrangementSettings,
  ChordEvent,
  Dialect,
  GrooveProfile,
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
  const scalePcs = scaleOf(key, dialect.melody.pitchCollection);
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

  const config = normalizeArrangement({ ...dialect.defaults.arrangement, ...arrangement });
  if (config.pianoPattern !== "block") {
    piano.splice(0, piano.length, ...generatePianoPattern(chords, config.pianoPattern));
  }
  guitar.push(...generateGuitar(chords, config.guitarPattern));
  drums.push(...generateDrums(plan.bars, meter, config.drumPattern));
  const sectionBeats = plan.bars * meter.barBeats;
  if (dialect.groove?.accentPattern.length) {
    bass.splice(0, bass.length, ...generateGrooveBass(chords, meter, dialect.groove, sectionBeats));
    annotations.push({
      bar: 0,
      ruleId: "groove-profile",
      text: `グルーヴ: 小節内 ${dialect.groove.accentPattern.join("-")} 拍を強調${
        dialect.groove.anticipation ? `、コードを ${dialect.groove.anticipation} 拍先取り` : ""
      }`,
    });
  }
  for (const notes of [piano, bass, guitar, drums]) {
    applyGroove(notes, config, rng, sectionBeats, meter, dialect.groove);
  }
  return { piano, bass, guitar, drums, annotations };
}


function generatePianoPattern(
  chords: ChordEvent[],
  pattern: ArrangementSettings["pianoPattern"],
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  let previousVoicing: number[] | undefined;
  for (const chord of chords) {
    if (pattern === "voice-led") {
      const voicing = voiceLead(chord.pitches, previousVoicing);
      previousVoicing = voicing;
      voicing.forEach((pitch, index) => notes.push({
        start: chord.start + index * 0.025,
        duration: Math.max(0.2, chord.durationBeats - index * 0.025),
        pitch,
        velocity: index === 0 ? 72 : 65,
      }));
    } else if (pattern === "arpeggio") {
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
    } else if (pattern === "syncopated") {
      for (let offset = 0.5; offset < chord.durationBeats - 1e-9; offset += 1) {
        for (const pitch of chord.pitches) {
          notes.push({
            start: chord.start + offset,
            duration: Math.min(0.62, chord.durationBeats - offset),
            pitch,
            velocity: offset % 2 < 1 ? 74 : 66,
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

function voiceLead(pitches: number[], previous?: number[]): number[] {
  if (!previous?.length) return [...pitches];
  return pitches.map((pitch, index) => {
    const target = previous[Math.min(index, previous.length - 1)]!;
    const candidates = [pitch - 12, pitch, pitch + 12];
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best);
  }).sort((a, b) => a - b);
}

function generateGuitar(
  chords: ChordEvent[],
  pattern: ArrangementSettings["guitarPattern"],
): NoteEvent[] {
  if (pattern === "off") return [];
  const notes: NoteEvent[] = [];
  for (const chord of chords) {
    const pitches = chord.pitches.map((pitch) => pitch + 12);
    if (pattern === "interlocking") {
      const pulses = [0, 0.75, 1.5, 2.5, 3.25];
      for (let barStart = 0; barStart < chord.durationBeats - 1e-9; barStart += 4) {
        pulses.forEach((pulse, index) => {
          const offset = barStart + pulse;
          if (offset >= chord.durationBeats - 1e-9) return;
          notes.push({
            start: chord.start + offset,
            duration: Math.min(0.34, chord.durationBeats - offset),
            pitch: pitches[index % pitches.length]!,
            velocity: index === 0 || index === 2 ? 75 : 65,
          });
        });
      }
      continue;
    }
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
    if (pattern === "shuffle") {
      for (let beat = 0; beat < bb; beat++) {
        hit(start + beat, 42, beat % 2 === 0 ? 74 : 64);
        if (beat + 2 / 3 < bb) hit(start + beat + 2 / 3, 42, 56);
      }
      hit(start, 36, 98);
      if (bb >= 4) {
        hit(start + 1, 38, 88);
        hit(start + 2, 36, 82);
        hit(start + 3, 38, 92);
      }
      continue;
    }
    if (pattern === "interlock") {
      for (let t = 0; t < bb; t += 0.5) hit(start + t, 42, t % 1 === 0 ? 68 : 58);
      for (const t of [0, 1.5, 3]) if (t < bb) hit(start + t, 36, t === 0 ? 98 : 84);
      for (const t of [1, 2.5]) if (t < bb) hit(start + t, 37, 82);
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
  meter: Meter,
  groove?: GrooveProfile,
): void {
  for (const note of notes) {
    const originalBar = Math.floor((note.start + 1e-9) / meter.barBeats);
    const barStart = originalBar * meter.barBeats;
    const barEnd = Math.min(sectionBeats, barStart + meter.barBeats);
    const eighth = Math.round(note.start * 2);
    const swingDelay = eighth % 2 === 1 ? config.swing * 0.16 : 0;
    const jitter = config.humanize > 0 ? (rng.next() * 2 - 1) * config.humanize * 0.035 : 0;
    note.start = Math.max(barStart, Math.min(barEnd - 0.02, note.start + swingDelay + jitter));
    note.duration = Math.max(0.03, Math.min(note.duration, barEnd - note.start));
    const velocityJitter = config.humanize > 0
      ? Math.round((rng.next() * 2 - 1) * config.humanize * 10)
      : 0;
    note.velocity = Math.max(
      1,
      Math.min(
        127,
        Math.round(note.velocity * config.velocityScale) + velocityJitter +
          (groove?.accentPattern.some((accent) =>
            Math.abs((((note.start % meter.barBeats) + meter.barBeats) % meter.barBeats) - accent) < 0.04)
            ? 8 : groove ? -2 : 0),
      ),
    );
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function generateGrooveBass(
  chords: ChordEvent[],
  meter: Meter,
  groove: GrooveProfile,
  sectionBeats: number,
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const bb = meter.barBeats;
  for (const chord of chords) {
    const end = Math.min(sectionBeats, chord.start + chord.durationBeats);
    const starts = new Set<number>([chord.start]);
    const firstBar = Math.floor(chord.start / bb);
    const lastBar = Math.floor(Math.max(chord.start, end - 1e-9) / bb);
    for (let bar = firstBar; bar <= lastBar; bar++) {
      for (const accent of groove.accentPattern) {
        const start = bar * bb + accent;
        if (start >= chord.start - 1e-9 && start < end - 1e-9) starts.add(start);
      }
    }
    [...starts].sort((a, b) => a - b).forEach((start, index) => {
      notes.push({
        start,
        duration: Math.min(Math.max(0.12, groove.subdivision * 0.85), end - start),
        pitch: chord.bassPitch,
        velocity: index === 0 ? 90 : 82,
      });
    });
  }
  const anticipation = Math.max(0, groove.anticipation ?? 0);
  if (anticipation > 0) {
    for (let i = 1; i < chords.length; i++) {
      const boundary = chords[i]!.start;
      const target = notes.find((note) =>
        note.pitch === chords[i]!.bassPitch && Math.abs(note.start - boundary) < 1e-9);
      if (target) {
        notes.push({
          ...target,
          start: Math.max(0, boundary - anticipation),
          duration: Math.min(anticipation, target.duration),
          velocity: Math.max(1, target.velocity - 7),
        });
      }
    }
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
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
