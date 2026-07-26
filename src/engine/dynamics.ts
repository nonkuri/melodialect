/**
 * 強弱 (v1.9)。
 *
 * 導入前の実測 (agitato・12 シード・既定フロー): 旋律の velocity は 90 と 100 の
 * 2 値しかなく、伴奏も奏法ごとの定数 + humanize のジッタだけだった。つまり
 * 全 20 ダイアレクトが曲頭から曲尾まで平坦に鳴っていて、セクション対比を
 * 担っていたのは編成と密度だけ。「同じ編成のまま弱く始めて盛り上げる」
 * 「カデンツの直前で急に落とす」が表現できなかった。
 *
 * ここは音を足さない。生成済みの NoteEvent の velocity へ倍率を掛けるだけの
 * 後段パスにしてある。奏法ごとに直書きされた velocity 定数 (accompaniment.ts)
 * を書き換えずに済み、パート間の音量バランスも比のまま保たれる。
 *
 * 宣言しないダイアレクトの出力は倍率 1 で完全に不変 (DEFAULT_DYNAMICS)。
 */
import type {
  Dialect,
  DynamicLevel,
  DynamicsProfile,
  GeneratedSection,
  NoteEvent,
  SectionType,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { Rng } from "./rng.js";

/** mf を 1.0 とした相対倍率。1 段で約 15% 変わる */
const LEVEL_GAIN: Record<DynamicLevel, number> = {
  pp: 0.62, p: 0.74, mp: 0.87, mf: 1, f: 1.14, ff: 1.3,
};

export const DEFAULT_DYNAMICS: DynamicsProfile = {
  sectionLevels: {},
  sectionArc: 0,
  phraseShape: 0,
  accent: 0,
  accentBeats: [],
  subitoProbability: 0,
};

export function dynamicsFor(dialect: Dialect): DynamicsProfile {
  const source = dialect.dynamics;
  if (!source) return DEFAULT_DYNAMICS;
  return {
    sectionLevels: { ...DEFAULT_DYNAMICS.sectionLevels, ...source.sectionLevels },
    sectionArc: source.sectionArc ?? DEFAULT_DYNAMICS.sectionArc,
    phraseShape: source.phraseShape ?? DEFAULT_DYNAMICS.phraseShape,
    accent: source.accent ?? DEFAULT_DYNAMICS.accent,
    accentBeats: source.accentBeats ?? DEFAULT_DYNAMICS.accentBeats,
    subitoProbability: source.subitoProbability ?? DEFAULT_DYNAMICS.subitoProbability,
  };
}

function isFlat(profile: DynamicsProfile): boolean {
  return !Object.keys(profile.sectionLevels).length &&
    profile.sectionArc === 0 && profile.phraseShape === 0 &&
    profile.accent === 0 && profile.subitoProbability === 0;
}

function levelFor(profile: DynamicsProfile, type: SectionType): DynamicLevel {
  return profile.sectionLevels[type] ?? profile.sectionLevels.default ?? "mf";
}

/** フレーズごとの [開始拍, 終了拍)。plan.phraseLengths は小節数 */
function phraseSpans(section: GeneratedSection, meter: Meter): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let bar = 0;
  for (const bars of section.plan.phraseLengths) {
    spans.push([bar * meter.barBeats, (bar + bars) * meter.barBeats]);
    bar += bars;
  }
  // コーダで小節が増えた分は最後のフレーズに含める
  const total = section.plan.bars * meter.barBeats;
  if (spans.length && spans.at(-1)![1] < total) spans.at(-1)![1] = total;
  return spans;
}

/**
 * ここから上をソフトに丸める。127 で頭打ちにすると、強奏セクションの中で
 * アクセントだけが潰れて「宣言したのに聞こえない」状態になる (実測: f と ff の
 * セクションで最大値が軒並み 127 に張り付いた)。逆に曲全体をピークで割ると
 * 曲がまるごと静かになる (実測: 平均 87 → 59)。上だけを圧縮して両方を避ける
 */
const KNEE = 96;

/** KNEE 以上を 127 へ漸近させる。単調なので強弱の順序は保たれる */
function softLimit(velocity: number): number {
  if (velocity <= KNEE) return velocity;
  const span = 127 - KNEE;
  return KNEE + span * (1 - Math.exp(-(velocity - KNEE) / span));
}

/**
 * セクションの強弱曲線を作り、全パートの velocity へ掛ける。
 * 曲線は 1 本だけで、旋律も伴奏もベースも同じ倍率を受ける。パートごとに
 * 別の曲線を当てると強弱ではなくミックスになり、アンサンブルが分解する
 */
function sectionDynamics(
  section: GeneratedSection,
  dialect: Dialect,
  meter: Meter,
  rng: Rng,
): { annotations: GeneratedSection["annotations"]; gains: Map<NoteEvent, number> } | null {
  const profile = dynamicsFor(dialect);
  if (isFlat(profile)) return null;

  const base = LEVEL_GAIN[levelFor(profile, section.plan.type)];
  const spans = phraseSpans(section, meter);
  const totalBeats = section.plan.bars * meter.barBeats;
  const accentBeats = profile.accentBeats.length
    ? profile.accentBeats
    : dialect.groove?.accentPattern ?? [];

  // subito: フレーズの最終小節を 1 段落とす。カデンツへ向けて張り詰めた音量を
  // 急に抜くことで、次の強奏が際立つ
  const subitoBars = new Set<number>();
  if (profile.subitoProbability > 0) {
    for (const [, end] of spans) {
      if (rng.chance(profile.subitoProbability)) subitoBars.add(Math.round(end / meter.barBeats) - 1);
    }
  }

  const gainAt = (start: number): number => {
    let gain = base;
    // セクション弧: 頭から末尾へ向かって直線的に増減する
    if (profile.sectionArc !== 0 && totalBeats > 0) {
      gain *= 1 + profile.sectionArc * (start / totalBeats - 0.5);
    }
    // フレーズ弧: フレーズの中ほどで山を作り、切れ目で戻す
    if (profile.phraseShape !== 0) {
      const span = spans.find(([from, to]) => start >= from && start < to) ?? spans.at(-1);
      if (span && span[1] > span[0]) {
        const t = (start - span[0]) / (span[1] - span[0]);
        gain *= 1 + profile.phraseShape * (Math.sin(Math.PI * t) - 0.5);
      }
    }
    if (subitoBars.has(Math.floor(start / meter.barBeats))) gain *= 0.72;
    // アクセント: 宣言した拍位置だけを突き上げる (sf)
    if (profile.accent > 0 && accentBeats.length) {
      const beatInBar = start % meter.barBeats;
      if (accentBeats.some((beat) => Math.abs(beatInBar - beat) < 1e-6)) {
        gain *= 1 + profile.accent * 0.35;
      }
    }
    return gain;
  };

  const gains = new Map<NoteEvent, number>();
  for (const part of [section.melody, section.piano, section.guitar, section.bass, section.drums]) {
    for (const note of part) gains.set(note, gainAt(note.start));
  }

  const parts: string[] = [`基準 ${levelFor(profile, section.plan.type)}`];
  if (profile.sectionArc > 0) parts.push("セクション全体でクレッシェンド");
  else if (profile.sectionArc < 0) parts.push("セクション全体でディミヌエンド");
  if (profile.phraseShape > 0) parts.push("フレーズごとに山を作る");
  if (profile.accent > 0 && accentBeats.length) parts.push(`${accentBeats.join("・")}拍にアクセント`);
  if (subitoBars.size) parts.push(`${[...subitoBars].sort((a, b) => a - b).map((bar) => bar + 1).join("・")}小節目で急に弱く`);
  return {
    gains,
    annotations: [{
      bar: 0,
      ruleId: "dynamics",
      level: "section",
      category: "arrangement",
      text: `強弱: ${parts.join(" / ")}`,
    }],
  };
}

/**
 * 曲全体へ強弱を適用する。倍率はセクション単位で作るが、正規化は曲を通して
 * 1 度だけ行う。セクションごとに正規化すると、セクション間の対比 (p の Intro と
 * ff の Outro) がその場で潰れてしまう。
 *
 * 正規化は曲全体の平均倍率を 1 にする形にした。強弱は相対的な形であって
 * 絶対音量ではない (絶対音量はミキサーの volume と velocityScale の担当) ので、
 * 宣言してもしなくても曲全体の音量は変わらず、中の起伏だけが変わる
 */
export function applySongDynamics(
  sections: GeneratedSection[],
  meter: Meter,
  dialectAt: (index: number) => Dialect,
  rngAt: (index: number) => Rng,
): void {
  const planned = sections.map((section, index) =>
    sectionDynamics(section, dialectAt(index), meter, rngAt(index)));
  if (planned.every((entry) => entry === null)) return;

  let total = 0;
  let count = 0;
  planned.forEach((entry) => {
    entry?.gains.forEach((gain) => { total += gain; count++; });
  });
  const normalize = count && total > 0 ? count / total : 1;

  planned.forEach((entry, index) => {
    if (!entry) return;
    entry.gains.forEach((gain, note) => {
      note.velocity = Math.max(1, Math.round(softLimit(note.velocity * gain * normalize)));
    });
    sections[index]!.annotations.push(...entry.annotations);
  });
}
