import React from 'react';
import { C, FONT_DISPLAY, label as L } from './theme';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: { title: string; tint: string; items: [string, string][] }[] = [
  {
    title: '景别 · 镜头远近', tint: '#FBEFD9',
    items: [
      ['大特写', '眼睛 / 嘴等极小局部，放大情绪或材质'],
      ['特写', '脸部或单一细节（领口、纽扣）'],
      ['中近景', '胸部以上，兼顾表情与上身'],
      ['中景', '腰部以上，最常用、最自然'],
      ['中远景', '膝盖以上，展示半身姿态与服装'],
      ['远景', '全身 + 部分环境'],
      ['全景', '人物较小，强调环境与氛围'],
    ],
  },
  {
    title: '镜头运动', tint: '#E6EFE2',
    items: [
      ['固定', '机位不动，最稳'],
      ['推', '镜头靠近主体，强调细节 / 情绪'],
      ['拉', '镜头远离，交代环境 / 收尾'],
      ['摇', '机位不动，左右或上下转动'],
      ['移', '机位平移，跟随或扫视'],
      ['跟', '跟随主体一起移动'],
      ['环绕', '绕着主体旋转，展示立体感与服装（最适合转身展示）'],
      ['升降', '机位上下移动'],
    ],
  },
  {
    title: '宫格 / 生图', tint: '#EDE4F2',
    items: [
      ['关键帧数', '= 分镜数 = 每张图的宫格数（如 9 → 9 分镜、3×3 九宫格）'],
      ['生图数量', '滑动条：生成几张宫格图，多生几张便于排版时挑选'],
      ['排版', '把生成图的小格拖进画布格子，拼出满意成片再导出'],
    ],
  },
  {
    title: '时长 & 小贴士', tint: '#F6E3DC',
    items: [
      ['时长', '单镜建议 2–5 秒；转身 / 走位 / 展示类可适当加长'],
      ['画面内容', '写「谁 + 在哪 + 做什么」'],
      ['一致性', '档案 + 主模特锁定 → 全片服装 / 人物不跑偏'],
    ],
  },
];

/** 分镜表「小白说明书」抽屉：右侧弹出，便签贴图板风格。 */
export default function GuidePanel({ open, onClose }: Props) {
  return (
    <>
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(42,37,30,0.18)' }} />
      )}
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh', width: 360, maxWidth: '88vw', zIndex: 50,
          background: C.bgTint, borderLeft: `1px solid ${C.lineStrong}`, boxShadow: open ? '-18px 0 48px rgba(42,37,30,0.16)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.28s ease',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${C.line}` }}>
          <div>
            <span style={L}>面向小白 · 速查</span>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.ink, margin: '2px 0 0' }}>分镜说明书</h3>
          </div>
          <button onClick={onClose} title="关闭" style={{ background: 'none', border: 'none', fontSize: 24, lineHeight: 1, color: C.inkSoft, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SECTIONS.map((sec, i) => (
            <div
              key={sec.title}
              style={{
                background: sec.tint, borderRadius: 12, padding: '14px 16px',
                border: '1px solid rgba(42,37,30,0.06)', boxShadow: '0 2px 10px rgba(42,37,30,0.07)',
                transform: `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
              }}
            >
              <div style={{ position: 'relative', marginBottom: 10 }}>
                {/* 便签胶带 */}
                <span style={{
                  position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%) rotate(-2deg)',
                  width: 56, height: 16, background: 'rgba(42,37,30,0.10)', borderRadius: 2,
                }} />
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, color: C.ink }}>{sec.title}</span>
              </div>
              {sec.items.map(([term, meaning]) => (
                <div key={term} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.65, marginBottom: 4 }}>
                  <span style={{ flexShrink: 0, fontWeight: 700, color: C.ink, minWidth: 70 }}>{term}</span>
                  <span style={{ color: C.inkSoft }}>{meaning}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
