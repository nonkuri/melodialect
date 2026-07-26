import { describe, expect, it } from "vitest";
import { parseRoman, romanRootPc, chordDisplayName, chordFromRoman } from "../src/engine/harmony.js";
import { generateSong } from "../src/engine/song.js";
import { parseForm } from "../src/engine/structure.js";
import {
  dialects,
  chromatic,
  modal,
  pedal,
  twilight,
  angular,
  orchestral,
  bossa,
  ostinato,
  serene,
  flow,
  blue,
  lament,
  interlock,
  voicing,
  drift,
  pulse,
  ember,
  prism,
  ryukyu,
  miyakobushi,
  agitato,
  dialectList,
} from "../src/dialects/index.js";
import { scaleOf } from "../src/engine/harmony.js";

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
  for (const dialect of [
    modal, pedal, twilight, angular, orchestral, bossa, ostinato, serene,
    flow, blue, lament, interlock, voicing,
  ]) {
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

  it("変則フレーズは1セクションで1小節だけ縮まり、6小節にはならない", () => {
    for (const dialect of [chromatic, modal]) {
      for (let seed = 1; seed <= 50; seed++) {
        const song = generateSong({ dialect, seed, form: ["verse"], ending: "loop" });
        expect(song.sections[0]!.plan.bars).toBeGreaterThanOrEqual(7);
      }
    }
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

  it("Chromatic: 専用ベースが4分音符で動き、半音接近音を含む", () => {
    let chromaticMoves = 0;
    let sections = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const song = generateSong({ dialect: chromatic, seed, form: ["verse"], ending: "loop" });
      const section = song.sections[0]!;
      sections++;
      expect(section.annotations.some((a) => a.ruleId === "melodic-bass")).toBe(true);
      expect(section.bass.length).toBeGreaterThanOrEqual(section.plan.bars * 3);
      chromaticMoves += section.bass.slice(1).filter((note, index) =>
        Math.abs(note.pitch - section.bass[index]!.pitch) === 1).length;
    }
    expect(chromaticMoves / sections).toBeGreaterThan(5);
  });

  it("Modal: ミクソリディアンの♭7とモーダル終止を優先する", () => {
    expect(scaleOf({ tonic: 7, mode: "major" }, modal.melody.pitchCollection)).toContain(5); // G の F
    let modalCadences = 0;
    let authenticCadences = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const song = generateSong({ dialect: modal, seed, form: ["verse"], ending: "loop" });
      const symbol = song.sections[0]!.chords.at(-1)!.symbol;
      if (symbol === "♭VII" || symbol === "IV") modalCadences++;
      if (symbol === "V7") authenticCadences++;
    }
    expect(modalCadences).toBeGreaterThan(authenticCadences * 2);
  });

  it("Pedal: ルート・5度ドローンとsus/add9の内声変化を両立する", () => {
    let coloredChords = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const song = generateSong({ dialect: pedal, seed, form: ["verse"], ending: "loop" });
      const section = song.sections[0]!;
      expect(section.annotations.some((a) => a.ruleId === "drone-bass")).toBe(true);
      expect(new Set(section.bass.map((note) => note.pitch % 12))).toEqual(new Set([2, 9]));
      coloredChords += section.chords.filter((chord) =>
        chord.quality === "sus4" || chord.quality === "add9").length;
    }
    expect(coloredChords).toBeGreaterThan(20);
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

describe("追加ダイアレクト (§4.1 D5〜D9)", () => {
  it("Bossa: 表示名がピアノとギターに共通する特徴を表す", () => {
    expect(bossa.name).toBe("Bossa (ルートレス和音+2小節シンコペーション)");
  });

  it("Serene: デフォルト拍子が 3/4 になり、休符から入る小節がある", () => {
    const song = generateSong({ dialect: serene, seed: 1 });
    expect(song.meter.name).toBe("3/4");
    expect(song.key.mode).toBe("major");
    // [-1, 2] テンプレート: 1 拍目が休符で 2 拍目からメロディが入る
    let restBar = false;
    for (let seed = 1; seed <= 10 && !restBar; seed++) {
      const s = generateSong({ dialect: serene, seed });
      for (const sec of s.sections) {
        for (const n of sec.melody) {
          if (Math.abs((n.start % s.meter.barBeats) - 1) < 1e-9 && n.duration === 2) {
            restBar = true;
          }
        }
      }
    }
    expect(restBar).toBe(true);
  });

  it("Ostinato: 短調 (A minor) で、同音連打率が非常に高い", () => {
    const song = generateSong({ dialect: ostinato, seed: 1 });
    expect(song.key).toEqual({ tonic: 9, mode: "minor" });
    let repeats = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = generateSong({ dialect: ostinato, seed });
      for (const sec of s.sections) {
        for (let i = 1; i < sec.melody.length; i++) {
          total++;
          if (sec.melody[i]!.pitch === sec.melody[i - 1]!.pitch) repeats++;
        }
      }
    }
    expect(repeats / total).toBeGreaterThan(0.3);
  });

  it("Bossa: 1 小節 2 コードのシンコペ和声が出る", () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const song = generateSong({ dialect: bossa, seed });
      found = song.sections.some((sec) =>
        sec.chords.some((c) => c.durationBeats === song.meter.barBeats / 2),
      );
    }
    expect(found).toBe(true);
  });

  it("Bossa: 専用ピアノとギター、先取りベース、2小節クロススティックを使う", () => {
    const song = generateSong({
      dialect: bossa,
      seed: 7,
      form: ["verse"],
      ending: "loop",
    });
    const section = song.sections[0]!;
    const hasStartNear = (notes: typeof section.piano, target: number) =>
      notes.some((note) => Math.abs(note.start - target) < 0.04);

    expect(song.arrangement).toMatchObject({
      pianoPattern: "bossa",
      guitarPattern: "bossa",
      drumPattern: "bossa",
      swing: 0.02,
    });
    expect(section.chords[0]!.symbol).toBe("I△9");
    expect(section.chords.some((chord) => chord.pitches.length >= 5)).toBe(true);
    expect(section.annotations.some((annotation) => annotation.ruleId === "bossa-groove")).toBe(true);

    for (const target of [0, 1.5, 3, 4.5, 6, 7.5]) {
      expect(hasStartNear(section.piano, target)).toBe(true);
    }
    for (const target of [0.5, 1.5, 2, 3.5, 4.5, 5, 6.5, 7, 7.5]) {
      expect(hasStartNear(section.guitar, target)).toBe(true);
    }
    for (const target of [0, 1.5, 2, 3.5]) {
      expect(hasStartNear(section.bass, target)).toBe(true);
    }
    const crossStick = section.drums.filter((note) => note.pitch === 37);
    for (const target of [0.5, 1.5, 3, 5, 6.5]) {
      expect(hasStartNear(crossStick, target)).toBe(true);
    }
  });

  it("Bossa: コーダも専用ボイシングのピアノとギターで終止する", () => {
    const song = generateSong({ dialect: bossa, seed: 7, form: ["verse"] });
    const section = song.sections[0]!;
    const codaStart = (section.plan.bars - 1) * song.meter.barBeats;
    expect(section.piano.some((note) => Math.abs(note.start - codaStart) < 0.04)).toBe(true);
    expect(section.guitar.some((note) => Math.abs(note.start - codaStart) < 0.04)).toBe(true);
  });

  it("Orchestral: 1–7–6–5の下降転回ベースと旋律的ベースを前景化する", () => {
    let applied = 0;
    let example: ReturnType<typeof generateSong>["sections"][number] | undefined;
    let chorusExample: ReturnType<typeof generateSong>["sections"][number] | undefined;
    for (let seed = 1; seed <= 40; seed++) {
      const section = generateSong({
        dialect: orchestral,
        seed,
        form: ["verse"],
        ending: "loop",
      }).sections[0]!;
      if (section.annotations.some((annotation) =>
        annotation.ruleId === "orchestral-inversion-line")) {
        applied++;
        example ??= section;
      }
      expect(section.annotations.some((annotation) =>
        annotation.ruleId === "melodic-bass")).toBe(true);
      expect(section.annotations.some((annotation) =>
        annotation.ruleId === "close-voice-leading")).toBe(true);

      const chorus = generateSong({
        dialect: orchestral,
        seed,
        form: ["chorus"],
        ending: "loop",
      }).sections[0]!;
      if (chorus.annotations.some((annotation) =>
        annotation.ruleId === "orchestral-inversion-line")) chorusExample ??= chorus;
    }
    expect(applied).toBeGreaterThanOrEqual(28);
    expect(example!.chords.slice(0, 4).map((chord) => chord.symbol)).toEqual([
      "I△7", "V7/3", "vi7", "iii7/3",
    ]);
    const bass = example!.chords.slice(0, 4).map((chord) => chord.bassPitch);
    expect(bass.slice(1).map((pitch, index) => pitch - bass[index]!)).toEqual([-1, -2, -2]);
    expect(chorusExample!.chords.slice(0, 4).map((chord) => chord.symbol)).toEqual([
      "vi7", "iii7/3", "IV△7", "I△7/3",
    ]);
    const chorusBass = chorusExample!.chords.slice(0, 4).map((chord) => chord.bassPitch);
    expect(chorusBass.slice(1).map((pitch, index) => pitch - chorusBass[index]!))
      .toEqual([-2, -2, -1]);
  });

  it("Angular: 変則フレーズ (8 小節未満のセクション) が出る", () => {
    let found = false;
    for (let seed = 1; seed <= 15 && !found; seed++) {
      const song = generateSong({ dialect: angular, seed });
      found = song.sections.some((s) => s.plan.bars < 8);
    }
    expect(found).toBe(true);
  });

  it("Angular: 方向反転・広い跳躍・1小節2コードを実際の出力に反映する", () => {
    const intervals: number[] = [];
    let directionChanges = 0;
    let directionPairs = 0;
    let twoChordBars = 0;
    let bars = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const section = generateSong({
        dialect: angular,
        seed,
        form: ["verse"],
        ending: "loop",
      }).sections[0]!;
      const sectionIntervals = section.melody.slice(1).map((note, index) =>
        note.pitch - section.melody[index]!.pitch);
      intervals.push(...sectionIntervals);
      for (let index = 1; index < sectionIntervals.length; index++) {
        const previous = sectionIntervals[index - 1]!;
        const current = sectionIntervals[index]!;
        if (previous === 0 || current === 0) continue;
        directionPairs++;
        if (Math.sign(previous) !== Math.sign(current)) directionChanges++;
      }
      for (let bar = 0; bar < section.plan.bars; bar++) {
        bars++;
        if (section.chords.filter((chord) => chord.bar === bar).length === 2) twoChordBars++;
      }
    }
    expect(intervals.filter((interval) => Math.abs(interval) >= 5).length / intervals.length)
      .toBeGreaterThan(0.25);
    expect(directionChanges / directionPairs).toBeGreaterThan(0.58);
    expect(twoChordBars / bars).toBeGreaterThan(0.4);
  });
});

describe("追加ダイアレクト D10〜D21", () => {
  it("全21ダイアレクトが重複なく推奨伴奏を持つ", () => {
    expect(dialectList).toHaveLength(21);
    expect(new Set(dialectList.map((dialect) => dialect.id)).size).toBe(21);
    for (const dialect of dialectList) {
      expect(dialect.defaults.arrangement).toBeDefined();
      expect(generateSong({ dialect, seed: 1 }).arrangement).toMatchObject(
        dialect.defaults.arrangement!,
      );
    }
  });

  it("Flow: 6/8 と推奨アルペジオ伴奏、セクション別構成を使う", () => {
    const song = generateSong({ dialect: flow, seed: 11, form: ["intro", "chorus"] });
    expect(song.meter.name).toBe("6/8");
    expect(song.arrangement).toMatchObject({
      pianoPattern: "arpeggio",
      guitarPattern: "arpeggio",
      drumPattern: "basic",
    });
    expect(song.sections[0]!.plan.phraseLengths).toEqual([4]);
    expect(song.sections[1]!.plan.phraseLengths).toEqual([4, 4]);
  });

  it("Blue: 12小節形式、ドミナント7th、ブルース音階、シャッフルを使う", () => {
    const song = generateSong({ dialect: blue, seed: 5, form: ["verse"] });
    const section = song.sections[0]!;
    expect(section.plan.bars).toBe(13); // 12 小節本体 + final コーダ
    expect(section.chords.slice(0, 10).map((chord) => chord.symbol)).toEqual([
      "I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7",
    ]);
    expect(section.annotations.some((a) => a.ruleId === "twelve-bar-blues")).toBe(true);
    expect(song.arrangement?.drumPattern).toBe("shuffle");
    expect(scaleOf(song.key, blue.melody.pitchCollection)).toEqual([0, 3, 5, 6, 7, 10]);
  });

  it("Lament: 和声的短音階と i→VII→VI→V7 の下降バスを使う", () => {
    const song = generateSong({ dialect: lament, seed: 3, form: ["verse"] });
    expect(song.key.mode).toBe("minor");
    expect(scaleOf(song.key, lament.melody.pitchCollection)).toContain(8); // A minor の G#
    expect(song.sections[0]!.chords.slice(0, 4).map((chord) => chord.symbol)).toEqual([
      "i", "VII", "VI", "V7",
    ]);
    expect(song.sections[0]!.annotations.some((a) => a.ruleId === "lament-bass")).toBe(true);
  });

  it("Interlock: 3-3-2アクセント、先取りベース、専用伴奏を生成する", () => {
    const song = generateSong({ dialect: interlock, seed: 7, form: ["verse", "chorus"] });
    expect(song.arrangement).toMatchObject({
      pianoPattern: "syncopated",
      guitarPattern: "interlocking",
      drumPattern: "interlock",
    });
    for (const section of song.sections) {
      expect(section.annotations.some((a) => a.ruleId === "groove-profile")).toBe(true);
      expect(section.bass.some((note) => Math.abs((note.start % 4) - 1.5) < 0.04)).toBe(true);
    }
  });

  it("Voicing: 9th・sus・half diminishedを解釈し、声部連結ピアノを使う", () => {
    expect(parseRoman("I△9").quality).toBe("maj9");
    expect(parseRoman("ii9").quality).toBe("min9");
    expect(parseRoman("V9").quality).toBe("dom9");
    expect(parseRoman("Isus2").quality).toBe("sus2");
    expect(parseRoman("Vsus4").quality).toBe("sus4");
    expect(parseRoman("viiø7").quality).toBe("halfDim7");
    expect(chordFromRoman("I△9", 0, { tonic: 0, mode: "major" }).pitches).toHaveLength(5);
    const song = generateSong({ dialect: voicing, seed: 9, form: ["chorus"], ending: "loop" });
    const section = song.sections[0]!;
    expect(song.arrangement?.pianoPattern).toBe("voice-led");
    expect(section.chords.some((chord) => chord.pitches.length >= 5)).toBe(true);
    expect(section.chords.some((chord) => chord.quality === "sus2" || chord.quality === "sus4"))
      .toBe(true);
    expect(section.annotations.some((annotation) => annotation.ruleId === "close-voice-leading"))
      .toBe(true);

    const voicings = section.chords.map((chord) => section.piano
      .filter((note) => Math.abs(note.start - chord.start) < 0.14)
      .map((note) => note.pitch)
      .sort((a, b) => a - b));
    expect(voicings.every((pitches) => pitches.length >= 3 && pitches.length <= 4)).toBe(true);
    for (let chordIndex = 1; chordIndex < voicings.length; chordIndex++) {
      const previous = voicings[chordIndex - 1]!;
      const current = voicings[chordIndex]!;
      current.forEach((pitch, voiceIndex) => {
        const targetIndex = current.length === 1
          ? 0
          : Math.round(voiceIndex * (previous.length - 1) / (current.length - 1));
        expect(Math.abs(pitch - previous[targetIndex]!)).toBeLessThanOrEqual(7);
      });
    }
  });
});

describe("旋法と変拍子のダイアレクト D15〜D18", () => {
  const FORM = parseForm("i,v,c,v,c,b,c,o");

  it("Drift: ドリアン音集合と長三和音の IV (短調に♮6が差す) を使う", () => {
    const song = generateSong({ dialect: drift, seed: 5, form: FORM });
    expect(song.key.mode).toBe("minor");
    // ドリアンの ♮6 = 主音 + 9 半音。自然短音階には無い
    expect(scaleOf(song.key, drift.melody.pitchCollection)).toContain((song.key.tonic + 9) % 12);
    const fourths = song.sections.flatMap((s) => s.chords).filter((c) => c.symbol === "IV");
    expect(fourths.length).toBeGreaterThan(0);
    // 短調の IV は長三和音として鳴る (根音 +4 半音が構成音にある)
    for (const chord of fourths.slice(0, 5)) {
      expect(chord.pitches.map((p) => ((p - chord.pitches[0]!) % 12 + 12) % 12)).toContain(4);
    }
  });

  it("Pulse: 4つ打ちドラムが毎拍キックを鳴らし、裏拍にオープンハイハットを置く", () => {
    const song = generateSong({ dialect: pulse, seed: 3, form: FORM });
    expect(song.arrangement?.drumPattern).toBe("drive");
    const chorus = song.sections.find((s) => s.plan.type === "chorus")!;
    const at = (beat: number, pitch: number) =>
      chorus.drums.some((n) => Math.abs(n.start - beat) < 0.05 && n.pitch === pitch);
    for (const beat of [0, 1, 2, 3]) expect(at(beat, 36), `${beat}拍のキック`).toBe(true);
    for (const beat of [0.5, 1.5, 2.5, 3.5]) expect(at(beat, 46), `${beat}拍のオープン`).toBe(true);
  });

  it("Ember: 7/8 の小節にフリギアの♭II が鳴り、音符が小節をはみ出さない", () => {
    const song = generateSong({ dialect: ember, seed: 11, form: FORM });
    expect(song.meter.name).toBe("7/8");
    expect(song.meter.barBeats).toBe(3.5);
    // ♭II = 主音 +1 半音の長三和音。フリギア以外では出てこない
    const flatTwo = song.sections.flatMap((s) => s.chords).filter((c) => c.symbol.startsWith("♭II"));
    expect(flatTwo.length).toBeGreaterThan(0);
    expect(flatTwo[0]!.rootPc).toBe((song.key.tonic + 1) % 12);
    for (const section of song.sections) {
      for (const note of section.melody) {
        const bar = Math.floor(note.start / 3.5 + 1e-9);
        expect(note.start + note.duration).toBeLessThanOrEqual((bar + 1) * 3.5 + 1e-6);
      }
    }
  });

  it("Prism: 5/4 を 3+2 で刻み、リディアンの♯4 を含む II が鳴る", () => {
    // シードによっては伴奏バリアントが「鍵盤独奏」(ドラム無し) を全セクションに
    // 選ぶため、拍節を確認できるシードを使う
    const song = generateSong({ dialect: prism, seed: 3, form: FORM });
    expect(song.meter.name).toBe("5/4");
    expect(song.meter.barBeats).toBe(5);
    expect(scaleOf(song.key, prism.melody.pitchCollection)).toContain((song.key.tonic + 6) % 12);
    const two = song.sections.flatMap((s) => s.chords).find((c) => c.symbol === "II")!;
    // II の第 3 音 = 主音 +6 半音 = リディアンの♯4
    expect(two.pitches.map((p) => ((p - song.key.tonic) % 12 + 12) % 12)).toContain(6);
    // 3+2 のグループ頭 (0 拍と 3 拍) にキックが乗る
    const chorus = song.sections.find((s) => s.plan.type === "chorus")!;
    for (const beat of [0, 3]) {
      expect(chorus.drums.some((n) => Math.abs(n.start - beat) < 0.05 && n.pitch === 36),
        `${beat}拍のキック`).toBe(true);
    }
  });
});

describe("日本の音階のダイアレクト D19〜D20", () => {
  const FORM = parseForm("i,v,c,v,c,b,c,o");
  const degreeOf = (pitch: number, tonic: number) => (((pitch - tonic) % 12) + 12) % 12;

  it("Ryukyu: 琉球音階 (♮3・♮7 を含み 2 度と 6 度が無い) で歌い、三線のストロークを保つ", () => {
    const song = generateSong({ dialect: ryukyu, seed: 21, form: FORM });
    const RYUKYU = [0, 4, 5, 7, 11];
    expect(scaleOf(song.key, ryukyu.melody.pitchCollection))
      .toEqual(RYUKYU.map((offset) => (song.key.tonic + offset) % 12));
    const degrees = song.sections.flatMap((section) => section.melody)
      .map((note) => degreeOf(note.pitch, song.key.tonic));
    expect(degrees.filter((degree) => RYUKYU.includes(degree)).length / degrees.length)
      .toBeGreaterThan(0.9);
    // 長 2 度と長 6 度は琉球音階に無い。ここが混ざると本土のヨナ抜きに寄る
    expect(degrees.filter((degree) => degree === 2 || degree === 9).length / degrees.length)
      .toBeLessThan(0.06);
    // 三線に当たるギターのストロークはダイアレクトの定義的な奏法なので、
    // どの伴奏バリアントでも外れない
    for (const variant of ryukyu.defaults.arrangementVariants!) {
      expect(variant.arrangement.guitarPattern).toBe("strum");
    }
  });

  it("Miyakobushi: 都節音階の♭2 と♭II が鳴り、持続低音の上で音が長く伸びる", () => {
    const song = generateSong({ dialect: miyakobushi, seed: 3, form: FORM });
    expect(song.key.mode).toBe("minor");
    // 都節の顔は主音のすぐ上の半音。律音階やヨナ抜き短音階には無い
    expect(scaleOf(song.key, miyakobushi.melody.pitchCollection))
      .toEqual([0, 1, 5, 7, 8].map((offset) => (song.key.tonic + offset) % 12));
    const melody = song.sections.flatMap((section) => section.melody);
    expect(melody.filter((note) => degreeOf(note.pitch, song.key.tonic) === 1).length)
      .toBeGreaterThan(0);
    const flatTwo = song.sections.flatMap((section) => section.chords)
      .filter((chord) => chord.symbol.startsWith("♭II"));
    expect(flatTwo.length).toBeGreaterThan(0);
    expect(flatTwo[0]!.rootPc).toBe((song.key.tonic + 1) % 12);

    const bars = song.sections.reduce((sum, section) => sum + section.plan.bars, 0);
    expect(melody.length / bars).toBeLessThan(2.5);
    expect(melody.filter((note) => note.duration >= 2).length / melody.length)
      .toBeGreaterThan(0.35);
    // ベースは調の中心を保つペダル。コードごとに動き回らない
    expect(song.sections.flatMap((section) => section.bass).length / bars).toBeLessThan(2.2);
  });
});

describe("急速短調ソナタのダイアレクト D21 (v1.9)", () => {
  const FORM = parseForm("i,v,c,b,v,c,o");
  const build = (seed: number) => generateSong({ dialect: agitato, seed, form: FORM });
  const chordsOf = (seed: number) => build(seed).sections.flatMap((section) => section.chords);

  it("Agitato: 2/2 のアラブレーヴェで、和声的短音階の導音を持つ", () => {
    const song = build(1);
    expect(song.meter.name).toBe("2/2");
    expect(song.meter.barBeats).toBe(4);
    expect(song.meter.midiNumerator).toBe(2);
    expect(song.meter.midiDenominator).toBe(2);
    expect(song.key.mode).toBe("minor");
    // 和声的短音階の♮7 (主音 +11 半音)
    expect(scaleOf(song.key, agitato.melody.pitchCollection)).toContain((song.key.tonic + 11) % 12);
  });

  it("Agitato: 減七・副属和音・ナポリが実際に鳴る", () => {
    const chords = [1, 2, 3, 4, 5, 6].flatMap((seed) => chordsOf(seed));
    const dim7 = chords.filter((chord) => chord.quality === "dim7");
    expect(dim7.length, "減七が 1 つも出ていない").toBeGreaterThan(0);
    // 減七は短 3 度の積み重ね。三和音 (dim) に落ちていないことを確かめる
    for (const chord of dim7.slice(0, 20)) {
      const intervals = chord.pitches.slice(1).map((pitch, i) => pitch - chord.pitches[i]!);
      expect(intervals).toEqual([3, 3, 3]);
    }
    expect(chords.some((chord) => chord.symbol === "V7/iv" || chord.symbol === "V7/V"),
      "副属和音が出ていない").toBe(true);
    expect(chords.some((chord) => chord.symbol === "♭II"), "ナポリが出ていない").toBe(true);
  });

  it("Agitato: 応用減七の根音が借用先の導音になる", () => {
    const key = { tonic: 9, mode: "minor" as const }; // A minor
    // V7/V = B7 (E の属七)、vii°7/V = D#dim7 (E の導音上の減七)。
    // 数字を無視して常に「借用先の 5 度上」にすると、どちらも B になってしまう
    expect(chordFromRoman("V7/V", 0, key).rootPc).toBe(11);
    expect(chordFromRoman("vii°7/V", 0, key).rootPc).toBe(3);
    expect(chordFromRoman("vii°7/iv", 0, key).rootPc).toBe(1);
    expect(chordDisplayName(chordFromRoman("♯vii°7", 0, key), false)).toBe("G#dim7");
  });

  it("Agitato: 二重奏の編成を保ち、走句を刻む", () => {
    for (const seed of [1, 5, 9]) {
      const song = build(seed);
      // 伴奏バリアントはどれも鍵盤だけ。ギターとドラムが入ると二重奏でなくなる
      expect(song.sections.flatMap((section) => section.guitar), `seed=${seed}`).toHaveLength(0);
      expect(song.sections.flatMap((section) => section.drums), `seed=${seed}`).toHaveLength(0);
      const melody = song.sections.flatMap((section) => section.melody);
      const short = melody.filter((note) => note.duration <= 0.5 + 1e-9);
      expect(short.length / melody.length, `seed=${seed} の走句`).toBeGreaterThan(0.3);
    }
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
