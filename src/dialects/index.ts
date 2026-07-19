import type { Dialect } from "../engine/types.js";
import { parseRoman } from "../engine/harmony.js";
import { registeredClicheNames } from "../engine/techniques.js";
import chromaticJson from "./chromatic.json" with { type: "json" };
import modalJson from "./modal.json" with { type: "json" };
import pedalJson from "./pedal.json" with { type: "json" };
import twilightJson from "./twilight.json" with { type: "json" };
import angularJson from "./angular.json" with { type: "json" };
import orchestralJson from "./orchestral.json" with { type: "json" };
import bossaJson from "./bossa.json" with { type: "json" };
import ostinatoJson from "./ostinato.json" with { type: "json" };
import sereneJson from "./serene.json" with { type: "json" };
import flowJson from "./flow.json" with { type: "json" };
import blueJson from "./blue.json" with { type: "json" };
import lamentJson from "./lament.json" with { type: "json" };
import interlockJson from "./interlock.json" with { type: "json" };
import voicingJson from "./voicing.json" with { type: "json" };

export interface DialectValidationIssue {
  path: string;
  message: string;
}

const MAX_DIALECT_BYTES = 128 * 1024;

/** ユーザー入力にも使う項目別スキーマ検証。 */
export function validateDialectDefinition(data: unknown): DialectValidationIssue[] {
  const issues: DialectValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength; } catch { add("$", "JSONとして直列化できません"); }
  if (bytes > MAX_DIALECT_BYTES) add("$", `最大サイズ ${MAX_DIALECT_BYTES / 1024}KB を超えています`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    add("$", "オブジェクトである必要があります");
    return issues;
  }
  const d = data as Partial<Dialect>;
  if (typeof d.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(d.id)) {
    add("id", "2〜48文字の英小文字・数字・ハイフンで指定してください");
  }
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 100) add("name", "1〜100文字で指定してください");
  if (!d.defaults || typeof d.defaults !== "object") add("defaults", "既定値が必要です");
  else {
    if (typeof d.defaults.key !== "string" || !/^[A-G](?:#|b)?$/.test(d.defaults.key)) add("defaults.key", "C、F#、Bb などで指定してください");
    if (d.defaults.mode !== "major" && d.defaults.mode !== "minor") add("defaults.mode", "major または minor を指定してください");
    if (!Number.isFinite(d.defaults.bpm) || d.defaults.bpm! < 40 || d.defaults.bpm! > 240) add("defaults.bpm", "40〜240の範囲で指定してください");
    if (d.defaults.meter && !["4/4", "3/4", "6/8"].includes(d.defaults.meter)) add("defaults.meter", "4/4、3/4、6/8 のいずれかです");
  }
  if (!d.chord || typeof d.chord !== "object") add("chord", "コード定義が必要です");
  else {
    if (!Array.isArray(d.chord.vocabulary) || d.chord.vocabulary.length < 1 || d.chord.vocabulary.length > 64) {
      add("chord.vocabulary", "1〜64個のコードが必要です");
    } else d.chord.vocabulary.forEach((symbol, index) => {
      if (typeof symbol !== "string") add(`chord.vocabulary[${index}]`, "文字列で指定してください");
      else try { parseRoman(symbol); } catch { add(`chord.vocabulary[${index}]`, `${symbol} は不正なローマ数字です`); }
    });
    if (!d.chord.transitions || typeof d.chord.transitions !== "object") add("chord.transitions", "遷移表が必要です");
    else Object.entries(d.chord.transitions).forEach(([from, table]) => {
      if (!table || typeof table !== "object") return add(`chord.transitions.${from}`, "遷移先と重みのオブジェクトが必要です");
      Object.entries(table).forEach(([to, weight]) => {
        if (!Number.isFinite(weight) || weight < 0 || weight > 100) add(`chord.transitions.${from}.${to}`, "重みは0〜100です");
      });
    });
    if (!Array.isArray(d.chord.cliches)) add("chord.cliches", "配列で指定してください");
    else {
      const allowed = new Set(registeredClicheNames());
      d.chord.cliches.forEach((name, index) => {
        if (!allowed.has(name)) add(`chord.cliches[${index}]`, `${name} は参照できない技法です（${[...allowed].join(", ")}）`);
      });
    }
  }
  if (!d.melody || typeof d.melody !== "object") add("melody", "旋律定義が必要です");
  else {
    const probabilities = [
      ["default", d.melody.leapProbability?.default],
      ["chorusHead", d.melody.leapProbability?.chorusHead],
    ] as const;
    probabilities.forEach(([path, value]) => {
      if (!Number.isFinite(value) || value! < 0 || value! > 1) add(`melody.leapProbability.${path}`, "0〜1の範囲で指定してください");
    });
    if (!Array.isArray(d.melody.leapRangeSemitones) || d.melody.leapRangeSemitones.length !== 2 ||
        d.melody.leapRangeSemitones.some((value) => !Number.isFinite(value) || value < 0 || value > 24) ||
        d.melody.leapRangeSemitones[0]! > d.melody.leapRangeSemitones[1]!) {
      add("melody.leapRangeSemitones", "[最小, 最大] を0〜24半音で指定してください");
    }
    const contours = ["stepwise", "repetitive", "pedal", "leap-then-descend", "angular", "syncopated-narrow", "ostinato", "floating", "arch", "call-response", "descending", "interlocking", "voice-led"];
    if (!contours.includes(d.melody.contour ?? "")) add("melody.contour", "利用可能な旋律輪郭を指定してください");
    if (!['down', 'up', 'none'].includes(d.melody.afterLeapBias ?? "")) add("melody.afterLeapBias", "down、up、none のいずれかです");
    if (typeof d.melody.pedalPoint !== "boolean") add("melody.pedalPoint", "真偽値で指定してください");
  }
  if (!d.structure || !Array.isArray(d.structure.phraseLengths) || !d.structure.phraseLengths.length ||
      d.structure.phraseLengths.length > 16 || d.structure.phraseLengths.some((value) => !Number.isInteger(value) || value < 1 || value > 32)) {
    add("structure.phraseLengths", "1〜32小節の値を最大16個で指定してください");
  }
  if (!Number.isFinite(d.structure?.irregularPhraseProbability) || d.structure!.irregularPhraseProbability < 0 || d.structure!.irregularPhraseProbability > 1) {
    add("structure.irregularPhraseProbability", "0〜1の範囲で指定してください");
  }
  return issues;
}

/** ダイアレクト JSON の読み込みと検証 (§6.2) */
export function loadDialect(data: unknown): Dialect {
  const issues = validateDialectDefinition(data);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  return structuredClone(data) as Dialect;
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
export const flow: Dialect = loadDialect(flowJson);
export const blue: Dialect = loadDialect(blueJson);
export const lament: Dialect = loadDialect(lamentJson);
export const interlock: Dialect = loadDialect(interlockJson);
export const voicing: Dialect = loadDialect(voicingJson);

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
  [flow.id]: flow,
  [blue.id]: blue,
  [lament.id]: lament,
  [interlock.id]: interlock,
  [voicing.id]: voicing,
  chromatic,
  modal,
  pedal,
  twilight,
  angular,
  orchestral,
  bossa,
  ostinato,
  serene,
  flow,
  blue,
  lament,
  interlock,
  voicing,
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
  flow,
  blue,
  lament,
  interlock,
  voicing,
];

const USER_DIALECTS_KEY = "melodialect.userDialects.v1";
const BUILTIN_IDS = new Set([...dialectList.map((dialect) => dialect.id), ...Object.keys(dialects)]);

function userStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function registerUserDialect(dialect: Dialect): void {
  dialects[dialect.id] = dialect;
  const index = dialectList.findIndex((item) => item.id === dialect.id);
  if (index >= 0) dialectList[index] = dialect;
  else dialectList.push(dialect);
}

export function listUserDialects(): Dialect[] {
  return dialectList.filter((dialect) => !BUILTIN_IDS.has(dialect.id));
}

function persistUserDialects(): void {
  userStorage()?.setItem(USER_DIALECTS_KEY, JSON.stringify(listUserDialects()));
}

export function saveUserDialect(data: unknown): Dialect {
  const dialect = loadDialect(data);
  if (BUILTIN_IDS.has(dialect.id)) throw new Error("内蔵ダイアレクトと同じ id は使用できません");
  registerUserDialect(dialect);
  persistUserDialects();
  return dialect;
}

export function removeUserDialect(id: string): void {
  if (BUILTIN_IDS.has(id)) return;
  delete dialects[id];
  const index = dialectList.findIndex((dialect) => dialect.id === id);
  if (index >= 0) dialectList.splice(index, 1);
  persistUserDialects();
}

export function downloadDialectJson(dialect: Dialect): void {
  const blob = new Blob([JSON.stringify(dialect, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${dialect.id}.dialect.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readUserDialectFile(file: File): Promise<Dialect> {
  if (file.size > MAX_DIALECT_BYTES) throw new Error(`最大サイズ ${MAX_DIALECT_BYTES / 1024}KB を超えています`);
  return saveUserDialect(JSON.parse(await file.text()));
}

function hydrateUserDialects(): void {
  const raw = userStorage()?.getItem(USER_DIALECTS_KEY);
  if (!raw) return;
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return;
    values.forEach((value) => {
      try {
        const dialect = loadDialect(value);
        if (!BUILTIN_IDS.has(dialect.id)) registerUserDialect(dialect);
      } catch { /* 壊れた1件だけを無視し、他の保存済み定義は利用可能にする */ }
    });
  } catch { /* storage is best-effort */ }
}

hydrateUserDialects();

/** "Chromatic (〜)" → "Chromatic" のような短縮表示名 */
export function shortName(dialect: Dialect): string {
  return dialect.name.split(" ")[0] ?? dialect.name;
}
