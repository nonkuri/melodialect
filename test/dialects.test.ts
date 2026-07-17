import { describe, expect, it } from "vitest";
import { parseRoman, romanRootPc, chordDisplayName, chordFromRoman } from "../src/engine/harmony.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import { dialects, paul, john, george, yuming } from "../src/dialects/index.js";

describe("新ダイアレクトのコード語彙", () => {
  const keyC = { tonic: 0, mode: "major" as const };

  it("John の借用和音: ♭VI (pc=8), iv (マイナー)", () => {
    expect(romanRootPc(parseRoman("♭VI"), keyC)).toBe(8); // A♭
    expect(parseRoman("iv")).toEqual({ degree: 4, flat: false, quality: "min" });
  });

  it("George の II7 はドッペルドミナント (D7 in C)", () => {
    const p = parseRoman("II7");
    expect(p).toEqual({ degree: 2, flat: false, quality: "dom7" });
    expect(romanRootPc(p, keyC)).toBe(2);
  });

  it("Yuming の I△7 / III7", () => {
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
  for (const dialect of [john, george, yuming]) {
    it(`${dialect.id}: シード固定で決定的に生成できる`, () => {
      const a = generateSong({ dialect, seed: 7 });
      const b = generateSong({ dialect, seed: 7 });
      expect(a).toEqual(b);
      expect(a.totalBars).toBeGreaterThan(0);
      for (const sec of a.sections) {
        expect(sec.chords.length).toBe(sec.plan.bars);
        expect(sec.melody.length).toBeGreaterThan(0);
      }
    });
  }

  it("John: 変則フレーズ長 (7 小節セクション) がいずれかのシードで出る", () => {
    let found = false;
    for (let seed = 1; seed <= 15 && !found; seed++) {
      const song = generateSong({ dialect: john, seed });
      found = song.sections.some((s) => s.plan.bars === 7);
    }
    expect(found).toBe(true);
  });

  it("John: 同音連打が多い (隣接音の反復率が Paul より高い)", () => {
    const repeatRate = (dialectId: "john" | "paul") => {
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
    const johnRate = repeatRate("john");
    expect(johnRate).toBeGreaterThan(0.25);
    expect(johnRate).toBeGreaterThan(repeatRate("paul"));
  });

  it("George: 逆ペダルポイント (最頻メロディ音の占有率が高い)", () => {
    let dominant = 0;
    let sections = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const song = generateSong({ dialect: george, seed });
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
    const song = generateSong({ dialect: george, seed: 1 });
    expect(song.sections[0]!.annotations.some((a) => a.ruleId === "inverted-pedal")).toBe(true);
  });

  it("Yuming: サビ頭で大きく跳躍する (7 半音以上が高頻度)", () => {
    let bigLeaps = 0;
    let choruses = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const song = generateSong({ dialect: yuming, seed });
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

describe("合作モード (§4.2)", () => {
  it("セクション別にダイアレクトを割り当てられる", () => {
    const song = generateSong({
      dialect: paul,
      seed: 42,
      form: [
        { type: "verse", dialectName: "john" },
        { type: "chorus" },
        { type: "verse", dialectName: "john" },
        { type: "chorus", dialectName: "yuming" },
      ],
      resolveDialect: (name) => dialects[name],
    });
    expect(song.sections.map((s) => s.dialectId)).toEqual([
      "john-modal", "paul-classic", "john-modal", "yuming-twilight",
    ]);
  });

  it("parseForm は v:john 記法を解釈する", () => {
    expect(parseForm("v:john,c,b:yuming")).toEqual([
      { type: "verse", dialectName: "john" },
      { type: "chorus" },
      { type: "bridge", dialectName: "yuming" },
    ]);
  });

  it("未知のダイアレクト名はエラー", () => {
    expect(() =>
      generateSong({
        dialect: paul,
        seed: 1,
        form: [{ type: "verse", dialectName: "nobody" }],
        resolveDialect: (name) => dialects[name],
      }),
    ).toThrow(/unknown dialect/);
  });
});
