import type { Dialect } from "../engine/types.js";
import { parseRoman } from "../engine/harmony.js";
import { METERS } from "../engine/meter.js";
import { registeredClicheNames } from "../engine/techniques.js";
import { registeredMotifOperatorNames } from "../engine/motifOps.js";
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
import driftJson from "./drift.json" with { type: "json" };
import pulseJson from "./pulse.json" with { type: "json" };
import emberJson from "./ember.json" with { type: "json" };
import prismJson from "./prism.json" with { type: "json" };
import ryukyuJson from "./ryukyu.json" with { type: "json" };
import miyakobushiJson from "./miyakobushi.json" with { type: "json" };
import agitatoJson from "./agitato.json" with { type: "json" };

export interface DialectValidationIssue {
  path: string;
  message: string;
}

const MAX_DIALECT_BYTES = 128 * 1024;
const SECTION_KEYS = ["intro", "verse", "chorus", "bridge", "outro"] as const;
export const MELODIC_CONTOURS = [
  "stepwise", "repetitive", "pedal", "leap-then-descend", "angular",
  "syncopated-narrow", "ostinato", "floating", "arch", "call-response",
  "descending", "interlocking", "voice-led",
] as const;
export const PITCH_COLLECTIONS = [
  "major", "lydian", "mixolydian", "dorian", "phrygian",
  "natural-minor", "harmonic-minor", "major-pentatonic", "minor-pentatonic", "blues",
  "ryukyu", "miyakobushi", "ritsu",
] as const;
export const PIANO_PATTERNS = ["off", "block", "arpeggio", "bossa", "eighth", "ballad", "syncopated", "voice-led"] as const;
export const GUITAR_PATTERNS = ["off", "strum", "arpeggio", "bossa", "syncopated", "interlocking"] as const;
export const DRUM_PATTERNS = ["off", "basic", "rock", "bossa", "shuffle", "interlock", "drive"] as const;
export const THEME_RETURNS = ["same", "vary", "new"] as const;
export const DYNAMIC_LEVELS = ["pp", "p", "mp", "mf", "f", "ff"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** ユーザー入力にも使う項目別スキーマ検証。 */
export function validateDialectDefinition(data: unknown): DialectValidationIssue[] {
  const issues: DialectValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const range = (path: string, value: unknown, minimum: number, maximum: number) => {
    if (!finite(value) || value < minimum || value > maximum) add(path, `${minimum}〜${maximum}の数値で指定してください`);
  };
  const probability = (path: string, value: unknown) => range(path, value, 0, 1);
  const boolean = (path: string, value: unknown) => {
    if (typeof value !== "boolean") add(path, "真偽値で指定してください");
  };
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength; } catch { add("$", "JSONとして直列化できません"); }
  if (bytes > MAX_DIALECT_BYTES) add("$", `最大サイズ ${MAX_DIALECT_BYTES / 1024}KB を超えています`);
  if (!isRecord(data)) {
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
    if (d.defaults.meter && !(d.defaults.meter in METERS)) add("defaults.meter", `${Object.keys(METERS).join("、")} のいずれかです`);
  }
  if (d.stylePrompt !== undefined && (typeof d.stylePrompt !== "string" || d.stylePrompt.length > 2000)) {
    add("stylePrompt", "2000文字以内の文字列で指定してください");
  }
  const vocabulary = Array.isArray(d.chord?.vocabulary)
    ? d.chord.vocabulary.filter((symbol): symbol is string => typeof symbol === "string")
    : [];
  const vocabularySet = new Set(vocabulary);
  const validateSymbol = (path: string, symbol: unknown, requireVocabulary = true) => {
    if (typeof symbol !== "string" || !symbol.trim()) return add(path, "コード記号を文字列で指定してください");
    try { parseRoman(symbol); } catch { add(path, `${symbol} は不正なローマ数字です`); }
    if (requireVocabulary && !vocabularySet.has(symbol)) add(path, `${symbol} は chord.vocabulary にありません`);
  };
  const validateProgressions = (path: string, value: unknown) => {
    if (!Array.isArray(value) || value.length > 64) return add(path, "最大64個の進行を配列で指定してください");
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isRecord(item)) return add(itemPath, "symbols と weight を持つオブジェクトが必要です");
      if (!Array.isArray(item.symbols) || item.symbols.length < 1 || item.symbols.length > 16) {
        add(`${itemPath}.symbols`, "1〜16個のコードを配列で指定してください");
      } else item.symbols.forEach((symbol, symbolIndex) =>
        validateSymbol(`${itemPath}.symbols[${symbolIndex}]`, symbol));
      range(`${itemPath}.weight`, item.weight, 0, 100);
    });
  };
  const validateDistribution = (path: string, value: unknown) => {
    if (!isRecord(value)) return add(path, "重みのオブジェクトが必要です");
    const entries = Object.entries(value);
    if (!entries.length) add(path, "1個以上の重みが必要です");
    entries.forEach(([key, weight]) => {
      if (!/^\d+(?:\.\d+)?$/.test(key) || Number(key) <= 0 || Number(key) > 8) add(`${path}.${key}`, "0より大きく8以下のコード数をキーにしてください");
      range(`${path}.${key}`, weight, 0, 100);
    });
    if (entries.length && !entries.some(([, weight]) => finite(weight) && weight > 0)) add(path, "少なくとも1つの重みを0より大きくしてください");
  };
  const validatePhraseLengths = (path: string, value: unknown) => {
    if (!Array.isArray(value) || !value.length || value.length > 16 ||
      value.some((item) => !Number.isInteger(item) || item < 1 || item > 32)) {
      add(path, "1〜32小節の整数を最大16個で指定してください");
    }
  };
  const validateCliches = (path: string, value: unknown) => {
    if (!Array.isArray(value) || value.length > 32) return add(path, "技法名を最大32個の配列で指定してください");
    const allowed = new Set(registeredClicheNames());
    value.forEach((name, index) => {
      if (typeof name !== "string" || !allowed.has(name)) add(`${path}[${index}]`, `${String(name)} は参照できない技法です（${[...allowed].join(", ")}）`);
    });
  };
  if (!d.chord || typeof d.chord !== "object") add("chord", "コード定義が必要です");
  else {
    if (!Array.isArray(d.chord.vocabulary) || d.chord.vocabulary.length < 1 || d.chord.vocabulary.length > 64) {
      add("chord.vocabulary", "1〜64個のコードが必要です");
    } else {
      d.chord.vocabulary.forEach((symbol, index) => validateSymbol(`chord.vocabulary[${index}]`, symbol, false));
      if (new Set(d.chord.vocabulary).size !== d.chord.vocabulary.length) add("chord.vocabulary", "同じコードを重複して指定できません");
    }
    if (!d.chord.transitions || typeof d.chord.transitions !== "object") add("chord.transitions", "遷移表が必要です");
    else Object.entries(d.chord.transitions).forEach(([from, table]) => {
      validateSymbol(`chord.transitions.${from}`, from);
      if (!table || typeof table !== "object") return add(`chord.transitions.${from}`, "遷移先と重みのオブジェクトが必要です");
      Object.entries(table).forEach(([to, weight]) => {
        validateSymbol(`chord.transitions.${from}.${to}`, to);
        range(`chord.transitions.${from}.${to}`, weight, 0, 100);
      });
      if (!Object.values(table).some((weight) => finite(weight) && weight > 0)) add(`chord.transitions.${from}`, "少なくとも1つの遷移重みを0より大きくしてください");
    });
    if (d.chord.idioms !== undefined) validateProgressions("chord.idioms", d.chord.idioms);
    if (d.chord.idiomProbability !== undefined) probability("chord.idiomProbability", d.chord.idiomProbability);
    if (d.chord.cadences !== undefined) {
      if (!isRecord(d.chord.cadences)) add("chord.cadences", "終止形のオブジェクトが必要です");
      else for (const key of ["final", "half"] as const) {
        if (d.chord.cadences[key] !== undefined) validateProgressions(`chord.cadences.${key}`, d.chord.cadences[key]);
      }
    }
    if (d.chord.harmonicRhythm !== undefined) {
      if (!isRecord(d.chord.harmonicRhythm)) add("chord.harmonicRhythm", "セクション別分布のオブジェクトが必要です");
      else Object.entries(d.chord.harmonicRhythm).forEach(([section, distribution]) => {
        if (section !== "default" && !SECTION_KEYS.includes(section as typeof SECTION_KEYS[number])) add(`chord.harmonicRhythm.${section}`, "未知のセクションです");
        validateDistribution(`chord.harmonicRhythm.${section}`, distribution);
      });
    }
    validateCliches("chord.cliches", d.chord.cliches);
    boolean("chord.borrowedChords", d.chord.borrowedChords);
  }
  const arrangement = d.defaults?.arrangement;
  if (arrangement !== undefined) {
    if (!isRecord(arrangement)) add("defaults.arrangement", "推奨伴奏のオブジェクトが必要です");
    else {
      if (arrangement.pianoPattern !== undefined && !PIANO_PATTERNS.includes(arrangement.pianoPattern as typeof PIANO_PATTERNS[number])) add("defaults.arrangement.pianoPattern", "利用可能なピアノパターンを指定してください");
      if (arrangement.guitarPattern !== undefined && !GUITAR_PATTERNS.includes(arrangement.guitarPattern as typeof GUITAR_PATTERNS[number])) add("defaults.arrangement.guitarPattern", "利用可能なギターパターンを指定してください");
      if (arrangement.drumPattern !== undefined && !DRUM_PATTERNS.includes(arrangement.drumPattern as typeof DRUM_PATTERNS[number])) add("defaults.arrangement.drumPattern", "利用可能なドラムパターンを指定してください");
      if (arrangement.swing !== undefined) probability("defaults.arrangement.swing", arrangement.swing);
      if (arrangement.humanize !== undefined) probability("defaults.arrangement.humanize", arrangement.humanize);
      if (arrangement.velocityScale !== undefined) range("defaults.arrangement.velocityScale", arrangement.velocityScale, 0.5, 1.5);
      if (arrangement.accompanimentDensity !== undefined) probability("defaults.arrangement.accompanimentDensity", arrangement.accompanimentDensity);
      if (arrangement.development !== undefined) probability("defaults.arrangement.development", arrangement.development);
      if (arrangement.autoArrange !== undefined) boolean("defaults.arrangement.autoArrange", arrangement.autoArrange);
    }
  }
  const variants = d.defaults?.arrangementVariants;
  if (variants !== undefined) {
    if (!Array.isArray(variants) || !variants.length || variants.length > 8) {
      add("defaults.arrangementVariants", "1〜8個の伴奏バリアントを配列で指定してください");
    } else {
      if (!variants.some((variant) => isRecord(variant) && finite(variant.weight) && variant.weight > 0)) {
        add("defaults.arrangementVariants", "少なくとも1つの重みを0より大きくしてください");
      }
      variants.forEach((variant, index) => {
        const path = `defaults.arrangementVariants[${index}]`;
        if (!isRecord(variant)) return add(path, "name、weight、arrangement を持つオブジェクトが必要です");
        if (typeof variant.name !== "string" || !variant.name.trim() || variant.name.length > 40) {
          add(`${path}.name`, "1〜40文字で指定してください");
        }
        range(`${path}.weight`, variant.weight, 0, 100);
        if (!isRecord(variant.arrangement)) return add(`${path}.arrangement`, "伴奏差分のオブジェクトが必要です");
        // 差分として意味を持つのは奏法とスウィングだけ。他を書けると
        // 「設定したのに効かない」項目が生まれるので、ここで弾く
        const value = variant.arrangement as Record<string, unknown>;
        for (const key of Object.keys(value)) {
          if (!["pianoPattern", "guitarPattern", "drumPattern", "swing"].includes(key)) {
            add(`${path}.arrangement.${key}`, "pianoPattern、guitarPattern、drumPattern、swing のみ指定できます");
          }
        }
        if (value.pianoPattern !== undefined && !PIANO_PATTERNS.includes(value.pianoPattern as typeof PIANO_PATTERNS[number])) add(`${path}.arrangement.pianoPattern`, "利用可能なピアノパターンを指定してください");
        if (value.guitarPattern !== undefined && !GUITAR_PATTERNS.includes(value.guitarPattern as typeof GUITAR_PATTERNS[number])) add(`${path}.arrangement.guitarPattern`, "利用可能なギターパターンを指定してください");
        if (value.drumPattern !== undefined && !DRUM_PATTERNS.includes(value.drumPattern as typeof DRUM_PATTERNS[number])) add(`${path}.arrangement.drumPattern`, "利用可能なドラムパターンを指定してください");
        if (value.swing !== undefined) probability(`${path}.arrangement.swing`, value.swing);
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
      probability(`melody.leapProbability.${path}`, value);
    });
    if (!Array.isArray(d.melody.leapRangeSemitones) || d.melody.leapRangeSemitones.length !== 2 ||
        d.melody.leapRangeSemitones.some((value) => !Number.isFinite(value) || value < 0 || value > 24) ||
        d.melody.leapRangeSemitones[0]! > d.melody.leapRangeSemitones[1]!) {
      add("melody.leapRangeSemitones", "[最小, 最大] を0〜24半音で指定してください");
    }
    if (!MELODIC_CONTOURS.includes(d.melody.contour as typeof MELODIC_CONTOURS[number])) add("melody.contour", "利用可能な旋律輪郭を指定してください");
    if (!['down', 'up', 'none'].includes(d.melody.afterLeapBias ?? "")) add("melody.afterLeapBias", "down、up、none のいずれかです");
    boolean("melody.pedalPoint", d.melody.pedalPoint);
    if (d.melody.pitchCollection !== undefined && !PITCH_COLLECTIONS.includes(d.melody.pitchCollection as typeof PITCH_COLLECTIONS[number])) add("melody.pitchCollection", "利用可能な音集合を指定してください");
    if (d.melody.repeatNoteProbability !== undefined) probability("melody.repeatNoteProbability", d.melody.repeatNoteProbability);
    if (d.melody.motif !== undefined) {
      if (!isRecord(d.melody.motif)) add("melody.motif", "モチーフ設定のオブジェクトが必要です");
      else {
        probability("melody.motif.repeatProbability", d.melody.motif.repeatProbability);
        if (d.melody.motif.development !== undefined) {
          if (!isRecord(d.melody.motif.development)) add("melody.motif.development", "操作子と重みのオブジェクトが必要です");
          else {
            const allowed = new Set(registeredMotifOperatorNames());
            const entries = Object.entries(d.melody.motif.development);
            if (!entries.length) add("melody.motif.development", "1個以上の操作子が必要です");
            entries.forEach(([name, weight]) => {
              if (!allowed.has(name)) add(`melody.motif.development.${name}`, `参照できない操作子です（${[...allowed].join(", ")}）`);
              range(`melody.motif.development.${name}`, weight, 0, 100);
            });
            if (!entries.some(([, weight]) => finite(weight) && weight > 0)) {
              add("melody.motif.development", "少なくとも1つの重みを0より大きくしてください");
            }
          }
        }
        if (d.melody.motif.developmentProbability !== undefined) {
          if (!isRecord(d.melody.motif.developmentProbability)) add("melody.motif.developmentProbability", "セクション別の指定が必要です");
          else Object.entries(d.melody.motif.developmentProbability).forEach(([section, value]) => {
            const path = `melody.motif.developmentProbability.${section}`;
            if (section !== "default" && !SECTION_KEYS.includes(section as typeof SECTION_KEYS[number])) add(path, "未知のセクションです");
            probability(path, value);
          });
        }
      }
    }
    if (d.melody.nonChordTones !== undefined) {
      if (!isRecord(d.melody.nonChordTones)) add("melody.nonChordTones", "非和声音設定のオブジェクトが必要です");
      else for (const key of ["appoggiatura", "suspension", "chromaticPassing"] as const) {
        if (d.melody.nonChordTones[key] !== undefined) probability(`melody.nonChordTones.${key}`, d.melody.nonChordTones[key]);
      }
    }
    if (d.melody.finalDegree !== undefined) {
      if (!isRecord(d.melody.finalDegree)) add("melody.finalDegree", "終止音の度数と重みのオブジェクトが必要です");
      else {
        const entries = Object.entries(d.melody.finalDegree);
        if (!entries.some(([, weight]) => finite(weight) && weight > 0)) {
          add("melody.finalDegree", "1個以上の度数に正の重みが必要です (全て0だと終止音を選べません)");
        }
        entries.forEach(([degree, weight]) => {
          if (!["1", "3", "5", "7", "9"].includes(degree)) add(`melody.finalDegree.${degree}`, "1、3、5、7、9のいずれかを指定してください");
          range(`melody.finalDegree.${degree}`, weight, 0, 100);
        });
      }
    }
    if (d.melody.registerShift !== undefined) {
      if (!isRecord(d.melody.registerShift)) add("melody.registerShift", "セクション別音域のオブジェクトが必要です");
      else Object.entries(d.melody.registerShift).forEach(([section, shift]) => {
        if (!SECTION_KEYS.includes(section as typeof SECTION_KEYS[number])) add(`melody.registerShift.${section}`, "未知のセクションです");
        if (!Number.isInteger(shift) || (shift as number) < -24 || (shift as number) > 24) add(`melody.registerShift.${section}`, "-24〜24半音の整数で指定してください");
      });
    }
  }
  if (!d.structure || typeof d.structure !== "object") add("structure", "構成定義が必要です");
  else {
    validatePhraseLengths("structure.phraseLengths", d.structure.phraseLengths);
    probability("structure.irregularPhraseProbability", d.structure.irregularPhraseProbability);
  }
  const validateRhythmGroups = (path: string, groups: unknown) => {
    if (!isRecord(groups)) return add(path, "拍子別テンプレートのオブジェクトが必要です");
    Object.entries(groups).forEach(([meterName, templates]) => {
      const meter = METERS[meterName];
      if (!meter) add(`${path}.${meterName}`, `${Object.keys(METERS).join("、")} のいずれかを指定してください`);
      if (!Array.isArray(templates) || !templates.length || templates.length > 64) return add(`${path}.${meterName}`, "1〜64個のテンプレートを配列で指定してください");
      templates.forEach((template, index) => {
        const itemPath = `${path}.${meterName}[${index}]`;
        if (!isRecord(template)) return add(itemPath, "beats と weight を持つオブジェクトが必要です");
        if (!Array.isArray(template.beats) || !template.beats.length || template.beats.length > 64 || template.beats.some((beat) => !finite(beat) || beat === 0 || Math.abs(beat) > 8)) {
          add(`${itemPath}.beats`, "0以外・絶対値8以下の拍を最大64個で指定してください");
        } else if (meter && Math.abs(template.beats.reduce((sum, beat) => sum + Math.abs(beat), 0) - meter.barBeats) > 0.001) {
          add(`${itemPath}.beats`, `${meterName}の1小節 (${meter.barBeats}拍) に一致しません`);
        }
        range(`${itemPath}.weight`, template.weight, 0, 100);
      });
    });
  };
  if (d.rhythm !== undefined) {
    if (!isRecord(d.rhythm)) add("rhythm", "リズム定義のオブジェクトが必要です");
    else {
      if (d.rhythm.templates !== undefined) validateRhythmGroups("rhythm.templates", d.rhythm.templates);
      if (d.rhythm.finalTemplates !== undefined) validateRhythmGroups("rhythm.finalTemplates", d.rhythm.finalTemplates);
      if (d.rhythm.anacrusisProbability !== undefined) probability("rhythm.anacrusisProbability", d.rhythm.anacrusisProbability);
      if (d.rhythm.chorusDensityBias !== undefined) probability("rhythm.chorusDensityBias", d.rhythm.chorusDensityBias);
      if (d.rhythm.breathProbability !== undefined) probability("rhythm.breathProbability", d.rhythm.breathProbability);
    }
  }
  if (d.groove !== undefined) {
    if (!isRecord(d.groove)) add("groove", "グルーヴ定義のオブジェクトが必要です");
    else {
      range("groove.subdivision", d.groove.subdivision, 0.125, 4);
      if (!Array.isArray(d.groove.accentPattern) || !d.groove.accentPattern.length || d.groove.accentPattern.length > 32 || d.groove.accentPattern.some((beat) => !finite(beat) || beat < 0 || beat >= 8)) add("groove.accentPattern", "0以上8未満の拍位置を最大32個で指定してください");
      if (d.groove.anticipation !== undefined) range("groove.anticipation", d.groove.anticipation, 0, 4);
      if (d.groove.bassPattern !== undefined && !["bossa", "melodic", "drone"].includes(d.groove.bassPattern as string)) add("groove.bassPattern", "利用可能なベースパターンを指定してください");
    }
  }
  if (d.bass !== undefined) {
    const roles = ["root", "pedal", "walking", "ostinato", "counterline"];
    if (!isRecord(d.bass)) add("bass", "ベース定義のオブジェクトが必要です");
    else {
      if (d.bass.roles !== undefined) {
        if (!isRecord(d.bass.roles)) add("bass.roles", "セクション別の役割定義が必要です");
        else Object.entries(d.bass.roles).forEach(([section, values]) => {
          if (section !== "default" && !SECTION_KEYS.includes(section as typeof SECTION_KEYS[number])) add(`bass.roles.${section}`, "未知のセクションです");
          if (!Array.isArray(values) || !values.length || values.some((role) => typeof role !== "string" || !roles.includes(role))) {
            add(`bass.roles.${section}`, "root、pedal、walking、ostinato、counterlineから1個以上指定してください");
          }
        });
      }
      for (const key of ["activity", "syncopation", "rests", "chordToneRatio", "approachRatio",
        "diatonicApproachRatio", "chromaticApproachRatio", "enclosureRatio", "resolveLeapRatio",
        "fifthOctaveRatio", "fillProbability"] as const) {
        if (d.bass[key] !== undefined) probability(`bass.${key}`, d.bass[key]);
      }
      if (d.bass.range !== undefined && (!Array.isArray(d.bass.range) || d.bass.range.length !== 2 ||
        d.bass.range.some((pitch) => !Number.isInteger(pitch) || pitch < 0 || pitch > 127) ||
        d.bass.range[0] >= d.bass.range[1])) add("bass.range", "0〜127の[最低音, 最高音]を指定してください");
      if (d.bass.maxLeap !== undefined) range("bass.maxLeap", d.bass.maxLeap, 1, 36);
    }
  }
  if (d.register !== undefined) {
    if (!isRecord(d.register)) add("register", "音域配分のオブジェクトが必要です");
    else {
      const minimumSpan = finite(d.register.minVoicingSpan) ? d.register.minVoicingSpan : 17;
      if (d.register.minVoicingSpan !== undefined) range("register.minVoicingSpan", d.register.minVoicingSpan, 12, 36);
      if (d.register.melodyClearance !== undefined) range("register.melodyClearance", d.register.melodyClearance, 0, 24);
      if (d.register.lowIntervalLimit !== undefined) range("register.lowIntervalLimit", d.register.lowIntervalLimit, 0, 24);
      for (const key of ["melody", "piano", "guitar"] as const) {
        const value = d.register[key];
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.length !== 2 ||
          value.some((pitch) => !Number.isInteger(pitch) || pitch < 0 || pitch > 127) ||
          value[0]! >= value[1]!) {
          add(`register.${key}`, "0〜127の[最低音, 最高音]を指定してください");
          continue;
        }
        // 窓が狭いと転回形の候補が全滅し、声部連結が無言で無効化される。
        // 9th 和音は基本形だけで 14 半音、転回形はさらに広い。
        if (key !== "melody" && value[1]! - value[0]! < minimumSpan) {
          add(`register.${key}`, `幅が ${minimumSpan} 半音以上必要です (転回形が窓に収まらず声部連結が働きません)`);
        }
      }
    }
  }
  if (d.expected !== undefined) {
    if (!isRecord(d.expected)) add("expected", "期待値のオブジェクトが必要です");
    else {
      if (d.expected.nonChordToneRatio !== undefined) probability("expected.nonChordToneRatio", d.expected.nonChordToneRatio);
      if (d.expected.clashPerBar !== undefined) range("expected.clashPerBar", d.expected.clashPerBar, 0, 8);
    }
  }
  if (d.theme !== undefined) {
    if (!isRecord(d.theme)) add("theme", "主題規則のオブジェクトが必要です");
    else {
      const themeKeys = [...SECTION_KEYS, "default"];
      if (d.theme.recurrence !== undefined) {
        if (!isRecord(d.theme.recurrence)) add("theme.recurrence", "セクション別の指定が必要です");
        else Object.entries(d.theme.recurrence).forEach(([section, value]) => {
          const path = `theme.recurrence.${section}`;
          if (!themeKeys.includes(section)) add(path, "未知のセクションです");
          if (!THEME_RETURNS.includes(value as typeof THEME_RETURNS[number])) {
            add(path, `${THEME_RETURNS.join(" / ")} のいずれかを指定してください`);
          }
        });
      }
      if (d.theme.variation !== undefined) {
        if (!isRecord(d.theme.variation)) add("theme.variation", "セクション別の指定が必要です");
        else Object.entries(d.theme.variation).forEach(([section, value]) => {
          const path = `theme.variation.${section}`;
          if (!themeKeys.includes(section)) add(path, "未知のセクションです");
          probability(path, value);
        });
      }
      if (d.theme.finalLift !== undefined) boolean("theme.finalLift", d.theme.finalLift);
    }
  }
  if (d.dynamics !== undefined) {
    if (!isRecord(d.dynamics)) add("dynamics", "強弱のオブジェクトが必要です");
    else {
      const levelKeys = [...SECTION_KEYS, "default"];
      if (d.dynamics.sectionLevels !== undefined) {
        if (!isRecord(d.dynamics.sectionLevels)) add("dynamics.sectionLevels", "セクション別の指定が必要です");
        else Object.entries(d.dynamics.sectionLevels).forEach(([section, level]) => {
          const path = `dynamics.sectionLevels.${section}`;
          if (!levelKeys.includes(section)) add(path, "未知のセクションです");
          if (!DYNAMIC_LEVELS.includes(level as typeof DYNAMIC_LEVELS[number])) {
            add(path, `${DYNAMIC_LEVELS.join(" / ")} のいずれかを指定してください`);
          }
        });
      }
      if (d.dynamics.sectionArc !== undefined) range("dynamics.sectionArc", d.dynamics.sectionArc, -1, 1);
      if (d.dynamics.phraseShape !== undefined) probability("dynamics.phraseShape", d.dynamics.phraseShape);
      if (d.dynamics.accent !== undefined) probability("dynamics.accent", d.dynamics.accent);
      if (d.dynamics.subitoProbability !== undefined) probability("dynamics.subitoProbability", d.dynamics.subitoProbability);
      if (d.dynamics.accentBeats !== undefined) {
        if (!Array.isArray(d.dynamics.accentBeats) || d.dynamics.accentBeats.length > 32 ||
          d.dynamics.accentBeats.some((beat) => !finite(beat) || beat < 0 || beat >= 8)) {
          add("dynamics.accentBeats", "0以上8未満の拍位置を最大32個で指定してください");
        }
      }
    }
  }
  if (d.sectionRules !== undefined) {
    if (!isRecord(d.sectionRules)) add("sectionRules", "セクション別規則のオブジェクトが必要です");
    else Object.entries(d.sectionRules).forEach(([section, rule]) => {
      const path = `sectionRules.${section}`;
      if (!SECTION_KEYS.includes(section as typeof SECTION_KEYS[number])) add(path, "未知のセクションです");
      if (!isRecord(rule)) return add(path, "規則のオブジェクトが必要です");
      if (rule.phraseLengths !== undefined) validatePhraseLengths(`${path}.phraseLengths`, rule.phraseLengths);
      if (rule.idioms !== undefined) validateProgressions(`${path}.idioms`, rule.idioms);
      if (rule.idiomProbability !== undefined) probability(`${path}.idiomProbability`, rule.idiomProbability);
      if (rule.cadences !== undefined) {
        if (!isRecord(rule.cadences)) add(`${path}.cadences`, "終止形のオブジェクトが必要です");
        else for (const key of ["final", "half"] as const) if (rule.cadences[key] !== undefined) validateProgressions(`${path}.cadences.${key}`, rule.cadences[key]);
      }
      if (rule.harmonicRhythm !== undefined) validateDistribution(`${path}.harmonicRhythm`, rule.harmonicRhythm);
      if (rule.cliches !== undefined) validateCliches(`${path}.cliches`, rule.cliches);
    });
  }
  if (d.modulation !== undefined) {
    if (!isRecord(d.modulation)) add("modulation", "転調定義のオブジェクトが必要です");
    else Object.entries(d.modulation).forEach(([section, config]) => {
      const path = `modulation.${section}`;
      if (!SECTION_KEYS.includes(section as typeof SECTION_KEYS[number])) add(path, "未知のセクションです");
      if (!isRecord(config)) return add(path, "probability と intervals を持つオブジェクトが必要です");
      probability(`${path}.probability`, config.probability);
      if (!Array.isArray(config.intervals) || !config.intervals.length || config.intervals.length > 16) add(`${path}.intervals`, "1〜16個の転調候補を指定してください");
      else config.intervals.forEach((interval, index) => {
        const itemPath = `${path}.intervals[${index}]`;
        if (!isRecord(interval)) return add(itemPath, "semitones と weight を持つオブジェクトが必要です");
        if (!Number.isInteger(interval.semitones) || (interval.semitones as number) < -24 || (interval.semitones as number) > 24) add(`${itemPath}.semitones`, "-24〜24半音の整数で指定してください");
        range(`${itemPath}.weight`, interval.weight, 0, 100);
      });
    });
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
export const drift: Dialect = loadDialect(driftJson);
export const pulse: Dialect = loadDialect(pulseJson);
export const ember: Dialect = loadDialect(emberJson);
export const prism: Dialect = loadDialect(prismJson);
export const ryukyu: Dialect = loadDialect(ryukyuJson);
export const miyakobushi: Dialect = loadDialect(miyakobushiJson);
export const agitato: Dialect = loadDialect(agitatoJson);

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
  [drift.id]: drift,
  [pulse.id]: pulse,
  [ember.id]: ember,
  [prism.id]: prism,
  [ryukyu.id]: ryukyu,
  [miyakobushi.id]: miyakobushi,
  [agitato.id]: agitato,
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
  drift,
  pulse,
  ember,
  prism,
  ryukyu,
  miyakobushi,
  agitato,
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
  drift,
  pulse,
  ember,
  prism,
  ryukyu,
  miyakobushi,
  agitato,
];

const USER_DIALECTS_KEY = "melodialect.userDialects.v1";
const BUILTIN_IDS = new Set([...dialectList.map((dialect) => dialect.id), ...Object.keys(dialects)]);

function userStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
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
  const storage = userStorage();
  if (!storage) throw new Error("ブラウザ保存を利用できません");
  storage.setItem(USER_DIALECTS_KEY, JSON.stringify(listUserDialects()));
}

function unregisterUserDialect(id: string): void {
  delete dialects[id];
  const index = dialectList.findIndex((dialect) => dialect.id === id);
  if (index >= 0) dialectList.splice(index, 1);
}

export function saveUserDialect(data: unknown): Dialect {
  const dialect = loadDialect(data);
  if (BUILTIN_IDS.has(dialect.id)) throw new Error("内蔵ダイアレクトと同じ id は使用できません");
  const previous = listUserDialects().find((item) => item.id === dialect.id);
  registerUserDialect(dialect);
  try {
    persistUserDialects();
  } catch (error) {
    if (previous) registerUserDialect(previous);
    else unregisterUserDialect(dialect.id);
    throw new Error(error instanceof DOMException && error.name === "QuotaExceededError"
      ? "ダイアレクトの保存容量が不足しています"
      : "ダイアレクトを端末へ保存できませんでした");
  }
  return dialect;
}

export function renameUserDialect(id: string, name: string): Dialect {
  const source = listUserDialects().find((dialect) => dialect.id === id);
  if (!source) throw new Error("保存済みダイアレクトが見つかりません");
  return saveUserDialect({ ...structuredClone(source), name: name.trim() });
}

export function isBuiltinDialect(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

export function removeUserDialect(id: string): void {
  if (BUILTIN_IDS.has(id)) return;
  const previous = listUserDialects().find((dialect) => dialect.id === id);
  if (!previous) return;
  unregisterUserDialect(id);
  try {
    persistUserDialects();
  } catch (error) {
    registerUserDialect(previous);
    throw new Error(error instanceof DOMException && error.name === "QuotaExceededError"
      ? "ダイアレクトを削除するための保存容量が不足しています"
      : "ダイアレクトの削除を端末へ保存できませんでした");
  }
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
