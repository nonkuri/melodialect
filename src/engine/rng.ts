/** シード付き乱数 (mulberry32)。同じシードなら常に同じ系列を返す (§4.2 再現性)。 */

export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [min, max] の整数 */
  int(min: number, max: number): number;
  /** 確率 p で true */
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  /** 重み付きサンプリング */
  weighted<T>(entries: ReadonlyArray<[T, number]>): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      if (arr.length === 0) throw new Error("pick from empty array");
      return arr[Math.floor(next() * arr.length)]!;
    },
    weighted(entries) {
      if (entries.length === 0) throw new Error("weighted from empty entries");
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) {
        r -= w;
        if (r < 0) return value;
      }
      return entries[entries.length - 1]![0];
    },
  };
}
