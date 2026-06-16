/**
 * downloadDirStore.ts — V5.XI-2.2 账号级默认下载目录持久化
 *
 * 用 IndexedDB 持久化 `FileSystemDirectoryHandle`（localStorage 无法序列化 handle）。
 * 命名空间 key = userId（与 V5.XII.4 useUserPersistedState 一致语义）；
 * 未登录态（userId == null）三个 IO 函数都直接返回，保持纯内存语义。
 *
 * 浏览器重启后 handle 句柄存活，但 readwrite 权限失活；
 * 实际写入前必须在用户手势内调 `handle.requestPermission({mode:'readwrite'})` 重授。
 * 这一步由 `saveBlobAs.saveToDir` 负责。
 */

const DB_NAME = 'tbfirst-download-dirs';
const DB_VERSION = 1;
const STORE = 'dirs';

/** 浏览器是否支持 File System Access API（Chromium 86+，Firefox/Safari 当前不支持） */
export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'showSaveFilePicker' in window && 'showDirectoryPicker' in window;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function normalizeUserId(userId: string | number | null | undefined): string | null {
  if (userId == null) return null;
  const s = String(userId);
  return s ? s : null;
}

export async function getDownloadDirHandle(
  userId: string | number | null | undefined,
): Promise<FileSystemDirectoryHandle | null> {
  const key = normalizeUserId(userId);
  if (!key) return null;
  try {
    const db = await openDB();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      } catch {
        try { db.close(); } catch { /* noop */ }
        resolve(null);
      }
    });
  } catch (e) {
    console.warn('[downloadDirStore] get failed:', e);
    return null;
  }
}

export async function setDownloadDirHandle(
  userId: string | number | null | undefined,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const key = normalizeUserId(userId);
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(handle, key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        tx.oncomplete = () => db.close();
      } catch {
        try { db.close(); } catch { /* noop */ }
        resolve();
      }
    });
  } catch (e) {
    console.warn('[downloadDirStore] set failed:', e);
  }
}

export async function clearDownloadDirHandle(
  userId: string | number | null | undefined,
): Promise<void> {
  const key = normalizeUserId(userId);
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        tx.oncomplete = () => db.close();
      } catch {
        try { db.close(); } catch { /* noop */ }
        resolve();
      }
    });
  } catch (e) {
    console.warn('[downloadDirStore] clear failed:', e);
  }
}
