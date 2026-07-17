import type { Dialect } from "../engine/types.js";
import paulJson from "./paul.json" with { type: "json" };

/** ダイアレクト JSON の読み込みと軽量バリデーション (§6.2) */
export function loadDialect(data: unknown): Dialect {
  const d = data as Dialect;
  if (!d.id || !d.chord?.vocabulary?.length || !d.melody?.leapProbability) {
    throw new Error("invalid dialect definition");
  }
  if (d.melody.leapRangeSemitones.length !== 2) {
    throw new Error(`dialect ${d.id}: leapRangeSemitones must be [min, max]`);
  }
  return d;
}

export const paul: Dialect = loadDialect(paulJson);

export const dialects: Record<string, Dialect> = {
  [paul.id]: paul,
  paul, // CLI 用の短縮名
};
