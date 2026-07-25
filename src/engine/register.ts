import type { Dialect, NoteEvent, RegisterPlan } from "./types.js";

/**
 * 音域配分の既定値 (§4.1)。
 *
 * メロディの下限を D4 (62) に置き、和声楽器の窓をその下へ逃がす。旧版の
 * メロディ下限 C4 (60) では、ピアノの上声・ギター (コードを丸ごと +12 した
 * 60〜85) と音域が丸かぶりで、旋律が非和声音を鳴らすたび伴奏の保持音と
 * 半音でぶつかっていた。
 *
 * 窓は「最低声部の下限」と「最高声部の上限」で、幅は minVoicingSpan 以上を
 * 常に保つ。9th 和音は基本形だけで 14 半音、転回形はさらに広いため、
 * 17 半音を下回る窓では転回形の候補が全滅して声部連結が働かなくなる。
 */
export const DEFAULT_REGISTER: RegisterPlan = {
  melody: [62, 84],
  piano: [45, 66],
  guitar: [52, 73],
  melodyClearance: 2,
  minVoicingSpan: 17,
  lowIntervalLimit: 16,
};

/** 窓の下限。これ以下へ押し込むと和音の内声が団子になって使いものにならない */
const ABSOLUTE_FLOOR = 40;
/** 旋律を避けるために窓を動かせる上限。これ以上動かすと編成そのものが変わる */
const MAX_SHIFT = 10;

export function registerPlanFor(dialect: Dialect): RegisterPlan {
  const source = dialect.register;
  return {
    melody: source?.melody ?? DEFAULT_REGISTER.melody,
    piano: source?.piano ?? DEFAULT_REGISTER.piano,
    guitar: source?.guitar ?? DEFAULT_REGISTER.guitar,
    melodyClearance: source?.melodyClearance ?? DEFAULT_REGISTER.melodyClearance,
    minVoicingSpan: source?.minVoicingSpan ?? DEFAULT_REGISTER.minVoicingSpan,
    lowIntervalLimit: source?.lowIntervalLimit ?? DEFAULT_REGISTER.lowIntervalLimit,
  };
}

export interface EffectiveWindow {
  window: [number, number];
  /** メロディを避けるために窓を下げた半音数 (0 なら宣言どおり) */
  loweredBy: number;
  /** 下限や可動域の制限で、宣言した melodyClearance を確保しきれなかった */
  clearanceReduced: boolean;
}

/**
 * 楽器のボイシング窓に、実際に生成されたメロディの最低音を反映させる。
 *
 * 窓は「平行移動」させる。上限だけを切り下げると幅が潰れて転回形の候補が
 * 全滅し、声部連結が無言で無効化される。逆に幅を保ったまま下端を床で
 * 止めると、ピアノとギターが同じ窓に落ちて衝突が付け替わるだけになる
 * (実測で両方 50〜63 に重なった)。平行移動なら宣言した楽器間の
 * テッシトゥーラ差がそのまま保たれる。
 *
 * 動かせる量には上限がある。旋律の下限が低いダイアレクトで窓を無制限に
 * 下げると編成そのものが別物になるため、残りは voiceChord の
 * 旋律回避 (avoid) が半音・短 9 度をピンポイントで潰す。
 */
export function effectiveWindow(
  plan: RegisterPlan,
  instrument: "piano" | "guitar",
  melody?: NoteEvent[],
): EffectiveWindow {
  const declared = plan[instrument];
  const base: [number, number] = [declared[0], declared[1]];
  if (!melody?.length || plan.melodyClearance <= 0) {
    return { window: base, loweredBy: 0, clearanceReduced: false };
  }
  const ceiling = Math.min(...melody.map((note) => note.pitch)) - plan.melodyClearance;
  if (ceiling >= base[1]) return { window: base, loweredBy: 0, clearanceReduced: false };

  const wanted = ceiling - base[1];
  const shift = Math.max(wanted, -MAX_SHIFT, ABSOLUTE_FLOOR - base[0]);
  return {
    window: [base[0] + shift, base[1] + shift],
    loweredBy: -shift,
    clearanceReduced: shift > wanted,
  };
}
