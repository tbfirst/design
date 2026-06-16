import React, { useEffect, useRef, useState } from 'react';
import { imageDropPaste } from '@/services/shared/imageDropPaste';
import { toProxiedSrc } from '@/services/shared/imageSrc';
import { storyboardService } from './storyboardService';
import { composeLayoutDataUri } from './layoutCompose';
import type { Shot, GridImage, GenParams, LayoutSlot } from './StoryboardTypes';
import { C, FONT_DISPLAY, label as L, btn } from './theme';

interface Props {
  shots: Shot[];           // 当前项目分镜（「使用当前项目」时构建提示词）
  gridImages: GridImage[]; // 当前项目宫格图
  layout: LayoutSlot[];    // 当前项目排版槽位（实时，用于合成参考图）
  genParams: GenParams;
}

type DataSource = 'project' | 'upload';
type Status = 'idle' | 'generating' | 'done' | 'error';

const POLL_INTERVAL = 8000;
const MAX_REF_IMAGES = 9; // Seedance 单次参考图上限
const SECONDS_OPTIONS = [5, 10, 15];
const ASPECT_OPTIONS = ['9:16', '16:9', '1:1', '3:4', '21:9'];
const RESOLUTION_OPTIONS = ['480p', '720p'];

/** 解析标准 Markdown 分镜表 → Shot[]（与导出的分镜表列序一致） */
function parseStoryboardMd(md: string): Shot[] {
  const lines = md.split('\n').filter(l => l.trim().startsWith('|'));
  const data = lines.slice(2); // 跳过表头 + 分隔行
  return data.map((line, i) => {
    const cells = line.split('|').slice(1, -1).map(c => c.trim().replace(/\\\|/g, '|'));
    return {
      shotNo: parseInt(cells[0] ?? '') || i + 1,
      scene: cells[1] || undefined,
      shotSize: cells[2] || undefined,
      description: cells[3] || undefined,
      action: cells[4] || undefined,
      cameraMovement: cells[5] || undefined,
      dialogue: cells[6] || undefined,
      duration: cells[7] || undefined,
      notes: cells[8] || undefined,
      characterIds: [],
      motionType: 'static' as const,
      frameCount: 1,
      frames: [],
    };
  }).filter(s => s.shotNo > 0);
}

/** 由分镜表构建一条 Seedance 提示词：参考图（@Image1+）→ 一条连续视频 */
function buildPrompt(shots: Shot[]): string {
  const header =
    'Animate the storyboard reference image @Image1 (plus any additional reference images) into ' +
    'ONE continuous cinematic fashion film. Keep the SAME model and the SAME outfit throughout; ' +
    'smooth motivated camera moves and seamless transitions between shots. Photorealistic, natural ' +
    'lighting, shallow depth of field.';
  if (!shots.length) return header + '\n\nFollow the shot order shown in the reference image(s).';
  const lines = shots.map((s, i) => {
    const parts: string[] = [];
    if (s.shotSize) parts.push(`[${s.shotSize}]`);
    if (s.description) parts.push(s.description.trim());
    if (s.action) parts.push(`动作:${s.action.trim()}`);
    if (s.cameraMovement) parts.push(`运镜:${s.cameraMovement.trim()}`);
    return `${i + 1}) ${parts.join('；') || '同一主体的一个时尚镜头'}`;
  });
  return `${header}\n\nShots in order:\n${lines.join('\n')}`;
}

function readFileAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = ev => resolve(ev.target?.result as string);
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsDataURL(f);
  });
}

/** /img 短链 → data URI（callxyq 为外部服务，无法访问内网短链，需直传 data URI） */
async function urlToDataUri(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(toProxiedSrc(url));
  if (!res.ok) throw new Error('参考图读取失败');
  const blob = await res.blob();
  return readFileAsDataUrl(new File([blob], 'ref'));
}

export default function Stage5Video({ shots: projectShots, gridImages, layout, genParams }: Props) {
  const projectGrid = gridImages.find(g => g.status === 'done' && g.imageUrl);
  const hasProjectData = projectShots.length > 0 && !!projectGrid;

  const [source, setSource] = useState<DataSource>(hasProjectData ? 'project' : 'upload');

  // 上传模式
  const [uploadedShots, setUploadedShots] = useState<Shot[]>([]);
  const [tableImageUri, setTableImageUri] = useState<string | null>(null); // 分镜表作为图片
  const [sheetRefUris, setSheetRefUris] = useState<string[]>([]);          // 排版宫格图 / 故事板（多张）
  const [parseMdError, setParseMdError] = useState<string | null>(null);

  // 项目模式：实时合成的排版成片
  const [composedRef, setComposedRef] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const shots = source === 'project' ? projectShots : uploadedShots;

  const [prompt, setPrompt] = useState<string>(() => buildPrompt(hasProjectData ? projectShots : []));
  const [aspectRatio, setAspectRatio] = useState<string>(
    ASPECT_OPTIONS.includes(genParams.aspectRatio) ? genParams.aspectRatio : '9:16',
  );
  const [seconds, setSeconds] = useState<number>(10);
  const [resolution, setResolution] = useState<string>('720p');

  const [status, setStatus] = useState<Status>('idle');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  // 项目模式：排版改动后（防抖）重新合成参考图，确保实时反映最新排布
  useEffect(() => {
    if (source !== 'project') return;
    let cancelled = false;
    setComposing(true);
    const t = setTimeout(async () => {
      try {
        let uri = await composeLayoutDataUri(layout, gridImages, genParams.gridCount);
        if (!uri && projectGrid?.imageUrl) uri = await urlToDataUri(projectGrid.imageUrl).catch(() => null);
        if (!cancelled) setComposedRef(uri);
      } finally {
        if (!cancelled) setComposing(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, layout, gridImages, genParams.gridCount]);

  /** 上传模式下要发给模型的参考图列表（排版/故事板在前，分镜表图在后），上限 9 张 */
  function uploadRefList(): string[] {
    return [...sheetRefUris, ...(tableImageUri ? [tableImageUri] : [])].slice(0, MAX_REF_IMAGES);
  }
  const uploadRefCount = uploadRefList().length;
  const refReady = source === 'upload' ? uploadRefCount > 0 : (!!composedRef || !!projectGrid?.imageUrl);

  // ---- 分镜表：.md 解析 / 图片作参考图 ----
  function handleTableUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setParseMdError(null);
    if (f.type.startsWith('image/')) {
      readFileAsDataUrl(f).then(setTableImageUri);
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseStoryboardMd(ev.target?.result as string);
      if (parsed.length === 0) {
        setParseMdError('未能解析出有效分镜行，请确认是标准 Markdown 表格，或改用图片');
        return;
      }
      setUploadedShots(parsed);
      setPrompt(buildPrompt(parsed));
    };
    reader.readAsText(f, 'utf-8');
  }

  // ---- 参考图：多张（排版宫格图 / 故事板）----
  function addSheetImages(files: File[]) {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    Promise.all(imgs.map(readFileAsDataUrl)).then(uris =>
      setSheetRefUris(prev => [...prev, ...uris].slice(0, MAX_REF_IMAGES)),
    );
  }
  function handleSheetUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files;
    e.target.value = '';
    if (!fl) return;
    const files: File[] = [];
    for (let i = 0; i < fl.length; i++) { const f = fl.item(i); if (f) files.push(f); }
    addSheetImages(files);
  }
  function removeSheet(idx: number) {
    setSheetRefUris(prev => prev.filter((_, i) => i !== idx));
  }

  async function resolveRefImages(): Promise<string[]> {
    if (source === 'upload') {
      const list = uploadRefList();
      if (!list.length) throw new Error('请至少上传 1 张参考图（排版宫格图 / 故事板 / 分镜表图）');
      return list;
    }
    // 项目模式：以最新排版实时合成，确保排版改动后参考图同步更新
    let uri = await composeLayoutDataUri(layout, gridImages, genParams.gridCount);
    if (!uri) uri = composedRef;
    if (!uri && projectGrid?.imageUrl) uri = await urlToDataUri(projectGrid.imageUrl);
    if (!uri) throw new Error('当前项目暂无可用排版/宫格图，请先完成「排版」');
    return [uri];
  }

  function startPolling(operationName: string) {
    pollTimer.current = setInterval(async () => {
      try {
        const result = await storyboardService.pollVideoClip({ operationName });
        if (result.done) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          if (result.error) { setStatus('error'); setError(result.error); }
          else { setStatus('done'); setVideoUri(result.videoUri ?? null); }
        }
      } catch (e: any) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = null;
        setStatus('error');
        setError(e?.message ?? '轮询失败');
      }
    }, POLL_INTERVAL);
  }

  async function generate() {
    if (!prompt.trim()) { setError('请先填写视频提示词'); return; }
    setError(null);
    setVideoUri(null);
    setStatus('generating');
    let imageDataUris: string[];
    try {
      imageDataUris = await resolveRefImages();
    } catch (e: any) {
      setStatus('error'); setError(e?.message ?? '参考图缺失'); return;
    }
    try {
      const { operationName } = await storyboardService.startVideoClip({
        imageDataUris,
        prompt,
        durationSeconds: seconds,
        aspectRatio,
        resolution,
      });
      startPolling(operationName);
    } catch (e: any) {
      setStatus('error');
      setError(e?.message ?? '启动失败');
    }
  }

  function reset() {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    setStatus('idle');
    setVideoUri(null);
    setError(null);
  }

  const thumb: React.CSSProperties = {
    width: 76, aspectRatio: '3/4', borderRadius: 8, objectFit: 'cover',
    border: `1px solid ${C.line}`, background: C.imgBackdrop,
  };

  return (
    <div style={{ padding: '32px 28px', maxWidth: 980, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ marginBottom: 24 }}>
        <span style={L}>第四步 · 视频</span>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.ink, margin: '4px 0 0' }}>视频生成</h2>
        <p style={{ color: C.inkSoft, fontSize: 13, margin: '6px 0 0' }}>
          上传分镜表（.md 或 图片）+ 排版宫格图 / 故事板（可多张），由 Seedance 2.0 一次性合成一条连续视频。
        </p>
      </div>

      {/* 数据来源 */}
      <section style={{ marginBottom: 22 }}>
        <span style={{ ...L, display: 'block', marginBottom: 10 }}>数据来源</span>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['project', 'upload'] as DataSource[]).map(s => (
            <button key={s} onClick={() => { setSource(s); setPrompt(buildPrompt(s === 'project' ? projectShots : uploadedShots)); }}
              disabled={s === 'project' && !hasProjectData}
              style={{
                padding: '8px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                background: source === s ? C.cta : C.surface,
                color: source === s ? C.ctaText : (s === 'project' && !hasProjectData) ? C.inkFaint : C.inkSoft,
                border: `1px solid ${source === s ? C.cta : C.line}`,
                cursor: (s === 'project' && !hasProjectData) ? 'not-allowed' : 'pointer',
              }}>
              {s === 'project' ? '使用当前项目' : '上传文件'}
            </button>
          ))}
        </div>

        {source === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <span style={{ ...L, display: 'block', marginBottom: 6 }}>分镜表（.md 或 图片，可选）</span>
              <label style={{ ...btn('ghost'), cursor: 'pointer', display: 'inline-block' }}>
                选择文件
                <input type="file" accept=".md,text/markdown,text/plain,image/*" onChange={handleTableUpload} style={{ display: 'none' }} />
              </label>
              {uploadedShots.length > 0 && (
                <span style={{ marginLeft: 10, fontSize: 12.5, color: C.ok }}>✓ 已解析 {uploadedShots.length} 个分镜</span>
              )}
              {tableImageUri && (
                <span style={{ marginLeft: 10, fontSize: 12.5, color: C.ok }}>
                  ✓ 分镜表图已作为参考图
                  <button onClick={() => setTableImageUri(null)} style={{ ...btn('ghost'), marginLeft: 8, padding: '2px 8px' }}>移除</button>
                </span>
              )}
              {parseMdError && <p style={{ color: C.danger, fontSize: 12.5, margin: '6px 0 0' }}>{parseMdError}</p>}
            </div>

            <div tabIndex={0} {...imageDropPaste(addSheetImages)}>
              <span style={{ ...L, display: 'block', marginBottom: 6 }}>
                参考图：排版宫格图 / 故事板（可多张，必填 · 最多 {MAX_REF_IMAGES} 张，可拖拽 / 粘贴）
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ ...btn('ghost'), cursor: 'pointer', display: 'inline-block' }}>
                  选择图片
                  <input type="file" accept="image/*" multiple onChange={handleSheetUpload} style={{ display: 'none' }} />
                </label>
                {sheetRefUris.map((uri, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={uri} alt={`ref${i}`} style={thumb} />
                    <button onClick={() => removeSheet(i)} title="移除"
                      style={{
                        position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%',
                        border: 'none', background: 'rgba(42,37,30,0.66)', color: '#fff', cursor: 'pointer',
                        fontSize: 11, lineHeight: '18px', padding: 0,
                      }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {source === 'project' && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{
              width: 140, aspectRatio: '3/4', borderRadius: 10, overflow: 'hidden',
              border: `1px solid ${C.line}`, background: C.imgBackdrop,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {composedRef
                ? <img src={composedRef} alt="排版成片" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : projectGrid?.imageUrl
                  ? <img src={toProxiedSrc(projectGrid.imageUrl)} alt="宫格图" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ color: C.inkFaint, fontSize: 12 }}>暂无排版图</span>}
            </div>
            <p style={{ fontSize: 12.5, color: C.inkSoft, margin: 0, maxWidth: 420 }}>
              参考图取自当前项目「排版」阶段的成片，{composing ? '正在同步最新排布…' : '已同步最新排布'}。
              回到「排版」修改后，回到这里会自动更新。
            </p>
          </div>
        )}
      </section>

      {/* 参数 */}
      <section style={{ marginBottom: 22 }}>
        <span style={{ ...L, display: 'block', marginBottom: 8 }}>参数</span>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={paramLabel}>
            画幅
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={selStyle}>
              {ASPECT_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label style={paramLabel}>
            时长(s)
            <select value={seconds} onChange={e => setSeconds(Number(e.target.value))} style={selStyle}>
              {SECONDS_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label style={paramLabel}>
            分辨率
            <select value={resolution} onChange={e => setResolution(e.target.value)} style={selStyle}>
              {RESOLUTION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* 提示词 */}
      <section style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={L}>视频提示词（@Image1 指代参考图）</span>
          <button onClick={() => setPrompt(buildPrompt(shots))} disabled={!shots.length} style={btn('ghost', !shots.length)}>↻ 用分镜表重建</button>
        </div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="描述要生成的连续视频；可用 @Image1 指代参考图"
          rows={7}
          style={{
            width: '100%', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical',
            border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px',
            background: C.surface, color: C.ink, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </section>

      {/* 操作 + 结果 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <button onClick={generate} disabled={status === 'generating' || !refReady} style={btn('primary', status === 'generating' || !refReady)}>
          {status === 'generating' ? '⏳ 生成中…' : '▶ 生成视频'}
        </button>
        {status === 'generating' && <span style={{ fontSize: 12.5, color: C.accent }}>Seedance 异步生成，约需 1–3 分钟，请保持页面打开</span>}
      </div>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>失败：{error}</p>}

      {status === 'done' && videoUri && (
        <div style={{ maxWidth: 420 }}>
          <video src={videoUri} controls playsInline style={{ width: '100%', borderRadius: 12, border: `1px solid ${C.line}` }} />
          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
            <a href={videoUri} download="故事板视频.mp4" style={{ fontSize: 12.5, color: C.accent, textDecoration: 'none' }}>⤓ 下载</a>
            <button onClick={reset} style={btn('ghost')}>重新生成</button>
          </div>
        </div>
      )}
    </div>
  );
}

const paramLabel: React.CSSProperties = {
  fontSize: 12.5, color: C.inkSoft, display: 'flex', alignItems: 'center', gap: 6,
};
const selStyle: React.CSSProperties = {
  fontSize: 12.5, padding: '5px 8px', border: `1px solid ${C.line}`,
  borderRadius: 6, background: C.surface, color: C.ink,
};
