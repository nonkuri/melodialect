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

/** Stable hash used to derive independent random streams without consuming a parent RNG. */
export function deriveSeed(seed: number, ...names: Array<string | number>): number {
  let value = (seed ^ 0x811c9dc5) >>> 0;
  for (const name of names) {
    const text = String(name);
    for (let index = 0; index < text.length; index++) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    value ^= 0xff;
    value = Math.imul(value, 0x85ebca6b) >>> 0;
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return value >>> 0;
}

export function createNamedRng(
  seed: number,
  name: string,
  sectionIndex = 0,
  candidateIndex = 0,
): Rng {
  return createRng(deriveSeed(seed, name, sectionIndex, candidateIndex));
}
