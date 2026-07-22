/** 拍単位はすべて 4 分音符 = 1 beat。ピッチは MIDI ノート番号。拍子は meter.ts 参照。 */

import type { Meter } from "./meter.js";

export type Mode = "major" | "minor";

export interface KeySignature {
  /** 主音のピッチクラス (C=0, C#=1, ... B=11) */
  tonic: number;
  mode: Mode;
}

export type ChordQuality =
  | "maj"
  | "min"
  | "dom7"
  | "maj7"
  | "min7"
  | "dim"
  | "sus2"
  | "sus4"
  | "add9"
  | "maj9"
  | "min9"
  | "dom9"
  | "halfDim7";

export interface ParsedRoman {
  /** スケール度数 1..7 */
  degree: number;
  flat: boolean;
  quality: ChordQuality;
}

/** Extended, structured representation used by the v1.2 harmony planner. */
export interface ChordSymbolAst {
  accidental: -2 | -1 | 0 | 1 | 2;
  degree: number;
  quality: ChordQuality;
  extension?: number;
  alterations?: Array<{ degree: number; accidental: -1 | 1 }>;
  bass?: { accidental: -2 | -1 | 0 | 1 | 2; degree: number };
  secondaryOf?: { accidental: -2 | -1 | 0 | 1 | 2; degree: number };
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
  /** Parsed v1.2 representation. Optional for projects saved before v1.2. */
  ast?: ChordSymbolAst;
  /** v0.9: コードがどの経路で決まったか。未指定は通常生成。 */
  origin?: "generated" | "user" | "completed" | "reharmonized";
}

export interface NoteEvent {
  /** セクション先頭からの開始位置 (beats) */
  start: number;
  /** 長さ (beats) */
  duration: number;
  pitch: number;
  velocity: number;
}


export type PianoPattern =
  | "off"
  | "block"
  | "arpeggio"
  | "bossa"
  | "eighth"
  | "ballad"
  | "syncopated"
  | "voice-led";
export type GuitarPattern =
  | "off"
  | "strum"
  | "arpeggio"
  | "bossa"
  | "syncopated"
  | "interlocking";
export type DrumPattern = "off" | "basic" | "rock" | "bossa" | "shuffle" | "interlock";
export type SongPart = "melody" | "piano" | "guitar" | "bass" | "drums";

export interface ArrangementSettings {
  pianoPattern: PianoPattern;
  guitarPattern: GuitarPattern;
  drumPattern: DrumPattern;
  /** 0..1: 裏の8分音符を遅らせる量 */
  swing: number;
  /** 0..1: タイミングとベロシティの揺らぎ */
  humanize: number;
  /** 0.5..1.5 */
  velocityScale: number;
  /** 0..1: automatic instrumentation and register density. */
  accompanimentDensity?: number;
  /** 0..1: amount of contrast and growth between sections. */
  development?: number;
  /** Keep legacy whole-song patterns, or let the section planner vary them. */
  autoArrange?: boolean;
}

export interface MixerPartSettings {
  mute: boolean;
  solo: boolean;
  /** 0..1.5 */
  volume: number;
  /** -1..1 */
  pan: number;
  timbre: string;
  /** SoundFont assignment. Omitted or sourceId="oscillator" keeps the built-in synth. */
  soundfont?: SoundFontAssignment;
}

export type MixerSettings = Record<SongPart, MixerPartSettings>;
export interface SoundFontAssignment {
  /** "standard" is the lite fallback; "generaluser-gs" is the optional quality pack. */
  sourceId: string;
  bankMSB: number;
  bankLSB: number;
  program: number;
  isDrum?: boolean;
  presetName?: string;
}

export interface MasterSettings {
  /** 0..1.5 linear gain. */
  volume: number;
  /** Protects audition and exported audio from unexpected SoundFont peaks. */
  limiter: boolean;
}

export interface CompositionControls {
  mode: Mode;
  melodyLow: number;
  melodyHigh: number;
  /** 0..1 */
  density: number;
  /** 0..1 */
  harmonyComplexity: number;
  /** 0..1 */
  tension: number;
  /** 0..1 */
  leap: number;
  /** 0..1 */
  repetition: number;
  /** 0..1 */
  syncopation: number;
  /** macro controls, all 0..1 */
  brightness: number;
  calm: number;
  surprise: number;
}

export interface SectionControl {
  id: string;
  type: SectionType;
  dialectId: string;
  /** 本体の小節数。final の最終セクションには別途コーダが付く。 */
  bars: number;
  transpose: number;
  bpm: number;
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
  /** Explanation hierarchy. Omitted legacy annotations are event-level. */
  level?: "song" | "section" | "event";
  category?: GenerationCategory;
}

export type GenerationCategory =
  | "structure"
  | "harmony"
  | "melody"
  | "bass"
  | "arrangement"
  | "rhythm"
  | "selection";

export interface GenerationReason {
  id: string;
  level: "song" | "section" | "event";
  category: GenerationCategory;
  summary: string;
  sectionIndex?: number;
  bar?: number;
  ruleId?: string;
  detail?: string;
  alternatives?: string[];
}

export interface SongFingerprint {
  harmony: string;
  melody: string;
  bass: string;
  accompaniment: string;
  combined: string;
}

export interface GenerationMetrics {
  valid: boolean;
  violations: string[];
  quality: number;
  harmonicCoherence: number;
  voiceLeading: number;
  melodicFit: number;
  bassSmoothness: number;
  accompanimentClarity: number;
  sectionContrast: number;
}

export type DiversityLevel = "stable" | "standard" | "adventurous";

export interface GenerationReport {
  candidateIndex: number;
  selectedFrom: number;
  diversity: DiversityLevel;
  fingerprint: SongFingerprint;
  metrics: GenerationMetrics;
  summary: GenerationReason[];
  differenceTags?: string[];
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
  guitar: NoteEvent[];
  drums: NoteEvent[];
  bpm?: number;
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
  arrangement?: ArrangementSettings;
  arrangementPlan?: ArrangementPlan;
  mixer?: MixerSettings;
  master?: MasterSettings;
  composition?: CompositionControls;
  /** 編集済みの仮歌詞。未指定時はシードから生成する。 */
  lyrics?: EditableSectionLyrics[];
  /** v1.2: deterministic candidate evaluation and layered explanations. */
  generationReport?: GenerationReport;
}

export type HarmonyGenerationMode = "auto" | "fixed" | "complete" | "reharmonize";
export type ChordDraftOrigin = "user" | "completed" | "reharmonized";

/** キー相対のローマ数字で保持する、入力コード 1 スロット。空文字は補完対象。 */
export interface ChordDraftSlot {
  symbol: string;
  start: number;
  durationBeats: number;
  origin: ChordDraftOrigin;
}

export type CadenceChoice = "dialect" | "authentic" | "plagal" | "deceptive" | "modal" | "half";
export type ChorusVariation = "same" | "light" | "large";

export interface SectionExpression {
  /** 0..1 */
  tension: number;
  /** 0..1 */
  density: number;
  /** 0..1 */
  brightness: number;
  cadence: CadenceChoice;
}

export interface FixedMotifNote {
  offset: number;
  duration: number;
  /** モチーフ先頭音からの半音差。 */
  interval: number;
  velocity: number;
}

export interface FixedMotif {
  sectionType: SectionType;
  /** セクション先頭からの固定位置。 */
  anchorBeat: number;
  lengthBeats: number;
  rootPitch: number;
  sourceTonic: number;
  notes: FixedMotifNote[];
}

/** v0.9 の作曲設計。WorkspaceState に保存し、全体生成時に適用する。 */
export interface CompositionDesign {
  harmonyMode: HarmonyGenerationMode;
  chordDrafts: ChordDraftSlot[][];
  originalChordDrafts?: ChordDraftSlot[][];
  chorusVariation: ChorusVariation;
  sectionExpressions: SectionExpression[];
  motif?: FixedMotif;
}

export type LyricsLanguage = "ja" | "en" | "scat";

export interface EditableSectionLyrics {
  language: LyricsLanguage;
  /** メロディの各音に対応する音節。 */
  syllables: string[];
  /** 直接編集する表示・出力用の行。 */
  lines: string[];
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

export type PitchCollection =
  | "major"
  | "mixolydian"
  | "natural-minor"
  | "harmonic-minor"
  | "major-pentatonic"
  | "minor-pentatonic"
  | "blues";

export type MelodicContour =
  | "stepwise"
  | "repetitive"
  | "pedal"
  | "leap-then-descend"
  | "angular"
  | "syncopated-narrow"
  | "ostinato"
  | "floating"
  | "arch"
  | "call-response"
  | "descending"
  | "interlocking"
  | "voice-led";

/** ダイアレクト固有の拍節。accentPattern は小節内の拍位置。 */
export interface GrooveProfile {
  subdivision: number;
  accentPattern: number[];
  /** 次のコードを何拍早く先取りするか。0 なら先取りなし。 */
  anticipation?: number;
  /** アクセント位置の単純なルート反復以外に、専用ベース型を使う。 */
  bassPattern?: "bossa" | "melodic" | "drone";
}

export type BassRole = "root" | "pedal" | "walking" | "ostinato" | "counterline";

/** Dialect-owned bass language. Missing values are inferred from legacy groove fields. */
export interface BassProfile {
  roles: Partial<Record<SectionType | "default", BassRole[]>>;
  /** All numeric tendencies are 0..1 unless a MIDI range is documented. */
  activity: number;
  syncopation: number;
  rests: number;
  chordToneRatio: number;
  approachRatio: number;
  diatonicApproachRatio: number;
  chromaticApproachRatio: number;
  enclosureRatio: number;
  resolveLeapRatio: number;
  fifthOctaveRatio: number;
  fillProbability: number;
  range: [number, number];
  maxLeap: number;
}

export type AccompanimentTexture =
  | "block"
  | "arpeggio"
  | "comping"
  | "pad"
  | "answer"
  | "interlock";

export interface ArrangementSectionPlan {
  sectionIndex: number;
  strategy: "piano-led" | "guitar-led" | "alternating" | "ensemble";
  density: number;
  registerShift: number;
  pianoTexture: AccompanimentTexture;
  guitarTexture: AccompanimentTexture;
  pianoActive: boolean;
  guitarActive: boolean;
  drumsActive: boolean;
  fillBars: number[];
  breakBars: number[];
  pickupBars: number[];
}

export interface ArrangementPlan {
  strategy: ArrangementSectionPlan["strategy"];
  sections: ArrangementSectionPlan[];
}

/** セクション単位で構成・和声語彙を上書きするルール。 */
export interface DialectSectionRule {
  phraseLengths?: number[];
  idioms?: WeightedProgression[];
  idiomProbability?: number;
  cadences?: {
    final?: WeightedProgression[];
    half?: WeightedProgression[];
  };
  harmonicRhythm?: Record<string, number>;
  cliches?: string[];
}

/** ダイアレクト定義 (§6.2 の JSON フォーマットに対応)。新フィールドはすべて省略可 (後方互換) */
export interface Dialect {
  id: string;
  name: string;
  /** Suno 等の外部サービスに渡すスタイル記述 (§4.5 テキスト出力) */
  stylePrompt?: string;
  /** meter はダイアレクトの推奨拍子 ("3/4" 等)。省略時 4/4 */
  defaults: {
    key: string;
    mode: Mode;
    bpm: number;
    meter?: string;
    /** 未指定時に使う推奨伴奏。既存ダイアレクトは従来値へフォールバックする。 */
    arrangement?: Partial<ArrangementSettings>;
  };
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
    /** 旋律に使う音集合。省略時は調性に応じた長音階/自然短音階。 */
    pitchCollection?: PitchCollection;
    /**
     * 跳躍確率。default はフレーズ頭、chorusHead はサビ (chorus) セクション頭。
     * フレーズ途中の跳躍確率は default の 35% (エンジン内ヒューリスティック)
     */
    leapProbability: { default: number; chorusHead: number };
    leapRangeSemitones: [number, number];
    afterLeapBias: "down" | "up" | "none";
    contour: MelodicContour;
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
  /** 3-3-2 など、伴奏とアクセントへ適用するダイアレクト固有グルーヴ。 */
  groove?: GrooveProfile;
  /** v1.2 bass grammar; legacy groove.bassPattern remains supported. */
  bass?: Partial<BassProfile>;
  /** Intro/Verse/Chorus 等で構成・進行語彙を変える。 */
  sectionRules?: Partial<Record<SectionType, DialectSectionRule>>;
  /**
   * セクション単位の転調傾向 (通常は bridge)。probability で発動し、
   * intervals から移調量 (半音) を重み付きで選ぶ
   */
  modulation?: Partial<
    Record<SectionType, { probability: number; intervals: Array<{ semitones: number; weight: number }> }>
  >;
}
