import type { MixerSettings, SoundFontAssignment } from "../engine/types.js";
import {
  GENERALUSER_SOUNDFONT_ASSET,
  GENERALUSER_SOUNDFONT_ID,
  GENERALUSER_SOUNDFONT_SHA256,
  GENERALUSER_SOUNDFONT_SIZE,
  GENERALUSER_SOUNDFONT_VERSION,
  LITE_SOUNDFONT_ID,
} from "./standardSoundFont.js";

export interface SoundFontPreset {
  name: string;
  bankMSB: number;
  bankLSB: number;
  program: number;
  isDrum: boolean;
}

export interface SoundFontMetadata {
  id: string;
  name: string;
  format: "sf2" | "sf3";
  size: number;
  presets: SoundFontPreset[];
  createdAt: string;
  updatedAt: string;
  storage: "opfs" | "indexeddb" | "bundled";
  packVersion?: string;
  contentHash?: string;
}

export interface SoundFontImportProgress {
  stage: "downloading" | "reading" | "parsing" | "saving" | "done";
  progress: number;
  message: string;
}

export interface SoundFontStorageReport {
  quota?: number;
  usage?: number;
  available?: number;
  persisted?: boolean;
  opfs: boolean;
}

export interface GeneralUserSoundFontStatus {
  installed: boolean;
  updateAvailable: boolean;
  metadata?: SoundFontMetadata;
}

const DATABASE = "melodialect-audio-library";
const DATABASE_VERSION = 1;
const META_STORE = "metadata";
const BLOB_STORE = "blobs";
const OPFS_DIRECTORY = "melodialect-soundfonts";
export const SOUNDFONT_WARNING_BYTES = 64 * 1024 * 1024;
export const SOUNDFONT_MAX_BYTES = 256 * 1024 * 1024;
export const STANDARD_SOUNDFONT_ID = LITE_SOUNDFONT_ID;
export { GENERALUSER_SOUNDFONT_ID } from "./standardSoundFont.js";

const standardMetadata: SoundFontMetadata = {
  id: STANDARD_SOUNDFONT_ID,
  name: "Melodialect Lite（フォールバック）",
  format: "sf2",
  size: 890,
  presets: [{ name: "Melodialect Saw", bankMSB: 0, bankLSB: 0, program: 0, isDrum: false }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  storage: "bundled",
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("このブラウザでは音源ライブラリを利用できません"));
      return;
    }
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("音源データベースを開けませんでした"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("ブラウザ内DBの操作に失敗しました"));
  });
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("ブラウザ内DBの保存に失敗しました"));
    transaction.onabort = () => reject(transaction.error ?? new Error("ブラウザ内DBの保存が中断されました"));
  });
}

async function opfsDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !("storage" in navigator) ||
      !("getDirectory" in navigator.storage)) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIRECTORY, { create });
  } catch {
    return null;
  }
}

async function saveBinary(id: string, buffer: ArrayBuffer): Promise<"opfs" | "indexeddb"> {
  const directory = await opfsDirectory(true);
  if (directory) {
    const handle = await directory.getFileHandle(`${id}.soundfont`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    return "opfs";
  }
  const database = await openDatabase();
  const transaction = database.transaction(BLOB_STORE, "readwrite");
  transaction.objectStore(BLOB_STORE).put(buffer, id);
  await transactionDone(transaction);
  database.close();
  return "indexeddb";
}

async function deleteBinary(metadata: SoundFontMetadata): Promise<void> {
  if (metadata.storage === "opfs") {
    const directory = await opfsDirectory(false);
    const candidates = new Set([
      `${metadata.id}.soundfont`,
      `${metadata.id}.${metadata.format}`,
      `${metadata.id}.sf2`,
    ]);
    for (const filename of candidates) {
      try {
        await directory?.removeEntry(filename);
      } catch {
        // An already-evicted OPFS file is equivalent to a successful delete.
      }
    }
  }
  const database = await openDatabase();
  const transaction = database.transaction(BLOB_STORE, "readwrite");
  transaction.objectStore(BLOB_STORE).delete(metadata.id);
  await transactionDone(transaction);
  database.close();
}

async function saveMetadata(metadata: SoundFontMetadata): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put(metadata);
  await transactionDone(transaction);
  database.close();
}

export async function listSoundFonts(): Promise<SoundFontMetadata[]> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(META_STORE, "readonly");
    const values = await requestResult(
      transaction.objectStore(META_STORE).getAll() as IDBRequest<SoundFontMetadata[]>,
    );
    database.close();
    return [standardMetadata, ...values.sort((a, b) => a.name.localeCompare(b.name, "ja"))];
  } catch {
    return [standardMetadata];
  }
}

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateSoundFontFile(file: File): void {
  if (!/\.sf[23]$/i.test(file.name)) {
    throw new Error("正式対応形式はSF2またはSF3です");
  }
  if (file.size > SOUNDFONT_MAX_BYTES) {
    throw new Error("256MBを超えるSoundFontは安全のため取り込めません");
  }
  if (file.size < 12) throw new Error("SoundFontファイルが空か破損しています");
}

function parseInWorker(
  buffer: ArrayBuffer,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<{ name: string; format: "sf2" | "sf3"; presets: SoundFontPreset[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./soundfont.worker.ts", import.meta.url), { type: "module" });
    const id = createId();
    const abort = () => {
      worker.terminate();
      reject(new DOMException("音源の取り込みをキャンセルしました", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{
      id: string;
      progress?: number;
      result?: { name: string; format: "sf2" | "sf3"; presets: SoundFontPreset[] };
      error?: string;
    }>) => {
      if (event.data.id !== id) return;
      if (event.data.progress !== undefined) onProgress?.(event.data.progress);
      if (event.data.error) {
        worker.terminate();
        reject(new Error(event.data.error));
      } else if (event.data.result) {
        worker.terminate();
        resolve(event.data.result);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("SoundFont解析Workerを起動できませんでした"));
    };
    worker.postMessage({ id, buffer }, [buffer]);
  });
}

export async function importSoundFont(
  file: File,
  options: {
    signal?: AbortSignal;
    replaceId?: string;
    onProgress?: (value: SoundFontImportProgress) => void;
  } = {},
): Promise<SoundFontMetadata> {
  validateSoundFontFile(file);
  options.onProgress?.({ stage: "reading", progress: 0.05, message: "ファイルを読み込み中" });
  const original = await file.arrayBuffer();
  const header = new TextDecoder("ascii").decode(original.slice(0, 12));
  if (!header.startsWith("RIFF") || !header.endsWith("sfbk")) {
    throw new Error("SoundFontのRIFF/sfbkヘッダーを確認できませんでした");
  }
  options.onProgress?.({ stage: "parsing", progress: 0.2, message: "プリセットを解析中 (端末内のみ)" });
  const parsed = await parseInWorker(original.slice(0), options.signal, (value) =>
    options.onProgress?.({
      stage: "parsing",
      progress: 0.2 + value * 0.55,
      message: "プリセットを解析中 (端末内のみ)",
    }));
  if (options.signal?.aborted) throw new DOMException("取り込みをキャンセルしました", "AbortError");
  options.onProgress?.({ stage: "saving", progress: 0.8, message: "端末内ストレージへ保存中" });
  const id = options.replaceId ?? createId();
  const existing = options.replaceId
    ? (await listSoundFonts()).find((font) => font.id === options.replaceId)
    : undefined;
  const location = await saveBinary(id, original);
  const now = new Date().toISOString();
  const metadata: SoundFontMetadata = {
    id,
    name: parsed.name || file.name.replace(/\.sf[23]$/i, ""),
    format: parsed.format,
    size: file.size,
    presets: parsed.presets,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    storage: location,
  };
  await saveMetadata(metadata);
  options.onProgress?.({ stage: "done", progress: 1, message: "取り込み完了" });
  window.dispatchEvent(new CustomEvent("melodialect:soundfonts-changed"));
  return metadata;
}

async function readDownload(
  response: Response,
  signal: AbortSignal | undefined,
  onProgress: ((value: SoundFontImportProgress) => void) | undefined,
): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ stage: "downloading", progress: 0.6, message: "高音質音源をダウンロード中" });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({
      stage: "downloading",
      progress: Math.min(0.6, received / GENERALUSER_SOUNDFONT_SIZE * 0.6),
      message: `高音質音源をダウンロード中 (${(received / 1024 / 1024).toFixed(1)} MB / ${(GENERALUSER_SOUNDFONT_SIZE / 1024 / 1024).toFixed(1)} MB)`,
    });
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function getGeneralUserSoundFontStatus(): Promise<GeneralUserSoundFontStatus> {
  const metadata = (await listSoundFonts()).find((font) => font.id === GENERALUSER_SOUNDFONT_ID);
  return {
    installed: Boolean(metadata),
    updateAvailable: Boolean(metadata && (
      metadata.packVersion !== GENERALUSER_SOUNDFONT_VERSION ||
      metadata.contentHash !== GENERALUSER_SOUNDFONT_SHA256
    )),
    metadata,
  };
}

export async function downloadGeneralUserSoundFont(options: {
  signal?: AbortSignal;
  onProgress?: (value: SoundFontImportProgress) => void;
} = {}): Promise<SoundFontMetadata> {
  options.onProgress?.({ stage: "downloading", progress: 0, message: "高音質音源をダウンロード中" });
  const response = await fetch(new URL(GENERALUSER_SOUNDFONT_ASSET, document.baseURI), {
    cache: "no-store",
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`高音質音源をダウンロードできませんでした (${response.status})`);
  const original = await readDownload(response, options.signal, options.onProgress);
  if (original.byteLength !== GENERALUSER_SOUNDFONT_SIZE) {
    throw new Error("高音質音源のサイズが配布情報と一致しません");
  }
  options.onProgress?.({ stage: "parsing", progress: 0.64, message: "音源の整合性を確認中" });
  if (await sha256(original) !== GENERALUSER_SOUNDFONT_SHA256) {
    throw new Error("高音質音源の整合性を確認できませんでした");
  }
  const header = new TextDecoder("ascii").decode(original.slice(0, 12));
  if (!header.startsWith("RIFF") || !header.endsWith("sfbk")) {
    throw new Error("高音質音源のRIFF/sfbkヘッダーを確認できませんでした");
  }
  const parsed = await parseInWorker(original.slice(0), options.signal, (value) =>
    options.onProgress?.({
      stage: "parsing",
      progress: 0.65 + value * 0.2,
      message: "SF3プリセットを解析中 (端末内のみ)",
    }));
  if (parsed.format !== "sf3") throw new Error("配布音源がSF3形式ではありません");
  options.signal?.throwIfAborted();
  options.onProgress?.({ stage: "saving", progress: 0.9, message: "端末内ストレージへ保存中" });
  const existing = (await listSoundFonts()).find((font) => font.id === GENERALUSER_SOUNDFONT_ID);
  const storage = await saveBinary(GENERALUSER_SOUNDFONT_ID, original);
  const now = new Date().toISOString();
  const metadata: SoundFontMetadata = {
    id: GENERALUSER_SOUNDFONT_ID,
    name: `GeneralUser GS ${GENERALUSER_SOUNDFONT_VERSION}`,
    format: "sf3",
    size: original.byteLength,
    presets: parsed.presets,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    storage,
    packVersion: GENERALUSER_SOUNDFONT_VERSION,
    contentHash: GENERALUSER_SOUNDFONT_SHA256,
  };
  await saveMetadata(metadata);
  options.onProgress?.({ stage: "done", progress: 1, message: "高音質音源の準備ができました" });
  window.dispatchEvent(new CustomEvent("melodialect:soundfonts-changed"));
  return metadata;
}

export async function getSoundFontBuffer(id: string): Promise<ArrayBuffer> {
  if (id === STANDARD_SOUNDFONT_ID) {
    const response = await fetch(new URL("melodialect-standard.sf2", document.baseURI));
    if (!response.ok) throw new Error("標準音源を読み込めませんでした");
    return response.arrayBuffer();
  }
  const metadata = (await listSoundFonts()).find((font) => font.id === id);
  if (!metadata) {
    if (id === GENERALUSER_SOUNDFONT_ID) {
      throw new Error("GeneralUser GS 高音質音源はまだダウンロードされていません");
    }
    throw new Error("音源が未取込または削除済みです");
  }
  if (metadata.storage === "opfs") {
    const directory = await opfsDirectory(false);
    const candidates = [
      `${id}.soundfont`,
      `${id}.${metadata.format}`,
      `${id}.sf2`,
    ];
    for (const filename of new Set(candidates)) {
      try {
        const handle = await directory?.getFileHandle(filename);
        const file = await handle?.getFile();
        if (file) return file.arrayBuffer();
      } catch {
        // Try the current filename and the legacy .sf2 filename before failing.
      }
    }
    throw new Error("端末内の音源本体が見つかりません。再取込してください");
  }
  const database = await openDatabase();
  const transaction = database.transaction(BLOB_STORE, "readonly");
  const value = await requestResult(transaction.objectStore(BLOB_STORE).get(id));
  database.close();
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Blob) return value.arrayBuffer();
  throw new Error("音源本体が見つかりません。再取込してください");
}

export async function renameSoundFont(id: string, name: string): Promise<void> {
  if (id === STANDARD_SOUNDFONT_ID || id === GENERALUSER_SOUNDFONT_ID) return;
  const metadata = (await listSoundFonts()).find((font) => font.id === id);
  if (!metadata) return;
  await saveMetadata({ ...metadata, name: name.trim() || metadata.name, updatedAt: new Date().toISOString() });
  window.dispatchEvent(new CustomEvent("melodialect:soundfonts-changed"));
}

export async function deleteSoundFont(id: string): Promise<void> {
  if (id === STANDARD_SOUNDFONT_ID) return;
  const metadata = (await listSoundFonts()).find((font) => font.id === id);
  if (!metadata) return;
  await deleteBinary(metadata);
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).delete(id);
  await transactionDone(transaction);
  database.close();
  window.dispatchEvent(new CustomEvent("melodialect:soundfonts-changed"));
}

export async function previewSoundFontPreset(
  metadata: SoundFontMetadata,
  preset: SoundFontPreset,
): Promise<void> {
  const { previewSoundFontNote } = await import("./soundfontPlayer.js");
  await previewSoundFontNote(metadata.id, preset, preset.isDrum ? 38 : 60, 100, 0.8);
}

export function assignmentForPreset(sourceId: string, preset: SoundFontPreset): SoundFontAssignment {
  return {
    sourceId,
    bankMSB: preset.bankMSB,
    bankLSB: preset.bankLSB,
    program: preset.program,
    isDrum: preset.isDrum,
    presetName: preset.name,
  };
}

export async function validateSoundFontAssignments(mixer: MixerSettings): Promise<string[]> {
  const fonts = await listSoundFonts();
  const ids = new Set(fonts.map((font) => font.id));
  const issues = Object.entries(mixer).flatMap(([part, settings]) => {
    const id = settings.soundfont?.sourceId;
    if (!id || ids.has(id) || id === GENERALUSER_SOUNDFONT_ID) return [];
    return [`${part}: 音源が未取込または削除済み`];
  });
  if (Object.values(mixer).some((settings) =>
    settings.soundfont?.sourceId === GENERALUSER_SOUNDFONT_ID) &&
    !ids.has(GENERALUSER_SOUNDFONT_ID)) {
    issues.unshift("標準のGeneralUser GS高音質音源が未ダウンロードです（現在は内蔵音源で再生）");
  }
  return issues;
}

export async function getSoundFontStorageReport(): Promise<SoundFontStorageReport> {
  const estimate = await navigator.storage?.estimate?.() ?? {};
  const persisted = await navigator.storage?.persisted?.();
  return {
    quota: estimate.quota,
    usage: estimate.usage,
    available: estimate.quota !== undefined && estimate.usage !== undefined
      ? Math.max(0, estimate.quota - estimate.usage)
      : undefined,
    persisted,
    opfs: Boolean(await opfsDirectory(false)),
  };
}

export async function requestPersistentSoundFontStorage(): Promise<boolean> {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}
