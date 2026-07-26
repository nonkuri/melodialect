/**
 * 主題の再帰 (v1.5) の回帰テスト。
 *
 * 導入前の実測 (14 ダイアレクト × 10 シード、既定フロー、候補 3):
 *   繰り返す Chorus 同士で 進行の一致 6% / 旋律の律動の一致 0% / 音列の一致 0%
 * つまりサビ 1 とサビ 2 が別の曲だった。ここで固定するのは
 * 「既定フロー (ダイアレクトを選ぶ → 全体生成) でも主題が戻ること」で、
 * 以前は作曲設計ダイアログを開いたときしか再現が走らなかった。
 *
 * 生成は重いので、コーパスはモジュール読み込み時に 1 度だけ作る。
 */
import { describe, expect, it } from "vitest";
import { dialectList, chromatic } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import { parseRoman } from "../src/engine/harmony.js";
import type { Dialect, GeneratedSection, NoteEvent, SectionType, Song } from "../src/engine/types.js";

const SEEDS = [1, 13, 42, 99];
const FORM = parseForm("i,v,c,v,c,b,c,o");
const SHORT_FORM = parseForm("v,c,v,c");

const progression = (section: GeneratedSection) => section.chords.map((chord) => chord.symbol).join(" ");
const rhythm = (notes: NoteEvent[]) =>
  notes.map((note) => `${note.start.toFixed(3)}:${note.duration.toFixed(3)}`).join(",");
const pitches = (notes: NoteEvent[]) => notes.map((note) => note.pitch).join(",");

/**
 * 主題が戻っているか。転調していないセクションは絶対音高で一致することを求め、
 * 転調したセクション (agitato のように modulation.chorus を宣言したもの) は
 * キーの差だけ移調された音列であることを求める。音域の端では 1 オクターブ
 * 折り返されるため、移調側はオクターブ差を許す
 */
function restatesTheme(a: GeneratedSection, b: GeneratedSection): boolean {
  if (a.melody.length !== b.melody.length || !a.melody.length) return false;
  const shift = (((b.key.tonic - a.key.tonic) % 12) + 12) % 12;
  if (shift === 0) return a.melody.every((note, i) => b.melody[i]!.pitch === note.pitch);
  return a.melody.every((note, i) => ((b.melody[i]!.pitch - note.pitch - shift) % 12 + 12) % 12 === 0);
}

function build(dialect: Dialect, seed: number, form = FORM): Song {
  return generateSong({
    dialect,
    seed,
    keyName: dialect.defaults.key,
    bpm: dialect.defaults.bpm,
    meterName: dialect.defaults.meter ?? "4/4",
    form,
    ending: "final",
    candidateCount: 3,
  });
}

const sectionsOf = (song: Song, type: SectionType) =>
  song.sections.filter((section) => section.plan.type === type);

interface Sample { dialect: Dialect; seed: number; song: Song; }
const corpus: Sample[] = dialectList.flatMap((dialect) =>
  SEEDS.map((seed) => ({ dialect, seed, song: build(dialect, seed) })));
const shortCorpus: Sample[] = dialectList.map((dialect) =>
  ({ dialect, seed: 21, song: build(dialect, 21, SHORT_FORM) }));

describe("主題の再帰 (既定フロー)", () => {
  it("繰り返す Chorus と Verse が主題の進行と律動を取り戻す", () => {
    for (const { dialect, seed, song } of corpus) {
      for (const type of ["chorus", "verse"] as const) {
        const list = sectionsOf(song, type);
        expect(list.length, `${dialect.id} の ${type} が繰り返されていない`).toBeGreaterThan(1);
        const first = list[0]!;
        for (const later of list.slice(1)) {
          expect(progression(later), `${dialect.id} seed=${seed} ${type} の進行が戻っていない`)
            .toBe(progression(first));
          expect(rhythm(later.melody), `${dialect.id} seed=${seed} ${type} の律動が戻っていない`)
            .toBe(rhythm(first.melody));
          expect(later.plan.bars).toBe(first.plan.bars);
        }
      }
    }
  });

  it("最後の Chorus は主題をそのまま再現し、途中の Chorus は変奏になる", () => {
    let variedSomewhere = 0;
    for (const { dialect, seed, song } of corpus) {
      const choruses = sectionsOf(song, "chorus");
      const first = choruses[0]!;
      const last = choruses.at(-1)!;
      // finalLift: いちばん記憶に残ってほしい最後の Chorus は主題そのもの
      expect(restatesTheme(first, last), `${dialect.id} seed=${seed} の最終 Chorus が主題と違う: ` +
        `${pitches(last.melody)} vs ${pitches(first.melody)}`).toBe(true);
      // 途中の Chorus は「同じ律動・違う歌い回し」。全部が完全コピーだと単調になる
      if (choruses.slice(1, -1).some((section) => !restatesTheme(first, section))) {
        variedSomewhere++;
      }
    }
    expect(variedSomewhere / corpus.length).toBeGreaterThan(0.8);
  });

  it("Verse は律動を共有したまま音程が変わる (歌詞違いの 2 番)", () => {
    const varied = corpus.filter(({ song }) => {
      const verses = sectionsOf(song, "verse");
      return pitches(verses[1]!.melody) !== pitches(verses[0]!.melody);
    });
    expect(varied.length / corpus.length).toBeGreaterThan(0.9);
  });

  it("主題を戻したセクションにも終止の注記が付き、最終セクションは I へ解決する", () => {
    for (const { dialect, song } of shortCorpus) {
      for (const section of song.sections) {
        expect(
          section.annotations.some((annotation) => annotation.ruleId === "cadence"),
          `${dialect.id} の ${section.plan.type} に終止の注記がない`,
        ).toBe(true);
      }
      const last = song.sections.at(-1)!.chords.at(-1)!;
      expect(parseRoman(last.symbol).degree, `${dialect.id} の曲末が I へ解決していない`).toBe(1);
    }
  });

  it("注記は実際に行った再現だけを述べる", () => {
    const choruses = sectionsOf(corpus[0]!.song, "chorus");
    expect(choruses[0]!.annotations.some((item) => item.ruleId === "theme-restate")).toBe(false);
    for (const later of choruses.slice(1)) {
      expect(later.annotations.some((item) => item.ruleId === "theme-restate")).toBe(true);
      expect(later.annotations.some((item) => item.ruleId === "theme-restate-harmony")).toBe(true);
    }
  });
});

describe("主題の規則はダイアレクトと利用者の指定で変えられる", () => {
  it("recurrence を new と宣言したダイアレクトは主題を戻さない", () => {
    const through: Dialect = {
      ...structuredClone(chromatic),
      id: "theme-test-through-composed",
      theme: { recurrence: { verse: "new", chorus: "new", default: "new" } },
    };
    const differed = SEEDS.filter((seed) => {
      const choruses = sectionsOf(build(through, seed, SHORT_FORM), "chorus");
      return progression(choruses[1]!) !== progression(choruses[0]!);
    });
    expect(differed.length, "new と宣言しても主題が戻ってしまっている").toBeGreaterThan(0);
  });

  it("recurrence を same と宣言すると途中の Chorus も完全再現になる", () => {
    const literal: Dialect = {
      ...structuredClone(chromatic),
      id: "theme-test-literal",
      theme: { recurrence: { chorus: "same" } },
    };
    for (const seed of SEEDS) {
      const choruses = sectionsOf(build(literal, seed), "chorus");
      for (const later of choruses.slice(1)) {
        expect(pitches(later.melody)).toBe(pitches(choruses[0]!.melody));
      }
    }
  });

  it("作曲設計の Chorus 変奏指定がダイアレクトの宣言より優先される", () => {
    const design = (chorusVariation: "same" | "light" | "large") => ({
      harmonyMode: "auto" as const,
      chordDrafts: [] as never[],
      chorusVariation,
      sectionExpressions: [],
    });
    const options = {
      dialect: chromatic,
      seed: 31,
      keyName: chromatic.defaults.key,
      form: SHORT_FORM,
      ending: "final" as const,
    };
    const large = sectionsOf(generateSong({ ...options, design: design("large") }), "chorus");
    // "large" は「主題から離れて作り直す」指定。進行か旋律のどちらかは変わる
    expect(
      progression(large[1]!) !== progression(large[0]!) ||
      pitches(large[1]!.melody) !== pitches(large[0]!.melody),
    ).toBe(true);
    const same = sectionsOf(generateSong({ ...options, design: design("same") }), "chorus");
    // SHORT_FORM では 2 つ目の Chorus が最終セクションなので、末尾は終止形へ
    // 差し替わる。和音が変われば強拍の音はその和音へ吸着されるため、完全一致を
    // 求めると「終止形がたまたま主題と同じ和音になったシードだけ通る」テストに
    // なる。進行が一致している範囲で「主題そのもの」を確認する
    const sharedBeats = same[0]!.chords.reduce((end, chord, index) =>
      same[1]!.chords[index]?.symbol === chord.symbol
        ? Math.max(end, chord.start + chord.durationBeats) : end, 0);
    expect(sharedBeats).toBeGreaterThan(0);
    const shared = (section: GeneratedSection) =>
      pitches(section.melody.filter((note) => note.start < sharedBeats));
    expect(shared(same[1]!)).toBe(shared(same[0]!));
  });

  it("同じシードなら主題の再現も含めて決定的", () => {
    expect(build(chromatic, 3, SHORT_FORM)).toEqual(build(chromatic, 3, SHORT_FORM));
  });
});

describe("候補評価が代替候補を活かしている", () => {
  it("代替候補が形状ガードで全滅しない", () => {
    const fallbacks = corpus.filter(({ song }) => song.generationReport!.metrics.fellBackToReference);
    // 形状ガードが伴奏バリアントと衝突していた頃は 26% がここへ落ち、
    // 候補を 3 つ作る投資がそのまま捨てられていた
    expect(
      fallbacks.length / corpus.length,
      `代替案が全滅した組: ${fallbacks.slice(0, 8).map((item) => `${item.dialect.id}/${item.seed}`).join(", ")}`,
    ).toBeLessThan(0.05);
  });

  it("常に候補 0 が選ばれるわけではない", () => {
    const other = corpus.filter(({ song }) => song.generationReport!.candidateIndex !== 0);
    expect(other.length / corpus.length).toBeGreaterThan(0.2);
  });
});
