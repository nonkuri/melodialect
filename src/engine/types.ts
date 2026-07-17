/** 拍単位はすべて 4 分音符 = 1 beat、4/4 固定(M1)。ピッチは MIDI ノート番号。 */

export type Mode = "major" | "minor";

export interface KeySignature {
  /** 主音のピッチクラス (C=0, C#=1, ... B=11) */
  tonic: number;
  mode: Mode;
}

export type ChordQuality = "maj" | "min" | "dom7" | "maj7" | "min7" | "dim";

export interface ParsedRoman {
  /** スケール度数 1..7 */
  degree: number;
  flat: boolean;
  quality: ChordQuality;
}

export interface ChordEvent {
  /** セクション内の小節番号 (0 始まり) */
  bar: number;
  /** コードシンボル (ローマ数字。スラッシュベースは "I/♭7" のように表記) */
  symbol: string;
  /** ルートのピッチクラス */
  rootPc: number;
  quality: ChordQuality;
  /** 伴奏用ボイシング (MIDI ノート番号、低い順) */
  pitches: number[];
  /** ベース音 (スラッシュコードの場合はルート以外になる) */
  bassPitch: number;
}

export interface NoteEvent {
  /** セクション先頭からの開始位置 (beats) */
  start: number;
  /** 長さ (beats) */
  duration: number;
  pitch: number;
  velocity: number;
}

export type SectionType = "intro" | "verse" | "chorus" | "bridge" | "outro";

export interface SectionPlan {
  type: SectionType;
  /** フレーズごとの小節数 (変則フレーズ長を含む) */
  phraseLengths: number[];
  bars: number;
}

/** 生成根拠の注記 (§4.4)。どの小節にどのルールが適用されたか */
export interface Annotation {
  /** セクション内の小節番号 (0 始まり) */
  bar: number;
  ruleId: string;
  text: string;
}

export interface GeneratedSection {
  plan: SectionPlan;
  /** 曲頭からの開始小節番号 */
  startBar: number;
  chords: ChordEvent[];
  melody: NoteEvent[];
  piano: NoteEvent[];
  bass: NoteEvent[];
  annotations: Annotation[];
}

export interface Song {
  dialectId: string;
  seed: number;
  key: KeySignature;
  bpm: number;
  sections: GeneratedSection[];
  totalBars: number;
}

/** ダイアレクト定義 (§6.2 の JSON フォーマットに対応) */
export interface Dialect {
  id: string;
  name: string;
  defaults: { key: string; mode: Mode; bpm: number };
  chord: {
    vocabulary: string[];
    transitions: Record<string, Record<string, number>>;
    /** 名前付き技法 (技法レジストリに登録されたものを参照) */
    cliches: string[];
    borrowedChords: boolean;
  };
  melody: {
    leapProbability: { default: number; chorusHead: number };
    leapRangeSemitones: [number, number];
    afterLeapBias: "down" | "up" | "none";
    contour: string;
    pedalPoint: boolean;
  };
  structure: {
    phraseLengths: number[];
    irregularPhraseProbability: number;
  };
}

export const BEATS_PER_BAR = 4;
