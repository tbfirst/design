import React from 'react';
import type { Shot } from './StoryboardTypes';
import { TEXT_COLS } from './shotTableColumns';
import { C, label as L } from './theme';

const thStyle: React.CSSProperties = {
  padding: '11px 10px', textAlign: 'left', ...L, color: C.inkSoft,
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', verticalAlign: 'top', wordBreak: 'break-word',
  whiteSpace: 'pre-wrap', fontSize: 12.5, color: C.ink, lineHeight: 1.55,
};

/** 只读分镜表：镜头号 + 8 个文本列（无操作列、无输入框）。供「查看分镜表」弹窗复用。 */
export default function ShotTableView({ shots }: { shots: Shot[] }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.panel, overflow: 'hidden' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: C.bgTint }}>
            <th style={{ ...thStyle, width: '5%' }}>镜头号</th>
            {TEXT_COLS.map(c => (<th key={c.key} style={{ ...thStyle, width: `${c.w}%` }}>{c.label}</th>))}
          </tr>
        </thead>
        <tbody>
          {shots.map((shot, idx) => (
            <tr key={shot.shotNo ?? idx} style={{ borderTop: `1px solid ${C.line}` }}>
              <td style={{ ...tdStyle, color: C.accent, fontWeight: 700, textAlign: 'center' }}>{idx + 1}</td>
              {TEXT_COLS.map(c => (
                <td key={c.key} style={tdStyle}>{(shot[c.key] as string | undefined) ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
