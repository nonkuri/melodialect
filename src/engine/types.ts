/** 拍単位はすべて 4 分音符 = 1 beat。ピッチは MIDI ノート番号。拍子は meter.ts 参照。 */

import type { Meter } from "./meter.js";

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
  /** セクション先頭からの開始位置 (beats)。ハーモニックリズムにより小節途中もあり得る */
  start: number;
  /** 長さ (beats)。1 小節未満 (小節内 2 コード) や複数小節 (2 小節 1 コード) もある */
  durationBeats: number;
  /** 開始位置の小節番号 (0 始まり)。注記・表示用 */
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
  /** このセクションのキー (転調時は曲のキーと異なる) */
  key: KeySignature;
  chords: ChordEvent[];
  melody: NoteEvent[];
  piano: NoteEvent[];
  bass: NoteEvent[];
  annotations: Annotation[];
}

/**
 * 曲の終わり方 (§4.2)。
 * "final" = 終止カデンツ+終止和音を 1 小節保持するコーダ付き。
 * "loop" = 半終止のまま曲頭の I へ戻る、リピート再生用のシームレスな継ぎ目
 */
export type EndingMode = "final" | "loop";

export interface Song {
  dialectId: string;
  seed: number;
  ending: EndingMode;
  key: KeySignature;
  /** 表示用のキー名 (例: "C", "Bb")。譜面の調号・音名の綴りに使う */
  keyName: string;
  bpm: number;
  meter: Meter;
  sections: GeneratedSection[];
  totalBars: number;
}

/** 重み付きリズムテンプレート。beats の負値は休符 (絶対値が長さ)。合計は 1 小節分 */
export interface RhythmTemplate {
  beats: number[];
  weight: number;
}

/** 重み付きコード列 (イディオム・カデンツに使う) */
export interface WeightedProgression {
  symbols: string[];
  weight: number;
}

/** ダイアレクト定義 (§6.2 の JSON フォーマットに対応)。新フィールドはすべて省略可 (後方互換) */
export interface Dialect {
  id: string;
  name: string;
  /** Suno 等の外部サービスに渡すスタイル記述 (§4.5 テキスト出力) */
  stylePrompt?: string;
  /** meter はダイアレクトの推奨拍子 ("3/4" 等)。省略時 4/4 */
  defaults: { key: string; mode: Mode; bpm: number; meter?: string };
  chord: {
    vocabulary: string[];
    transitions: Record<string, Record<string, number>>;
    /**
     * 進行の定型句 (§4.1)。マルコフ 1 手ではなく 3〜4 コードのまとまりで挿入され、
     * ダイアレクト特有の「決まり文句」を保つ
     */
    idioms?: WeightedProgression[];
    /** 各スロットでイディオム挿入を試みる確率。省略時 0 */
    idiomProbability?: number;
    /**
     * カデンツの好み。final は最終セクション末尾の 2 コード (例 V7→I = 全終止、
     * IV→I = 変格終止)、half は途中セクション末尾の 1 コード (例 V7 = 半終止)。
     * 省略時は V7→I / V7
     */
    cadences?: {
      final?: WeightedProgression[];
      half?: WeightedProgression[];
    };
    /**
     * ハーモニックリズム: 1 小節あたりのコード数の確率分布。
     * キーは "0.5" (2 小節 1 コード) | "1" | "2" (1 小節 2 コード)。
     * セクションタイプ別に上書きでき、"default" が既定
     */
    harmonicRhythm?: Record<string, Record<string, number>>;
    /** 名前付き技法 (技法レジストリに登録されたものを参照) */
    cliches: string[];
    borrowedChords: boolean;
  };
  /** リズム語彙 (§4.1)。省略時はエンジン内蔵の共通テンプレート */
  rhythm?: {
    /** 拍子名 → 重み付きテンプレート。定義のない拍子は内蔵テンプレートにフォールバック */
    templates?: Record<string, RhythmTemplate[]>;
    /** フレーズ最終小節用テンプレート */
    finalTemplates?: Record<string, RhythmTemplate[]>;
    /** フレーズ最終小節の末尾を次フレーズへのアウフタクト (先取音) にする確率 */
    anacrusisProbability?: number;
    /** サビで音数の多いテンプレートを優先する度合い (0〜1)。セクション対比に使う */
    chorusDensityBias?: number;
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
    /** 逆ペダルポイント (Pedal §4.1 D3): メロディを固定音に留めコードのみ変化させる */
    pedalPoint: boolean;
    /** 同音連打の確率 (Modal §4.1 D1)。省略時 0 */
    repeatNoteProbability?: number;
    /**
     * モチーフ反復: セクション最初のフレーズのリズムと輪郭を記憶し、
     * 以降のフレーズで確率的に再利用する (移調反復 = シークエンスを含む)
     */
    motif?: { repeatProbability: number };
    /** 非和声音の傾向。倚音 (強拍の上方隣接音→解決)、掛留、半音階経過音 */
    nonChordTones?: {
      appoggiatura?: number;
      suspension?: number;
      chromaticPassing?: number;
    };
    /** セクションタイプ別の音域中心シフト (半音)。サビで音域を上げる等の対比に使う */
    registerShift?: Partial<Record<SectionType, number>>;
  };
  structure: {
    phraseLengths: number[];
    irregularPhraseProbability: number;
  };
  /**
   * セクション単位の転調傾向 (通常は bridge)。probability で発動し、
   * intervals から移調量 (半音) を重み付きで選ぶ
   */
  modulation?: Partial<
    Record<SectionType, { probability: number; intervals: Array<{ semitones: number; weight: number }> }>
  >;
}
