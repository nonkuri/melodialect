import { useEffect, useMemo, useRef, useState } from "react";
import type { SongPart, SoundFontAssignment } from "../engine/types.js";
import {
  SOUNDFONT_WARNING_BYTES,
  assignmentForPreset,
  deleteSoundFont,
  getSoundFontStorageReport,
  importSoundFont,
  listSoundFonts,
  previewSoundFontPreset,
  renameSoundFont,
  requestPersistentSoundFontStorage,
  type SoundFontImportProgress,
  type SoundFontMetadata,
  type SoundFontStorageReport,
} from "../audio/soundfonts.js";

const PARTS: Array<[SongPart, string]> = [
  ["melody", "メロディ"],
  ["piano", "ピアノ"],
  ["guitar", "ギター"],
  ["bass", "ベース"],
  ["drums", "ドラム"],
];

function bytes(value: number | undefined): string {
  if (value === undefined) return "不明";
  return value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function SoundFontLibrary({
  onClose,
  onAssign,
  issues = [],
}: {
  onClose: () => void;
  onAssign: (part: SongPart, assignment: SoundFontAssignment) => void;
  issues?: string[];
}) {
  const [fonts, setFonts] = useState<SoundFontMetadata[]>([]);
  const [selectedId, setSelectedId] = useState("standard");
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<SoundFontImportProgress | null>(null);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<SoundFontStorageReport | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = () => {
    void listSoundFonts().then((items) => {
      setFonts(items);
      if (!items.some((font) => font.id === selectedId)) setSelectedId("standard");
    });
    void getSoundFontStorageReport().then(setReport).catch(() => setReport(null));
  };
  useEffect(refresh, []);

  const selected = fonts.find((font) => font.id === selectedId) ?? fonts[0];
  const presets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    return (selected?.presets ?? []).filter((preset) =>
      !normalized || preset.name.toLocaleLowerCase("ja").includes(normalized) ||
      `${preset.bankMSB}:${preset.bankLSB}:${preset.program}`.includes(normalized));
  }, [selected, query]);

  const add = (file: File, replaceId?: string) => {
    if (file.size > SOUNDFONT_WARNING_BYTES &&
        !window.confirm(`${bytes(file.size)} の大容量音源です。メモリ不足時は標準音源へ戻ります。続けますか？`)) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setMessage("");
    void importSoundFont(file, {
      signal: controller.signal,
      replaceId,
      onProgress: setProgress,
    }).then((metadata) => {
      setSelectedId(metadata.id);
      setMessage(`${metadata.name} を端末内へ保存しました`);
      refresh();
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "音源の取り込みに失敗しました");
    }).finally(() => {
      abortRef.current = null;
      setProgress(null);
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal soundfont-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soundfont-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="soundfont-title">音源ライブラリ</h2>
            <p>SF2本体はOPFS、プリセット情報はブラウザ内DBへ保存します。</p>
          </div>
          <button onClick={onClose} aria-label="閉じる">×</button>
        </header>

        <div className="privacy-note">
          選択した音源はサーバーへ送信されません。解析・保存・試聴はすべてこの端末内で行います。
          サイトデータ削除、公開URLやブラウザの変更後は再取込が必要です。
        </div>

        {issues.length > 0 && (
          <div className="soundfont-issues" role="alert">
            <strong>再取込が必要な割り当てがあります</strong>
            <span>{issues.join(" / ")}</span>
            <span>対象のSF2を再取込するか、下の標準音源を各パートへ割り当ててください。</span>
          </div>
        )}

        <div className="soundfont-storage">
          <span>使用量: {bytes(report?.usage)}</span>
          <span>推定空き: {bytes(report?.available)}</span>
          <span>{report?.opfs ? "OPFS対応" : "IndexedDBフォールバック"}</span>
          <span>{report?.persisted ? "永続化済み" : "自動消去の可能性あり"}</span>
          {!report?.persisted && (
            <button onClick={() => void requestPersistentSoundFontStorage().then((ok) => {
              setMessage(ok ? "永続ストレージを有効にしました" : "ブラウザが永続化を許可しませんでした");
              refresh();
            })}>永続化を依頼</button>
          )}
        </div>

        <div className="soundfont-toolbar">
          <button className="primary" onClick={() => importRef.current?.click()}>＋ 音源を追加</button>
          <input
            ref={importRef}
            type="file"
            accept=".sf2,audio/sf2,application/octet-stream"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) add(file);
              event.target.value = "";
            }}
          />
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {fonts.map((font) => (
              <option value={font.id} key={font.id}>{font.name} · {bytes(font.size)}</option>
            ))}
          </select>
          {selected && selected.id !== "standard" && (
            <>
              <button onClick={() => {
                const name = window.prompt("音源名", selected.name);
                if (name !== null) void renameSoundFont(selected.id, name).then(refresh);
              }}>名前変更</button>
              <button onClick={() => replaceRef.current?.click()}>再取込</button>
              <input
                ref={replaceRef}
                type="file"
                accept=".sf2"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) add(file, selected.id);
                  event.target.value = "";
                }}
              />
              <button className="danger" onClick={() => {
                if (!window.confirm("この音源本体を端末から削除しますか？プロジェクトは標準音源へフォールバックします。")) return;
                void deleteSoundFont(selected.id).then(refresh);
              }}>削除</button>
            </>
          )}
        </div>

        {progress && (
          <div className="import-progress" role="status">
            <progress max={1} value={progress.progress} />
            <span>{progress.message}</span>
            <button onClick={() => abortRef.current?.abort()}>キャンセル</button>
          </div>
        )}
        {message && <p className="manager-message" role="status">{message}</p>}

        <label className="preset-search">
          プリセット検索
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前または 0:0:40" />
        </label>
        <div className="preset-list">
          {presets.map((preset, index) => (
            <article key={`${preset.bankMSB}:${preset.bankLSB}:${preset.program}:${index}`}>
              <div>
                <strong>{preset.name}</strong>
                <small>Bank {preset.bankMSB}:{preset.bankLSB} / Program {preset.program}{preset.isDrum ? " / Drum" : ""}</small>
              </div>
              <button onClick={() => selected && void previewSoundFontPreset(selected, preset).catch((error: unknown) =>
                setMessage(error instanceof Error ? error.message : "試聴できませんでした"))}>試聴</button>
              <div className="assign-buttons">
                {PARTS.map(([part, label]) => (
                  <button
                    key={part}
                    disabled={!selected}
                    onClick={() => {
                      if (!selected) return;
                      onAssign(part, assignmentForPreset(selected.id, preset));
                      setMessage(`${label}へ「${preset.name}」を割り当てました`);
                    }}
                  >{label}へ</button>
                ))}
              </div>
            </article>
          ))}
          {presets.length === 0 && <p>条件に一致するプリセットはありません。</p>}
        </div>
      </section>
    </div>
  );
}
