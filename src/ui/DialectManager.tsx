import { useMemo, useRef, useState } from "react";
import type { Dialect, MelodicContour, Mode } from "../engine/types.js";
import { generateSong } from "../engine/song.js";
import {
  dialectList,
  dialects,
  downloadDialectJson,
  DRUM_PATTERNS,
  GUITAR_PATTERNS,
  listUserDialects,
  loadDialect,
  MELODIC_CONTOURS,
  PIANO_PATTERNS,
  readUserDialectFile,
  removeUserDialect,
  renameUserDialect,
  saveUserDialect,
  validateDialectDefinition,
  type DialectValidationIssue,
} from "../dialects/index.js";

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function nextId(source: Dialect): string {
  const root = `user-${source.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 39).replace(/-+$/g, "") || "user-dialect";
  for (let index = 1; index < 10_000; index++) {
    const id = `${root}-${index}`;
    if (!dialects[id]) return id;
  }
  return `user-${Date.now().toString(36)}`;
}

export function duplicateDialectDefinition(source: Dialect): Dialect {
  const duplicate = structuredClone(source);
  duplicate.id = nextId(source);
  duplicate.name = `${source.name} のコピー`;
  return duplicate;
}

function progressionText(dialect: Dialect): string {
  return (dialect.chord.idioms ?? [])
    .map((progression) => `${progression.symbols.join(", ")} | ${progression.weight}`)
    .join("\n");
}

function parseProgressions(value: string): NonNullable<Dialect["chord"]["idioms"]> {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [symbolsPart = "", weightPart = "1"] = line.split("|");
    return {
      symbols: symbolsPart.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
      weight: Number(weightPart.trim()),
    };
  });
}

function Issue({ path, issues }: { path: string; issues: DialectValidationIssue[] }) {
  const matches = issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}[`) || issue.path.startsWith(`${path}.`));
  if (!matches.length) return null;
  return <small className="field-issue" role="alert">{matches[0]!.message}</small>;
}

export function DialectManager({
  activeDialectId,
  onUse,
}: {
  activeDialectId: string;
  onUse: (dialect: Dialect) => void;
}) {
  const [sourceId, setSourceId] = useState(activeDialectId);
  const [draft, setDraft] = useState<Dialect | null>(null);
  const [progressions, setProgressions] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const issues = useMemo(() => draft ? validateDialectDefinition(draft) : [], [draft]);
  const users = useMemo(() => listUserDialects(), [tick]);

  const edit = (dialect: Dialect, duplicate: boolean) => {
    const next = duplicate ? duplicateDialectDefinition(dialect) : structuredClone(dialect);
    setDraft(next);
    setProgressions(progressionText(next));
    setPreview([]);
    setMessage(duplicate ? "コピーを編集しています。保存するまで元の定義は変わりません。" : "保存済み定義を編集しています。");
  };
  const update = (recipe: (next: Dialect) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      recipe(next);
      return next;
    });
  };
  const number = (value: string) => Number(value);

  const save = () => {
    if (!draft || issues.length) {
      setMessage("赤字の項目を修正してから保存してください。");
      return;
    }
    try {
      const saved = saveUserDialect(draft);
      setDraft(structuredClone(saved));
      setTick((value) => value + 1);
      setMessage(`${saved.name} を端末へ保存しました。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存に失敗しました");
    }
  };

  const trial = () => {
    if (!draft) return;
    try {
      const dialect = loadDialect(draft);
      const song = generateSong({
        dialect,
        seed: 100,
        keyName: dialect.defaults.key,
        mode: dialect.defaults.mode,
        bpm: dialect.defaults.bpm,
        meterName: dialect.defaults.meter ?? "4/4",
        form: ["verse", "chorus"],
        ending: "loop",
      });
      setPreview(song.sections.map((section, index) =>
        `${index === 0 ? "Verse" : "Chorus"}: ${section.chords.map((chord) => chord.symbol).join(" → ")}（旋律 ${section.melody.length}音）`));
      setMessage("編集中の定義を保存せずに、固定シード100で試し生成しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "試し生成に失敗しました");
    }
  };

  return (
    <section className="dialect-manager" aria-label="ダイアレクト作成と管理">
      <div className="dialect-source-row">
        <label>複製元
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <optgroup label="内蔵">
              {dialectList.filter((dialect) => !users.some((user) => user.id === dialect.id)).map((dialect) =>
                <option key={dialect.id} value={dialect.id}>{dialect.name}</option>)}
            </optgroup>
            {users.length > 0 && <optgroup label="ユーザー">
              {users.map((dialect) => <option key={dialect.id} value={dialect.id}>{dialect.name}</option>)}
            </optgroup>}
          </select>
        </label>
        <button type="button" onClick={() => edit(dialects[sourceId]!, true)}>複製して新規作成</button>
        <button type="button" disabled={!users.some((dialect) => dialect.id === sourceId)} onClick={() => edit(dialects[sourceId]!, false)}>保存済みを編集</button>
        <button type="button" onClick={() => fileRef.current?.click()}>JSON読込</button>
        <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          void readUserDialectFile(file).then((dialect) => {
            setTick((value) => value + 1);
            setSourceId(dialect.id);
            edit(dialect, false);
            setMessage(`${dialect.name} を検証して保存しました。`);
          }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "JSON読込に失敗しました"));
        }} />
      </div>

      {message && <p className="manager-message" role="status">{message}</p>}

      {draft && <div className="dialect-editor">
        <fieldset>
          <legend>基本情報・推奨値</legend>
          <label>ID（英小文字・数字・ハイフン）<input value={draft.id} aria-invalid={issues.some((issue) => issue.path === "id")} onChange={(event) => update((next) => { next.id = event.target.value; })} /><Issue path="id" issues={issues} /></label>
          <label>名前<input value={draft.name} aria-invalid={issues.some((issue) => issue.path === "name")} onChange={(event) => update((next) => { next.name = event.target.value; })} /><Issue path="name" issues={issues} /></label>
          <label>推奨キー<select value={draft.defaults.key} onChange={(event) => update((next) => { next.defaults.key = event.target.value; })}>{KEYS.map((key) => <option key={key}>{key}</option>)}</select><Issue path="defaults.key" issues={issues} /></label>
          <label>調性<select value={draft.defaults.mode} onChange={(event) => update((next) => { next.defaults.mode = event.target.value as Mode; })}><option value="major">メジャー</option><option value="minor">マイナー</option></select></label>
          <label>テンポ<input type="number" min={40} max={240} value={draft.defaults.bpm} onChange={(event) => update((next) => { next.defaults.bpm = number(event.target.value); })} /><Issue path="defaults.bpm" issues={issues} /></label>
          <label>拍子<select value={draft.defaults.meter ?? "4/4"} onChange={(event) => update((next) => { next.defaults.meter = event.target.value; })}><option>4/4</option><option>3/4</option><option>6/8</option></select></label>
        </fieldset>

        <fieldset>
          <legend>コード語彙・優先進行</legend>
          <label className="wide">コード語彙（カンマ区切り）<textarea rows={3} value={draft.chord.vocabulary.join(", ")} onChange={(event) => update((next) => { next.chord.vocabulary = event.target.value.split(/[\s,]+/).filter(Boolean); })} /><Issue path="chord.vocabulary" issues={issues} /></label>
          <label className="wide">優先進行（1行ごと: コード列 | 重み）<textarea rows={5} value={progressions} onChange={(event) => {
            const value = event.target.value;
            setProgressions(value);
            update((next) => { next.chord.idioms = parseProgressions(value); });
          }} /><Issue path="chord.idioms" issues={issues} /></label>
          <label>優先進行の採用率<input type="number" min={0} max={1} step={0.05} value={draft.chord.idiomProbability ?? 0} onChange={(event) => update((next) => { next.chord.idiomProbability = number(event.target.value); })} /><Issue path="chord.idiomProbability" issues={issues} /></label>
        </fieldset>

        <fieldset>
          <legend>旋律・フレーズ</legend>
          <label>旋律輪郭<select value={draft.melody.contour} onChange={(event) => update((next) => { next.melody.contour = event.target.value as MelodicContour; })}>{MELODIC_CONTOURS.map((contour) => <option key={contour}>{contour}</option>)}</select></label>
          <label>通常の跳躍率<input type="number" min={0} max={1} step={0.05} value={draft.melody.leapProbability.default} onChange={(event) => update((next) => { next.melody.leapProbability.default = number(event.target.value); })} /><Issue path="melody.leapProbability.default" issues={issues} /></label>
          <label>サビ頭の跳躍率<input type="number" min={0} max={1} step={0.05} value={draft.melody.leapProbability.chorusHead} onChange={(event) => update((next) => { next.melody.leapProbability.chorusHead = number(event.target.value); })} /><Issue path="melody.leapProbability.chorusHead" issues={issues} /></label>
          <label>跳躍の最小半音<input type="number" min={0} max={24} value={draft.melody.leapRangeSemitones[0]} onChange={(event) => update((next) => { next.melody.leapRangeSemitones[0] = number(event.target.value); })} /></label>
          <label>跳躍の最大半音<input type="number" min={0} max={24} value={draft.melody.leapRangeSemitones[1]} onChange={(event) => update((next) => { next.melody.leapRangeSemitones[1] = number(event.target.value); })} /><Issue path="melody.leapRangeSemitones" issues={issues} /></label>
          <label>同音反復率<input type="number" min={0} max={1} step={0.05} value={draft.melody.repeatNoteProbability ?? 0} onChange={(event) => update((next) => { next.melody.repeatNoteProbability = number(event.target.value); })} /><Issue path="melody.repeatNoteProbability" issues={issues} /></label>
          <label>跳躍後<select value={draft.melody.afterLeapBias} onChange={(event) => update((next) => { next.melody.afterLeapBias = event.target.value as Dialect["melody"]["afterLeapBias"]; })}><option value="down">下降</option><option value="up">上昇</option><option value="none">指定なし</option></select></label>
          <label>フレーズ長（カンマ区切り）<input value={draft.structure.phraseLengths.join(", ")} onChange={(event) => update((next) => { next.structure.phraseLengths = event.target.value.split(/[\s,]+/).filter(Boolean).map(Number); })} /><Issue path="structure.phraseLengths" issues={issues} /></label>
          <label>変則フレーズ率<input type="number" min={0} max={1} step={0.05} value={draft.structure.irregularPhraseProbability} onChange={(event) => update((next) => { next.structure.irregularPhraseProbability = number(event.target.value); })} /><Issue path="structure.irregularPhraseProbability" issues={issues} /></label>
        </fieldset>

        <fieldset>
          <legend>推奨伴奏</legend>
          <label>ピアノ<select value={draft.defaults.arrangement?.pianoPattern ?? "block"} onChange={(event) => update((next) => { next.defaults.arrangement = { ...next.defaults.arrangement, pianoPattern: event.target.value as NonNullable<Dialect["defaults"]["arrangement"]>["pianoPattern"] }; })}>{PIANO_PATTERNS.map((pattern) => <option key={pattern}>{pattern}</option>)}</select></label>
          <label>ギター<select value={draft.defaults.arrangement?.guitarPattern ?? "off"} onChange={(event) => update((next) => { next.defaults.arrangement = { ...next.defaults.arrangement, guitarPattern: event.target.value as NonNullable<Dialect["defaults"]["arrangement"]>["guitarPattern"] }; })}>{GUITAR_PATTERNS.map((pattern) => <option key={pattern}>{pattern}</option>)}</select></label>
          <label>ドラム<select value={draft.defaults.arrangement?.drumPattern ?? "off"} onChange={(event) => update((next) => { next.defaults.arrangement = { ...next.defaults.arrangement, drumPattern: event.target.value as NonNullable<Dialect["defaults"]["arrangement"]>["drumPattern"] }; })}>{DRUM_PATTERNS.map((pattern) => <option key={pattern}>{pattern}</option>)}</select></label>
          <label>スウィング<input type="number" min={0} max={1} step={0.05} value={draft.defaults.arrangement?.swing ?? 0} onChange={(event) => update((next) => { next.defaults.arrangement = { ...next.defaults.arrangement, swing: number(event.target.value) }; })} /></label>
          <label>揺らぎ<input type="number" min={0} max={1} step={0.05} value={draft.defaults.arrangement?.humanize ?? 0} onChange={(event) => update((next) => { next.defaults.arrangement = { ...next.defaults.arrangement, humanize: number(event.target.value) }; })} /></label>
          <label>音量倍率<input type="number" min={0.5} max={1.5} step={0.05} value={draft.defaults.arrangement?.velocityScale ?? 1} onChange={(event) => update((next) => { next.defaults.arrangement = { ...next.defaults.arrangement, velocityScale: number(event.target.value) }; })} /></label>
        </fieldset>

        <p className="advanced-preservation">この基本GUIに表示されないリズム、カデンツ、セクション規則、転調などの高度なJSON項目も元のまま保存します。</p>
        {issues.length > 0 && <details className="dialect-issues" open><summary>{issues.length}件の検証エラー</summary><ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code>: {issue.message}</li>)}</ul></details>}
        {preview.length > 0 && <div className="dialect-preview" aria-live="polite"><strong>試し生成結果</strong>{preview.map((line) => <span key={line}>{line}</span>)}</div>}
        <div className="manager-actions">
          <button type="button" onClick={trial} disabled={issues.length > 0}>試し生成</button>
          <button type="button" className="primary" onClick={save} disabled={issues.length > 0}>端末へ保存</button>
          <button type="button" onClick={() => onUse(draft)} disabled={issues.length > 0 || !users.some((dialect) => dialect.id === draft.id)}>この曲で使う</button>
          <button type="button" onClick={() => downloadDialectJson(draft)} disabled={issues.length > 0}>JSON書き出し</button>
        </div>
      </div>}

      <div className="user-dialect-list">
        <h3>保存済みユーザーダイアレクト</h3>
        {users.length === 0 && <p>まだありません。内蔵ダイアレクトを複製して始めてください。</p>}
        {users.map((dialect) => <article key={dialect.id}>
          <span><strong>{dialect.name}</strong><small>{dialect.id}{activeDialectId === dialect.id ? " · この曲で使用中" : ""}</small></span>
          <button type="button" onClick={() => { setSourceId(dialect.id); edit(dialect, true); }}>複製</button>
          <button type="button" onClick={() => { setSourceId(dialect.id); edit(dialect, false); }}>編集</button>
          <button type="button" onClick={() => {
            const name = window.prompt("新しい表示名", dialect.name);
            if (name === null) return;
            try { renameUserDialect(dialect.id, name); setTick((value) => value + 1); }
            catch (error) { setMessage(error instanceof Error ? error.message : "名前変更に失敗しました"); }
          }}>名前変更</button>
          <button type="button" onClick={() => downloadDialectJson(dialect)}>JSON</button>
          <button type="button" className="danger" disabled={activeDialectId === dialect.id} title={activeDialectId === dialect.id ? "別のダイアレクトへ切り替えてから削除してください" : undefined} onClick={() => {
            if (!window.confirm(`「${dialect.name}」を削除しますか？`)) return;
            try {
              removeUserDialect(dialect.id);
              if (sourceId === dialect.id) setSourceId(activeDialectId);
              setTick((value) => value + 1);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "削除に失敗しました");
            }
          }}>削除</button>
        </article>)}
      </div>
    </section>
  );
}
