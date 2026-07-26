/**
 * 動機労作 (v1.9)。
 *
 * シークエンス (移調反復) は melody.ts の motif-repeat が既に持っていて、
 * セクション間の主題再現は theme.ts が持っている。ここが足すのは、その 2 つでは
 * 書けない「展開部でやること」— 断片化・拡大・反行・ストレッタ。
 *
 * 和声の技法レジストリ (techniques.ts) とは別に立てている。あちらは ChordEvent の
 * 列を書き換えるもので、こちらはモチーフの律動と輪郭を書き換えるもの。同じ
 * レジストリに同居させると、片方の型に合わせるための分岐が両方へ入り込む。
 *
 * ダイアレクト設計ルール 3 と同じ理由で、操作子は終止形へは適用しない。
 * 除外は呼び出し側 (melody.ts) が担当し、セクション最終フレーズの最終小節を
 * 展開の対象から外してモチーフのまま残す。
 */

/** モチーフ 1 音分。step はモチーフ先頭音からの音階段数 */
export interface MotifSlot {
  offsetInPhrase: number;
  duration: number;
  rest: boolean;
  step: number;
}

export type MotifOperatorFn = (slots: MotifSlot[], phraseBeats: number) => MotifSlot[];

const registry = new Map<string, MotifOperatorFn>();

export function registerMotifOperator(name: string, fn: MotifOperatorFn): void {
  registry.set(name, fn);
}

export function registeredMotifOperatorNames(): string[] {
  return [...registry.keys()];
}

/** 未登録の名前や、フレーズに収まらない結果は null を返して呼び出し側を素通しさせる */
export function applyMotifOperator(
  name: string,
  slots: MotifSlot[],
  phraseBeats: number,
): MotifSlot[] | null {
  const fn = registry.get(name);
  if (!fn || !slots.length) return null;
  const result = fn(slots.map((slot) => ({ ...slot })), phraseBeats);
  const sounding = result.filter((slot) => !slot.rest);
  if (!sounding.length) return null;
  const fits = result.every((slot) =>
    slot.offsetInPhrase >= -1e-9 && slot.offsetInPhrase + slot.duration <= phraseBeats + 1e-9);
  return fits ? result : null;
}

/** モチーフの先頭から、指定拍数に収まるぶんだけを切り出す */
function head(slots: MotifSlot[], beats: number): MotifSlot[] {
  const cell: MotifSlot[] = [];
  for (const slot of slots) {
    if (slot.offsetInPhrase + slot.duration > beats + 1e-9) break;
    cell.push(slot);
  }
  return cell;
}

/** cell を offset から敷き、フレーズをはみ出す分は捨てる */
function layAt(cell: MotifSlot[], offset: number, phraseBeats: number): MotifSlot[] {
  return cell
    .map((slot) => ({ ...slot, offsetInPhrase: offset + slot.offsetInPhrase }))
    .filter((slot) => slot.offsetInPhrase + slot.duration <= phraseBeats + 1e-9);
}

/**
 * 断片化。モチーフの頭 1 拍ぶんだけを取り出し、フレーズいっぱいに敷き詰める。
 * 展開部の主要な手口で、主題が「切り刻まれて」聞こえる
 */
registerMotifOperator("fragmentation", (slots, phraseBeats) => {
  const cellBeats = Math.max(1, Math.min(2, phraseBeats / 4));
  const cell = head(slots, cellBeats);
  if (!cell.length) return slots;
  const span = Math.max(...cell.map((slot) => slot.offsetInPhrase + slot.duration));
  const out: MotifSlot[] = [];
  for (let offset = 0; offset + span <= phraseBeats + 1e-9; offset += span) {
    out.push(...layAt(cell, offset, phraseBeats));
  }
  return out.length ? out : slots;
});

/** 反行。音階段数の符号を反転して輪郭を鏡像にする。律動は変えない */
registerMotifOperator("inversion", (slots) =>
  slots.map((slot) => ({ ...slot, step: -slot.step })));

/**
 * 拡大。音価を 2 倍に引き伸ばす。フレーズをはみ出した分は切り落とすので、
 * 実際には「主題の前半だけが 2 倍の音価で鳴る」形になる
 */
registerMotifOperator("augmentation", (slots, phraseBeats) => {
  const out = slots
    .map((slot) => ({
      ...slot,
      offsetInPhrase: slot.offsetInPhrase * 2,
      duration: slot.duration * 2,
    }))
    .filter((slot) => slot.offsetInPhrase + slot.duration <= phraseBeats + 1e-9);
  return out.length ? out : slots;
});

/**
 * ストレッタ。旋律が 1 本しかないので、声部を重ねる本来の形は取れない。
 * 単旋律での相当物として、断片の再登場を詰めていく (間隔を 1 回ごとに縮める)。
 * 主題が追い立てられて聞こえる、という効果の側を採っている
 */
registerMotifOperator("stretto", (slots, phraseBeats) => {
  const cell = head(slots, Math.max(1, Math.min(2, phraseBeats / 4)));
  if (!cell.length) return slots;
  const span = Math.max(...cell.map((slot) => slot.offsetInPhrase + slot.duration));

  // 入りの位置を先に決める。間隔は 1 回ごとに 8 分ぶん詰めるが、詰めるのは
  // 4 回まで。無制限に詰めると間隔が下限に張り付き、どの入りも頭の 1 音で
  // 断ち切られて「同じ音の連打」に化ける (実測: 16 拍で 20 音以上が step 0 に
  // なった)。詰め終わったら元の間隔へ戻し、残りは断片の反復で埋める
  const floor = Math.max(0.5, span / 2);
  const entries: number[] = [];
  let offset = 0;
  let gap = span;
  while (offset + 0.5 <= phraseBeats + 1e-9) {
    entries.push(offset);
    offset += gap;
    gap = entries.length < 4 ? Math.max(floor, gap - 0.5) : span;
  }
  if (entries.length < 2) return slots;

  const out: MotifSlot[] = [];
  entries.forEach((entry, index) => {
    // 次の入りが来たら前の入りはそこで断ち切られる。旋律は 1 本しかないので、
    // 重ねるのではなく食い込ませることでしか「詰まってくる」を出せない
    const cutoff = Math.min(entries[index + 1] ?? phraseBeats, phraseBeats);
    for (const slot of cell) {
      const start = entry + slot.offsetInPhrase;
      if (start >= cutoff - 1e-9) break;
      out.push({ ...slot, offsetInPhrase: start, duration: Math.min(slot.duration, cutoff - start) });
    }
  });
  return out.length ? out : slots;
});
