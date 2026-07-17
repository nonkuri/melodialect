import type { Dialect, SectionPlan, SectionType } from "./types.js";
import type { Rng } from "./rng.js";

/**
 * 構成生成 (§4.2 手順 1)。
 * セクション列に対しフレーズ長を決定する。irregularPhraseProbability により
 * フレーズを 1 小節削って 7 小節構成などの変則化を行う (John / §4.1 D1)。
 */
export function planStructure(
  form: SectionType[],
  dialect: Dialect,
  rng: Rng,
): SectionPlan[] {
  return form.map((type) => {
    const phraseLengths = dialect.structure.phraseLengths.map((len) => {
      if (len > 2 && rng.chance(dialect.structure.irregularPhraseProbability)) {
        return len - 1;
      }
      return len;
    });
    const bars = phraseLengths.reduce((a, b) => a + b, 0);
    return { type, phraseLengths, bars };
  });
}

export function parseForm(formStr: string): SectionType[] {
  const map: Record<string, SectionType> = {
    i: "intro", v: "verse", c: "chorus", b: "bridge", o: "outro",
    intro: "intro", verse: "verse", chorus: "chorus", bridge: "bridge", outro: "outro",
  };
  return formStr
    .split(/[,\s-]+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      const type = map[t.toLowerCase()];
      if (!type) throw new Error(`unknown section type: ${t}`);
      return type;
    });
}
