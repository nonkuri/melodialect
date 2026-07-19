import type { ChordDraftSlot, Mode, SectionType } from "../engine/types.js";

export interface ChordProgressionTemplate {
  id: string;
  name: string;
  createdAt: string;
  /** ローマ数字なので、適用先のキーへ自動的に移調される。 */
  relativeToKey: true;
  mode: Mode;
  meterName: string;
  sectionTypes: SectionType[];
  sections: ChordDraftSlot[][];
}

const STORAGE_KEY = "melodialect.chordTemplates.v1";

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function listChordTemplates(): ChordProgressionTemplate[] {
  try {
    const value = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is ChordProgressionTemplate => Boolean(
        item && typeof item === "object" && (item as ChordProgressionTemplate).relativeToKey === true,
      ))
      : [];
  } catch {
    return [];
  }
}

export function saveChordTemplate(
  name: string,
  mode: Mode,
  meterName: string,
  sectionTypes: SectionType[],
  sections: ChordDraftSlot[][],
): ChordProgressionTemplate {
  const template: ChordProgressionTemplate = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim() || "コード進行テンプレート",
    createdAt: new Date().toISOString(),
    relativeToKey: true,
    mode,
    meterName,
    sectionTypes: [...sectionTypes],
    sections: structuredClone(sections),
  };
  storage()?.setItem(STORAGE_KEY, JSON.stringify([template, ...listChordTemplates()].slice(0, 40)));
  return template;
}

export function deleteChordTemplate(id: string): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(listChordTemplates().filter((item) => item.id !== id)));
}
