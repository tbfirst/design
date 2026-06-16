import React, { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { toProxiedSrc, toImgPath, makeImgErrorFallback } from '@/services/shared/imageSrc';
import type { ModelInfo } from './StoryboardTypes';
import { C, label as L, panel as panelStyle, btn } from './theme';

interface ModelOption {
  id: number;
  name?: string;
  url: string;
}

interface Props {
  selected: ModelInfo | null;
  onSelect: (model: ModelInfo | null) => void;
}

/**
 * 共享模特库选择器：复用 /api/image/models（生图模特库），
 * 选中后把模特肖像作为「主模特」资产，锁定整个分镜链路的人物一致性。
 */
export default function ModelPicker({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'personal' | 'group'>('personal');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onImgError = makeImgErrorFallback();

  async function fetchModels(s: 'personal' | 'group') {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<ModelOption[]>(`/api/image/models?scope=${s}`);
      setModels(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.message ?? '模特库加载失败');
      setModels([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) fetchModels(scope);
  }, [open, scope]);

  function pick(m: ModelOption) {
    onSelect({ refs: [toImgPath(m.url)], name: m.name, id: m.id });
    setOpen(false);
  }

  return (
    <section style={{ ...panelStyle, padding: 18, marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: selected ? 12 : 0, flexWrap: 'wrap' }}>
        <span style={L}>主模特 · 锁定全片人物一致性（可选）</span>
        <button onClick={() => setOpen(o => !o)} style={btn('ghost')}>
          {open ? '收起' : selected ? '更换模特' : '从模特库选择'}
        </button>
        {selected && (
          <button onClick={() => onSelect(null)} style={btn('danger')}>不使用模特</button>
        )}
      </div>

      {/* 已选模特 */}
      {selected && selected.refs[0] && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src={toProxiedSrc(selected.refs[0])}
            onError={onImgError}
            alt="selected-model"
            style={{ width: 60, height: 80, borderRadius: 10, objectFit: 'cover', border: `2px solid ${C.accent}`, background: C.imgBackdrop }}
          />
          <span style={{ fontSize: 13, color: C.ink }}>
            <strong>{selected.name || '已选模特'}</strong>
            <span style={{ color: C.inkSoft }}>　全片将锁定该人物</span>
          </span>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['personal', 'group'] as const).map(s => {
              const on = scope === s;
              return (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  style={{
                    padding: '6px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    background: on ? C.cta : C.surface, color: on ? C.ctaText : C.inkSoft,
                    border: `1px solid ${on ? C.cta : C.line}`,
                  }}
                >
                  {s === 'personal' ? '个人' : '共享组'}
                </button>
              );
            })}
          </div>

          {loading && <p style={{ color: C.inkSoft, fontSize: 12.5 }}>加载中…</p>}
          {error && <p style={{ color: C.danger, fontSize: 12.5 }}>{error}</p>}
          {!loading && !error && models.length === 0 && (
            <p style={{ color: C.inkFaint, fontSize: 12.5 }}>该范围暂无模特（可在「图像生成」里创建模特库）。</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
            {models.map(m => {
              const active = selected?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => pick(m)}
                  title={m.name}
                  style={{
                    padding: 0, border: `2px solid ${active ? C.accent : C.line}`, borderRadius: 10,
                    overflow: 'hidden', cursor: 'pointer', background: C.imgBackdrop,
                  }}
                >
                  <img
                    src={toProxiedSrc(m.url)}
                    onError={onImgError}
                    alt={m.name || `model-${m.id}`}
                    style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
