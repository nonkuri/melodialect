/**
 * 拍子 (§4.2)。内部の時間単位は常に 4 分音符 = 1 beat。
 * 6/8 は複合拍子として 1 小節 = 3 beats (付点 4 分 × 2 拍) で扱う。
 */
export interface Meter {
  /** 表示名 ("4/4" など)。VexFlow の拍子記号にもそのまま使う */
  name: string;
  /** 1 小節の長さ (4 分音符単位) */
  barBeats: number;
  /** 強拍位置 (小節内 beat)。メロディのコードトーン同期に使う */
  strongBeats: number[];
  /** SMF 拍子メタイベント用 */
  midiNumerator: number;
  midiDenominator: number;
  /** メトロノームクリック間隔 (MIDI クロック)。6/8 は付点 4 分 = 36 */
  midiClocks: number;
  /**
   * 変拍子の内部グルーピング (4 分音符単位)。5/4 = 3+2、7/8 = 2+2+3 八分。
   * 均等拍子には持たせない。これがある拍子は「1 小節を等間隔で割り切れない」
   * ため、伴奏・ベースは小節頭からグループ単位で敷き直す。
   */
  groups?: number[];
}

export const METERS: Record<string, Meter> = {
  "4/4": {
    name: "4/4", barBeats: 4, strongBeats: [0, 2],
    midiNumerator: 4, midiDenominator: 4, midiClocks: 24,
  },
  "3/4": {
    name: "3/4", barBeats: 3, strongBeats: [0],
    midiNumerator: 3, midiDenominator: 4, midiClocks: 24,
  },
  "6/8": {
    name: "6/8", barBeats: 3, strongBeats: [0, 1.5],
    midiNumerator: 6, midiDenominator: 8, midiClocks: 36,
  },
  "5/4": {
    name: "5/4", barBeats: 5, strongBeats: [0, 3],
    midiNumerator: 5, midiDenominator: 4, midiClocks: 24,
    groups: [3, 2],
  },
  "7/8": {
    name: "7/8", barBeats: 3.5, strongBeats: [0, 1, 2],
    midiNumerator: 7, midiDenominator: 8, midiClocks: 12,
    groups: [1, 1, 1.5],
  },
};

/** グループの頭 (小節内 beat)。均等拍子は強拍をそのまま返す。 */
export function groupHeads(meter: Meter): number[] {
  if (!meter.groups) return meter.strongBeats;
  const heads: number[] = [];
  let beat = 0;
  for (const group of meter.groups) {
    heads.push(beat);
    beat += group;
  }
  return heads;
}

export const DEFAULT_METER: Meter = METERS["4/4"]!;

export function meterOf(name: string): Meter {
  const meter = METERS[name];
  if (!meter) {
    throw new Error(`unknown meter: ${name} (available: ${Object.keys(METERS).join(", ")})`);
  }
  return meter;
}
