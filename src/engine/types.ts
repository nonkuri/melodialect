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
  /** このセクションの生成に使われたダイアレクト (合作モード §4.2) */
  dialectId: string;
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
  /** 表示用のキー名 (例: "C", "Bb")。譜面の調号・音名の綴りに使う */
  keyName: string;
  bpm: number;
  sections: GeneratedSection[];
  totalBars: number;
}

/** ダイアレクト定義 (§6.2 の JSON フォーマットに対応) */
export interface Dialect {
  id: string;
  name: string;
  /** Suno 等の外部サービスに渡すスタイル記述 (§4.5 テキスト出力) */
  stylePrompt?: string;
  defaults: { key: string; mode: Mode; bpm: number };
  chord: {
    vocabulary: string[];
    transitions: Record<string, Record<string, number>>;
    /** 名前付き技法 (技法レジストリに登録されたものを参照) */
    cliches: string[];
    borrowedChords: boolean;
  };
  melody: {
    /**
     * 跳躍確率。default はフレーズ頭、chorusHead はサビ (chorus) セクション頭。
     * フレーズ途中の跳躍確率は default の 35% (エンジン内ヒューリスティック)
     */
    leapProbability: { default: number; chorusHead: number };
    leapRangeSemitones: [number, number];
    afterLeapBias: "down" | "up" | "none";
    contour: string;
    /** 逆ペダルポイント (George §4.1 D3): メロディを固定音に留めコードのみ変化させる */
    pedalPoint: boolean;
    /** 同音連打の確率 (John §4.1 D1)。省略時 0 */
    repeatNoteProbability?: number;
  };
  structure: {
    phraseLengths: number[];
    irregularPhraseProbability: number;
  };
}

export const BEATS_PER_BAR = 4;
