import type { Dialect, SectionPlan, SectionType } from "./types.js";
import type { Rng } from "./rng.js";

/**
 * 構成生成 (§4.2 手順 1)。
 * セクションに対しフレーズ長を決定する。irregularPhraseProbability により
 * フレーズを 1 小節削って 7 小節構成などの変則化を行う (Modal / §4.1 D1)。
 */
export function planSection(type: SectionType, dialect: Dialect, rng: Rng): SectionPlan {
  const phraseLengths = dialect.structure.phraseLengths.map((len) => {
    if (len > 2 && rng.chance(dialect.structure.irregularPhraseProbability)) {
      return len - 1;
    }
    return len;
  });
  const bars = phraseLengths.reduce((a, b) => a + b, 0);
  return { type, phraseLengths, bars };
}

export interface FormEntry {
  type: SectionType;
  /** 合作モード (§4.2): このセクションに割り当てるダイアレクト名。省略時はメイン */
  dialectName?: string;
}

const TYPE_MAP: Record<string, SectionType> = {
  i: "intro", v: "verse", c: "chorus", b: "bridge", o: "outro",
  intro: "intro", verse: "verse", chorus: "chorus", bridge: "bridge", outro: "outro",
};

/**
 * 構成文字列のパース。"v,c,v,c" のほか、セクション別ダイアレクト割り当て
 * "v:modal,c:chromatic" (合作モード) をサポートする。
 */
export function parseForm(formStr: string): FormEntry[] {
  return formStr
    .split(/[,\s]+/)
    .filter((t) => t.length > 0)
    .map((token) => {
      const [typePart, dialectName] = token.split(":");
      const type = TYPE_MAP[(typePart ?? "").toLowerCase()];
      if (!type) throw new Error(`unknown section type: ${token}`);
      return dialectName ? { type, dialectName } : { type };
    });
}
