import { useRef } from "react";
import type { RecentProject, Variation } from "./project.js";

export function ProjectToolbar({
  title,
  recents,
  variations,
  onTitleChange,
  onNew,
  onSave,
  onOpen,
  onExport,
  onImport,
  onCreateVariation,
  onLoadVariation,
  onToggleFavorite,
}: {
  title: string;
  recents: RecentProject[];
  variations: Variation[];
  onTitleChange: (title: string) => void;
  onNew: () => void;
  onSave: () => void;
  onOpen: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onCreateVariation: () => void;
  onLoadVariation: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="project-toolbar">
      <input
        className="project-title"
        aria-label="曲名"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <button onClick={onNew}>新規</button>
      <button onClick={onSave}>保存</button>
      <select
        aria-label="最近使ったプロジェクト"
        value=""
        onChange={(event) => event.target.value && onOpen(event.target.value)}
      >
        <option value="">最近使った曲…</option>
        {recents.map((project) => (
          <option key={project.id} value={project.id}>{project.title}</option>
        ))}
      </select>
      <button onClick={onExport}>JSON</button>
      <button onClick={() => fileRef.current?.click()}>読込</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.melodialect.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = "";
        }}
      />
      <span className="toolbar-separator" />
      <button onClick={onCreateVariation}>＋ バリエーション</button>
      <select
        aria-label="バリエーション履歴"
        value=""
        onChange={(event) => event.target.value && onLoadVariation(event.target.value)}
      >
        <option value="">履歴 / A-B比較…</option>
        {variations.map((variation) => (
          <option key={variation.id} value={variation.id}>
            {variation.favorite ? "★ " : ""}{variation.name} · seed {variation.workspace.settings.seed}
          </option>
        ))}
      </select>
      {variations.length > 0 && (
        <button
          title="最新候補のお気に入りを切り替える"
          onClick={() => onToggleFavorite(variations[0]!.id)}
        >
          {variations[0]!.favorite ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}
