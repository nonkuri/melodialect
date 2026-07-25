/**
 * ダイアレクトの識別性と多様性の統計テスト (TODO Dialect v2 の前提)。
 *
 * 単一シードの特性テスト (dialects.test.ts) は「その技法が使えること」を示すが、
 * 「同じダイアレクトで 2 曲目を作る意味があること」「新しいダイアレクトが既存の
 * 焼き直しになっていないこと」は 1 曲では測れない。ここでは複数シードの特徴量
 * 分布で測る。
 *
 * **測るのは重複の検出であって、ダイアレクト同士を引き離すことではない** (v1.7.1)。
 * このアプリの約束は「この曲は Ryukyu の癖で書かれている」であり、ダイアレクトが
 * 統計的に離れていることではない。実在の作曲家の語法同士も近いことがある
 * (twilight と angular は実際に近い) ので、近いこと自体は欠陥ではない。
 *
 * v1.7.0 まで置いていた 2 つの絶対しきい値 (最近傍比 > 1.2、重心距離 > 1.5) は外した。
 * 特徴量を母集団で z 標準化する以上、ダイアレクトを 1 つ足すだけで全ペアの比が一律に
 * 縮み、しきい値に固定した意味がないため。実際 v1.7.0 では、無関係な 2 種を足した
 * だけで compound-flow が 1.20 → 1.18 で落ち、指標の都合で既存の drift を改変する
 * 事故が起きた (経緯は TODO.md の実測記録)。重複した定義は leave-one-out の分類が
 * 崩れる (どちらの重心へ落ちるかが半々になる) ので、分類精度だけで捕まえられる。
 *
 * 特徴量には主音基準のピッチクラス比を含める。音階そのものが正体のダイアレクト
 * (drift=ドリアン、ember=フリギア、ryukyu=琉球、miyakobushi=都節) を、正体を見ずに
 * 判定していたのが v1.7.0 の穴だった。
 *
 * 伴奏は defaults.arrangementVariants でシードごとに意図的に振れるため、
 * 多様性として別に測る。
 */
import { describe, expect, it } from "vitest";
import { dialectList } from "../src/dialects/index.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import type { NoteEvent } from "../src/engine/types.js";

const SEEDS = [1, 7, 13, 42, 99, 128, 256, 777];
const FORM = parseForm("i,v,c,v,c,b,c,o");

const CORE_FEATURES = [
  "melNotesPerBar", "melStep", "melLeap", "melRepeat", "melSpan", "melSyncopation",
  "melLong", "melCenter", "chordsPerBar", "chordExtended", "chordAltered", "chordVariety",
  "bassNotesPerBar", "bassInterval", "bassLeap",
] as const;
/** 主音から見たピッチクラスの出現比。音階が正体のダイアレクトはここに出る */
const PITCH_FEATURES = [
  "pc0", "pc1", "pc2", "pc3", "pc4", "pc5", "pc6", "pc7", "pc8", "pc9", "pc10", "pc11",
] as const;
const ARRANGEMENT_FEATURES = ["pianoPerBar", "guitarPerBar", "drumsPerBar"] as const;
type Feature =
  | typeof CORE_FEATURES[number]
  | typeof PITCH_FEATURES[number]
  | typeof ARRANGEMENT_FEATURES[number];
/** 重複検出に使う「作曲language」= 旋律・和声・ベース + 音使い */
const IDENTITY_FEATURES: Feature[] = [...CORE_FEATURES, ...PITCH_FEATURES];
const FEATURES: Feature[] = [...IDENTITY_FEATURES, ...ARRANGEMENT_FEATURES];

function measure(dialectIndex: number, seed: number): Record<Feature, number> {
  const dialect = dialectList[dialectIndex]!;
  const song = generateSong({
    dialect,
    seed,
    keyName: dialect.defaults.key,
    bpm: dialect.defaults.bpm,
    meterName: dialect.defaults.meter ?? "4/4",
    form: FORM,
    ending: "final",
  });
  const barBeats = song.meter.barBeats;
  const strong = new Set(song.meter.strongBeats);
  const melody: NoteEvent[] = [];
  const parts = { piano: 0, guitar: 0, drums: 0, bass: 0 };
  const bass: NoteEvent[] = [];
  const symbols = new Set<string>();
  let bars = 0, chords = 0, extended = 0, altered = 0;
  for (const section of song.sections) {
    bars += section.plan.bars;
    melody.push(...section.melody);
    bass.push(...section.bass);
    parts.piano += section.piano.length;
    parts.guitar += section.guitar.length;
    parts.drums += section.drums.length;
    chords += section.chords.length;
    for (const chord of section.chords) {
      symbols.add(chord.symbol);
      if (/7|9|11|13|△|ø/.test(chord.symbol)) extended++;
      if (/[♭#]|\//.test(chord.symbol)) altered++;
    }
  }
  const intervals = (notes: NoteEvent[]) => {
    const sorted = [...notes].sort((a, b) => a.start - b.start);
    const values: number[] = [];
    for (let index = 1; index < sorted.length; index++) {
      values.push(Math.abs(sorted[index]!.pitch - sorted[index - 1]!.pitch));
    }
    return values;
  };
  const pitchClasses = Object.fromEntries(PITCH_FEATURES.map((name) => [name, 0])) as
    Record<typeof PITCH_FEATURES[number], number>;
  for (const note of melody) {
    const degree = (((note.pitch - song.key.tonic) % 12) + 12) % 12;
    pitchClasses[PITCH_FEATURES[degree]!] += 1 / (melody.length || 1);
  }
  const melodyIntervals = intervals(melody);
  const bassIntervals = intervals(bass);
  const ratio = (values: number[], predicate: (value: number) => boolean) =>
    values.length ? values.filter(predicate).length / values.length : 0;
  const pitches = melody.map((note) => note.pitch);
  // 拍子で 1 小節の長さが違うため、密度は 4 拍あたりへ揃える
  const perFourBeats = 4 / barBeats / Math.max(1, bars);
  return {
    melNotesPerBar: melody.length * perFourBeats,
    melStep: ratio(melodyIntervals, (value) => value > 0 && value <= 2),
    melLeap: ratio(melodyIntervals, (value) => value >= 5),
    melRepeat: ratio(melodyIntervals, (value) => value === 0),
    melSpan: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0,
    melSyncopation: melody.length
      ? melody.filter((note) => !strong.has(((note.start % barBeats) + barBeats) % barBeats)).length / melody.length
      : 0,
    melLong: melody.length ? melody.filter((note) => note.duration >= 2).length / melody.length : 0,
    melCenter: pitches.length ? pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length : 0,
    chordsPerBar: chords * perFourBeats,
    chordExtended: chords ? extended / chords : 0,
    chordAltered: chords ? altered / chords : 0,
    chordVariety: symbols.size,
    bassNotesPerBar: bass.length * perFourBeats,
    bassInterval: bassIntervals.length
      ? bassIntervals.reduce((sum, value) => sum + value, 0) / bassIntervals.length : 0,
    bassLeap: ratio(bassIntervals, (value) => value >= 5),
    pianoPerBar: parts.piano * perFourBeats,
    guitarPerBar: parts.guitar * perFourBeats,
    drumsPerBar: parts.drums * perFourBeats,
    ...pitchClasses,
  };
}

interface Profile {
  id: string;
  name: string;
  samples: Array<Record<Feature, number>>;
}

const profiles: Profile[] = dialectList.map((dialect, index) => ({
  id: dialect.id,
  name: dialect.name,
  samples: SEEDS.map((seed) => measure(index, seed)),
}));

const stats = new Map<Feature, { mean: number; deviation: number }>();
for (const feature of FEATURES) {
  const values = profiles.flatMap((profile) => profile.samples.map((sample) => sample[feature]));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  stats.set(feature, { mean, deviation: Math.sqrt(variance) || 1 });
}

function vectors(profile: Profile, features: readonly Feature[]): number[][] {
  return profile.samples.map((sample) => features.map((feature) => {
    const { mean, deviation } = stats.get(feature)!;
    return (sample[feature] - mean) / deviation;
  }));
}

function centroid(points: number[][]): number[] {
  return points[0]!.map((_, index) =>
    points.reduce((sum, point) => sum + point[index]!, 0) / points.length);
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((value, index) => value - b[index]!));
}

/** 重心からの平均距離 = そのダイアレクトのシード間ばらつき */
function spread(points: number[][]): number {
  const center = centroid(points);
  return points.reduce((sum, point) => sum + distance(point, center), 0) / points.length;
}

describe("ダイアレクトの重複検出 (複数シードの特徴量分布)", () => {
  const cores = profiles.map((profile) => ({
    profile,
    points: vectors(profile, IDENTITY_FEATURES),
  }));

  /**
   * 1 曲ずつ「どのダイアレクトの重心に最も近いか」を当てる (leave-one-out)。
   *
   * 比 (最近傍までの距離 ÷ シード間ばらつき) ではなく分類精度で見るのは、比の分母に
   * ダイアレクト内の多様性が入り、多様性を増やすと識別性が下がったように見えるため。
   * 分子も母集団依存なので、しきい値を絶対値で置くと増設のたびに揺れる (v1.7.0 の事故)。
   *
   * ここで捕まえたいのは「既存の焼き直しを足してしまった」場合だけ。重複していれば
   * どちらの重心へ落ちるかが半々になり、そのダイアレクトの精度が 0.5 付近へ落ちる。
   * 逆に、近い 2 つが安定して自分側へ分類されるなら、近いままで構わない。
   */
  it("1 曲ずつ、最も近い重心が自分のダイアレクトになる", () => {
    let hits = 0;
    let total = 0;
    const misses: string[] = [];
    for (const own of cores) {
      let ownHits = 0;
      own.points.forEach((point, index) => {
        // 自分の重心はその曲を除いて計算する。含めると自明に自分が最も近くなる
        const ownCenter = centroid(own.points.filter((_, i) => i !== index));
        const ranked = [
          { id: own.profile.id, value: distance(point, ownCenter) },
          ...cores.filter((other) => other.profile.id !== own.profile.id)
            .map((other) => ({ id: other.profile.id, value: distance(point, centroid(other.points)) })),
        ].sort((a, b) => a.value - b.value);
        total++;
        if (ranked[0]!.id === own.profile.id) { hits++; ownHits++; }
      });
      // 重複した定義は自分と相手へ半々に落ちる。全体精度だけでは 1 つの
      // ダイアレクトの全滅が埋もれるため、個別にも見る
      expect(ownHits / own.points.length, `${own.profile.id} が他と混ざっている`)
        .toBeGreaterThan(0.5);
      if (ownHits < own.points.length) misses.push(`${own.profile.id} ${ownHits}/${own.points.length}`);
    }
    expect(hits / total, `分類できなかった組: ${misses.join(", ")}`).toBeGreaterThan(0.8);
  });

  /**
   * 近さそのものはしきい値で縛らず、診断として残す。実在の作曲家の語法にも
   * 近い組はあり (twilight と angular)、離すこと自体は目的ではない。
   * ダイアレクトを足したときに、どの組が近づいたかを読むための出力。
   */
  it("最も近い組を診断として記録する", () => {
    const rows = cores.map(({ profile, points }) => {
      const center = centroid(points);
      const nearest = cores
        .filter((other) => other.profile.id !== profile.id)
        .map((other) => ({ id: other.profile.id, value: distance(center, centroid(other.points)) }))
        .sort((a, b) => a.value - b.value)[0]!;
      return { id: profile.id, nearest: nearest.id, ratio: nearest.value / spread(points) };
    }).sort((a, b) => a.ratio - b.ratio);
    console.info(`最も近い組 (比が小さい順): ${rows.slice(0, 5)
      .map((row) => `${row.id}←${row.nearest} ${row.ratio.toFixed(2)}`).join(" / ")}`);
    // 重心が完全に重なる (= 定義が同一) 場合だけを異常として弾く
    for (const row of rows) expect(row.ratio, `${row.id} と ${row.nearest}`).toBeGreaterThan(0.5);
  });
});

describe("ダイアレクト内の多様性 (シードを変えたときの伴奏の振れ幅)", () => {
  it("全ダイアレクトが複数の伴奏バリアントを宣言している", () => {
    for (const dialect of dialectList) {
      const variants = (dialect.defaults.arrangementVariants ?? []).filter((item) => item.weight > 0);
      expect(variants.length, `${dialect.id} の伴奏が 1 通りしかない`).toBeGreaterThan(1);
    }
  });

  it("伴奏がシードごとに変化する (1 ダイアレクト 1 伴奏になっていない)", () => {
    const spreads = profiles.map((profile) => ({
      id: profile.id,
      value: spread(vectors(profile, ARRANGEMENT_FEATURES)),
    }));
    const average = spreads.reduce((sum, item) => sum + item.value, 0) / spreads.length;
    // 伴奏を defaults.arrangement 1 つで固定していた頃は全体平均 0.09 で、
    // 何シード回しても同じ伴奏だった
    expect(average, "伴奏の振れ幅が固定伴奏時代の水準へ戻っている").toBeGreaterThan(0.5);
    // 少数シードでは、重みの大きいバリアントばかり引く組み合わせが起こりうる。
    // 個別のしきい値は「大半のダイアレクトで実際に振れている」ことの確認に留める
    const varying = spreads.filter((item) => item.value > 0.2);
    expect(
      varying.length,
      `伴奏が動いていないダイアレクト: ${spreads.filter((item) => item.value <= 0.2).map((item) => item.id).join(", ")}`,
    ).toBeGreaterThanOrEqual(profiles.length - 3);
  });

  it("旋律・和声もシードごとに変化する", () => {
    for (const profile of profiles) {
      const value = spread(vectors(profile, CORE_FEATURES));
      expect(value, `${profile.id} の作曲内容がシードで変化していない`).toBeGreaterThan(0.4);
    }
  });
});

describe("ダイアレクトの宣言が実際に使われている", () => {
  it("全ダイアレクトが名前付き技法を宣言している", () => {
    for (const dialect of dialectList) {
      expect(dialect.chord.cliches.length, `${dialect.id} に技法がない`).toBeGreaterThan(0);
    }
  });

  it("全ダイアレクトが BassProfile と旋律音域を宣言している", () => {
    for (const dialect of dialectList) {
      expect(dialect.bass, `${dialect.id} に bass がない`).toBeDefined();
      expect(dialect.bass!.roles, `${dialect.id} に bass.roles がない`).toBeDefined();
      expect(dialect.register?.melody, `${dialect.id} に register.melody がない`).toBeDefined();
    }
  });

  it("宣言した活動量がベースの音数へ反映される", () => {
    const points = dialectList.map((dialect, index) => ({
      id: dialect.id,
      activity: dialect.bass!.activity!,
      density: profiles[index]!.samples
        .reduce((sum, sample) => sum + sample.bassNotesPerBar, 0) / SEEDS.length,
    }));
    const low = points.filter((point) => point.activity <= 0.4);
    const high = points.filter((point) => point.activity >= 0.7);
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(average(low.map((point) => point.density)))
      .toBeLessThan(average(high.map((point) => point.density)));
  });

  it("宣言した旋律音域が守られる", () => {
    for (const [index, dialect] of dialectList.entries()) {
      const [low] = dialect.register!.melody!;
      const measured = Math.min(...profiles[index]!.samples.map((sample) => sample.melCenter));
      expect(measured, `${dialect.id} の旋律が宣言した下限より低い`).toBeGreaterThanOrEqual(low);
    }
  });
});
