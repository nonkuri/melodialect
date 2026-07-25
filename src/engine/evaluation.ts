import type {
  DiversityLevel,
  GenerationMetrics,
  GenerationReason,
  GeneratedSection,
  NoteEvent,
  SectionType,
  Song,
  SongFingerprint,
} from "./types.js";
import { chordAtBeat, parseRoman } from "./harmony.js";
import { createNamedRng } from "./rng.js";

const EPSILON = 1e-7;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

function quantize(value: number, step = 0.25): number {
  return Math.round(value / step) * step;
}

function intervalFingerprint(notes: NoteEvent[]): string {
  const ordered = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return ordered.slice(1).map((note, index) => {
    const previous = ordered[index]!;
    const interval = Math.max(-12, Math.min(12, note.pitch - previous.pitch));
    return `${interval}@${quantize(note.start - previous.start)}/${quantize(note.duration)}`;
  }).join(",");
}

function rangeOf(notes: NoteEvent[]): string {
  if (!notes.length) return "off";
  const pitches = notes.map((note) => note.pitch);
  return `${Math.min(...pitches)}-${Math.max(...pitches)}`;
}

function onsetFingerprint(notes: NoteEvent[], barBeats: number): string {
  return Array.from(new Set(notes.map((note) => quantize(note.start % barBeats))))
    .sort((a, b) => a - b)
    .join(".");
}

function voicingFingerprint(notes: NoteEvent[]): string {
  const onsets = new Map<string, number[]>();
  notes.forEach((note) => {
    const key = quantize(note.start).toFixed(2);
    const pitches = onsets.get(key) ?? [];
    pitches.push(note.pitch);
    onsets.set(key, pitches);
  });
  return Array.from(onsets.values()).slice(0, 24).map((pitches) => {
    const ordered = pitches.sort((a, b) => a - b);
    return `${ordered.length}:${ordered.at(-1)! - ordered[0]!}`;
  }).join(".");
}

function accompanimentSectionFingerprint(section: GeneratedSection, barBeats: number): string {
  const parts = (["piano", "guitar", "drums"] as const).map((part) => {
    const notes = section[part];
    const activeBars = Array.from(new Set(notes.map((note) => Math.floor(note.start / barBeats))))
      .sort((a, b) => a - b).join(".");
    return `${part}:${activeBars}:${onsetFingerprint(notes, barBeats)}:${rangeOf(notes)}:${voicingFingerprint(notes)}:${notes.length}`;
  });
  return `${section.plan.type}[${parts.join("|")}]`;
}

export function fingerprintSong(song: Song): SongFingerprint {
  const harmonyRaw = song.sections.map((section) => section.chords
    .map((chord) => `${chord.symbol}@${quantize(chord.durationBeats)}`).join(">"))
    .join("/");
  const melodyRaw = song.sections.map((section) => intervalFingerprint(section.melody)).join("/");
  const bassRaw = song.sections.map((section) => intervalFingerprint(section.bass)).join("/");
  const accompanimentRaw = song.sections
    .map((section) => accompanimentSectionFingerprint(section, song.meter.barBeats)).join("/");
  const harmony = stableHash(harmonyRaw);
  const melody = stableHash(melodyRaw);
  const bass = stableHash(bassRaw);
  const accompaniment = stableHash(accompanimentRaw);
  return {
    harmony,
    melody,
    bass,
    accompaniment,
    combined: stableHash([harmony, melody, bass, accompaniment].join("|")),
  };
}

function duplicateEvents(notes: NoteEvent[]): boolean {
  const seen = new Set<string>();
  for (const note of notes) {
    const key = `${note.start.toFixed(5)}:${note.duration.toFixed(5)}:${note.pitch}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function validateGeneratedSong(song: Song): string[] {
  const violations: string[] = [];
  if (!song.sections.length) violations.push("セクションがありません");
  song.sections.forEach((section, sectionIndex) => {
    const sectionBeats = section.plan.bars * song.meter.barBeats;
    const chords = [...section.chords].sort((a, b) => a.start - b.start);
    if (!chords.length) violations.push(`${sectionIndex + 1}番目のセクションにコードがありません`);
    if (chords[0] && Math.abs(chords[0].start) > EPSILON) {
      violations.push(`${sectionIndex + 1}番目のセクションのコードが先頭から始まりません`);
    }
    chords.forEach((chord, index) => {
      if (!Number.isFinite(chord.start) || !Number.isFinite(chord.durationBeats) || chord.durationBeats <= 0) {
        violations.push(`${sectionIndex + 1}番目のセクションに不正なコード音価があります`);
      }
      const next = chords[index + 1];
      if (next && Math.abs(chord.start + chord.durationBeats - next.start) > EPSILON) {
        violations.push(`${sectionIndex + 1}番目のセクションのコード被覆に隙間または重複があります`);
      }
    });
    const finalChord = chords.at(-1);
    if (finalChord && Math.abs(finalChord.start + finalChord.durationBeats - sectionBeats) > EPSILON) {
      violations.push(`${sectionIndex + 1}番目のセクション末尾までコードが被覆されていません`);
    }
    for (const part of ["melody", "piano", "guitar", "bass", "drums"] as const) {
      const notes = section[part];
      if (duplicateEvents(notes)) violations.push(`${sectionIndex + 1}番目の${part}に重複イベントがあります`);
      if (notes.some((note) => !Number.isFinite(note.start) || !Number.isFinite(note.duration) ||
        note.duration <= 0 || note.start < -EPSILON || note.start + note.duration > sectionBeats + EPSILON ||
        note.pitch < 0 || note.pitch > 127)) {
        violations.push(`${sectionIndex + 1}番目の${part}に範囲外イベントがあります`);
      }
      if ((part === "melody" || part === "bass") && notes.some((note, index) =>
        index > 0 && Math.abs(note.pitch - notes[index - 1]!.pitch) > (part === "bass" ? 24 : 36))) {
        violations.push(`${sectionIndex + 1}番目の${part}に極端な跳躍があります`);
      }
    }
  });
  return Array.from(new Set(violations));
}

function harmonicCoherence(song: Song): number {
  const values: number[] = [];
  for (const section of song.sections) {
    for (let index = 1; index < section.chords.length; index++) {
      try {
        const previous = parseRoman(section.chords[index - 1]!.symbol);
        const current = parseRoman(section.chords[index]!.symbol);
        const distance = Math.abs(current.degree - previous.degree);
        const functional = current.degree === 1 || current.degree === 4 || current.degree === 5 ||
          previous.degree === 2 || previous.degree === 4 || previous.degree === 5;
        values.push(clamp01(0.82 + (functional ? 0.18 : 0) - (distance === 0 ? 0.25 : 0)));
      } catch {
        values.push(0.7);
      }
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * 声部移動の評価 (§4.4)。
 *
 * 旧実装は移動量の合計をそのまま減点していたため、まったく動かない伴奏が
 * 最高得点になった。この指標の重みを上げると静止した伴奏が選ばれ、
 * セクション対比と正面から衝突する。
 *
 * また加算がオンセット群の数に比例していたので、打点の多いパターン
 * (eighth / interlocking) は「密度が高いだけ」で減点されていた。
 * interlock-332 と ostinato-minimal は定義どおりのことをして罰せられる。
 * ここでは 1 遷移 = 1 サンプルとして平均し、密度の影響を打ち消す。
 */
function movementScore(distance: number): number {
  if (distance === 0) return 0.72; // 静止は中立。最良でも最悪でもない
  if (distance <= 3) return 1;
  return clamp01(1 - (distance - 3) / 9);
}

function nearestMovement(pitch: number, previous: number[]): number {
  return Math.min(...previous.map((source) => {
    const raw = Math.abs(pitch - source);
    return Math.min(raw, Math.abs(raw - 12), Math.abs(raw - 24));
  }));
}

function voiceLeading(song: Song): number {
  const transitions: number[] = [];
  const scoreTransition = (previous: number[], current: number[]): void => {
    if (!previous.length || !current.length) return;
    const mean = current.reduce((sum, pitch) => sum + nearestMovement(pitch, previous), 0) /
      current.length;
    transitions.push(movementScore(mean));
  };
  for (const section of song.sections) {
    for (let index = 1; index < section.chords.length; index++) {
      scoreTransition(section.chords[index - 1]!.pitches, section.chords[index]!.pitches);
    }
    for (const part of ["piano", "guitar"] as const) {
      const onsets = new Map<string, number[]>();
      section[part].forEach((note) => {
        const key = note.start.toFixed(4);
        const pitches = onsets.get(key) ?? [];
        pitches.push(note.pitch);
        onsets.set(key, pitches);
      });
      const groups = Array.from(onsets.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, pitches]) => pitches);
      groups.slice(1).forEach((current, index) => scoreTransition(groups[index]!, current));
    }
  }
  return transitions.length
    ? transitions.reduce((sum, value) => sum + value, 0) / transitions.length
    : 0.7;
}

/** 衝突検出用の 0.25 拍バケット。素直な総当たりは旋律 × 伴奏の O(n²) になる */
const CLASH_BUCKET = 0.25;
/** 装飾音や 16 分の経過音は無罪にする。これ未満の音は数えない */
const CLASH_MIN_DURATION = 0.5;
/** 同時に鳴っていると言える最小の重なり */
const CLASH_MIN_OVERLAP = 0.25;

function bucketNotes(notes: NoteEvent[]): Map<number, NoteEvent[]> {
  const buckets = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    if (note.duration < CLASH_MIN_DURATION - EPSILON) continue;
    const last = Math.floor((note.start + note.duration - EPSILON) / CLASH_BUCKET);
    for (let index = Math.floor(note.start / CLASH_BUCKET); index <= last; index++) {
      const group = buckets.get(index) ?? [];
      group.push(note);
      buckets.set(index, group);
    }
  }
  return buckets;
}

/**
 * 不協和の制御 (§4.4)。
 *
 * 短 2 度を一律に減点すると、ブルース音階の ♭5 が構造的に和音から外れる
 * blue-shuffle、angular-sevenths、extended-voicing が常に不利になり、
 * セレクタが一番無難な候補ばかり選んでこの 3 つの個性が消える。
 *
 * そこで二重に絞る。(1) 短い装飾音やすれ違いの経過音は無罪とし、0.5 拍以上
 * 保持される音どうしが 0.25 拍以上重なって半音・短 9 度になる場合だけを数える。
 * (2) 絶対値ではなくダイアレクトが宣言した期待値からの超過分を測る。
 *
 * (1) だけをもっと厳しくすると全ダイアレクトで 0 になり、指標としての
 * 判別力が消える (accompanimentClarity が 0.98 で飽和していたのと同じ失敗)。
 * 実測で定義を比較し、ダイアレクト間の標準偏差が最大になる形を選んでいる。
 */
function dissonanceControl(song: Song): number {
  const values: number[] = [];
  for (const section of song.sections) {
    const expected = section.expected?.clashPerBar ?? 0.26;
    const buckets = bucketNotes([...section.piano, ...section.guitar]);
    let clashes = 0;
    for (const note of section.melody) {
      if (note.duration < CLASH_MIN_DURATION - EPSILON) continue;
      const seen = new Set<NoteEvent>();
      const last = Math.floor((note.start + note.duration - EPSILON) / CLASH_BUCKET);
      for (let index = Math.floor(note.start / CLASH_BUCKET); index <= last; index++) {
        for (const other of buckets.get(index) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          const overlap = Math.min(note.start + note.duration, other.start + other.duration) -
            Math.max(note.start, other.start);
          if (overlap < CLASH_MIN_OVERLAP - EPSILON) continue;
          const interval = Math.abs(note.pitch - other.pitch);
          if (interval === 1 || interval === 13) clashes += 1;
        }
      }
    }
    const perBar = clashes / Math.max(1, section.plan.bars);
    values.push(clamp01(1 - Math.max(0, perBar - expected) / 0.4));
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
}

/** セクション末とフレーズ末が和音構成音へ着地しているか (§4.4) */
function cadenceLanding(song: Song): number {
  const values: number[] = [];
  for (const section of song.sections) {
    if (!section.melody.length || !section.chords.length) continue;
    const ordered = [...section.melody].sort((a, b) => a.start - b.start);
    const barBeats = song.meter.barBeats;
    // フレーズ末の音 = 各フレーズ最終小節で最後に鳴る音
    const phraseEnds: NoteEvent[] = [];
    let bar = 0;
    for (const length of section.plan.phraseLengths) {
      bar += length;
      const limit = bar * barBeats;
      const candidate = [...ordered].reverse().find((note) => note.start < limit - EPSILON);
      if (candidate) phraseEnds.push(candidate);
    }
    const last = ordered.at(-1)!;
    if (!phraseEnds.includes(last)) phraseEnds.push(last);
    for (const note of phraseEnds) {
      const chord = chordAtBeat(section.chords, note.start);
      const chordPcs = chord.pitches.map((pitch) => ((pitch % 12) + 12) % 12);
      // 曲末は特に厳しく見る
      const weight = note === last ? 2 : 1;
      const fitted = chordPcs.includes(((note.pitch % 12) + 12) % 12) ? 1 : 0;
      for (let index = 0; index < weight; index++) values.push(fitted);
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
}

function melodicFit(song: Song): number {
  let total = 0;
  let fitted = 0;
  for (const section of song.sections) {
    for (const note of section.melody) {
      if (!section.chords.length) continue;
      total += 1;
      const chord = chordAtBeat(section.chords, note.start);
      const chordPcs = chord.pitches.map((pitch) => ((pitch % 12) + 12) % 12);
      const pc = ((note.pitch % 12) + 12) % 12;
      const strongBeat = Math.abs(note.start - Math.round(note.start)) < EPSILON;
      fitted += chordPcs.includes(pc) ? 1 : strongBeat ? 0.45 : 0.72;
    }
  }
  return total ? fitted / total : 0;
}

function bassSmoothness(song: Song): number {
  let score = 0;
  let count = 0;
  for (const section of song.sections) {
    const notes = [...section.bass].sort((a, b) => a.start - b.start);
    notes.forEach((note, index) => {
      if (!section.chords.length) return;
      const chord = chordAtBeat(section.chords, note.start);
      const chordPcs = chord.pitches.map((pitch) => pitch % 12);
      const chordFit = chordPcs.includes(note.pitch % 12) ? 1 : 0.72;
      const leap = index ? Math.abs(note.pitch - notes[index - 1]!.pitch) : 0;
      score += chordFit * clamp01(1 - Math.max(0, leap - 7) / 17);
      count += 1;
    });
  }
  return count ? score / count : 0;
}

function accompanimentClarity(song: Song): number {
  let overlap = 0;
  let total = 0;
  let fitted = 0;
  let pitched = 0;
  for (const section of song.sections) {
    const piano = new Set(section.piano.map((note) => quantize(note.start).toFixed(2)));
    const guitar = new Set(section.guitar.map((note) => quantize(note.start).toFixed(2)));
    total += Math.max(1, piano.size + guitar.size);
    for (const onset of piano) if (guitar.has(onset)) overlap += 1;
    for (const part of [section.piano, section.guitar]) {
      for (const note of part) {
        if (!section.chords.length) continue;
        const chord = chordAtBeat(section.chords, note.start);
        const chordPcs = new Set(chord.pitches.map((pitch) => ((pitch % 12) + 12) % 12));
        fitted += chordPcs.has(((note.pitch % 12) + 12) % 12) ? 1 : 0;
        pitched += 1;
      }
    }
  }
  const separation = clamp01(1 - overlap / Math.max(1, total) * 0.65);
  const chordFit = pitched ? fitted / pitched : 1;
  // 同時発音の少なさより、コードに属する音を鳴らしていることを優先する。
  // これにより「音域変更」を誤って半音移調として実装した場合も採用前に検出できる。
  return chordFit * 0.78 + separation * 0.22;
}

function sectionContrast(song: Song): number {
  if (song.sections.length < 2) return 0.7;
  const density = (section: GeneratedSection) =>
    (section.piano.length + section.guitar.length + section.bass.length + section.drums.length) /
    Math.max(1, section.plan.bars);
  const expectedRatio: Record<GeneratedSection["plan"]["type"], number> = {
    intro: 0.7,
    verse: 0.9,
    chorus: 1.15,
    bridge: 0.95,
    outro: 0.78,
  };
  const values: number[] = [];
  for (let index = 1; index < song.sections.length; index++) {
    const previous = song.sections[index - 1]!;
    const current = song.sections[index]!;
    const ratio = Math.max(0.03, density(current) / Math.max(0.03, density(previous)));
    const target = expectedRatio[current.plan.type];
    const distance = Math.abs(Math.log(ratio / target));
    let score = clamp01(1 - distance / Math.log(2.25));
    // Outroで直前まで鳴っていたドラムが突然ゼロになる切断感を明示的に避ける。
    if (current.plan.type === "outro" && previous.drums.length > 0 && current.drums.length === 0) {
      score *= 0.35;
    }
    values.push(score);
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.7;
}

function densityOf(section: GeneratedSection, parts: Array<"piano" | "guitar" | "bass" | "drums">): number {
  return parts.reduce((sum, part) => sum + section[part].length, 0) / Math.max(1, section.plan.bars);
}

function ratioWithin(value: number, reference: number, minimum: number, maximum: number): boolean {
  if (reference < 1e-7) return value < 1e-7;
  const ratio = value / reference;
  return ratio >= minimum && ratio <= maximum;
}

const SHAPE_PARTS = ["piano", "guitar", "bass", "drums"] as const;

/**
 * 曲全体の厚みで正規化した、セクションごとの密度曲線。
 *
 * 絶対密度で候補を比べると、伴奏バリアントが宣言どおりに編成を薄くした候補
 * (例: Voicing の「無伴奏に近い」) まで「構造の破壊」として弾かれる。
 * 守りたいのはセクション間の起伏であって、曲全体の音量ではない。
 */
function densityContour(song: Song): number[] {
  const densities = song.sections.map((section) => densityOf(section, [...SHAPE_PARTS]));
  const total = densities.reduce((sum, value) => sum + value, 0);
  const average = total / Math.max(1, densities.length);
  if (average < 1e-7) return densities.map(() => 0);
  return densities.map((value) => value / average);
}

function averageDensity(song: Song, type: SectionType): number | null {
  const sections = song.sections.filter((section) => section.plan.type === type);
  if (!sections.length) return null;
  return sections.reduce((sum, section) => sum + densityOf(section, [...SHAPE_PARTS]), 0) /
    sections.length;
}

/**
 * 候補それ自体が、曲としての起伏を保っているか。
 *
 * v1.2.1 で直した破綻 (サビで全楽器を強制する、アウトロでドラムが突然止まる)
 * は「候補 0 と比べて違う」ことではなく「その曲の中で逆さま」であることが問題
 * だった。判定を候補間の比較から曲内の比較へ移す。
 */
function hasCoherentShape(song: Song): boolean {
  const verse = averageDensity(song, "verse");
  const chorus = averageDensity(song, "chorus");
  // サビが Verse より薄い曲は、盛り上がりが逆さまになっている
  if (verse !== null && chorus !== null && verse > 1e-7 && chorus < verse * 0.8) return false;
  const outro = averageDensity(song, "outro");
  const peak = Math.max(...song.sections.map((section) => densityOf(section, [...SHAPE_PARTS])));
  // アウトロが曲中で最も厚いのも同じく逆さま
  if (outro !== null && peak > 1e-7 && outro > peak * 1.05) return false;
  // 一度鳴り出したドラムが、あるセクションだけ完全に消えるのは破綻
  const drums = song.sections.map((section) => section.drums.length);
  if (drums.some((count) => count > 0) && drums.some((count) => count === 0)) {
    const silent = song.sections.filter((section) => section.drums.length === 0);
    // 入口と出口を抜くのは編曲上の意図。それ以外での消音だけを破綻とみなす
    if (silent.some((section) => section.plan.type !== "intro" && section.plan.type !== "outro")) {
      return false;
    }
  }
  return true;
}

/**
 * 基準候補 (候補 0) と同じ起伏を保っているか。
 *
 * ここは以前、各指標に個別のハードしきい値も課していた。しかし候補間の指標差は
 * 0.02〜0.03 程度しかないため、「不協和が 0.03 良くなったが旋律適合が 0.02
 * 落ちた」という健全なトレードオフまで機械的に弾いていた。実測で 112 曲中
 * 81 曲 (72%) で代替案が全滅し、候補を 3 つ作る意味が失われていた。
 *
 * v1.4 で伴奏バリアントを入れた後は、残った絶対密度の比較が今度は
 * バリアントと衝突した。実測 (14 ダイアレクト × 12 シード) では代替候補の
 * 46.7% がここで棄却され、25.6% の曲で代替案が全滅していた。しかも棄却理由は
 * ほぼ全部が「総密度が候補 0 と違う」で、ハード制約違反は 0% だった。
 * つまり弾いていたのは破綻ではなく、宣言どおりに編成を変えた候補だった。
 *
 * そこで比較を「正規化した密度曲線の形」に限り、絶対量の違いは
 * hasCoherentShape が曲内で見る。
 */
function preservesSectionShape(candidate: Song, reference: Song): boolean {
  if (candidate.sections.length !== reference.sections.length) return false;
  if (candidate.sections.some((section, index) =>
    section.plan.type !== reference.sections[index]!.plan.type)) return false;
  if (!hasCoherentShape(candidate)) return false;
  const a = densityContour(candidate);
  const b = densityContour(reference);
  // 正規化後の差。0.55 は「あるセクションだけ相対的な厚みが半分以下／1.5 倍以上」
  // に相当し、編成の入れ替えは通し、特定セクションの空洞化は止める
  return a.every((value, index) => Math.abs(value - b[index]!) <= 0.55);
}

export function evaluateSong(song: Song): GenerationMetrics {
  const violations = validateGeneratedSong(song);
  const harmonic = harmonicCoherence(song);
  const voices = voiceLeading(song);
  const melody = melodicFit(song);
  const bass = bassSmoothness(song);
  const accompaniment = accompanimentClarity(song);
  const contrast = sectionContrast(song);
  const dissonance = dissonanceControl(song);
  const landing = cadenceLanding(song);
  const quality = clamp01(
    harmonic * 0.17 + voices * 0.12 + melody * 0.16 + bass * 0.13 +
    accompaniment * 0.12 + contrast * 0.1 + dissonance * 0.12 + landing * 0.08 -
    violations.length * 0.25,
  );
  return {
    valid: violations.length === 0,
    violations,
    quality,
    harmonicCoherence: harmonic,
    voiceLeading: voices,
    melodicFit: melody,
    bassSmoothness: bass,
    accompanimentClarity: accompaniment,
    sectionContrast: contrast,
    dissonanceControl: dissonance,
    cadenceLanding: landing,
  };
}

function reasonsForSong(song: Song, candidateIndex: number, selectedFrom: number): GenerationReason[] {
  const reasons: GenerationReason[] = [{
    id: `selection-${candidateIndex}`,
    level: "song",
    category: "selection",
    summary: selectedFrom > 1
      ? `${selectedFrom}個の候補から、破綻を避けつつダイアレクトらしさと変化の釣り合う案を選びました`
      : "ダイアレクトの規則から曲全体を組み立てました",
    ruleId: "candidate-selection",
  }];
  song.sections.forEach((section, sectionIndex) => {
    const previous = song.sections[sectionIndex - 1];
    const currentDensity = section.piano.length + section.guitar.length + section.drums.length;
    const previousDensity = previous ? previous.piano.length + previous.guitar.length + previous.drums.length : 0;
    const densityText = !previous ? "曲の入口となる密度に設定"
      : currentDensity > previousDensity * 1.12 ? "前のセクションより伴奏を厚くして展開"
        : currentDensity < previousDensity * 0.88 ? "前のセクションより伴奏を間引いて対比"
          : "前のセクションとの一貫性を維持";
    reasons.push({
      id: `section-${sectionIndex}`,
      level: "section",
      category: "arrangement",
      sectionIndex,
      summary: `${section.plan.type}: ${densityText}`,
      ruleId: "section-arrangement-summary",
    });
  });
  return reasons;
}

export function attachGenerationReport(
  song: Song,
  candidateIndex: number,
  selectedFrom: number,
  diversity: DiversityLevel,
): Song {
  song.generationReport = {
    candidateIndex,
    selectedFrom,
    diversity,
    fingerprint: fingerprintSong(song),
    metrics: evaluateSong(song),
    summary: reasonsForSong(song, candidateIndex, selectedFrom),
  };
  return song;
}

function fingerprintDistance(a: SongFingerprint, b: SongFingerprint): number {
  const fields: Array<keyof SongFingerprint> = ["harmony", "melody", "bass", "accompaniment"];
  return fields.reduce((score, field) => score + (a[field] === b[field] ? 0 : 0.25), 0);
}

export function describeCandidateDifference(candidate: Song, reference?: Song): string[] {
  if (!reference) return ["基準候補"];
  const a = candidate.generationReport?.fingerprint ?? fingerprintSong(candidate);
  const b = reference.generationReport?.fingerprint ?? fingerprintSong(reference);
  const tags: string[] = [];
  if (a.harmony !== b.harmony) tags.push("コードを変奏");
  if (a.melody !== b.melody) tags.push("旋律を変奏");
  if (a.bass !== b.bass) tags.push("ベースが変化");
  if (a.accompaniment !== b.accompaniment) tags.push("伴奏編成を変更");
  return tags.length ? tags : ["細部を変奏"];
}

export function selectSongCandidate(
  candidates: Song[],
  seed: number,
  diversity: DiversityLevel,
): Song {
  if (!candidates.length) throw new Error("生成候補がありません");
  candidates.forEach((song, index) => attachGenerationReport(song, index, candidates.length, diversity));
  const valid = candidates.filter((song) => song.generationReport!.metrics.valid);
  const pool = valid.length ? valid : candidates;
  const reference = candidates[0]!;
  const guarded = pool.filter((song) => song === reference || preservesSectionShape(song, reference));
  const qualified = guarded.length ? guarded : [reference];
  // 形状ガードは reference を無条件で通すので、guarded が空になることはまずない。
  // 実際に起きるのは「代替案だけが全部弾かれ、選択肢が reference 1 つになる」形。
  // 無言で落ちると「候補が同点だった」のか「ガードが働いた」のか区別できない
  if (candidates.length > 1 && qualified.every((song) => song === reference)) {
    reference.generationReport!.metrics.fellBackToReference = true;
  }
  const maxQuality = Math.max(...qualified.map((song) => song.generationReport!.metrics.quality));
  const referenceQuality = reference.generationReport!.metrics.quality;
  // A different automatic result must show a meaningful measured improvement.
  // Diversity remains available without this threshold through 「他の候補」.
  const improvement = diversity === "adventurous" ? 0.008 : diversity === "standard" ? 0.012 : 0.018;
  const top = maxQuality < referenceQuality + improvement
    ? [reference]
    : qualified.filter((song) => song.generationReport!.metrics.quality >= maxQuality - 0.003);
  const rng = createNamedRng(seed, "candidate-selection");
  const weighted = top.map((song, index) => {
    const previous = top.slice(0, index);
    const novelty = previous.length
      ? Math.min(...previous.map((item) => fingerprintDistance(song.generationReport!.fingerprint, item.generationReport!.fingerprint)))
      : 0.5;
    const noveltyWeight = diversity === "stable" ? 0.01 : diversity === "standard" ? 0.04 : 0.1;
    const qualityWeight = Math.exp((song.generationReport!.metrics.quality - maxQuality) * 120);
    return [song, qualityWeight * (1 + novelty * noveltyWeight)] as [Song, number];
  });
  const selected = rng.weighted(weighted);
  selected.generationReport!.differenceTags = describeCandidateDifference(selected, candidates[0]);
  const selectionReason = selected.generationReport!.summary.find((reason) =>
    reason.ruleId === "candidate-selection");
  if (selectionReason && candidates.length > 1) {
    selectionReason.alternatives = candidates.filter((candidate) => candidate !== selected).slice(0, 3)
      .map((candidate) => describeCandidateDifference(candidate, selected).join("・"));
  }
  return selected;
}
