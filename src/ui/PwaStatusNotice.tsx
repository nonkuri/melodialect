import { useEffect, useState } from "react";
import {
  activatePwaUpdate,
  listenForPwaStatus,
  repairPwaCache,
  type PwaStatus,
} from "../pwa.js";

export function PwaStatusNotice() {
  const [status, setStatus] = useState<PwaStatus | null>(null);
  useEffect(() => listenForPwaStatus(setStatus), []);

  if (!status || status.kind === "ready") return null;
  if (status.kind === "offline") {
    return <div className="pwa-notice offline" role="status">オフラインで起動中です。端末内のプロジェクトはそのまま編集できます。</div>;
  }
  if (status.kind === "update") {
    return (
      <div className="pwa-notice" role="status">
        <span>新しい Melodialect を利用できます。保存してから更新してください。</span>
        <button type="button" onClick={() => activatePwaUpdate(status.worker)}>保存済み・更新する</button>
        <button type="button" className="link" onClick={() => setStatus(null)}>あとで</button>
      </div>
    );
  }
  return (
    <div className="pwa-notice error" role="alert">
      <span>アプリ更新の準備に失敗しました。プロジェクトとユーザー音源はアプリキャッシュとは別に保存されています。</span>
      <button type="button" onClick={() => void repairPwaCache()}>アプリキャッシュだけ修復</button>
      <button type="button" className="link" onClick={() => setStatus(null)}>閉じる</button>
    </div>
  );
}
