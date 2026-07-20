import { useEffect, useRef, useState } from "react";
import {
  deleteProject,
  downloadBackup,
  duplicateProject,
  getStorageReport,
  listProjectSnapshots,
  listProjects,
  listTrash,
  permanentlyDeleteProject,
  readBackupFile,
  renameStoredProject,
  restoreProject,
  restoreSnapshot,
  type ProjectDocument,
  type StorageReport,
  type TrashEntry,
} from "./project.js";

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "不明";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectManager({
  currentId,
  onClose,
  onOpen,
  onProjectsChanged,
  onCreateSample,
}: {
  currentId: string;
  onClose: () => void;
  onOpen: (project: ProjectDocument) => void;
  onProjectsChanged: () => void;
  onCreateSample: () => void;
}) {
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [report, setReport] = useState<StorageReport | null>(null);
  const [tab, setTab] = useState<"projects" | "trash">("projects");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const backupRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setProjects(listProjects());
    setTrash(listTrash());
    void getStorageReport().then(setReport).catch(() => setReport(null));
    onProjectsChanged();
  };

  useEffect(refresh, []);

  const rename = (project: ProjectDocument) => {
    const title = window.prompt("新しい曲名", project.title);
    if (title !== null) {
      renameStoredProject(project.id, title);
      refresh();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal project-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="project-manager-title">プロジェクト一覧</h2>
            <p>自動保存の世代、削除した曲、全曲バックアップを管理します。</p>
          </div>
          <button onClick={onClose} aria-label="閉じる">×</button>
        </header>

        <div className="manager-actions">
          <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>
            曲 ({projects.length})
          </button>
          <button className={tab === "trash" ? "active" : ""} onClick={() => setTab("trash")}>
            ゴミ箱 ({trash.length})
          </button>
          <span className="spacer" />
          <button onClick={downloadBackup}>全曲バックアップ</button>
          <button onClick={() => backupRef.current?.click()}>一括復元</button>
          <input
            ref={backupRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void readBackupFile(file)
                  .then((count) => {
                    setMessage(`${count}件のプロジェクトを復元しました`);
                    refresh();
                  })
                  .catch((error: unknown) =>
                    setMessage(error instanceof Error ? error.message : "復元に失敗しました"));
              }
              event.target.value = "";
            }}
          />
        </div>

        {report && (
          <div className="storage-summary">
            <span>プロジェクト保存: {formatBytes(report.localProjectBytes)}</span>
            <span>サイト全体: {formatBytes(Math.max(report.usage ?? 0, report.localBytes))}</span>
            <span>推定空き: {formatBytes(report.available)}</span>
            <span>{report.persisted ? "永続ストレージ" : "ブラウザ判断で消去される可能性あり"}</span>
          </div>
        )}
        {message && <p className="manager-message" role="status">{message}</p>}

        <div className="project-list">
          {tab === "projects" && projects.map((project) => {
            const snapshots = expanded === project.id ? listProjectSnapshots(project.id) : [];
            return (
              <article className={project.id === currentId ? "current" : ""} key={project.id}>
                <div className="project-row">
                  <div>
                    <strong>{project.title}</strong>
                    <small>{new Date(project.updatedAt).toLocaleString("ja-JP")} · seed {project.workspace.settings.seed}</small>
                  </div>
                  <button onClick={() => onOpen(project)}>開く</button>
                  <button onClick={() => rename(project)}>名前変更</button>
                  <button onClick={() => { duplicateProject(project.id); refresh(); }}>複製</button>
                  <button onClick={() => setExpanded(expanded === project.id ? null : project.id)}>
                    保存世代
                  </button>
                  <button
                    className="danger"
                    disabled={project.id === currentId}
                    title={project.id === currentId ? "開いているプロジェクトは削除できません" : undefined}
                    onClick={() => {
                      if (!window.confirm(`「${project.title}」をゴミ箱へ移動しますか？`)) return;
                      deleteProject(project.id);
                      refresh();
                    }}
                  >
                    削除
                  </button>
                </div>
                {expanded === project.id && (
                  <div className="snapshot-list">
                    {snapshots.length === 0 && <span>復元できる保存世代はまだありません。</span>}
                    {snapshots.map((snapshot) => (
                      <div key={snapshot.id}>
                        <span>{snapshot.label} · {new Date(snapshot.createdAt).toLocaleString("ja-JP")}</span>
                        <button onClick={() => {
                          if (!window.confirm("現在状態を退避して、この保存世代へ戻しますか？")) return;
                          const restored = restoreSnapshot(project.id, snapshot.id);
                          if (restored) onOpen(restored);
                          refresh();
                        }}>この状態へ復元</button>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}

          {tab === "trash" && trash.map((entry) => (
            <article key={entry.project.id}>
              <div className="project-row">
                <div>
                  <strong>{entry.project.title}</strong>
                  <small>削除: {new Date(entry.deletedAt).toLocaleString("ja-JP")}</small>
                </div>
                <button onClick={() => {
                  const restored = restoreProject(entry.project.id);
                  if (restored) onOpen(restored);
                  refresh();
                }}>復元</button>
                <button className="danger" onClick={() => {
                  if (!window.confirm("保存世代も含めて完全に削除します。元に戻せません。続けますか？")) return;
                  permanentlyDeleteProject(entry.project.id);
                  refresh();
                }}>完全削除</button>
              </div>
            </article>
          ))}

          {tab === "projects" && projects.length === 0 && <div className="empty-state">
            <p>保存されたプロジェクトはありません。サンプルから操作を試すか、新しい曲を作成してください。</p>
            <button type="button" onClick={onCreateSample}>サンプル曲を開く</button>
          </div>}
          {tab === "trash" && trash.length === 0 && <p>ゴミ箱は空です。</p>}
        </div>
      </section>
    </div>
  );
}
