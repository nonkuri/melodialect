import type { MixerSettings, SongPart, SoundFontAssignment } from "../engine/types.js";
import { GENERALUSER_SOUNDFONT_ID } from "./standardSoundFont.js";

/**
 * 内蔵の音色セット。GeneralUser GS (標準高音質音源) の GM プリセットだけで
 * 組んであるので、追加のダウンロードなしに 5 パートまとめて着せ替えられる。
 *
 * ダイアレクトは楽器を宣言しない (どの方言もどの編成で鳴らせる) ため、
 * 楽器の組み合わせはここに独立して持つ。
 *
 * volume は音源側の音量差を埋める補正 (1 が既定)。同じ演奏内容を既定の GM 音色
 * (Flute / Grand Piano / Nylon Guitar / Finger Bass / Standard Kit) と各プリセットの
 * 音色でオフライン合成し、RMS 比と peak 比の相乗平均から求めた実測値を 0.75〜1.25 に
 * 収めている。RMS だけで合わせると減衰の速い撥弦 (三味線・箏) のアタックが暴れ、
 * peak だけで合わせるとパッド系 (Slow Strings) が鳴りっぱなしで大きくなる。
 */
export interface TimbrePresetPart {
  program: number;
  /** GeneralUser GS のプリセット名。ミキサーの表示にそのまま出す */
  presetName: string;
  isDrum?: boolean;
  /** 0..1.5。省略時は 1 */
  volume?: number;
}

export interface TimbrePreset {
  id: string;
  name: string;
  description: string;
  /** 相性の良いダイアレクト (UI の補足表示) */
  suitedTo: string;
  parts: Record<SongPart, TimbrePresetPart>;
}

export const TIMBRE_PRESETS: readonly TimbrePreset[] = [
  {
    id: "ryukyu-sanshin",
    name: "琉球（歌三線と太鼓）",
    description: "三線が旋律と伴奏を弾き、箏が合いの手を入れる。太鼓は管弦楽キットの低い胴で鳴らす。",
    suitedTo: "Ryukyu",
    parts: {
      melody: { program: 106, presetName: "Shamisen", volume: 1.25 },
      piano: { program: 107, presetName: "Koto", volume: 0.85 },
      guitar: { program: 106, presetName: "Shamisen", volume: 1.25 },
      bass: { program: 32, presetName: "Acoustic Bass", volume: 0.8 },
      drums: { program: 48, presetName: "Orchestral", isDrum: true, volume: 0.75 },
    },
  },
  {
    id: "wafu-koto",
    name: "和（箏と尺八）",
    description: "尺八が長く伸びる旋律を吹き、箏のアルペジオと弓弦の持続低音が支える。",
    suitedTo: "Miyakobushi / Serene",
    parts: {
      melody: { program: 77, presetName: "Shakuhachi", volume: 1.25 },
      piano: { program: 107, presetName: "Koto", volume: 0.85 },
      guitar: { program: 106, presetName: "Shamisen", volume: 1.25 },
      bass: { program: 43, presetName: "Double Bass", volume: 1.25 },
      drums: { program: 48, presetName: "Orchestral", isDrum: true, volume: 0.75 },
    },
  },
  {
    id: "song-acoustic",
    name: "歌もの（声とアコースティック）",
    description: "旋律を合唱の音色に置き換えて歌の輪郭を確かめる、デモ作り向けの標準編成。",
    suitedTo: "Twilight / Flow / Chromatic",
    parts: {
      melody: { program: 52, presetName: "Concert Choir", volume: 1.25 },
      piano: { program: 0, presetName: "Grand Piano", volume: 1 },
      guitar: { program: 25, presetName: "Steel Guitar", volume: 1.25 },
      bass: { program: 33, presetName: "Finger Bass", volume: 1 },
      drums: { program: 0, presetName: "Standard 1", isDrum: true, volume: 1 },
    },
  },
  {
    id: "electric-pop",
    name: "エレクトリック・ポップ",
    description: "鋸波リードとエレピ、シンセベースと電子ドラム。4つ打ちや反復系のダイアレクト向け。",
    suitedTo: "Pulse / Ostinato / Interlock",
    parts: {
      melody: { program: 81, presetName: "Saw Lead", volume: 1.25 },
      piano: { program: 4, presetName: "Tine Electric Piano", volume: 1.25 },
      guitar: { program: 27, presetName: "Clean Guitar", volume: 1.05 },
      bass: { program: 38, presetName: "Synth Bass 1", volume: 0.8 },
      drums: { program: 24, presetName: "Electronic", isDrum: true, volume: 0.9 },
    },
  },
  {
    id: "jazz-combo",
    name: "ジャズ・コンボ",
    description: "テナーサックス、ジャズギター、ウッドベース、ブラシ寄りのジャズキット。",
    suitedTo: "Blue / Angular / Voicing",
    parts: {
      melody: { program: 66, presetName: "Tenor Sax", volume: 1.25 },
      piano: { program: 0, presetName: "Grand Piano", volume: 1 },
      guitar: { program: 26, presetName: "Jazz Guitar", volume: 0.85 },
      bass: { program: 32, presetName: "Acoustic Bass", volume: 0.8 },
      drums: { program: 32, presetName: "Jazz", isDrum: true, volume: 1.05 },
    },
  },
  {
    id: "orchestral-strings",
    name: "オーケストラ（弦とハープ）",
    description: "ヴァイオリンの旋律を弦楽の持続とハープが包む。転回形や広い和音を確かめるとき向け。",
    suitedTo: "Orchestral / Prism / Serene",
    parts: {
      melody: { program: 40, presetName: "Violin", volume: 1.25 },
      piano: { program: 49, presetName: "Slow Strings", volume: 1.25 },
      guitar: { program: 46, presetName: "Orchestral Harp", volume: 0.75 },
      bass: { program: 43, presetName: "Double Bass", volume: 1.25 },
      drums: { program: 48, presetName: "Orchestral", isDrum: true, volume: 0.75 },
    },
  },
  {
    id: "latin-nylon",
    name: "ラテン（ナイロン弦）",
    description: "フルートとナイロン弦ギター、ウッドベースとルームキット。ボサノヴァ系の刻みに合う。",
    suitedTo: "Bossa / Lament",
    parts: {
      melody: { program: 73, presetName: "Flute", volume: 1 },
      piano: { program: 4, presetName: "Tine Electric Piano", volume: 1.25 },
      guitar: { program: 24, presetName: "Nylon Guitar", volume: 1 },
      bass: { program: 32, presetName: "Acoustic Bass", volume: 0.8 },
      drums: { program: 8, presetName: "Room", isDrum: true, volume: 0.95 },
    },
  },
];

export function findTimbrePreset(id: string): TimbrePreset | undefined {
  return TIMBRE_PRESETS.find((preset) => preset.id === id);
}

export function timbrePresetAssignment(part: TimbrePresetPart): SoundFontAssignment {
  return {
    sourceId: GENERALUSER_SOUNDFONT_ID,
    bankMSB: 0,
    bankLSB: 0,
    program: part.program,
    isDrum: part.isDrum,
    presetName: part.presetName,
  };
}

/**
 * 音色と音量だけを差し替える。ミュート・ソロ・パンはユーザーの操作なので残す。
 */
export function applyTimbrePreset(mixer: MixerSettings, preset: TimbrePreset): MixerSettings {
  const next = structuredClone(mixer);
  for (const [part, values] of Object.entries(preset.parts) as Array<[SongPart, TimbrePresetPart]>) {
    const strip = next[part];
    if (!strip) continue;
    strip.soundfont = timbrePresetAssignment(values);
    strip.volume = values.volume ?? 1;
  }
  return next;
}
