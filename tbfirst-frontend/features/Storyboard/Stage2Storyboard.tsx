import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { storyboardService, parseShots } from './storyboardService';
import GuidePanel from './GuidePanel';
import type { PreProduction, Shot, GarmentInfo, ModelInfo, GenParams } from './StoryboardTypes';
import { gridDims } from './StoryboardTypes';
import { TEXT_COLS, SHOT_SIZE_OPTIONS } from './shotTableColumns';
import { C, FONT_DISPLAY, label as L, input as bigInput, btn } from './theme';

interface Props {
  storyText: string;
  preProductionJson: string;
  preProduction: PreProduction;
  projectId: number;
  garment: GarmentInfo | null;
  model: ModelInfo | null;
  genParams: GenParams;
  onGenParamsChange?: (gp: GenParams) => void;
  initialShots?: Shot[];
  onShotsChange?: (shots: Shot[]) => void;
  onComplete: (shots: Shot[]) => void;
}

export default function Stage2Storyboard({
  storyText, preProductionJson, projectId, garment, model, genParams, onGenParamsChange,
  initialShots, onShotsChange, onComplete,
}: Props) {
  const [shots, setShots] = useState<Shot[]>(initialShots ?? []); // 载入项目时回显既有分镜
  const [dynamicScript, setDynamicScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showGuide, setShowGuide] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  // setShots + 上报给向导（自由切 stage 不丢编辑）
  function commitShots(next: Shot[]) {
    setShots(next);
    onShotsChange?.(next);
  }

  function buildDocJson(updatedShots: Shot[]): string {
    return JSON.stringify({
      preProduction: preProductionJson ? JSON.parse(preProductionJson) : undefined,
      shots: updatedShots,
      garment: garment ?? undefined,
      model: model ?? undefined,
      genParams,
      storyText: storyText || undefined,
    });
  }

  async function handleExpand() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await storyboardService.generateDraft(projectId, {
        // 后端 storyText @NotBlank：保证非空（动态脚本才是本阶段主输入）
        storyText: storyText?.trim() || '基于故事大纲与动态脚本扩写分镜',
        preProductionJson,
        dynamicScript: dynamicScript.trim() || undefined,
        consistencyProtocol: garment?.consistencyProtocol || undefined,
        gridCount: genParams.gridCount, // 恰好生成 N 个分镜（= 宫格数）
      });
      const next = parseShots(resp.shots);
      commitShots(next);
      // 扩写结果整份落库（带 garment/genParams，避免后续覆写丢失）
      try { await storyboardService.saveDoc(projectId, buildDocJson(next), 'stage2'); } catch { /* 静默 */ }
    } catch (e: any) {
      setError(e?.message ?? '分镜表生成失败');
    } finally {
      setLoading(false);
    }
  }

  function triggerSave(updatedShots: Shot[]) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setSaveStatus('saving');
      try {
        await storyboardService.saveDoc(projectId, buildDocJson(updatedShots), 'stage2');
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      } finally {
        inFlightRef.current = false;
      }
    }, 800);
  }

  function updateShot(idx: number, field: keyof Shot, value: string | number) {
    const updated = shots.map((s, i) =>
      i === idx ? { ...s, [field]: value } : s,
    );
    commitShots(updated);
    triggerSave(updated);
  }

  function addShot() {
    const maxNo = shots.reduce((m, s) => Math.max(m, s.shotNo), 0);
    const next: Shot = {
      shotNo: maxNo + 1, // 稳定内部 id（不随删除重排），显示用 idx+1
      characterIds: [], motionType: 'static', frameCount: 1, frames: [],
    };
    const updated = [...shots, next];
    commitShots(updated);
    triggerSave(updated);
  }

  function deleteShot(idx: number) {
    const updated = shots.filter((_, i) => i !== idx);
    commitShots(updated);
    triggerSave(updated);
  }

  const saveColor = saveStatus === 'saving' ? C.accent : saveStatus === 'saved' ? C.ok : saveStatus === 'error' ? C.danger : C.inkFaint;

  return (
    <div style={{ padding: '32px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
        <div>
          <span style={L}>第二步 · 分镜</span>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.ink, margin: '4px 0 0' }}>
            分镜表{shots.length > 0 ? <span style={{ fontSize: 16, color: C.inkSoft }}>　{shots.length} 镜</span> : null}
          </h2>
        </div>
        <span style={{ fontSize: 12.5, color: saveColor, fontWeight: 600 }}>
          {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : ''}
        </span>
      </div>

      {/* 动态脚本 + AI 导演扩写 */}
      <section style={{ marginBottom: 20 }}>
        <span style={{ ...L, display: 'block', marginBottom: 10 }}>动态脚本 · 导演意图</span>
        <textarea
          value={dynamicScript}
          onChange={e => setDynamicScript(e.target.value)}
          placeholder="例如：模特正面站立，随后缓慢向右进行 360 度转身展示亚麻衬衫廓形。留空则按故事大纲扩写。"
          rows={3}
          style={{ ...bigInput, width: '100%', resize: 'vertical', fontSize: 14.5, lineHeight: 1.7 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={handleExpand} disabled={loading} style={btn('primary', loading)}>
            {loading ? '扩写中…' : shots.length > 0 ? '✨ 重新导演扩写' : '✨ AI 导演扩写'}
          </button>
          {garment?.consistencyProtocol && <span style={{ fontSize: 12.5, color: C.ok }}>● 已绑定服装一致性档案</span>}
          {model?.refs?.length && <span style={{ fontSize: 12.5, color: C.accent }}>● 已锁定主模特</span>}
        </div>
      </section>

      {error && <p style={{ color: C.danger, marginBottom: 12, fontSize: 13 }}>{error}</p>}

      {shots.length > 0 && (
        <>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.panel, overflow: 'hidden' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: C.bgTint }}>
                  <th style={{ ...thStyle, width: '4%' }}>镜头号</th>
                  {TEXT_COLS.map(c => (<th key={c.key} style={{ ...thStyle, width: `${c.w}%` }}>{c.label}</th>))}
                  <th style={{ ...thStyle, width: '4%' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((shot, idx) => (
                  <tr key={shot.shotNo} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '8px 12px', color: C.accent, fontWeight: 700, textAlign: 'center' }}>{idx + 1}</td>
                    {TEXT_COLS.map(c => (
                      <td key={c.key} style={{ padding: '6px 8px', verticalAlign: 'top', wordBreak: 'break-word' }}>
                        {c.key === 'shotSize' ? (
                          <select
                            value={(shot.shotSize as string | undefined) ?? ''}
                            onChange={e => updateShot(idx, 'shotSize', e.target.value)}
                            style={{ ...cellInput, width: '100%', cursor: 'pointer' }}
                          >
                            <option value="">景别</option>
                            {SHOT_SIZE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            {shot.shotSize && !SHOT_SIZE_OPTIONS.includes(shot.shotSize) && (
                              <option value={shot.shotSize}>{shot.shotSize}</option>
                            )}
                          </select>
                        ) : (
                          <AutoTextarea
                            value={(shot[c.key] as string | undefined) ?? ''}
                            onChange={e => updateShot(idx, c.key, e.target.value)}
                            placeholder={c.label}
                            style={{ ...cellInput, width: '100%', lineHeight: 1.55, fontFamily: 'inherit' }}
                          />
                        )}
                      </td>
                    ))}
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button onClick={() => deleteShot(idx)} title="删除该分镜" style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 14 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={addShot} style={{ ...btn('ghost'), marginTop: 14, borderStyle: 'dashed' }}>+ 添加分镜</button>

          {/* 生图数量滑动条（控制下一阶段生成几张 N 宫格图） */}
          {(() => {
            const m = genParams.imageCount || 1;
            const [rows, cols] = gridDims(genParams.gridCount);
            return (
              <section style={{ marginTop: 22, padding: 16, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, maxWidth: 460 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={L}>生图数量</span>
                  <span style={{ fontSize: 13, color: C.inkSoft }}>
                    生成 <b style={{ color: C.ink }}>{m}</b> 张 {genParams.gridCount} 宫格图（{rows}×{cols}）
                  </span>
                </div>
                <input
                  type="range" min={1} max={8} step={1} value={m}
                  onChange={e => onGenParamsChange?.({ ...genParams, imageCount: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: C.cta, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, color: C.inkFaint, marginTop: 4, padding: '0 2px' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <span key={n}>{n}</span>)}
                </div>
              </section>
            );
          })()}

          <div>
            <button onClick={() => onComplete(shots)} style={{ ...btn('primary'), marginTop: 18, padding: '12px 28px', fontSize: 14.5 }}>
              立即生图并进入审片台 →
            </button>
          </div>
        </>
      )}

      {/* 悬浮「说明书」按钮（右侧）→ 弹出贴图板速查 */}
      <button
        onClick={() => setShowGuide(true)}
        title="分镜说明书 · 面向小白"
        style={{
          position: 'fixed', right: 0, top: '42%', zIndex: 30,
          background: C.cta, color: C.ctaText, border: 'none', borderRadius: '12px 0 0 12px',
          padding: '14px 9px', cursor: 'pointer', writingMode: 'vertical-rl',
          fontSize: 13, fontWeight: 700, letterSpacing: '0.12em',
          boxShadow: '-4px 6px 18px rgba(42,37,30,0.22)',
        }}
      >
        📖 分镜说明书
      </button>
      <GuidePanel open={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
}

/**
 * 自增高文本框：高度随内容自动撑开，完整显示所有文字、不出现上下滚动条。
 * 监听 value 变化与列宽变化（ResizeObserver）重新测量，避免换行后被裁切。
 */
function AutoTextarea({ value, onChange, placeholder, style }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(() => { fit(); }, [value, fit]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let prevW = -1;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w !== prevW) { prevW = w; fit(); } // 仅列宽变化时重测，避免改高度自触发循环
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      style={{ ...style, overflow: 'hidden', resize: 'none' }}
    />
  );
}

const cellInput: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 6,
  color: C.ink, padding: '6px 8px', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
};

const thStyle: React.CSSProperties = {
  padding: '11px 10px', textAlign: 'left',
  ...L, color: C.inkSoft,
};
