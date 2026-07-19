import { useMemo, useRef, useState } from "react";
import type {
  CompositionDesign,
  EditableSectionLyrics,
  HarmonyGenerationMode,
  LyricsLanguage,
} from "../engine/types.js";
import {
  analyzeSectionContrast,
  captureFixedMotif,
  formatChordDraft,
  normalizeCompositionDesign,
  parseChordDraftText,
  reharmonizeChordDrafts,
} from "../engine/design.js";
import { generateLyrics, generateSectionLyrics } from "../engine/lyrics.js";
import {
  dialects,
  downloadDialectJson,
  listUserDialects,
  readUserDialectFile,
  removeUserDialect,
} from "../dialects/index.js";
import { cloneWorkspace, type WorkspaceState } from "./project.js";
import type { NoteSelection } from "./editor.js";
import {
  deleteChordTemplate,
  listChordTemplates,
  saveChordTemplate,
} from "./chordTemplates.js";

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro", verse: "Verse", chorus: "Chorus", bridge: "Bridge", outro: "Outro",
};

export type CompositionTool = "harmony" | "expression" | "lyrics" | "dialects";

const TOOL_COPY: Record<CompositionTool, {
  title: string;
  description: string;
  saveLabel?: string;
  savedMessage?: string;
}> = {
  harmony: {
    title: "コード進行を設計",
    description: "コード原案の固定、空欄補完、リハーモナイズとテンプレートを扱います。",
    saveLabel: "コード設定を保存",
    savedMessage: "コード設定を保存しました",
  },
  expression: {
    title: "曲全体の表情を設計",
    description: "モチーフ、Chorus間の変奏、セクションごとの緊張度・密度・明るさ・終止形を整えます。",
    saveLabel: "表情設定を保存",
    savedMessage: "曲全体の表情設定を保存しました",
  },
  lyrics: {
    title: "仮歌詞を編集",
    description: "セクションごとの歌詞と、メロディ音符への音節割り当てを編集します。",
    saveLabel: "歌詞を保存",
    savedMessage: "仮歌詞を保存しました",
  },
  dialects: {
    title: "ダイアレクトを管理",
    description: "ユーザー定義ダイアレクトの読み込み、書き出し、削除を行います。",
  },
};

interface Props {
  tool: CompositionTool;
  workspace: WorkspaceState;
  selectedSection: number;
  noteSelections: NoteSelection[];
  onClose: () => void;
  onCommit: (
    workspace: WorkspaceState,
    message: string,
    regenerate?: "melody" | "accompaniment",
  ) => void;
}

function bodyBeats(workspace: WorkspaceState, sectionIndex: number): number {
  const section = workspace.song.sections[sectionIndex]!;
  const isFinal = workspace.song.ending === "final" && sectionIndex === workspace.song.sections.length - 1;
  return Math.max(1, section.plan.bars - (isFinal ? 1 : 0)) * workspace.song.meter.barBeats;
}

export function CompositionDesignDialog({
  tool,
  workspace,
  selectedSection,
  noteSelections,
  onClose,
  onCommit,
}: Props) {
  const copy = TOOL_COPY[tool];
  const [design, setDesign] = useState<CompositionDesign>(() =>
    normalizeCompositionDesign(workspace.design, workspace.song, workspace.composition));
  const [chordTexts, setChordTexts] = useState(() =>
    design.chordDrafts.map((draft) => formatChordDraft(draft)));
  const [lyrics, setLyrics] = useState<EditableSectionLyrics[]>(() =>
    generateLyrics(workspace.song).map((item) => structuredClone(item)));
  const [lyricSection, setLyricSection] = useState(Math.min(selectedSection, workspace.song.sections.length - 1));
  const [templateName, setTemplateName] = useState("お気に入り進行");
  const [templates, setTemplates] = useState(listChordTemplates);
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [dialectIssues, setDialectIssues] = useState<string[]>([]);
  const [userDialectTick, setUserDialectTick] = useState(0);
  const regenerationSalt = useRef(1);

  const parsedDrafts = useMemo(() => workspace.song.sections.map((section, index) => {
    const dialect = dialects[section.dialectId] ?? dialects[workspace.settings.dialectId]!;
    return parseChordDraftText(
      chordTexts[index] ?? "",
      bodyBeats(workspace, index),
      workspace.song.meter,
      dialect,
      section.key,
      workspace.song.ending === "final" && index === workspace.song.sections.length - 1,
    );
  }), [chordTexts, workspace]);
  const hasErrors = parsedDrafts.some((result) => result.diagnostics.some((item) => item.severity === "error"));
  const contrast = useMemo(() => analyzeSectionContrast(workspace.song), [workspace.song]);

  const updateExpression = (index: number, patch: Partial<CompositionDesign["sectionExpressions"][number]>) => {
    setDesign((current) => {
      const sectionExpressions = structuredClone(current.sectionExpressions);
      sectionExpressions[index] = { ...sectionExpressions[index]!, ...patch };
      return { ...current, sectionExpressions };
    });
  };

  const buildWorkspace = (): WorkspaceState | null => {
    if (tool === "harmony" && design.harmonyMode !== "auto" && hasErrors) {
      setMessage("コード進行のエラーを修正してから適用してください");
      return null;
    }
    const next = cloneWorkspace(workspace);
    const currentDesign = normalizeCompositionDesign(workspace.design, workspace.song, workspace.composition);
    if (tool === "harmony") {
      next.design = {
        ...currentDesign,
        harmonyMode: design.harmonyMode,
        chordDrafts: hasErrors ? structuredClone(design.chordDrafts) : parsedDrafts.map((result) => result.slots),
        originalChordDrafts: structuredClone(design.originalChordDrafts),
      };
    } else if (tool === "expression") {
      next.design = {
        ...currentDesign,
        motif: structuredClone(design.motif),
        chorusVariation: design.chorusVariation,
        sectionExpressions: structuredClone(design.sectionExpressions),
      };
    } else if (tool === "lyrics") {
      next.song.lyrics = structuredClone(lyrics);
    }
    return next;
  };

  const apply = (regenerate?: "melody" | "accompaniment") => {
    const next = buildWorkspace();
    if (!next) return;
    onCommit(
      next,
      regenerate
        ? `固定コードに対して${regenerate === "melody" ? "メロディ" : "伴奏"}だけ生成しました`
        : copy.savedMessage ?? "設定を保存しました",
      regenerate,
    );
    onClose();
  };

  const rehar = () => {
    if (hasErrors) return setMessage("コード進行のエラーを修正してください");
    const originals = parsedDrafts.map((result) => result.slots);
    if (originals.some((draft) => draft.some((slot) => !slot.symbol))) {
      return setMessage("リハーモナイズ前に空欄を埋めるか、空欄補完モードで生成してください");
    }
    const sectionDialects = workspace.song.sections.map((section) =>
      dialects[section.dialectId] ?? dialects[workspace.settings.dialectId]!);
    const candidate = reharmonizeChordDrafts(
      originals,
      sectionDialects,
      workspace.song.seed + 97,
      workspace.song.ending === "final",
    );
    setDesign((current) => ({
      ...current,
      harmonyMode: "reharmonize",
      originalChordDrafts: structuredClone(originals),
      chordDrafts: candidate,
    }));
    setChordTexts(candidate.map(formatChordDraft));
    setMessage("原案を保存し、リハーモナイズ候補へ切り替えました。復元ボタンで戻せます");
  };

  const restoreOriginal = () => {
    if (!design.originalChordDrafts) return;
    const originals = structuredClone(design.originalChordDrafts);
    setDesign((current) => ({ ...current, harmonyMode: "fixed", chordDrafts: originals }));
    setChordTexts(originals.map(formatChordDraft));
    setMessage("リハーモナイズ前の原案を復元しました");
  };

  const currentLyrics = lyrics[lyricSection] ?? { language: "ja" as const, syllables: [], lines: [] };
  const setCurrentLyrics = (patch: Partial<EditableSectionLyrics>) => {
    setLyrics((current) => {
      const next = structuredClone(current);
      next[lyricSection] = { ...currentLyrics, ...patch };
      return next;
    });
  };

  const userDialects = useMemo(() => listUserDialects(), [userDialectTick]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`modal composition-design composition-design-${tool}`} role="dialog" aria-modal="true" aria-label={copy.title}>
        <header>
          <div>
            <h2>{copy.title}</h2>
            <p>{copy.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ダイアログを閉じる">×</button>
        </header>

        {message && <p className="manager-message">{message}</p>}

        {tool === "harmony" && <section className="design-section" aria-label="コード進行の設定">
          <div className="design-grid">
            <label>
              生成モード
              <select
                value={design.harmonyMode}
                onChange={(event) => setDesign((current) => ({
                  ...current, harmonyMode: event.target.value as HarmonyGenerationMode,
                }))}
              >
                <option value="auto">標準: ダイアレクトから全体生成</option>
                <option value="fixed">入力コードを固定</option>
                <option value="complete">空欄だけ補完</option>
                <option value="reharmonize">リハーモナイズ候補を使用</option>
              </select>
            </label>
            <p className="design-help">入力例: <code>I:4 | vi:4 | _:4 | V7:4</code>。<code>@開始拍:長さ</code>でも入力できます。空欄は _ です。</p>
          </div>
          <div className="chord-drafts">
            {workspace.song.sections.map((section, index) => (
              <label key={index}>
                <span>{index + 1}. {SECTION_LABELS[section.plan.type]}（{bodyBeats(workspace, index)}拍、ローマ数字）</span>
                <textarea
                  rows={2}
                  value={chordTexts[index] ?? ""}
                  onChange={(event) => setChordTexts((current) => current.map((text, itemIndex) =>
                    itemIndex === index ? event.target.value : text))}
                />
                {parsedDrafts[index]!.diagnostics.map((diagnostic, diagnosticIndex) => (
                  <small key={diagnosticIndex} className={`draft-${diagnostic.severity}`}>
                    {diagnostic.severity === "error" ? "エラー" : "警告"}: {diagnostic.message}
                  </small>
                ))}
              </label>
            ))}
          </div>
          <div className="manager-actions">
            <button type="button" onClick={rehar} disabled={hasErrors}>リハーモナイズ候補を作る</button>
            <button type="button" onClick={restoreOriginal} disabled={!design.originalChordDrafts}>原案へ復元</button>
            <button type="button" onClick={() => apply("melody")} disabled={design.harmonyMode === "auto" || hasErrors}>メロディだけ生成</button>
            <button type="button" onClick={() => apply("accompaniment")} disabled={design.harmonyMode === "auto" || hasErrors}>伴奏だけ生成</button>
          </div>

          <div className="template-row">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} aria-label="テンプレート名" />
            <button type="button" disabled={hasErrors} onClick={() => {
              const saved = saveChordTemplate(
                templateName,
                workspace.song.key.mode,
                workspace.song.meter.name,
                workspace.song.sections.map((section) => section.plan.type),
                parsedDrafts.map((result) => result.slots),
              );
              setTemplates(listChordTemplates());
              setTemplateId(saved.id);
              setMessage("キー相対のローマ数字テンプレートとして保存しました");
            }}>テンプレート保存</button>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">保存済みテンプレート</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <button type="button" disabled={!templateId} onClick={() => {
              const template = templates.find((item) => item.id === templateId);
              if (!template) return;
              if (template.sections.length !== workspace.song.sections.length) {
                return setMessage("セクション数が異なるため、この曲へ適用できません");
              }
              const drafts = structuredClone(template.sections);
              setDesign((current) => ({ ...current, harmonyMode: "fixed", chordDrafts: drafts }));
              setChordTexts(drafts.map(formatChordDraft));
              setMessage(`ローマ数字を ${workspace.song.keyName} へ移調して適用しました`);
            }}>現在のキーへ適用</button>
            <button type="button" className="danger" disabled={!templateId} onClick={() => {
              deleteChordTemplate(templateId);
              setTemplates(listChordTemplates());
              setTemplateId("");
            }}>削除</button>
          </div>
        </section>}

        {tool === "expression" && <section className="design-section" aria-label="曲全体の表情設定">
          <div className="manager-actions">
            <button type="button" onClick={() => {
              const melodySelections = noteSelections.filter((selection) => selection.part === "melody");
              const sectionIndex = melodySelections[0]?.sectionIndex;
              if (sectionIndex === undefined || melodySelections.some((selection) => selection.sectionIndex !== sectionIndex)) {
                return setMessage("同じセクションのメロディノートを選択してから固定してください");
              }
              const motif = captureFixedMotif(workspace.song, sectionIndex, melodySelections.map((selection) => selection.noteIndex));
              if (!motif) return setMessage("固定するメロディノートがありません");
              setDesign((current) => ({ ...current, motif }));
              setMessage(`${motif.notes.length}音のモチーフを ${SECTION_LABELS[motif.sectionType]} に固定しました`);
            }}>選択メロディをモチーフ固定</button>
            <button type="button" disabled={!design.motif} onClick={() => setDesign((current) => ({ ...current, motif: undefined }))}>固定解除</button>
            <span>{design.motif ? `${design.motif.notes.length}音 / ${SECTION_LABELS[design.motif.sectionType]}` : "未設定"}</span>
            <label>
              Chorus間
              <select value={design.chorusVariation} onChange={(event) => setDesign((current) => ({
                ...current,
                chorusVariation: event.target.value as CompositionDesign["chorusVariation"],
              }))}>
                <option value="same">同じ</option>
                <option value="light">軽い変奏</option>
                <option value="large">大きな変奏</option>
              </select>
            </label>
          </div>
          <div className="expression-table">
            {workspace.song.sections.map((section, index) => {
              const expression = design.sectionExpressions[index]!;
              const metrics = contrast[index]!;
              return (
                <div className="expression-row" key={index}>
                  <strong>{index + 1}. {SECTION_LABELS[section.plan.type]}</strong>
                  <label>緊張度 <input type="range" min={0} max={1} step={0.05} value={expression.tension} onChange={(event) => updateExpression(index, { tension: Number(event.target.value) })} /></label>
                  <label>密度 <input type="range" min={0} max={1} step={0.05} value={expression.density} onChange={(event) => updateExpression(index, { density: Number(event.target.value) })} /></label>
                  <label>明るさ <input type="range" min={0} max={1} step={0.05} value={expression.brightness} onChange={(event) => updateExpression(index, { brightness: Number(event.target.value) })} /></label>
                  <label>終止形 <select value={expression.cadence} onChange={(event) => updateExpression(index, { cadence: event.target.value as typeof expression.cadence })}>
                    <option value="dialect">ダイアレクト推奨</option><option value="authentic">全終止</option>
                    <option value="plagal">変格終止</option><option value="deceptive">偽終止</option>
                    <option value="modal">モーダル終止</option><option value="half">半終止</option>
                  </select></label>
                  <div className="contrast-bars" title="現在の生成結果におけるセクション間の相対値">
                    <span>音域<i style={{ width: `${metrics.register * 100}%` }} /></span>
                    <span>密度<i style={{ width: `${metrics.density * 100}%` }} /></span>
                    <span>明度<i style={{ width: `${metrics.brightness * 100}%` }} /></span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>}

        {tool === "lyrics" && <section className="design-section" aria-label="仮歌詞の編集">
          <div className="lyrics-editor">
            <label>セクション<select value={lyricSection} onChange={(event) => setLyricSection(Number(event.target.value))}>
              {workspace.song.sections.map((section, index) => <option key={index} value={index}>{index + 1}. {SECTION_LABELS[section.plan.type]}</option>)}
            </select></label>
            <label>言語<select value={currentLyrics.language} onChange={(event) => setCurrentLyrics({ language: event.target.value as LyricsLanguage })}>
              <option value="ja">日本語</option><option value="en">英語</option><option value="scat">スキャット</option>
            </select></label>
            <label className="wide">歌詞（行ごとに直接編集）<textarea rows={4} value={currentLyrics.lines.join("\n")} onChange={(event) => setCurrentLyrics({ lines: event.target.value.split("\n") })} /></label>
            <label className="wide">音符への音節割り当て（空白区切り、{workspace.song.sections[lyricSection]?.melody.length ?? 0}音）<textarea rows={3} value={currentLyrics.syllables.join(" ")} onChange={(event) => setCurrentLyrics({ syllables: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [] })} /></label>
            {currentLyrics.syllables.length !== (workspace.song.sections[lyricSection]?.melody.length ?? 0) && <small className="draft-warning">警告: 音節数とメロディ音数が一致していません</small>}
            <div className="manager-actions wide">
              <button type="button" onClick={() => setLyrics((current) => {
                const next = structuredClone(current);
                next[lyricSection] = generateSectionLyrics(workspace.song, lyricSection, currentLyrics.language, regenerationSalt.current++);
                return next;
              })}>このセクションを再生成</button>
              <button type="button" disabled={lyricSection === 0} onClick={() => setLyrics((current) => {
                const next = structuredClone(current);
                next[lyricSection] = structuredClone(current[lyricSection - 1]!);
                return next;
              })}>前セクションからコピー</button>
            </div>
          </div>
        </section>}

        {tool === "dialects" && <section className="design-section" aria-label="ユーザー定義ダイアレクト">
          <p className="design-help">JSONは128KBまで。値域、ローマ数字、参照可能な内蔵技法を項目別に検証し、端末内へ保存します。</p>
          <div className="manager-actions">
            <label className="file-button">JSONを読み込む<input type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void readUserDialectFile(file).then((dialect) => {
                setDialectIssues([]);
                setUserDialectTick((value) => value + 1);
                setMessage(`${dialect.name} を保存しました`);
              }).catch((error: unknown) => setDialectIssues(
                (error instanceof Error ? error.message : "読み込みに失敗しました").split("\n"),
              ));
            }} /></label>
          </div>
          {dialectIssues.length > 0 && <ul className="dialect-issues">{dialectIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
          <div className="user-dialect-list">
            {userDialects.length === 0 && <p>保存済みユーザーダイアレクトはありません。</p>}
            {userDialects.map((dialect) => <article key={dialect.id}>
              <span><strong>{dialect.name}</strong><small>{dialect.id}</small></span>
              <button type="button" onClick={() => downloadDialectJson(dialect)}>JSON書き出し</button>
              <button type="button" className="danger" onClick={() => {
                removeUserDialect(dialect.id);
                setUserDialectTick((value) => value + 1);
              }}>削除</button>
            </article>)}
          </div>
        </section>}

        <footer className="design-footer">
          <button type="button" onClick={onClose}>{tool === "dialects" ? "閉じる" : "キャンセル"}</button>
          {copy.saveLabel && <button type="button" className="primary" onClick={() => apply()}>{copy.saveLabel}</button>}
        </footer>
      </section>
    </div>
  );
}
