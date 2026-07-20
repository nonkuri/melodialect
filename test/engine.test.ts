import { describe, expect, it } from "vitest";
import { createRng } from "../src/engine/rng.js";
import { parseRoman, romanRootPc, chordFromRoman, chordAtBeat, scaleOf } from "../src/engine/harmony.js";
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

  it("構成は V-C-V-C を基本に、変則7小節と最終コーダを再現可能", () => {
    expect(song.sections.map((s) => s.plan.type)).toEqual(["verse", "chorus", "verse", "chorus"]);
    expect(song.sections.map((s) => s.plan.bars)).toEqual([8, 8, 7, 9]);
    expect(song.totalBars).toBe(32);
  });

  it("コードイベントはセクション全体を隙間なく被覆する (ハーモニックリズム)", () => {
    for (const sec of song.sections) {
      const chords = sec.chords;
      expect(chords[0]!.start).toBe(0);
      for (let i = 1; i < chords.length; i++) {
        expect(chords[i]!.start).toBeCloseTo(
          chords[i - 1]!.start + chords[i - 1]!.durationBeats,
        );
      }
      const last = chords.at(-1)!;
      expect(last.start + last.durationBeats).toBeCloseTo(sec.plan.bars * song.meter.barBeats);
    }
  });

  it("最終セクションはダイアレクトの終止形 (I へ解決) で終わる", () => {
    const last = song.sections.at(-1)!;
    const lastChord = last.chords.at(-1)!;
    expect(parseRoman(lastChord.symbol).degree).toBe(1);
    expect(last.annotations.some((a) => a.ruleId === "cadence")).toBe(true);
  });

  it("メロディは音域内かつスケール音・コードトーン・半音隣接音 (非和声音) のいずれか", () => {
    // 借用和音の小節では強拍がスケール外のコードトーンになり得る。
    // 半音階経過音 (§4.1) は前後の音と半音関係にあることを確認する
    const scalePcs = scaleOf(song.key);
    for (const sec of song.sections) {
      sec.melody.forEach((n, i) => {
        expect(n.pitch).toBeGreaterThanOrEqual(57);
        expect(n.pitch).toBeLessThanOrEqual(85);
        const chord = chordAtBeat(sec.chords, n.start);
        const chordPcs = chord.pitches.map((p) => p % 12);
        const pc = ((n.pitch % 12) + 12) % 12;
        const prev = sec.melody[i - 1];
        const next = sec.melody[i + 1];
        const isChromaticNeighbor =
          (prev !== undefined && Math.abs(n.pitch - prev.pitch) === 1) ||
          (next !== undefined && Math.abs(n.pitch - next.pitch) === 1);
        expect(
          scalePcs.includes(pc) || chordPcs.includes(pc) || isChromaticNeighbor,
        ).toBe(true);
      });
    }
  });

  it("各小節のメロディは小節内に収まり、休符込みで 1 小節分を超えない", () => {
    for (const sec of song.sections) {
      const byBar = new Map<number, number>();
      for (const n of sec.melody) {
        const bar = Math.floor(n.start / song.meter.barBeats);
        expect(n.start + n.duration).toBeLessThanOrEqual(
          (bar + 1) * song.meter.barBeats + 1e-9,
        );
        byBar.set(bar, (byBar.get(bar) ?? 0) + n.duration);
      }
      for (const [, total] of byBar) {
        expect(total).toBeLessThanOrEqual(song.meter.barBeats + 1e-9);
      }
    }
  });

  it.each(["3/4", "6/8"] as const)("拍子 %s でも各小節が正しい長さになる", (meterName) => {
    const metered = generateSong({ dialect: chromatic, seed: 42, meterName });
    expect(metered.meter.name).toBe(meterName);
    for (const sec of metered.sections) {
      for (const n of sec.melody) {
        const bar = Math.floor(n.start / metered.meter.barBeats);
        expect(n.start + n.duration).toBeLessThanOrEqual(
          (bar + 1) * metered.meter.barBeats + 1e-9,
        );
      }
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
    // 複数シードのどれかでクリシェが出ることを確認 (確率 0.6 × 先頭 4 小節が 1 コード/小節のとき)
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
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

  it("final (既定): コーダで終止和音を保持し、メロディは入らない", () => {
    expect(song.ending).toBe("final");
    const last = song.sections.at(-1)!;
    const bb = song.meter.barBeats;
    const tailStart = 8 * bb;
    const coda = last.chords.at(-1)!;
    expect(coda.start).toBe(tailStart);
    expect(coda.durationBeats).toBe(bb);
    expect(parseRoman(coda.symbol).degree).toBe(1);
    expect(last.annotations.some((a) => a.ruleId === "final-hold")).toBe(true);
    expect(
      last.piano.some((n) => n.start === tailStart && n.duration === bb),
    ).toBe(true);
    expect(last.melody.every((n) => n.start < tailStart)).toBe(true);
  });

  it("loop: コーダなし・半終止で終わり、最後の音が曲頭の音に近い", () => {
    const looped = generateSong({ dialect: chromatic, seed: 42, ending: "loop" });
    expect(looped.ending).toBe("loop");
    expect(looped.totalBars).toBe(31);
    const last = looped.sections.at(-1)!;
    const lastChord = last.chords.at(-1)!;
    // 半終止 (V7 / IV) のまま曲頭の I へ戻る
    expect(parseRoman(lastChord.symbol).degree).not.toBe(1);
    expect(last.annotations.some((a) => a.ruleId === "loop-seam")).toBe(true);
    expect(last.annotations.some((a) => a.ruleId === "final-hold")).toBe(false);
    const firstPitch = looped.sections[0]!.melody[0]!.pitch;
    const lastPitch = last.melody.at(-1)!.pitch;
    expect(Math.abs(lastPitch - firstPitch)).toBeLessThanOrEqual(6);
    // ループモードも決定的
    expect(generateSong({ dialect: chromatic, seed: 42, ending: "loop" })).toEqual(looped);
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
