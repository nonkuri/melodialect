import { describe, expect, it } from "vitest";
import { createRng } from "../src/engine/rng.js";
import { parseRoman, romanRootPc, chordFromRoman, scaleOf } from "../src/engine/harmony.js";
import { generateSong } from "../src/engine/song.js";
import { chromatic } from "../src/dialects/index.js";

describe("rng", () => {
  it("同じシードなら同じ系列を返す", () => {
    const a = createRng(123);
    const b = createRng(123);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("weighted は重みに従いサンプリングする", () => {
    const rng = createRng(1);
    const counts = { x: 0, y: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[rng.weighted<"x" | "y">([["x", 9], ["y", 1]])]++;
    }
    expect(counts.x).toBeGreaterThan(800);
  });
});

describe("harmony: ローマ数字パース", () => {
  it("基本トライアドの度数と性質", () => {
    expect(parseRoman("I")).toEqual({ degree: 1, flat: false, quality: "maj" });
    expect(parseRoman("vi")).toEqual({ degree: 6, flat: false, quality: "min" });
    expect(parseRoman("V7")).toEqual({ degree: 5, flat: false, quality: "dom7" });
    expect(parseRoman("ii7")).toEqual({ degree: 2, flat: false, quality: "min7" });
    expect(parseRoman("IV△7")).toEqual({ degree: 4, flat: false, quality: "maj7" });
    expect(parseRoman("♭VII")).toEqual({ degree: 7, flat: true, quality: "maj" });
  });

  it("C メジャーで ♭VII のルートは B♭ (pc=10)", () => {
    const key = { tonic: 0, mode: "major" as const };
    expect(romanRootPc(parseRoman("♭VII"), key)).toBe(10);
  });

  it("V7 のボイシングは属七の構成音を含む", () => {
    const key = { tonic: 0, mode: "major" as const };
    const chord = chordFromRoman("V7", 0, key);
    const pcs = chord.pitches.map((p) => p % 12).sort((a, b) => a - b);
    expect(pcs).toEqual([2, 5, 7, 11]); // G7 = G B D F
  });
});

describe("generateSong (Chromatic, seed 固定)", () => {
  const song = generateSong({ dialect: chromatic, seed: 42 });

  it("同じシードなら同一の曲を生成する (再現性 §4.2)", () => {
    const again = generateSong({ dialect: chromatic, seed: 42 });
    expect(again).toEqual(song);
  });

  it("異なるシードでは異なる曲になる", () => {
    const other = generateSong({ dialect: chromatic, seed: 43 });
    const symbols = (s: typeof song) =>
      s.sections.flatMap((sec) => sec.chords.map((c) => c.symbol)).join(",");
    const melodyPitches = (s: typeof song) =>
      s.sections.flatMap((sec) => sec.melody.map((n) => n.pitch)).join(",");
    expect(symbols(other) + melodyPitches(other)).not.toBe(symbols(song) + melodyPitches(song));
  });

  it("構成は V-C-V-C で各 8 小節 (Chromatic は変則フレーズなし)", () => {
    expect(song.sections.map((s) => s.plan.type)).toEqual(["verse", "chorus", "verse", "chorus"]);
    for (const s of song.sections) expect(s.plan.bars).toBe(8);
    expect(song.totalBars).toBe(32);
  });

  it("最終セクションは V7 → I の全終止で終わる", () => {
    const last = song.sections.at(-1)!;
    const lastChords = last.chords.slice(-2).map((c) => c.symbol);
    expect(lastChords).toEqual(["V7", "I"]);
  });

  it("メロディはすべて音域内かつスケール音またはその小節のコードトーン", () => {
    // 借用和音 (♭VII 等) の小節では強拍がスケール外のコードトーンになり得る
    const scalePcs = scaleOf(song.key);
    for (const sec of song.sections) {
      for (const n of sec.melody) {
        expect(n.pitch).toBeGreaterThanOrEqual(60);
        expect(n.pitch).toBeLessThanOrEqual(81);
        const bar = Math.floor(n.start / song.meter.barBeats);
        const chordPcs = sec.chords[bar]!.pitches.map((p) => p % 12);
        const pc = ((n.pitch % 12) + 12) % 12;
        expect(scalePcs.includes(pc) || chordPcs.includes(pc)).toBe(true);
      }
    }
  });

  it("各小節のメロディの長さの合計は 1 小節分", () => {
    for (const sec of song.sections) {
      const byBar = new Map<number, number>();
      for (const n of sec.melody) {
        const bar = Math.floor(n.start / song.meter.barBeats);
        byBar.set(bar, (byBar.get(bar) ?? 0) + n.duration);
      }
      for (const [, total] of byBar) expect(total).toBeCloseTo(song.meter.barBeats);
    }
  });

  it.each(["3/4", "6/8"] as const)("拍子 %s でも各小節が正しい長さになる", (meterName) => {
    const metered = generateSong({ dialect: chromatic, seed: 42, meterName });
    expect(metered.meter.name).toBe(meterName);
    for (const sec of metered.sections) {
      const byBar = new Map<number, number>();
      for (const n of sec.melody) {
        const bar = Math.floor(n.start / metered.meter.barBeats);
        byBar.set(bar, (byBar.get(bar) ?? 0) + n.duration);
      }
      for (const [, total] of byBar) expect(total).toBeCloseTo(metered.meter.barBeats);
      // 伴奏も小節内に収まっている
      for (const n of [...sec.piano, ...sec.bass]) {
        const bar = Math.floor(n.start / metered.meter.barBeats);
        expect(n.start + n.duration).toBeLessThanOrEqual(
          (bar + 1) * metered.meter.barBeats + 1e-9,
        );
      }
    }
    // 同一シードでも 4/4 とは別の曲になるが決定的
    expect(generateSong({ dialect: chromatic, seed: 42, meterName })).toEqual(metered);
  });

  it("半音階クリシェが適用された場合はベースが半音下降する", () => {
    // 複数シードのどれかでクリシェが出ることを確認 (確率 0.6)
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const s = generateSong({ dialect: chromatic, seed });
      for (const sec of s.sections) {
        const cliche = sec.annotations.filter((a) => a.ruleId === "chromatic-cliche");
        if (cliche.length > 0) {
          found = true;
          const basses = sec.chords.slice(0, 4).map((c) => c.bassPitch);
          expect(basses[1]).toBe(basses[0]! - 1);
          expect(basses[2]).toBe(basses[0]! - 2);
          expect(basses[3]).toBe(basses[0]! - 3);
        }
      }
    }
    expect(found).toBe(true);
  });

  it("生成根拠の注記が付与される", () => {
    const all = song.sections.flatMap((s) => s.annotations);
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) {
      expect(a.ruleId).toBeTruthy();
      expect(a.text).toBeTruthy();
    }
  });
});
