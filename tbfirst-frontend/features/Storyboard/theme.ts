import type React from 'react';

/**
 * 分镜生成视觉系统 — 「编辑感奶白」(editorial cream)
 * 暖奶白画布 + 墨黑主行动 + 克制陶土点缀 + 发丝线分隔 + 衬线大标题。
 * 全特性内联样式统一引用此处 token，保证整套界面一致。
 */
export const C = {
  bg: '#F3EEE6',        // 奶白画布（暖）
  bgTint: '#EDE6DA',    // 略深分区/侧栏
  panel: '#FCFAF6',     // 卡片/面板
  surface: '#FFFFFF',   // 输入/图片底
  imgBackdrop: '#F0EBE2', // 图片留白底（contain letterbox）
  ink: '#2A251E',       // 主文字
  inkSoft: '#6B6253',   // 次文字
  inkFaint: '#A99E8B',  // placeholder / 三级
  line: '#E7E0D2',      // 发丝线
  lineStrong: '#D7CCB8',
  accent: '#AE5640',    // 陶土点缀（克制）
  accentSoft: '#F1E5DF',
  ok: '#4B7A57',
  okSoft: '#E7EFE6',
  danger: '#B0413B',
  dangerSoft: '#F4E4E2',
  cta: '#2A251E',       // 主行动（墨黑）
  ctaText: '#FBF8F2',
};

export const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
export const FONT_DISPLAY = "Georgia, 'Songti SC', 'Times New Roman', serif";

/** 编辑感小标签：大写、宽字距 */
export const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: C.inkSoft,
};

export const displayTitle: React.CSSProperties = {
  fontFamily: FONT_DISPLAY, fontWeight: 600, color: C.ink, letterSpacing: '0.01em',
};

export const panel: React.CSSProperties = {
  background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
};

export const input: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10,
  color: C.ink, padding: '10px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  fontFamily: FONT_BODY,
};

export const inputSm: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
  color: C.ink, padding: '6px 9px', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
  fontFamily: FONT_BODY,
};

export const select: React.CSSProperties = { ...inputSm, cursor: 'pointer' };

export function btn(kind: 'primary' | 'ghost' | 'subtle' | 'danger' = 'primary', disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '9px 18px', borderRadius: 10, fontSize: 13.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT_BODY,
    transition: 'background 0.15s, border-color 0.15s, color 0.15s', whiteSpace: 'nowrap',
  };
  if (kind === 'primary')
    return { ...base, background: disabled ? C.lineStrong : C.cta, color: C.ctaText, border: `1px solid ${disabled ? C.lineStrong : C.cta}` };
  if (kind === 'ghost')
    return { ...base, background: 'transparent', color: C.ink, border: `1px solid ${C.lineStrong}` };
  if (kind === 'danger')
    return { ...base, background: 'transparent', color: C.danger, border: `1px solid ${C.dangerSoft}` };
  return { ...base, background: C.accentSoft, color: C.accent, border: `1px solid ${C.accentSoft}` };
}

/** 小尺寸链接式按钮 */
export function linkBtn(color: string): React.CSSProperties {
  return { background: 'none', border: 'none', color, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0, fontFamily: FONT_BODY };
}
