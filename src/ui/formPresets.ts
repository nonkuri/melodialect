import { parseForm } from "../engine/structure.js";

/** 標準の構成プリセット (§4.2) */
export const STANDARD_FORMS: Array<{ label: string; value: string }> = [
  { label: "Verse-Chorus ×2", value: "v,c,v,c" },
  { label: "V-C-V-C-B-C", value: "v,c,v,c,b,c" },
  { label: "Intro/Outro 付き", value: "i,v,c,v,c,o" },
  { label: "AABA (Verse×2-Bridge-Verse)", value: "v,v,b,v" },
  { label: "フル構成", value: "i,v,c,v,c,b,c,o" },
  { label: "Verse ×2", value: "v,v" },
  { label: "Chorus のみ", value: "c" },
];

const STORAGE_KEY = "melodialect.customForms";

/** ユーザー定義の構成を localStorage から読む */
export function loadCustomForms(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function saveCustomForms(forms: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(forms));
}

/** 構成文字列の妥当性チェック。正規化した文字列を返し、不正なら null */
export function validateForm(formStr: string): string | null {
  try {
    const entries = parseForm(formStr);
    if (entries.length === 0 || entries.length > 16) return null;
    return entries
      .map((e) => {
        const short = { intro: "i", verse: "v", chorus: "c", bridge: "b", outro: "o" }[e.type];
        return e.dialectName ? `${short}:${e.dialectName}` : short;
      })
      .join(",");
  } catch {
    return null;
  }
}
