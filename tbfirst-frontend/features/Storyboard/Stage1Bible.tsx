import React, { useRef, useState } from 'react';
import { storyboardService, parsePreProduction } from './storyboardService';
import { uploadFilesToGcs } from '@/services/uploadService';
import { imageDropPaste } from '@/services/shared/imageDropPaste';
import { fileToDataUri } from '@/services/shared/imagePartUtils';
import { toImgPath, toProxiedSrc, makeImgErrorFallback } from '@/services/shared/imageSrc';
import ModelPicker from './ModelPicker';
import Lightbox from './Lightbox';
import type { PreProduction, GarmentInfo, GenParams, ModelInfo, Shot, BibleCharacter, BibleScene } from './StoryboardTypes';
import { GRID_OPTIONS } from './StoryboardTypes';
import { C, FONT_DISPLAY, label as L, panel as panelStyle, input as inputStyle, select as selectStyle, btn } from './theme';

interface Props {
  initialProjectId?: number | null;
  initialPreProduction?: PreProduction | null;
  initialStoryText?: string;
  initialGarment?: GarmentInfo | null;
  initialModel?: ModelInfo | null;
  initialShots?: Shot[];
  initialVideoScript?: string;
  onVideoScriptChange?: (s: string) => void;
  /** 生成参数（N=gridCount 等）由向导托管，单一真源 */
  genParams: GenParams;
  onGenParamsChange: (gp: GenParams) => void;
  onBibleChange?: (
    pp: PreProduction, ppJson: string,
    garment: GarmentInfo | null, model: ModelInfo | null, storyText: string,
  ) => void;
  /** 故事大纲生成成功：向导据此设 projectId（同阶段露出分镜表，不切 stage） */
  onProjectCreated: (
    projectId: number,
    preProduction: PreProduction,
    preProductionJson: string,
    storyText: string,
    garment: GarmentInfo | null,
    model: ModelInfo | null,
  ) => void;
}

type InputMode = 'garment' | 'script' | 'video';

const MODES: { key: InputMode; label: string; hint: string }[] = [
  { key: 'garment', label: '服饰单品生成', hint: '上传服装正反面照片，出图时直接以该图锁定服装一致性' },
  { key: 'script', label: '自行输入脚本', hint: '粘贴剧本 / 大纲 / 故事概要，并可上传产品图锁定服装一致性' },
  { key: 'video', label: '视频解析脚本', hint: '上传一段参考视频，AI 解析出脚本模板，替换服饰 / 模特即可复用' },
];

const ASPECT_OPTIONS = ['3:4', '16:9', '9:16', '1:1'];
const TIME_OPTIONS = ['', '日', '夜', '黄昏', '清晨'];

/** 第一阶段工作区宽度：与审片台（Stage3）一致，左右留白居中 */
const WORKBENCH: React.CSSProperties = { maxWidth: 1180, margin: '0 auto' };
/** 上传视频体积上限（Gemini inline 约 20MB，留余量） */
const VIDEO_MAX_BYTES = 18 * 1024 * 1024;

function uid(prefix: string) { return prefix + Math.random().toString(36).slice(2, 9); }

export default function Stage1Bible({
  initialProjectId, initialPreProduction, initialStoryText, initialGarment, initialModel,
  initialShots, initialVideoScript, genParams, onGenParamsChange, onBibleChange,
  onProjectCreated, onVideoScriptChange,
}: Props) {
  const restored = !!initialPreProduction;
  const [mode, setMode] = useState<InputMode>(restored && !(initialGarment?.refs?.length) ? 'script' : 'garment');
  const [storyText, setStoryText] = useState(initialStoryText ?? '');
  const [uploadedRefs, setUploadedRefs] = useState<string[]>(initialGarment?.refs ?? []);
  const [consistencyProtocol, setConsistencyProtocol] = useState(initialGarment?.consistencyProtocol ?? '');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(initialModel ?? null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preProduction, setPreProduction] = useState<PreProduction | null>(initialPreProduction ?? null);
  const [preProductionJson, setPreProductionJson] = useState(initialPreProduction ? JSON.stringify(initialPreProduction) : '');
  const [projectId, setProjectId] = useState<number | null>(initialProjectId ?? null);
  const [bibleStoryText, setBibleStoryText] = useState(initialStoryText ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lightbox, setLightbox] = useState<string | null>(null);
  // 视频解析脚本（video 模式）
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [parsingVideo, setParsingVideo] = useState(false);
  const [videoScript, setVideoScript] = useState(initialVideoScript ?? '');
  const onImgError = makeImgErrorFallback();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 产品/服装图上传：服饰单品生成 + 自行输入脚本 都支持（后者用于锁服装一致性）
  const usesUpload = mode === 'garment' || mode === 'script';
  const curGarment = (): GarmentInfo | null =>
    (uploadedRefs.length > 0 || consistencyProtocol.trim()) ? { refs: uploadedRefs, consistencyProtocol } : null;

  /** 写回故事大纲：更新本地 + 同步向导 ref（onBibleChange）+ 防抖整份落库（保留已有 shots） */
  function applyBible(nextPP: PreProduction, persist: boolean) {
    const json = JSON.stringify(nextPP);
    setPreProduction(nextPP);
    setPreProductionJson(json);
    const st = bibleStoryText || storyText.trim();
    onBibleChange?.(nextPP, json, curGarment(), selectedModel, st);
    if (persist && projectId != null) {
      const pid = projectId;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveTimer.current = setTimeout(() => {
        const doc = JSON.stringify({
          preProduction: nextPP,
          shots: initialShots ?? [],
          garment: curGarment() ?? undefined,
          model: selectedModel ?? undefined,
          genParams,
          storyText: st || undefined,
        });
        storyboardService.saveDoc(pid, doc, 'stage1').then(() => setSaveStatus('saved')).catch(() => setSaveStatus('idle'));
      }, 700);
    }
  }

  // 上传参考图：文件选择 / 拖拽 / 粘贴 三入口共用
  async function uploadRefFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const urls = await uploadFilesToGcs(files, 'storyboard-garment');
      setUploadedRefs(prev => [...prev, ...urls.map(u => toImgPath(u))]);
    } catch (err: any) {
      setError(err?.message ?? '图片上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await uploadRefFiles(Array.from(fileList));
    e.target.value = '';
  }

  function removeRef(idx: number) {
    setUploadedRefs(prev => prev.filter((_, i) => i !== idx));
  }

  // 视频选择：仅本地预览 + 体积校验，解析时才读 base64
  function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > VIDEO_MAX_BYTES) {
      setError(`视频过大（${(f.size / 1024 / 1024).toFixed(1)}MB），请用 ≤18MB 的短视频`);
      return;
    }
    setError(null);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(f);
    setVideoPreview(URL.createObjectURL(f));
  }

  async function handleParseVideo() {
    if (!videoFile || parsingVideo) return;
    setParsingVideo(true);
    setError(null);
    try {
      const dataUri = await fileToDataUri(videoFile); // 不压缩，原始字节
      const sceneCount = Math.min(Math.max(genParams.gridCount || 6, 1), 12);
      const resp = await storyboardService.parseVideo({
        videoDataUri: dataUri,
        sceneCount,
        prompt: storyText.trim() || undefined,
      });
      const md = resp.markdown ?? '';
      setVideoScript(md);
      onVideoScriptChange?.(md);
    } catch (e: any) {
      setError(e?.message ?? '视频解析失败，请重试（建议更短的视频）');
    } finally {
      setParsingVideo(false);
    }
  }

  /** 把解析出的脚本应用到「自行输入脚本 / 服装单品生成」 */
  function applyVideoScript(target: 'script' | 'garment') {
    if (!videoScript.trim()) return;
    setStoryText(videoScript);
    setMode(target);
    setError(null);
  }

  const canGenerate =
    !loading && !uploading &&
    (mode === 'script' ? storyText.trim().length > 0 : uploadedRefs.length > 0);

  /** 调用后端生成故事大纲 + 同步向导 ref；garment / script / video 三入口共用 */
  async function runGenerateBible(
    req: { storyText: string; mode: 'script' | 'images'; imageRefs?: string[] },
    effectiveStoryText: string,
  ) {
    setLoading(true);
    setError(null);
    try {
      setBibleStoryText(effectiveStoryText);
      const resp = await storyboardService.generateBible(req);
      const pp = parsePreProduction(resp.preProduction);
      setProjectId(resp.projectId);
      // 后端已落库；这里仅同步向导 ref（不重复 saveDoc）
      setPreProduction(pp);
      setPreProductionJson(resp.preProduction);
      onBibleChange?.(pp, resp.preProduction, curGarment(), selectedModel, effectiveStoryText);
      // 通知向导：设 projectId → 同阶段正下方露出「分镜表」区
      onProjectCreated(resp.projectId, pp, resp.preProduction, effectiveStoryText, curGarment(), selectedModel);
    } catch (e: any) {
      setError(e?.message ?? '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    let req: { storyText: string; mode: 'script' | 'images'; imageRefs?: string[] };
    let effectiveStoryText: string;
    if (mode === 'script') {
      effectiveStoryText = storyText.trim();
      req = { storyText: effectiveStoryText, mode: 'script' };
    } else {
      effectiveStoryText = storyText.trim() || '请根据上传的服装参考图，构思一个适合展示该服装的短片故事并生成故事大纲';
      req = { storyText: effectiveStoryText, mode: 'images', imageRefs: uploadedRefs };
    }
    await runGenerateBible(req, effectiveStoryText);
  }

  /** 视频解析模式：按当前解析出的脚本生成 / 重新生成故事大纲 */
  async function handleGenerateFromVideoScript() {
    const text = videoScript.trim();
    if (!text || loading) return;
    await runGenerateBible({ storyText: text, mode: 'script' }, text);
  }

  // ---- 故事大纲编辑 ----
  function editLogline(v: string) { if (preProduction) applyBible({ ...preProduction, logline: v }, true); }
  function editChar(i: number, field: keyof BibleCharacter, v: string) {
    if (!preProduction) return;
    applyBible({ ...preProduction, characters: preProduction.characters.map((c, idx) => idx === i ? { ...c, [field]: v } : c) }, true);
  }
  function addChar() {
    if (!preProduction) return;
    applyBible({ ...preProduction, characters: [...preProduction.characters, { id: uid('c'), name: '', appearance: '' }] }, true);
  }
  function removeChar(i: number) {
    if (!preProduction) return;
    applyBible({ ...preProduction, characters: preProduction.characters.filter((_, idx) => idx !== i) }, true);
  }
  function editScene(i: number, field: keyof BibleScene, v: string) {
    if (!preProduction) return;
    applyBible({ ...preProduction, scenes: preProduction.scenes.map((s, idx) => idx === i ? { ...s, [field]: v } : s) }, true);
  }
  function addScene() {
    if (!preProduction) return;
    applyBible({ ...preProduction, scenes: [...preProduction.scenes, { id: uid('s'), name: '', location: '', timeOfDay: '', lighting: '' }] }, true);
  }
  function removeScene(i: number) {
    if (!preProduction) return;
    applyBible({ ...preProduction, scenes: preProduction.scenes.filter((_, idx) => idx !== i) }, true);
  }

  const activeMode = MODES.find(m => m.key === mode)!;
  const sectionLabel: React.CSSProperties = { ...L, display: 'block', marginBottom: 10 };

  return (
    <div style={{ padding: '32px 28px', ...WORKBENCH }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <span style={L}>第一步 · 故事</span>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.ink, margin: '4px 0 0' }}>基础脚本生成</h2>
        </div>
        {saveStatus !== 'idle' && (
          <span style={{ fontSize: 12.5, color: saveStatus === 'saving' ? C.accent : C.ok, fontWeight: 600 }}>
            {saveStatus === 'saving' ? '保存中…' : '已保存'}
          </span>
        )}
      </div>

      {/* 输入方式 */}
      <section style={{ marginBottom: 22 }}>
        <span style={sectionLabel}>输入方式</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {MODES.map(m => {
            const active = mode === m.key;
            return (
              <button key={m.key} onClick={() => { setMode(m.key); setError(null); }}
                style={{
                  padding: '9px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                  background: active ? C.cta : C.surface, color: active ? C.ctaText : C.inkSoft,
                  border: `1px solid ${active ? C.cta : C.line}`, cursor: 'pointer',
                }}>
                {m.label}
              </button>
            );
          })}
        </div>
        <p style={{ color: C.inkSoft, fontSize: 13, margin: 0 }}>{activeMode.hint}</p>
      </section>

      {/* 上传区（服饰单品生成 + 自行输入脚本：上传产品/服装图锁一致性） */}
      {usesUpload && (
        <section style={{ ...panelStyle, padding: 18, marginBottom: 18 }} tabIndex={0} {...imageDropPaste(uploadRefFiles)}>
          <span style={sectionLabel}>{mode === 'script' ? '产品 / 服装参考图（可选，可拖拽 / 粘贴，锁定服装一致性）' : '服装参考图（正 / 反 / 细节，可拖拽 / 粘贴）'}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            {uploadedRefs.map((url, i) => (
              <div key={url + i} style={{ position: 'relative', width: 116 }}>
                <div onClick={() => setLightbox(url)} title="点击查看完整图"
                  style={{ width: 116, aspectRatio: '3 / 4', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.line}`, background: C.imgBackdrop, cursor: 'zoom-in' }}>
                  <img src={toProxiedSrc(url)} onError={onImgError} alt={`ref-${i}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <button onClick={(e) => { e.stopPropagation(); removeRef(i); }} title="移除"
                  style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(42,37,30,0.72)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: '22px', padding: 0 }}>×</button>
              </div>
            ))}
            <label style={{ width: 116, aspectRatio: '3 / 4', borderRadius: 10, border: `1.5px dashed ${C.lineStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: uploading ? 'wait' : 'pointer', color: C.inkSoft, fontSize: 12.5, background: C.surface, padding: 8 }}>
              {uploading ? '上传中…' : '+ 点击 / 拖拽 / 粘贴'}
              <input type="file" accept="image/*" multiple onChange={handleFiles} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={L}>视觉一致性档案（可选手填）</span>
            </div>
            <textarea value={consistencyProtocol} onChange={e => setConsistencyProtocol(e.target.value)}
              placeholder="可选：手动补充 面料 / 廓形 / 颜色 / 结构（留空则完全以参考图为准；出图始终以参考图为权威规格）" rows={4}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.6 }} />
          </div>
        </section>
      )}

      {/* 文本输入（garment / script） */}
      {mode !== 'video' && (
        <section style={{ marginBottom: 18 }}>
          <span style={sectionLabel}>{mode === 'script' ? '剧本 / 大纲' : '补充说明（可选）'}</span>
          <textarea value={storyText} onChange={e => setStoryText(e.target.value)}
            placeholder={mode === 'script' ? '输入剧本、大纲或故事概要…' : '品类、目标风格、拍摄场景倾向…'}
            rows={mode === 'script' ? 8 : 3} style={{ ...inputStyle, width: '100%', resize: 'vertical', fontSize: 14.5, lineHeight: 1.7 }} />
        </section>
      )}

      {/* 视频解析脚本（video 模式） */}
      {mode === 'video' && (
        <section style={{ ...panelStyle, padding: 18, marginBottom: 18 }}>
          <span style={sectionLabel}>参考视频（≤18MB 短视频）</span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 14 }}>
            {videoPreview ? (
              <video src={videoPreview} controls style={{ width: 280, maxWidth: '100%', borderRadius: 10, border: `1px solid ${C.line}`, background: '#000' }} />
            ) : (
              <label style={{ width: 280, height: 158, borderRadius: 10, border: `1.5px dashed ${C.lineStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', color: C.inkSoft, fontSize: 13, background: C.surface, padding: 8 }}>
                + 选择视频文件
                <input type="file" accept="video/*" onChange={handleVideoSelect} style={{ display: 'none' }} />
              </label>
            )}
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {videoFile && (
                <div style={{ fontSize: 12.5, color: C.inkSoft }}>
                  {videoFile.name}（{(videoFile.size / 1024 / 1024).toFixed(1)}MB）
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {videoPreview && (
                  <label style={{ ...btn('ghost'), cursor: 'pointer' }}>
                    重新选择
                    <input type="file" accept="video/*" onChange={handleVideoSelect} style={{ display: 'none' }} />
                  </label>
                )}
                <button onClick={handleParseVideo} disabled={!videoFile || parsingVideo} style={btn('primary', !videoFile || parsingVideo)}>
                  {parsingVideo ? '解析中…' : '✨ 解析视频生成脚本'}
                </button>
              </div>
              <p style={{ color: C.inkSoft, fontSize: 12.5, margin: 0 }}>
                AI 解析视频镜头节奏 → 生成中文脚本模板；再「应用」到自行输入脚本 / 服装单品生成，换服饰、模特即可复用。
              </p>
            </div>
          </div>

          {videoScript && (
            <div>
              <span style={{ ...L, display: 'block', marginBottom: 8 }}>解析脚本（可编辑）</span>
              <textarea value={videoScript} onChange={e => { setVideoScript(e.target.value); onVideoScriptChange?.(e.target.value); }} rows={10}
                style={{ ...inputStyle, width: '100%', resize: 'vertical', fontSize: 13.5, lineHeight: 1.6, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }} />
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={handleGenerateFromVideoScript} disabled={loading} style={btn('primary', loading)}>
                  {loading ? '生成中…' : preProduction ? '↻ 重新生成故事大纲' : '✨ 生成故事大纲'}
                </button>
                <button onClick={() => applyVideoScript('script')} style={btn('ghost')}>→ 用作自行输入脚本</button>
                <button onClick={() => applyVideoScript('garment')} style={btn('ghost')}>→ 用作服装单品生成补充</button>
              </div>
            </div>
          )}
        </section>
      )}

      {mode !== 'video' && <ModelPicker selected={selectedModel} onSelect={setSelectedModel} />}

      {/* 生成参数 */}
      <section style={{ ...panelStyle, padding: 18, marginTop: 18 }}>
        <span style={sectionLabel}>生成参数</span>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          {([
            ['画幅比例', genParams.aspectRatio, (v: string) => onGenParamsChange({ ...genParams, aspectRatio: v }), ASPECT_OPTIONS.map(a => [a, a] as const)],
            ['关键帧数', String(genParams.gridCount), (v: string) => onGenParamsChange({ ...genParams, gridCount: Number(v) }), GRID_OPTIONS.map(n => [String(n), `${n} 宫格 / ${n} 分镜`] as const)],
            ['渲染画质', genParams.quality, (v: string) => onGenParamsChange({ ...genParams, quality: v as '1K' | '2K' }), [['1K', '1K 标准 (Fast)'], ['2K', '2K 高清']] as const],
          ] as const).map(([lab, val, on, opts]) => (
            <label key={lab as string} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={L}>{lab}</span>
              <select value={val as string} onChange={e => (on as (v: string) => void)(e.target.value)} style={{ ...selectStyle, minWidth: 170, padding: '8px 10px', fontSize: 13 }}>
                {(opts as readonly (readonly [string, string])[]).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          ))}
        </div>
        <p style={{ color: C.inkSoft, fontSize: 12.5, margin: '10px 0 0' }}>
          关键帧数 = 分镜数 = 每张生成图的宫格数（如 9 → 生成 9 个分镜、每张图为 3×3 九宫格）。
        </p>
      </section>

      {mode !== 'video' && (
        <button onClick={handleGenerate} disabled={!canGenerate} style={{ ...btn('primary', !canGenerate), marginTop: 20, padding: '12px 28px', fontSize: 14.5 }}>
          {loading ? '生成中…' : preProduction ? '重新生成故事大纲' : '生成故事大纲'}
        </button>
      )}

      {error && <p style={{ color: C.danger, marginTop: 10, fontSize: 13 }}>{error}</p>}

      {/* 故事大纲（可编辑） */}
      {preProduction && (
        <section style={{ ...panelStyle, padding: 22, marginTop: 26 }}>
          <span style={sectionLabel}>故事大纲（可直接编辑）</span>
          <textarea
            value={preProduction.logline ?? ''}
            onChange={e => editLogline(e.target.value)}
            placeholder="一句话故事概要（logline）"
            rows={2}
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: FONT_DISPLAY, fontStyle: 'italic', fontSize: 16, lineHeight: 1.6, marginBottom: 18 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={L}>角色 · {preProduction.characters.length}</span>
            <button onClick={addChar} style={btn('ghost')}>+ 添加角色</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {preProduction.characters.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={c.name ?? ''} onChange={e => editChar(i, 'name', e.target.value)} placeholder="角色名" style={{ ...rowInput, minWidth: 120, flex: 1 }} />
                <input value={c.appearance ?? ''} onChange={e => editChar(i, 'appearance', e.target.value)} placeholder="外貌描述" style={{ ...rowInput, minWidth: 200, flex: 3 }} />
                <button onClick={() => removeChar(i)} title="删除角色" style={delBtn}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={L}>场景 · {preProduction.scenes.length}</span>
            <button onClick={addScene} style={btn('ghost')}>+ 添加场景</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {preProduction.scenes.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={s.name ?? ''} onChange={e => editScene(i, 'name', e.target.value)} placeholder="场景名" style={{ ...rowInput, minWidth: 110, flex: 1 }} />
                <input value={s.location ?? ''} onChange={e => editScene(i, 'location', e.target.value)} placeholder="地点" style={{ ...rowInput, minWidth: 110, flex: 1 }} />
                <select value={s.timeOfDay ?? ''} onChange={e => editScene(i, 'timeOfDay', e.target.value)} style={{ ...rowInput, minWidth: 76 }}>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t || '时间段'}</option>)}
                </select>
                <input value={s.lighting ?? ''} onChange={e => editScene(i, 'lighting', e.target.value)} placeholder="灯光风格" style={{ ...rowInput, minWidth: 120, flex: 1 }} />
                <button onClick={() => removeScene(i)} title="删除场景" style={delBtn}>✕</button>
              </div>
            ))}
          </div>

          <p style={{ color: C.inkSoft, fontSize: 13, margin: '4px 0 0' }}>
            ↓ 大纲已就绪，向下在「分镜表」区生成并编辑分镜。
          </p>
        </section>
      )}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

const rowInput: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
  color: C.ink, padding: '8px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const delBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 14, padding: '0 4px',
};
