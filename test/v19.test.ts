/**
 * v1.9 の回帰テスト: 強弱 (dynamics.ts) と動機労作 (motifOps.ts)。
 *
 * 導入前の実測 (agitato・12 シード・既定フロー):
 *   旋律の velocity は 90 と 100 の 2 値のみ。曲全体が平坦で、セクション対比を
 *   担っていたのは編成と密度だけだった。
 *   動機労作は「移調反復 (シークエンス)」しかなく、断片化・反行・拡大・
 *   ストレッタは表現手段が存在しなかった。
 *
 * ここで固定するのは 2 つ。宣言したものが実際に出力へ出ること (設計ルール 1) と、
 * 宣言しないダイアレクトの出力が 1 バイトも変わらないこと。
 */
import { describe, expect, it } from "vitest";
import { agitato, dialectList, lament } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import { applyMotifOperator, registeredMotifOperatorNames } from "../src/engine/motifOps.js";
import { DEFAULT_DYNAMICS, dynamicsFor } from "../src/engine/dynamics.js";
import type { GeneratedSection, NoteEvent, Song } from "../src/engine/types.js";

const FORM = parseForm("i,v,c,b,v,c,o");
const build = (dialect: typeof agitato, seed: number) => generateSong({ dialect, seed, form: FORM });

const allNotes = (section: GeneratedSection): NoteEvent[] =>
  [...section.melody, ...section.piano, ...section.guitar, ...section.bass, ...section.drums];
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const meanVelocity = (notes: NoteEvent[]) => mean(notes.map((note) => note.velocity));
const velocityFingerprint = (song: Song) =>
  song.sections.flatMap(allNotes).reduce((sum, note) => sum + note.velocity, 0);

describe("強弱 (v1.9)", () => {
  it("宣言しないダイアレクトは平坦なまま (既定値が恒等)", () => {
    expect(dynamicsFor(lament)).toEqual(DEFAULT_DYNAMICS);
    for (const dialect of dialectList) {
      if (dialect.dynamics) continue;
      const song = build(dialect, 3);
      expect(
        song.sections.flatMap((section) => section.annotations)
          .some((annotation) => annotation.ruleId === "dynamics"),
        `${dialect.id} に強弱の注記が付いている`,
      ).toBe(false);
    }
  });

  it("宣言しないダイアレクトの velocity は v1.8 と同じ指紋を保つ", () => {
    // 生成のどこかで強弱パスが素通りしなくなったら、この数字が動く
    const expected: Record<string, number> = {
      "chromatic-cliche": 162312,
      "harmonic-lament": 34542,
      "four-on-floor": 163776,
      "miyakobushi-drone": 30100,
      "bossa-syncopation": 94122,
    };
    for (const [id, fingerprint] of Object.entries(expected)) {
      const dialect = dialectList.find((item) => item.id === id)!;
      expect(velocityFingerprint(build(dialect, 3)), id).toBe(fingerprint);
    }
  });

  it("セクション別の基準強弱が平均 velocity の差になって出る", () => {
    // agitato の宣言: intro=p / verse=mf / chorus=f / outro=ff
    for (const seed of [1, 7, 13]) {
      const song = build(agitato, seed);
      const levelOf = (type: string) => mean(song.sections
        .filter((section) => section.plan.type === type)
        .map((section) => meanVelocity(allNotes(section))));
      expect(levelOf("intro"), `seed=${seed} intro < verse`).toBeLessThan(levelOf("verse"));
      expect(levelOf("verse"), `seed=${seed} verse < chorus`).toBeLessThan(levelOf("chorus"));
      expect(levelOf("chorus"), `seed=${seed} chorus < outro`).toBeLessThan(levelOf("outro"));
    }
  });

  it("セクション弧が前半と後半の差になって出る", () => {
    const song = build(agitato, 1);
    let rising = 0;
    for (const section of song.sections) {
      const half = section.plan.bars * song.meter.barBeats / 2;
      const notes = allNotes(section);
      const front = notes.filter((note) => note.start < half);
      const back = notes.filter((note) => note.start >= half);
      if (front.length && back.length && meanVelocity(back) > meanVelocity(front)) rising++;
    }
    // sectionArc は正 (クレッシェンド) を宣言している
    expect(rising / song.sections.length).toBeGreaterThan(0.7);
  });

  it("アクセント拍が周囲より強く鳴る", () => {
    const song = build(agitato, 1);
    const accents = agitato.dynamics!.accentBeats!;
    const on: number[] = [];
    const off: number[] = [];
    for (const section of song.sections) {
      for (const note of allNotes(section)) {
        const beat = note.start % song.meter.barBeats;
        (accents.some((accent) => Math.abs(beat - accent) < 1e-6) ? on : off).push(note.velocity);
      }
    }
    expect(on.length).toBeGreaterThan(0);
    expect(mean(on)).toBeGreaterThan(mean(off) * 1.15);
  });

  it("頭打ちで潰れず、曲全体の音量も痩せない", () => {
    for (const seed of [1, 7, 13]) {
      const song = build(agitato, seed);
      const velocities = song.sections.flatMap(allNotes).map((note) => note.velocity);
      const clipped = velocities.filter((velocity) => velocity >= 127).length;
      expect(clipped / velocities.length, `seed=${seed} の頭打ち`).toBeLessThan(0.01);
      // 平坦なダイアレクト (lament) と同程度の音量帯に収まっていること。
      // ピークで割る正規化にすると、ここが 0.7 倍近くまで落ちた
      expect(mean(velocities), `seed=${seed} の平均`).toBeGreaterThan(60);
      expect(new Set(velocities).size, `seed=${seed} の velocity 種類数`).toBeGreaterThan(30);
    }
  });
});

describe("動機労作 (v1.9)", () => {
  const motif = [
    { offsetInPhrase: 0, duration: 0.5, rest: false, step: 0 },
    { offsetInPhrase: 0.5, duration: 0.5, rest: false, step: 2 },
    { offsetInPhrase: 1, duration: 1, rest: false, step: 1 },
    { offsetInPhrase: 2, duration: 2, rest: false, step: -1 },
    { offsetInPhrase: 4, duration: 1, rest: false, step: 3 },
    { offsetInPhrase: 5, duration: 3, rest: false, step: 0 },
    { offsetInPhrase: 8, duration: 4, rest: false, step: -2 },
    { offsetInPhrase: 12, duration: 4, rest: false, step: 0 },
  ];

  it("4 つの操作子が登録されている", () => {
    expect(registeredMotifOperatorNames().sort())
      .toEqual(["augmentation", "fragmentation", "inversion", "stretto"]);
  });

  it("どの操作子もフレーズをはみ出さず、音を重ねない", () => {
    for (const phraseBeats of [8, 12, 16]) {
      for (const name of registeredMotifOperatorNames()) {
        const source = motif.filter((slot) => slot.offsetInPhrase < phraseBeats);
        const result = applyMotifOperator(name, source, phraseBeats);
        expect(result, `${name} @${phraseBeats}`).not.toBeNull();
        const sorted = [...result!].sort((a, b) => a.offsetInPhrase - b.offsetInPhrase);
        sorted.forEach((slot, index) => {
          expect(slot.offsetInPhrase + slot.duration, `${name} @${phraseBeats} のはみ出し`)
            .toBeLessThanOrEqual(phraseBeats + 1e-9);
          if (index === 0) return;
          const previous = sorted[index - 1]!;
          expect(previous.offsetInPhrase + previous.duration, `${name} @${phraseBeats} の重なり`)
            .toBeLessThanOrEqual(slot.offsetInPhrase + 1e-9);
        });
      }
    }
  });

  it("反行は律動を保ったまま輪郭を反転する", () => {
    const result = applyMotifOperator("inversion", motif, 16)!;
    expect(result.map((slot) => [slot.offsetInPhrase, slot.duration]))
      .toEqual(motif.map((slot) => [slot.offsetInPhrase, slot.duration]));
    expect(result.map((slot) => slot.step)).toEqual(motif.map((slot) => -slot.step));
  });

  it("拡大は音価を 2 倍にする", () => {
    const result = applyMotifOperator("augmentation", motif, 16)!;
    result.forEach((slot, index) => {
      expect(slot.duration).toBe(motif[index]!.duration * 2);
      expect(slot.offsetInPhrase).toBe(motif[index]!.offsetInPhrase * 2);
    });
  });

  it("断片化は頭のセルだけを敷き詰める", () => {
    const result = applyMotifOperator("fragmentation", motif, 16)!;
    expect(result.length).toBeGreaterThan(motif.length);
    // 使われる step は頭のセルにあるものだけ
    const cellSteps = new Set(motif.slice(0, 3).map((slot) => slot.step));
    for (const slot of result) expect(cellSteps.has(slot.step)).toBe(true);
  });

  it("ストレッタは同音連打に化けない", () => {
    const result = applyMotifOperator("stretto", motif, 16)!;
    // 詰めた入りを無制限に続けると、どの入りも頭の 1 音で断ち切られて
    // step が 1 種類だけになった (v1.9 実装時の実測: 16 拍で 20 音以上)
    expect(new Set(result.map((slot) => slot.step)).size).toBeGreaterThan(1);
    const runs = result.filter((slot, index) => index > 0 && slot.step === result[index - 1]!.step);
    expect(runs.length / result.length).toBeLessThan(0.5);
  });

  it("宣言したダイアレクトで発火し、展開部に集まる", { timeout: 30_000 }, () => {
    const developments: Array<{ type: string; text: string }> = [];
    for (let seed = 1; seed <= 24; seed++) {
      for (const section of build(agitato, seed).sections) {
        for (const annotation of section.annotations) {
          if (annotation.ruleId === "motif-development") {
            developments.push({ type: section.plan.type, text: annotation.text });
          }
        }
      }
    }
    expect(developments.length, "動機労作が 1 度も発火していない").toBeGreaterThan(5);
    // developmentProbability は bridge=0.85 / chorus=0.2 / default=0.12
    const inBridge = developments.filter((entry) => entry.type === "bridge").length;
    expect(inBridge / developments.length).toBeGreaterThan(0.5);
  });

  it("宣言しないダイアレクトでは発火しない", { timeout: 30_000 }, () => {
    for (const dialect of dialectList) {
      if (dialect.melody.motif?.development) continue;
      expect(
        build(dialect, 2).sections.flatMap((section) => section.annotations)
          .some((annotation) => annotation.ruleId === "motif-development"),
        `${dialect.id} で動機労作が発火した`,
      ).toBe(false);
    }
  });

  it("展開してもセクション末は和音構成音へ着地する", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const song = build(agitato, seed);
      for (const section of song.sections) {
        const last = section.melody.at(-1);
        if (!last) continue;
        const chord = [...section.chords].reverse()
          .find((item) => item.start <= last.start + 1e-9)!;
        const degrees = chord.pitches.map((pitch) => ((pitch % 12) + 12) % 12);
        expect(degrees, `seed=${seed} ${section.plan.type} の着地`)
          .toContain(((last.pitch % 12) + 12) % 12);
      }
    }
  });
});
