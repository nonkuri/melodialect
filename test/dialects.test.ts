import { describe, expect, it } from "vitest";
import { parseRoman, romanRootPc, chordDisplayName, chordFromRoman } from "../src/engine/harmony.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import { dialects, chromatic, modal, pedal, twilight } from "../src/dialects/index.js";

describe("新ダイアレクトのコード語彙", () => {
  const keyC = { tonic: 0, mode: "major" as const };

  it("Modal の借用和音: ♭VI (pc=8), iv (マイナー)", () => {
    expect(romanRootPc(parseRoman("♭VI"), keyC)).toBe(8); // A♭
    expect(parseRoman("iv")).toEqual({ degree: 4, flat: false, quality: "min" });
  });

  it("Pedal の II7 はドッペルドミナント (D7 in C)", () => {
    const p = parseRoman("II7");
    expect(p).toEqual({ degree: 2, flat: false, quality: "dom7" });
    expect(romanRootPc(p, keyC)).toBe(2);
  });

  it("Twilight の I△7 / III7", () => {
    expect(parseRoman("I△7")).toEqual({ degree: 1, flat: false, quality: "maj7" });
    expect(parseRoman("III7")).toEqual({ degree: 3, flat: false, quality: "dom7" });
  });

  it("コード表示名: スラッシュベースとフラット表記", () => {
    const chord = chordFromRoman("I", 0, keyC);
    expect(chordDisplayName(chord, false)).toBe("C");
    const slash = { ...chord, bassPitch: chord.bassPitch - 2 }; // C/B♭
    expect(chordDisplayName(slash, true)).toBe("C/B♭");
  });
});

describe("各ダイアレクトの生成", () => {
  for (const dialect of [modal, pedal, twilight]) {
    it(`${dialect.id}: シード固定で決定的に生成できる`, () => {
      const a = generateSong({ dialect, seed: 7 });
      const b = generateSong({ dialect, seed: 7 });
      expect(a).toEqual(b);
      expect(a.totalBars).toBeGreaterThan(0);
      for (const sec of a.sections) {
        // コードイベントはセクションを隙間なく被覆する (ハーモニックリズム対応)
        expect(sec.chords[0]!.start).toBe(0);
        for (let i = 1; i < sec.chords.length; i++) {
          expect(sec.chords[i]!.start).toBeCloseTo(
            sec.chords[i - 1]!.start + sec.chords[i - 1]!.durationBeats,
          );
        }
        const last = sec.chords.at(-1)!;
        expect(last.start + last.durationBeats).toBeCloseTo(sec.plan.bars * a.meter.barBeats);
        expect(sec.melody.length).toBeGreaterThan(0);
      }
    });
  }

  it("Modal: 変則フレーズ長 (7 小節セクション) がいずれかのシードで出る", () => {
    let found = false;
    for (let seed = 1; seed <= 15 && !found; seed++) {
      const song = generateSong({ dialect: modal, seed });
      found = song.sections.some((s) => s.plan.bars === 7);
    }
    expect(found).toBe(true);
  });

  it("Modal: 同音連打が多い (隣接音の反復率が Chromatic より高い)", () => {
    const repeatRate = (dialectId: "modal" | "chromatic") => {
      let repeats = 0;
      let total = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const song = generateSong({ dialect: dialects[dialectId]!, seed });
        for (const sec of song.sections) {
          for (let i = 1; i < sec.melody.length; i++) {
            total++;
            if (sec.melody[i]!.pitch === sec.melody[i - 1]!.pitch) repeats++;
          }
        }
      }
      return repeats / total;
    };
    const modalRate = repeatRate("modal");
    expect(modalRate).toBeGreaterThan(0.25);
    expect(modalRate).toBeGreaterThan(repeatRate("chromatic"));
  });

  it("Pedal: 逆ペダルポイント (最頻メロディ音の占有率が高い)", () => {
    let dominant = 0;
    let sections = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const song = generateSong({ dialect: pedal, seed });
      for (const sec of song.sections) {
        sections++;
        const counts = new Map<number, number>();
        for (const n of sec.melody) {
          counts.set(n.pitch, (counts.get(n.pitch) ?? 0) + 1);
        }
        const top = Math.max(...counts.values());
        if (top / sec.melody.length >= 0.4) dominant++;
      }
    }
    expect(dominant / sections).toBeGreaterThan(0.6);
    const song = generateSong({ dialect: pedal, seed: 1 });
    expect(song.sections[0]!.annotations.some((a) => a.ruleId === "inverted-pedal")).toBe(true);
  });

  it("Twilight: サビ頭で大きく跳躍する (7 半音以上が高頻度)", () => {
    let bigLeaps = 0;
    let choruses = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const song = generateSong({ dialect: twilight, seed });
      for (let i = 1; i < song.sections.length; i++) {
        const sec = song.sections[i]!;
        if (sec.plan.type !== "chorus") continue;
        choruses++;
        const prevLast = song.sections[i - 1]!.melody.at(-1)!.pitch;
        const first = sec.melody[0]!.pitch;
        if (Math.abs(first - prevLast) >= 5) bigLeaps++;
      }
    }
    expect(choruses).toBeGreaterThan(0);
    expect(bigLeaps / choruses).toBeGreaterThan(0.5);
  });
});

describe("作曲分析の 6 要素 (§4.1)", () => {
  it("ハーモニックリズム: Twilight のサビに 1 小節 2 コードが出る", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: twilight, seed });
      found = song.sections.some(
        (sec) =>
          sec.plan.type === "chorus" &&
          sec.chords.some((c) => c.durationBeats === song.meter.barBeats / 2),
      );
    }
    expect(found).toBe(true);
  });

  it("ハーモニックリズム: Modal に 2 小節 1 コードが出る", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: modal, seed });
      found = song.sections.some((sec) =>
        sec.chords.some((c) => c.durationBeats === song.meter.barBeats * 2),
      );
    }
    expect(found).toBe(true);
  });

  it("進行イディオム: Twilight に定型句 (IV△7→III7→vi 等) の注記が付く", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: twilight, seed });
      found = song.sections.some((sec) =>
        sec.annotations.some((a) => a.ruleId === "chord-idiom"),
      );
    }
    expect(found).toBe(true);
  });

  it("カデンツ: 全セクションに終止の注記が付き、最終セクションは I 系で終わる", () => {
    for (const dialect of [chromatic, modal, pedal, twilight]) {
      const song = generateSong({ dialect, seed: 3 });
      for (const sec of song.sections) {
        expect(sec.annotations.some((a) => a.ruleId === "cadence")).toBe(true);
      }
      const lastChord = song.sections.at(-1)!.chords.at(-1)!;
      expect(parseRoman(lastChord.symbol).degree).toBe(1);
    }
  });

  it("モチーフ反復: Chromatic に motif-repeat の注記が付く", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: chromatic, seed });
      found = song.sections.some((sec) =>
        sec.annotations.some((a) => a.ruleId === "motif-repeat"),
      );
    }
    expect(found).toBe(true);
  });

  it("リズム語彙: Modal に休符 (小節内の音価合計 < 1 小節) が出る", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: modal, seed });
      for (const sec of song.sections) {
        const byBar = new Map<number, number>();
        for (const n of sec.melody) {
          const bar = Math.floor(n.start / song.meter.barBeats);
          byBar.set(bar, (byBar.get(bar) ?? 0) + n.duration);
        }
        for (const [, total] of byBar) {
          if (total < song.meter.barBeats - 1e-9) found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("アウフタクト: Twilight に anacrusis の注記が付く", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: twilight, seed });
      found = song.sections.some((sec) =>
        sec.annotations.some((a) => a.ruleId === "anacrusis"),
      );
    }
    expect(found).toBe(true);
  });

  it("非和声音: Twilight に倚音、Pedal に掛留の注記が付く", () => {
    const has = (dialect: typeof twilight, ruleId: string): boolean => {
      for (let seed = 1; seed <= 15; seed++) {
        const song = generateSong({ dialect, seed });
        if (song.sections.some((sec) => sec.annotations.some((a) => a.ruleId === ruleId))) {
          return true;
        }
      }
      return false;
    };
    expect(has(twilight, "appoggiatura")).toBe(true);
    expect(has(pedal, "suspension")).toBe(true);
  });

  it("セクション対比: Twilight のサビはヴァースより音域が高い (レジスタシフト)", () => {
    let versePitches: number[] = [];
    let chorusPitches: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const song = generateSong({ dialect: twilight, seed });
      for (const sec of song.sections) {
        const target = sec.plan.type === "verse" ? versePitches : chorusPitches;
        target.push(...sec.melody.map((n) => n.pitch));
      }
    }
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    expect(mean(chorusPitches)).toBeGreaterThan(mean(versePitches));
  });

  it("転調: Twilight のブリッジがいずれかのシードで転調し、最終セクションは主調に戻る", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({
        dialect: twilight,
        seed,
        form: ["verse", "chorus", "bridge", "chorus"],
      });
      const bridge = song.sections.find((s) => s.plan.type === "bridge")!;
      if (bridge.key.tonic !== song.key.tonic) {
        found = true;
        expect(bridge.annotations.some((a) => a.ruleId === "modulation")).toBe(true);
        expect(song.sections.at(-1)!.key.tonic).toBe(song.key.tonic);
      }
    }
    expect(found).toBe(true);
  });
});

describe("合作モード (§4.2)", () => {
  it("セクション別にダイアレクトを割り当てられる", () => {
    const song = generateSong({
      dialect: chromatic,
      seed: 42,
      form: [
        { type: "verse", dialectName: "modal" },
        { type: "chorus" },
        { type: "verse", dialectName: "modal" },
        { type: "chorus", dialectName: "twilight" },
      ],
      resolveDialect: (name) => dialects[name],
    });
    expect(song.sections.map((s) => s.dialectId)).toEqual([
      "modal-irregular", "chromatic-cliche", "modal-irregular", "twilight-ballad",
    ]);
  });

  it("parseForm は v:modal 記法を解釈する", () => {
    expect(parseForm("v:modal,c,b:twilight")).toEqual([
      { type: "verse", dialectName: "modal" },
      { type: "chorus" },
      { type: "bridge", dialectName: "twilight" },
    ]);
  });

  it("未知のダイアレクト名はエラー", () => {
    expect(() =>
      generateSong({
        dialect: chromatic,
        seed: 1,
        form: [{ type: "verse", dialectName: "nobody" }],
        resolveDialect: (name) => dialects[name],
      }),
    ).toThrow(/unknown dialect/);
  });
});
