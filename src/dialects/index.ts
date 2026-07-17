import type { Dialect } from "../engine/types.js";
import paulJson from "./paul.json" with { type: "json" };
import johnJson from "./john.json" with { type: "json" };
import georgeJson from "./george.json" with { type: "json" };
import yumingJson from "./yuming.json" with { type: "json" };

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
export const john: Dialect = loadDialect(johnJson);
export const george: Dialect = loadDialect(georgeJson);
export const yuming: Dialect = loadDialect(yumingJson);

/** id と短縮名の両方で引ける */
export const dialects: Record<string, Dialect> = {
  [paul.id]: paul,
  [john.id]: john,
  [george.id]: george,
  [yuming.id]: yuming,
  paul,
  john,
  george,
  yuming,
};

/** UI 表示用の重複なしリスト */
export const dialectList: Dialect[] = [paul, john, george, yuming];

/** "Paul (〜)" → "Paul" のような短縮表示名 */
export function shortName(dialect: Dialect): string {
  return dialect.name.split(" ")[0] ?? dialect.name;
}
