/**
 * saveBlobAs.ts — V5.XI-2.2 下载落盘核心工具
 *
 * 双模式：
 *   1. `mode='saveAs'`：弹原生 `showSaveFilePicker` 让用户选位置；
 *   2. `mode='auto'`：账号已设默认目录 → 静默写入；未设 → 等同 saveAs。
 *
 * 浏览器不支持 File System Access API 时降级到 `<a download>`（落到浏览器默认下载目录），
 * 调用方收到 `result='fallback'` 与 `needsAlert` 后展示提示。
 *
 * V5.XI-3.7：
 *   - **下载顺序**：fetch + 魔数判定 → showSaveFilePicker（用真实 mime 校正的 suggestedName）
 *     → write。这样 picker 不依赖 FileSystemFileHandle.move()（Chrome 117+），
 *     新老浏览器都能拿到正确扩展名。
 *   - **激活态兜底**：模块级 imageCache（TTL 60s）缓存已 fetch 完成的 blob；
 *     fetch 慢导致首次 picker 因 transient user activation 过期失败时，
 *     返回 'failed' + 引导用户再点一次；第二次点击直接读缓存、picker 立即弹出。
 *   - **错误暴露**：write / picker / fetch 失败不再被静默吞为 'cancelled'，
 *     新增 'failed' 状态带 `error` 字段，HistoryModal 据此 alert + 不更新 saved。
 *   - 'cancelled' 仅在用户主动取消（AbortError）时返回，UI 完全静默。
 */
import {
  getDownloadDirHandle,
  setDownloadDirHandle,
  isFileSystemAccessSupported,
} from './downloadDirStore';

// FileSystemHandle.queryPermission / requestPermission + window.showSaveFilePicker /
// showDirectoryPicker 在 TS lib.dom.d.ts 当前版本（5.8 / DOM）尚未稳定导出，用最小内联
// 类型覆盖一遍，避免触发 lint 报错。运行时由 isFileSystemAccessSupported() 守门。
interface HandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}
interface HandleWithPermissions {
  queryPermission?: (desc?: HandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (desc?: HandlePermissionDescriptor) => Promise<PermissionState>;
}

interface SavePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}
interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
}
interface WindowFSAccess {
  showSaveFilePicker?: (opts?: SavePickerOptions) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (opts?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}
const fsWindow: WindowFSAccess = typeof window !== 'undefined' ? (window as unknown as WindowFSAccess) : {};

const IMAGE_TYPES = [
  {
    description: 'Image',
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    },
  },
];

function isAbortError(e: unknown): boolean {
  return !!(e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError');
}

function isSecurityError(e: unknown): boolean {
  return !!(e && typeof e === 'object' && (e as { name?: string }).name === 'SecurityError');
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || String(e);
  return String(e);
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

const MIME_EXT_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

/**
 * 根据魔数检测出的真实 MIME 校正文件扩展名。
 * 修复后端 persistImages 把 PNG 字节命名为 .jpg 的存量脏数据 —— 下载到本地
 * 的文件名应该和实际字节格式匹配，否则 Windows / macOS 资源管理器按扩展名
 * 查看会报"格式不支持或文件损坏"。
 */
export function correctFilenameForMime(filename: string, mime: string): string {
  const targetExt = MIME_EXT_MAP[mime.toLowerCase()];
  if (!targetExt) return filename;
  const lower = filename.toLowerCase();
  // jpg/jpeg 都算 jpeg 匹配
  if (mime === 'image/jpeg' && (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))) return filename;
  if (lower.endsWith(targetExt)) return filename;
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot < filename.length - 6) {
    return filename + targetExt;
  }
  return filename.slice(0, dot) + targetExt;
}

export interface FetchedImage {
  blob: Blob;
  mime: string;
}

// V5.XI-3.7：模块级 blob 缓存。fetch 完成的 blob 存活 60s，期间同一 URL 再次
// 调用直接命中缓存。两个用途：
//   1. 首次点击的 picker 因激活态过期失败时，第二次点击复用已缓存的 blob，
//      picker 在新激活态里立即弹出，不再等 fetch。
//   2. saveAs 失败回退到 fallback 路径时也可复用，避免双倍网络往返。
interface CachedImage {
  blob: Blob;
  mime: string;
  expireAt: number;
}
const imageCache = new Map<string, CachedImage>();
const IMAGE_CACHE_TTL_MS = 60_000;

function readCache(url: string): FetchedImage | null {
  const now = Date.now();
  const hit = imageCache.get(url);
  if (hit && hit.expireAt > now) {
    return { blob: hit.blob, mime: hit.mime };
  }
  if (hit) imageCache.delete(url);
  return null;
}

function writeCache(url: string, fetched: FetchedImage): void {
  const now = Date.now();
  imageCache.set(url, { blob: fetched.blob, mime: fetched.mime, expireAt: now + IMAGE_CACHE_TTL_MS });
  // 顺手清过期项，避免长期累积。
  for (const [k, v] of imageCache) {
    if (v.expireAt <= now) imageCache.delete(k);
  }
}

/**
 * V5.XI-3.1：tbfirst 网关 `/img/**` 要求 `Authorization: Bearer <token>`；
 * V5.XI-3.5：强制以**魔数**决定真实图片格式，不再相信响应 Content-Type。
 * V5.XI-3.7：fetch 结果进入模块级缓存（TTL 60s），首次调用 fetch 后，60s 内
 * 同 URL 的第二次/第三次调用直接读缓存（用于 picker 激活态过期后的二次点击）。
 */
async function fetchImage(url: string): Promise<FetchedImage> {
  const cached = readCache(url);
  if (cached) return cached;

  const headers: Record<string, string> = { Accept: 'image/*' };
  try {
    const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('token') : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // sessionStorage 不可访问 → 不附 token，由后端拒绝
  }
  const resp = await fetch(url, { credentials: 'include', headers, cache: 'no-store' });
  if (!resp.ok) {
    let preview = '';
    try { preview = (await resp.text()).slice(0, 120); } catch { /* noop */ }
    throw new Error(`fetch ${url} failed: HTTP ${resp.status}${preview ? ` — ${preview}` : ''}`);
  }
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  const buf = await resp.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error('empty response body');
  }
  const head = new Uint8Array(buf.slice(0, Math.min(buf.byteLength, 16)));
  const magicMime = detectImageMime(head);
  if (!magicMime) {
    let preview = '';
    try { preview = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 120)); } catch { /* noop */ }
    const headHex = Array.from(head.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      `bytes are not a recognised image (ct=${ct || '(none)'}, head=${headHex}): ${preview}`,
    );
  }
  const fetched: FetchedImage = { blob: new Blob([buf], { type: magicMime }), mime: magicMime };
  writeCache(url, fetched);
  return fetched;
}

/**
 * V5.XI-3.7 fallback 下载：fetch 拿正确字节 + 魔数校正 filename + Blob URL → `<a download>`。
 * 落到浏览器默认下载目录（用户的 Downloads 等）。
 */
export async function triggerFallbackDownload(url: string, filename: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const fetched = await fetchImage(url);
  const correctedName = correctFilenameForMime(filename, fetched.mime);
  const blobUrl = URL.createObjectURL(fetched.blob);
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = correctedName;
    a.target = '_self';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

export type SaveOutcome = 'saved' | 'cancelled' | 'fallback' | 'failed';

export interface SaveAsResult {
  outcome: SaveOutcome;
  error?: string;
}

/**
 * V5.XV.14 弹原生"另存为"对话框：picker 先弹（用 click transient activation）→ 用户
 * 选位置 → fetch 字节 → 写入。
 *
 * 修正 V5.XI-3.7 的顺序错误：原先 fetch → picker，慢链路 fetch 耗时 >5s 时
 * Chrome 的 transient user activation 已过期，picker 抛 SecurityError，用户被迫"再点
 * 一次"。改为先弹 picker，picker 立即拿到激活态，用户选完位置后再异步 fetch + write。
 *
 * 副作用：suggestedName 在 fetch 之前确定，无法用魔数纠错；但后端
 * ImageProxyController 已用 detectImageMimeFromBytes 校正 Content-Disposition 文件名
 * （V5.XI-3.7），实际正常路径 filename 已正确，魔数校正退化为下载后写文件时的可选优化。
 */
export async function saveAsViaSavePicker(
  url: string,
  filename: string,
): Promise<SaveAsResult> {
  if (!isFileSystemAccessSupported() || !fsWindow.showSaveFilePicker) {
    return { outcome: 'fallback' };
  }

  // 1) 立即弹 picker —— 用 click 触发的 transient user activation，绝不能在 await 别的
  //    network IO 之后才弹（会丢激活态）。suggestedName 用入参 filename。
  let handle: FileSystemFileHandle;
  try {
    handle = await fsWindow.showSaveFilePicker({
      suggestedName: filename,
      types: IMAGE_TYPES,
    });
  } catch (e) {
    if (isAbortError(e)) return { outcome: 'cancelled' };
    if (isSecurityError(e)) {
      return {
        outcome: 'failed',
        error: '另存为对话框未弹出（浏览器会话超时）。请再次点击"下载并收藏"。',
      };
    }
    return { outcome: 'failed', error: `另存为对话框失败：${errorMessage(e)}` };
  }

  // 2) 用户已选位置（picker 已 resolve），不再受激活态约束 → 安全地 await fetch
  let fetched: FetchedImage;
  try {
    fetched = await fetchImage(url);
  } catch (e) {
    return { outcome: 'failed', error: `下载失败：${errorMessage(e)}` };
  }

  // 3) 写入字节
  try {
    const writable = await handle.createWritable();
    await writable.write(fetched.blob);
    await writable.close();
    return { outcome: 'saved' };
  } catch (e) {
    return { outcome: 'failed', error: `写入文件失败：${errorMessage(e)}` };
  }
}

export interface SaveToDirResult {
  outcome: 'saved' | 'permission-denied' | 'permission-cancelled' | 'failed';
  error?: string;
}

/** 写入已存的目录句柄；权限失活时在用户手势内 requestPermission。 */
export async function saveToDir(
  handle: FileSystemDirectoryHandle,
  url: string,
  filename: string,
): Promise<SaveToDirResult> {
  const h = handle as FileSystemDirectoryHandle & HandleWithPermissions;
  try {
    if (typeof h.queryPermission === 'function') {
      const cur = await h.queryPermission({ mode: 'readwrite' });
      if (cur !== 'granted') {
        if (typeof h.requestPermission !== 'function') return { outcome: 'permission-denied' };
        let next: PermissionState;
        try {
          next = await h.requestPermission({ mode: 'readwrite' });
        } catch (e) {
          return isAbortError(e)
            ? { outcome: 'permission-cancelled' }
            : { outcome: 'permission-denied', error: errorMessage(e) };
        }
        if (next !== 'granted') return { outcome: 'permission-denied' };
      }
    }
  } catch (e) {
    return { outcome: 'permission-denied', error: errorMessage(e) };
  }

  try {
    const fetched = await fetchImage(url);
    const correctedName = correctFilenameForMime(filename, fetched.mime);
    const fileHandle = await handle.getFileHandle(correctedName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(fetched.blob);
    await writable.close();
    return { outcome: 'saved' };
  } catch (e) {
    if (isAbortError(e)) return { outcome: 'permission-cancelled' };
    return { outcome: 'failed', error: `写入默认目录失败：${errorMessage(e)}` };
  }
}

/** 让用户选默认下载目录并持久化到 IndexedDB。 */
export async function chooseDownloadDir(
  userId: string | number | null | undefined,
): Promise<'saved' | 'cancelled' | 'unsupported'> {
  if (!isFileSystemAccessSupported() || !fsWindow.showDirectoryPicker) return 'unsupported';
  try {
    const handle = await fsWindow.showDirectoryPicker({ mode: 'readwrite' });
    await setDownloadDirHandle(userId, handle);
    return 'saved';
  } catch (e) {
    if (isAbortError(e)) return 'cancelled';
    console.warn('[saveBlobAs] chooseDir failed:', e);
    return 'cancelled';
  }
}

export interface DownloadAndFavoriteOptions {
  url: string;
  filename: string;
  userId: string | number | null | undefined;
  /** 'auto' 优先用账号默认目录，回落到 saveAs；'saveAs' 始终弹另存为对话框。 */
  mode: 'auto' | 'saveAs';
}

export interface DownloadAndFavoriteResult {
  /**
   * - 'saved' / 'fallback'：文件已写到本地（前者用户选了位置/已设默认目录；后者落到浏览器默认 Downloads）
   * - 'cancelled'：用户主动取消（不需要 alert）
   * - 'failed'：fetch / picker / write 真的失败了，调用方应 alert(needsAlert) 且不要标 saved
   */
  result: SaveOutcome;
  needsAlert?: string;
}

/**
 * 顶层编排：
 *   - 'saveAs' → 弹另存为；不支持 → 降级 `<a download>` + alert。
 *   - 'auto' → 有默认目录 → 静默写；权限失败 → 弹另存为兜底 + alert。
 *   - 'auto' 无默认目录 → 等同 saveAs。
 *
 * V5.XI-3.7：传播 saveAsViaSavePicker / saveToDir 的 'failed' 状态，让 HistoryModal 区分
 * "用户取消"与"真的下载失败"，前者静默、后者必须 alert 且不要更新 saved 角标。
 */
export async function downloadAndFavorite(
  opts: DownloadAndFavoriteOptions,
): Promise<DownloadAndFavoriteResult> {
  const { url, filename, userId, mode } = opts;

  const runFallback = async (alertMsg: string): Promise<DownloadAndFavoriteResult> => {
    try {
      await triggerFallbackDownload(url, filename);
      return { result: 'fallback', needsAlert: alertMsg };
    } catch (e) {
      return {
        result: 'failed',
        needsAlert: `下载失败：${errorMessage(e)}`,
      };
    }
  };

  // V5.XV.13: 移除 V5.XIV.8 + V5.XV.4 的 <a download> fast path —— 两个根本缺陷：
  //   1. HEAD 探测烧掉 transient user activation 配额（Chrome 5s）→ HEAD 慢时
  //      <a download>.click() 之后 picker 已无激活态，浏览器不弹"另存为"对话框，
  //      用户看到"下载缓慢/对话框未出现"。
  //   2. <a download> 触发后无条件 return 'saved'，浏览器无法回报取消/失败
  //      → 用户在保存对话框点取消、或后端 502 时，前端仍显示"已成功下载"。
  // 改为统一走 saveAsViaSavePicker：fetch 完整 blob → showSaveFilePicker 返回 promise
  // （AbortError=取消、SecurityError=激活态超时、resolve=成功）→ 三态准确。fetch 慢
  // 致首次失败时，blob 已进模块缓存（TTL 60s），第二次点击立即弹 picker，不再 fetch。
  if (mode === 'saveAs') {
    const r = await saveAsViaSavePicker(url, filename);
    if (r.outcome === 'fallback') {
      return runFallback('当前浏览器不支持选择保存位置，文件已下载到浏览器默认下载目录');
    }
    if (r.outcome === 'failed') {
      return { result: 'failed', needsAlert: r.error };
    }
    return { result: r.outcome };
  }

  // mode === 'auto'
  const handle = await getDownloadDirHandle(userId);
  if (!handle) {
    const r = await saveAsViaSavePicker(url, filename);
    if (r.outcome === 'fallback') {
      return runFallback('当前浏览器不支持选择保存位置，文件已下载到浏览器默认下载目录');
    }
    if (r.outcome === 'failed') {
      return { result: 'failed', needsAlert: r.error };
    }
    return { result: r.outcome };
  }

  const dirR = await saveToDir(handle, url, filename);
  if (dirR.outcome === 'saved') return { result: 'saved' };
  if (dirR.outcome === 'permission-cancelled') return { result: 'cancelled' };
  // 'permission-denied' / 'failed' → 弹另存为兜底
  const fallbackR = await saveAsViaSavePicker(url, filename);
  if (fallbackR.outcome === 'fallback') {
    return runFallback('默认下载位置授权已失效或写入失败，已用浏览器默认下载目录兜底');
  }
  if (fallbackR.outcome === 'failed') {
    return {
      result: 'failed',
      needsAlert: dirR.error ? `${dirR.error}；${fallbackR.error || ''}` : fallbackR.error,
    };
  }
  if (fallbackR.outcome === 'saved') {
    return {
      result: 'saved',
      needsAlert: '默认下载位置授权已失效或写入失败，本次请手动选择保存位置',
    };
  }
  return { result: fallbackR.outcome };
}
