import type {
  Annotation,
  ArrangementSectionPlan,
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
import { createNamedRng } from "./rng.js";
import { chordAtBeat, pcToPitch, scaleOf } from "./harmony.js";

import { normalizeArrangement } from "./controls.js";
import { generateBassLine } from "./bass.js";
import {
  applyArrangementSectionPlan,
  settingsForArrangementPlan,
} from "./arrangement.js";
import { effectiveWindow, registerPlanFor } from "./register.js";
import { guideTones, upperVoices, voiceChord } from "./voicing.js";
export interface AccompanimentResult {
  piano: NoteEvent[];
  bass: NoteEvent[];
  annotations: Annotation[];
  guitar: NoteEvent[];
  drums: NoteEvent[];
}

export interface AccompanimentGenerationContext {
  seed: number;
  sectionIndex: number;
  candidateIndex: number;
  melody?: NoteEvent[];
  arrangementSection?: ArrangementSectionPlan;
}

/**
 * 1 パート分のボイシング担当。窓と直前のボイシングを閉じ込め、
 * 全パターンが同じ規則で転回形を選ぶようにする。
 * previous はセクション内でのみ連結し、跨がない。セクション単位の部分再生成で
 * 全体生成と違う声部配置になるのを防ぐため
 */
export interface Voicer {
  (chord: ChordEvent, tones?: number[], cadential?: boolean): number[];
  relaxed: boolean;
}

/** 和音が鳴っている間に重なる旋律のピッチ。転回形の衝突回避に使う */
function melodyDuring(melody: NoteEvent[] | undefined, chord: ChordEvent): number[] {
  if (!melody?.length) return [];
  const end = chord.start + chord.durationBeats;
  const pitches = new Set<number>();
  for (const note of melody) {
    if (note.start >= end - 1e-9 || note.start + note.duration <= chord.start + 1e-9) continue;
    pitches.add(note.pitch);
  }
  return [...pitches];
}

export function createVoicer(
  window: [number, number],
  lowIntervalLimit: number,
  melody?: NoteEvent[],
): Voicer {
  let previous: number[] | undefined;
  const voicer = ((chord, tones, cadential) => {
    const result = voiceChord({
      chord, tones, window, previous, lowIntervalLimit, cadential,
      avoid: melodyDuring(melody, chord),
    });
    previous = result.pitches.length ? result.pitches : previous;
    if (result.relaxed) voicer.relaxed = true;
    return result.pitches;
  }) as Voicer;
  voicer.relaxed = false;
  return voicer;
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
  context?: AccompanimentGenerationContext,
): AccompanimentResult {
  const piano: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  const annotations: Annotation[] = [];
  const scalePcs = scaleOf(key, dialect.melody.pitchCollection);
  const register = registerPlanFor(dialect);
  const pianoWindow = effectiveWindow(register, "piano", context?.melody);
  const guitarWindow = effectiveWindow(register, "guitar", context?.melody);
  const pianoVoicer = createVoicer(pianoWindow.window, register.lowIntervalLimit, context?.melody);
  const guitarVoicer = createVoicer(guitarWindow.window, register.lowIntervalLimit, context?.melody);
  const lastChordStart = chords.at(-1)?.start ?? -1;
  // 旧ユーザーダイアレクトとの互換用。内蔵ダイアレクトは groove.bassPattern で
  // 旋律とベースの役割を独立に指定する。
  const melodicBass = dialect.melody.contour === "stepwise" && !dialect.groove?.bassPattern;
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

    const voiced = pianoVoicer(chord, undefined, chord.start === lastChordStart);

    if (meter.name === "3/4") {
      // 小節に揃ったセグメントはワルツ、半端なセグメントはブロックコード
      if (chord.start % 3 === 0 && seg % 3 === 0) {
        const barsInSeg = seg / 3;
        for (let b = 0; b < barsInSeg; b++) {
          const barStart = chord.start + b * 3;
          const isLastBarOfSeg = b === barsInSeg - 1;
          for (const beat of [1, 2]) {
            for (const pitch of voiced) {
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
        for (const pitch of voiced) {
          piano.push({ start: chord.start, duration: seg, pitch, velocity: 68 });
        }
        bass.push({ start: chord.start, duration: seg, pitch: chord.bassPitch, velocity: 88 });
      }
    } else if (meter.name === "6/8") {
      // 複合 2 拍子: 付点 4 分 (1.5 beats) ごとに和音とベース
      for (let t = 0; t < seg - 1e-9; t += 1.5) {
        const dur = Math.min(1.5, seg - t);
        for (const pitch of voiced) {
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
        for (const pitch of voiced) {
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

  const baseConfig = normalizeArrangement({ ...dialect.defaults.arrangement, ...arrangement });
  const config = settingsForArrangementPlan(baseConfig, context?.arrangementSection);
  if (config.pianoPattern !== "block") {
    // ブロック以外は自前でボイシングし直すので、直前の連結状態を持ち越さない
    const patternVoicer = createVoicer(pianoWindow.window, register.lowIntervalLimit, context?.melody);
    piano.splice(0, piano.length,
      ...generatePianoPattern(chords, config.pianoPattern, meter, patternVoicer, lastChordStart));
    if (patternVoicer.relaxed) pianoVoicer.relaxed = true;
  }
  if (config.pianoPattern === "voice-led") {
    const hasNinthChord = chords.some((chord) => chord.pitches.length >= 5);
    annotations.push({
      bar: 0,
      ruleId: "close-voice-leading",
      text: hasNinthChord
        ? "声部連結ピアノ: 9th和音は5度を省いた4声とし、転回形全体の移動量を最小化"
        : "声部連結ピアノ: 転回形全体を比較し、上声の移動量を最小化",
    });
  }
  guitar.push(...generateGuitar(chords, config.guitarPattern, meter, guitarVoicer, lastChordStart));

  // 音域配分は結果から注記する。窓を下げた／広げたことを黙らせない
  for (const [label, instrument, result, voicer] of [
    ["ピアノ", "piano", pianoWindow, pianoVoicer],
    ["ギター", "guitar", guitarWindow, guitarVoicer],
  ] as const) {
    const active = instrument === "piano" ? piano.length : guitar.length;
    if (!active) continue;
    const detail = [
      result.loweredBy > 0
        ? `旋律の最低音を避けて窓を ${result.loweredBy} 半音下げた`
        : "ダイアレクト宣言どおりの窓を使用",
      result.clearanceReduced ? "音域下限に達したため旋律との間隔を削った" : "",
      voicer.relaxed ? "和音が窓に収まらず制約を緩めた" : "",
    ].filter(Boolean).join("、");
    annotations.push({
      bar: 0,
      ruleId: "register-allocation",
      text: `${label}の音域 ${result.window[0]}〜${result.window[1]}: ${detail}`,
      level: "section",
      category: "arrangement",
    });
  }
  drums.push(...generateDrums(plan.bars, meter, config.drumPattern));
  const sectionBeats = plan.bars * meter.barBeats;
  const namedRng = (name: string) => context
    ? createNamedRng(context.seed, name, context.sectionIndex, context.candidateIndex)
    : rng;
  if (dialect.groove?.accentPattern.length) {
    const bassPattern = dialect.groove.bassPattern;
    const grooveBass = bassPattern === "bossa" && meter.name === "4/4"
      ? generateBossaBass(chords, sectionBeats)
      : bassPattern === "melodic"
        ? generateMelodicBass(chords, meter, scalePcs, sectionBeats)
        : bassPattern === "drone"
          ? generateDroneBass(key, meter, sectionBeats)
          : generateGrooveBass(chords, meter, dialect.groove, sectionBeats);
    bass.splice(0, bass.length, ...grooveBass);
    annotations.push({
      bar: 0,
      ruleId: bassPattern === "bossa" ? "bossa-groove"
        : bassPattern === "melodic" ? "melodic-bass"
        : bassPattern === "drone" ? "drone-bass"
        : "groove-profile",
      text: bassPattern === "bossa"
        ? "ボサ・グルーヴ: ルートと5度の低音に次のコードの8分先取りを重ねる"
        : bassPattern === "melodic"
          ? "メロディックベース: コードトーンを結び、次のルートへ半音または順次進行で接近"
          : bassPattern === "drone"
            ? "ドローンベース: 調のルートと5度を保ち、上声のコード変化を前景化"
        : `グルーヴ: 小節内 ${dialect.groove.accentPattern.join("-")} 拍を強調${
          dialect.groove.anticipation ? `、コードを ${dialect.groove.anticipation} 拍先取り` : ""
        }`,
    });
  }
  const plannedBass = generateBassLine({
    plan,
    chords,
    melody: context?.melody,
    drums,
    dialect,
    key,
    meter,
    rng: namedRng("bass"),
    legacy: [...bass],
    candidateIndex: context?.candidateIndex ?? 0,
  });
  bass.splice(0, bass.length, ...plannedBass.notes);
  annotations.push(...plannedBass.annotations);
  const arranged = applyArrangementSectionPlan(
    { piano, guitar, drums, melody: context?.melody },
    context?.arrangementSection,
    meter,
    plan.bars,
    {
      piano: namedRng("piano"),
      guitar: namedRng("guitar"),
      drums: namedRng("drums"),
    },
    // 手で組んだ伴奏型だけは間引き・音域変更から守る。候補 0 かどうかは条件にしない
    config.pianoPattern === "bossa" || config.pianoPattern === "voice-led" ||
      config.guitarPattern === "bossa",
  );
  piano.splice(0, piano.length, ...arranged.piano);
  guitar.splice(0, guitar.length, ...arranged.guitar);
  drums.splice(0, drums.length, ...arranged.drums);
  annotations.push(...arranged.annotations);
  const chordStarts = chords.map((chord) => chord.start);
  applyGroove(piano, config, namedRng("humanize-piano"), sectionBeats, meter, dialect.groove, chordStarts);
  applyGroove(bass, config, namedRng("humanize-bass"), sectionBeats, meter, dialect.groove, chordStarts);
  applyGroove(guitar, config, namedRng("humanize-guitar"), sectionBeats, meter, dialect.groove, chordStarts);
  applyGroove(drums, config, namedRng("humanize-drums"), sectionBeats, meter, dialect.groove);
  return { piano, bass, guitar, drums, annotations };
}


function generatePianoPattern(
  chords: ChordEvent[],
  pattern: ArrangementSettings["pianoPattern"],
  meter: Meter,
  voicer: Voicer,
  lastChordStart: number,
): NoteEvent[] {
  if (pattern === "off") return [];
  if (pattern === "bossa") return generateBossaPiano(chords, meter, voicer);
  const notes: NoteEvent[] = [];
  for (const chord of chords) {
    const cadential = chord.start === lastChordStart;
    // 9th 和音はベースと響きが重くなりやすい 5 度を省き、
    // root / 3rd / 7th / 9th の 4 声を声部連結する。
    const voicing = voicer(chord, pattern === "voice-led" ? upperVoices(chord) : undefined, cadential);
    if (!voicing.length) continue;
    if (pattern === "voice-led") {
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
          pitch: voicing[index % voicing.length]!,
          velocity: index % voicing.length === 0 ? 76 : 68,
        });
      }
    } else if (pattern === "eighth") {
      for (let offset = 0; offset < chord.durationBeats - 1e-9; offset += 0.5) {
        for (const pitch of voicing) {
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
        for (const pitch of voicing) {
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
        const order = offset % 4 === 0 ? voicing : [...voicing].reverse();
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

/**
 * コーダ (§4.2) など、和音を 1 小節保持するだけの箇所で使う。
 * ここが独自にボイシングを組むと、パターン側の音域配分と食い違ったまま
 * 最後の 1 小節だけ跳ね上がる。song.ts はこの関数を経由すること。
 */
export function renderSustainedChord(
  chord: ChordEvent,
  options: {
    dialect: Dialect;
    arrangement: ArrangementSettings;
    melody?: NoteEvent[];
    start: number;
    durationBeats: number;
  },
): { piano: NoteEvent[]; guitar: NoteEvent[]; bass: NoteEvent[] } {
  const register = registerPlanFor(options.dialect);
  const piano: NoteEvent[] = [];
  const guitar: NoteEvent[] = [];
  const { start, durationBeats } = options;
  if (options.arrangement.pianoPattern !== "off") {
    const window = effectiveWindow(register, "piano", options.melody).window;
    const tones = options.arrangement.pianoPattern === "bossa"
      ? guideTones(chord)
      : options.arrangement.pianoPattern === "voice-led" ? upperVoices(chord) : chord.pitches;
    for (const pitch of createVoicer(window, register.lowIntervalLimit, options.melody)(chord, tones, true)) {
      piano.push({ start, duration: durationBeats, pitch, velocity: 64 });
    }
  }
  if (options.arrangement.guitarPattern !== "off") {
    const window = effectiveWindow(register, "guitar", options.melody).window;
    const tones = options.arrangement.guitarPattern === "bossa" ? guideTones(chord) : chord.pitches;
    createVoicer(window, register.lowIntervalLimit, options.melody)(chord, tones, true)
      .forEach((pitch, index) => guitar.push({
        start: start + index * 0.014,
        duration: Math.max(0.1, durationBeats - index * 0.014),
        pitch,
        velocity: 62 - Math.min(index, 3),
      }));
  }
  return {
    piano,
    guitar,
    bass: [{ start, duration: durationBeats, pitch: chord.bassPitch, velocity: 78 }],
  };
}

/**
 * ギターの刻みを埋め尽くさない、疎なボサノヴァ・ピアノ型。
 * ルートをベースへ任せ、3rd/7th/9th を中心に2小節で声部連結する。
 */
function generateBossaPiano(chords: ChordEvent[], meter: Meter, voicer: Voicer): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const sectionBeats = chords.at(-1)!.start + chords.at(-1)!.durationBeats;
  const bb = meter.barBeats;

  for (let bar = 0; bar * bb < sectionBeats - 1e-9; bar++) {
    const barStart = bar * bb;
    const pulses = meter.name === "4/4"
      ? bar % 2 === 0 ? [0, 1.5, 3] : [0.5, 2, 3.5]
      : [0, Math.max(0.5, bb / 2)].filter((pulse) => pulse < bb);
    for (const pulse of pulses) {
      const start = barStart + pulse;
      if (start >= sectionBeats - 1e-9) continue;
      const chord = chordAtBeat(chords, start);
      const voicing = voicer(chord, guideTones(chord));
      const chordEnd = chord.start + chord.durationBeats;
      const duration = Math.min(pulse % 1 === 0 ? 0.9 : 0.58, chordEnd - start);
      if (duration < 0.08) continue;
      voicing.forEach((pitch, index) => notes.push({
        start: start + index * 0.018,
        duration: Math.max(0.08, duration - index * 0.018),
        pitch,
        velocity: (pulse % 1 === 0 ? 57 : 62) - index * 2,
      }));
    }
  }
  return notes;
}

function generateGuitar(
  chords: ChordEvent[],
  pattern: ArrangementSettings["guitarPattern"],
  meter: Meter,
  voicer: Voicer,
  lastChordStart: number,
): NoteEvent[] {
  if (pattern === "off") return [];
  if (pattern === "bossa") return generateBossaGuitar(chords, meter, voicer);
  const notes: NoteEvent[] = [];
  for (const chord of chords) {
    // 旧実装はここで chord.pitches を丸ごと +12 していた。ルートが 48〜59 に
    // 固定されているため上端が 85 まで届き、旋律 (60〜81) と完全に重なっていた。
    const pitches = voicer(chord, undefined, chord.start === lastChordStart);
    if (!pitches.length) continue;
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

/**
 * 2 小節で呼吸するボサノヴァのナイロンギター型。
 * 低音はベースへ任せ、3rd/7th/9th を含む上声を滑らかにつなぐ。
 */
function generateBossaGuitar(chords: ChordEvent[], meter: Meter, voicer: Voicer): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const sectionBeats = chords.at(-1)!.start + chords.at(-1)!.durationBeats;
  const bb = meter.barBeats;

  for (let bar = 0; bar * bb < sectionBeats - 1e-9; bar++) {
    const barStart = bar * bb;
    const pulses = meter.name === "4/4"
      ? bar % 2 === 0
        ? [0.5, 1.5, 2, 3.5]
        : [0.5, 1, 2.5, 3, 3.5]
      : Array.from({ length: Math.floor(bb) }, (_, index) => index + 0.5);

    for (const pulse of pulses) {
      const start = barStart + pulse;
      if (start >= sectionBeats - 1e-9) continue;
      const chord = chordAtBeat(chords, start);
      const voicing = voicer(chord, guideTones(chord));
      const chordEnd = chord.start + chord.durationBeats;
      const strokeDuration = Math.min(pulse % 1 === 0 ? 0.58 : 0.38, chordEnd - start);
      if (strokeDuration < 0.08) continue;
      voicing.forEach((pitch, index) => notes.push({
        start: start + index * 0.014,
        duration: Math.max(0.08, strokeDuration - index * 0.014),
        pitch,
        velocity: (pulse % 1 === 0 ? 62 : 70) - Math.min(index, 3),
      }));
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
    if (pattern === "bossa" && meter.name === "4/4") {
      for (let t = 0; t < bb; t += 0.5) {
        hit(start + t, 42, t % 1 === 0 ? 62 : 54);
      }
      hit(start, 36, 88);
      hit(start + 1.5, 36, 55);
      hit(start + 2, 36, 76);
      hit(start + 3.5, 36, 52);
      const crossStick = bar % 2 === 0 ? [0.5, 1.5, 3] : [1, 2.5];
      crossStick.forEach((offset, index) => hit(start + offset, 37, index === 0 ? 72 : 66));
      continue;
    }
    for (let t = 0; t < bb; t += 0.5) hit(start + t, 42, t % 1 === 0 ? 70 : 58);
    hit(start, 36, 98);
    if (bb >= 3) hit(start + 2, 38, 88);
    if (pattern === "rock" && bb >= 4) {
      hit(start + 1, 38, 86);
      hit(start + 3, 38, 92);
      hit(start + 2.5, 36, 82);
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
  /** 揺らぎで音がコード境界を跨がないようにするための境界一覧 */
  chordStarts?: number[],
): void {
  for (const note of notes) {
    const originalBar = Math.floor((note.start + 1e-9) / meter.barBeats);
    const barStart = originalBar * meter.barBeats;
    const barEnd = Math.min(sectionBeats, barStart + meter.barBeats);
    const eighth = Math.round(note.start * 2);
    const swingDelay = eighth % 2 === 1 ? config.swing * 0.16 : 0;
    const jitter = config.humanize > 0 ? (rng.next() * 2 - 1) * config.humanize * 0.035 : 0;
    // 揺らぎで前のコードへ食い込むと、その和音のために選んだボイシングが
    // 別の和音の上で鳴る。数ミリ秒でも「和音の音を鳴らしている」という
    // 前提が崩れるので、自分のコードの開始位置より前へは動かさない
    const chordFloor = chordStarts?.length
      ? chordStarts.reduce((best, start) =>
        start <= note.start + 1e-9 && start > best ? start : best, 0)
      : barStart;
    note.start = Math.max(
      Math.max(barStart, chordFloor),
      Math.min(barEnd - 0.02, note.start + swingDelay + jitter),
    );
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

/** 4/4 ボサの低音。1・3 拍のルートと5度、コード直前の8分先取りを使う。 */
function generateBossaBass(chords: ChordEvent[], sectionBeats: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const pulses = [0, 1.5, 2, 3.5];
  for (let barStart = 0; barStart < sectionBeats - 1e-9; barStart += 4) {
    for (const pulse of pulses) {
      const start = barStart + pulse;
      if (start >= sectionBeats - 1e-9) continue;
      const chord = chordAtBeat(chords, start);
      const nextChord = chords.find((candidate) =>
        candidate.start > start + 1e-9 && Math.abs(candidate.start - start - 0.5) < 1e-9);
      const anticipatesChange = nextChord !== undefined;
      const rootPulse = pulse === 0 || pulse === 2;
      notes.push({
        start,
        duration: Math.min(
          anticipatesChange ? 0.38 : rootPulse ? 1.2 : 0.42,
          sectionBeats - start,
        ),
        pitch: anticipatesChange
          ? nextChord.bassPitch
          : rootPulse ? chord.bassPitch : chord.bassPitch + 7,
        velocity: anticipatesChange ? 76 : rootPulse ? 88 : 80,
      });
    }
  }
  return notes;
}

/** 同じピッチクラスを保ったまま reference に最も近い低音域へ置く。 */
function nearestBassPitch(pitch: number, reference: number): number {
  const pc = ((pitch % 12) + 12) % 12;
  const candidates: number[] = [];
  for (let candidate = 34; candidate <= 58; candidate++) {
    if (candidate % 12 === pc) candidates.push(candidate);
  }
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - reference) < Math.abs(best - reference) ? candidate : best,
  candidates[0]!);
}

/**
 * 低音を単なるルート反復にせず、コード内声と次コードへの接近音で歌わせる。
 * ルートのオクターブも直前音に近い位置へ置くため、B2→C2 のような不自然な
 * 11半音下降を避け、B2→C3 と滑らかにつなぐ。
 */
function generateMelodicBass(
  chords: ChordEvent[],
  meter: Meter,
  scalePcs: number[],
  sectionBeats: number,
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const pulse = meter.name === "6/8" ? 1.5 : 1;
  let previousPitch = chords[0]?.bassPitch ?? 36;

  chords.forEach((chord, index) => {
    const end = Math.min(sectionBeats, chord.start + chord.durationBeats);
    const root = nearestBassPitch(chord.bassPitch, previousPitch);
    const nextChord = chords[index + 1];
    const nextRoot = nextChord ? nearestBassPitch(nextChord.bassPitch, root) : root;
    const starts: number[] = [];
    for (let start = chord.start; start < end - 1e-9; start += pulse) starts.push(start);

    starts.forEach((start, pulseIndex) => {
      const isFirst = pulseIndex === 0;
      const isLast = pulseIndex === starts.length - 1;
      let pitch = root;
      if (!isFirst && isLast && nextChord && nextRoot !== root) {
        const direction = nextRoot > previousPitch ? -1 : 1;
        const chromaticApproach = nextRoot + direction;
        const diatonicApproach = passingTone(previousPitch, nextRoot, scalePcs);
        pitch = Math.abs(chromaticApproach - previousPitch) <= 5
          ? chromaticApproach
          : diatonicApproach;
      } else if (!isFirst) {
        const progress = pulseIndex / Math.max(starts.length - 1, 1);
        const target = Math.round(root + (nextRoot - root) * progress);
        const chordTones = chord.pitches.flatMap((tone) => [
          nearestBassPitch(tone, target),
          nearestBassPitch(tone, target) + 12,
        ]).filter((tone) => tone >= 34 && tone <= 58);
        pitch = chordTones.reduce((best, tone) =>
          Math.abs(tone - target) < Math.abs(best - target) ? tone : best,
        root);
      }
      notes.push({
        start,
        duration: Math.min(pulse * 0.88, end - start),
        pitch,
        velocity: isFirst ? 90 : isLast && nextChord ? 78 : 82,
      });
      previousPitch = pitch;
    });
  });
  return notes;
}

/** 西洋和声のコードが動いても、ルートと5度だけは低声部で保つドローン。 */
function generateDroneBass(
  key: KeySignature,
  meter: Meter,
  sectionBeats: number,
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const tonic = pcToPitch(key.tonic, 36);
  const pulse = meter.name === "4/4" ? 2 : 1.5;
  for (let start = 0, index = 0; start < sectionBeats - 1e-9; start += pulse, index++) {
    notes.push({
      start,
      duration: Math.min(pulse * 0.94, sectionBeats - start),
      pitch: index % 2 === 0 ? tonic : tonic + 7,
      velocity: index % 2 === 0 ? 88 : 78,
    });
  }
  return notes;
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
