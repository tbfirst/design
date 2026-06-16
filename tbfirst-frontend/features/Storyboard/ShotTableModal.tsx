import React from 'react';
import type { Shot } from './StoryboardTypes';
import ShotTableView from './ShotTableView';
import { C, FONT_DISPLAY, label as L } from './theme';

/** 「查看分镜表」弹窗：复用 Lightbox 遮罩风格，内嵌只读分镜表于可滚动白卡。 */
export default function ShotTableModal({ shots, onClose }: { shots: Shot[] | null; onClose: () => void }) {
  if (!shots) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(28,24,20,0.82)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: 'min(1100px, 94vw)', maxHeight: '88vh', overflow: 'auto',
          background: C.panel, borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.45)', padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <div>
            <span style={L}>该图对应分镜表</span>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.ink, margin: '4px 0 0' }}>
              分镜表 <span style={{ fontSize: 14, color: C.inkSoft }}>{shots.length} 镜</span>
            </h3>
          </div>
          <button onClick={onClose} title="关闭"
            style={{ background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: C.inkSoft, cursor: 'pointer' }}>×</button>
        </div>
        <ShotTableView shots={shots} />
      </div>
    </div>
  );
}
