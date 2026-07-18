import type { Dialect } from "../engine/types.js";
import chromaticJson from "./chromatic.json" with { type: "json" };
import modalJson from "./modal.json" with { type: "json" };
import pedalJson from "./pedal.json" with { type: "json" };
import twilightJson from "./twilight.json" with { type: "json" };
import angularJson from "./angular.json" with { type: "json" };
import orchestralJson from "./orchestral.json" with { type: "json" };
import bossaJson from "./bossa.json" with { type: "json" };
import ostinatoJson from "./ostinato.json" with { type: "json" };
import sereneJson from "./serene.json" with { type: "json" };

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

export const chromatic: Dialect = loadDialect(chromaticJson);
export const modal: Dialect = loadDialect(modalJson);
export const pedal: Dialect = loadDialect(pedalJson);
export const twilight: Dialect = loadDialect(twilightJson);
export const angular: Dialect = loadDialect(angularJson);
export const orchestral: Dialect = loadDialect(orchestralJson);
export const bossa: Dialect = loadDialect(bossaJson);
export const ostinato: Dialect = loadDialect(ostinatoJson);
export const serene: Dialect = loadDialect(sereneJson);

/** id と短縮名の両方で引ける */
export const dialects: Record<string, Dialect> = {
  [chromatic.id]: chromatic,
  [modal.id]: modal,
  [pedal.id]: pedal,
  [twilight.id]: twilight,
  [angular.id]: angular,
  [orchestral.id]: orchestral,
  [bossa.id]: bossa,
  [ostinato.id]: ostinato,
  [serene.id]: serene,
  chromatic,
  modal,
  pedal,
  twilight,
  angular,
  orchestral,
  bossa,
  ostinato,
  serene,
};

/** UI 表示用の重複なしリスト */
export const dialectList: Dialect[] = [
  chromatic,
  modal,
  pedal,
  twilight,
  angular,
  orchestral,
  bossa,
  ostinato,
  serene,
];

/** "Chromatic (〜)" → "Chromatic" のような短縮表示名 */
export function shortName(dialect: Dialect): string {
  return dialect.name.split(" ")[0] ?? dialect.name;
}
