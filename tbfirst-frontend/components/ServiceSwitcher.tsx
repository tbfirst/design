import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Svc { id: string; name: string; desc: string; href: string; icon: string; tint: string; }

// 全服务列表（新增服务在此登记即可）
const SERVICES: Svc[] = [
  { id: 'brandgenius', name: 'BrandGenius-AI', desc: '图像生成工作台', href: '/workspace', icon: '🎨', tint: '#E7EEF7' },
  { id: 'cinestitch', name: 'Cinestitch', desc: '分镜生成', href: '/cinestitch', icon: '🎬', tint: '#F3E7E1' },
  { id: 'agent', name: 'AI Agent', desc: '智能对话助手', href: '/agent', icon: '🤖', tint: '#E8F0E8' },
];

const SIZE = 54;
const MENU_W = 248;
const MENU_H = 246;
const INK = '#262320';
const INK_TXT = '#FBF8F2';
const PANEL = '#FFFFFF';
const LINE = '#E7E1D6';
const SUB = '#6B6253';
const ACCENT = '#AE5640';

const winW = () => (typeof window !== 'undefined' ? window.innerWidth : 1280);
const winH = () => (typeof window !== 'undefined' ? window.innerHeight : 800);

/**
 * 全服务悬浮切换器（copilot 风）：
 * - 可在页面任意拖动
 * - 初始紧贴右边框、隐藏半边（露出半圆把手）；拖出时显示整个圆；松手靠近边缘自动回贴
 * - 点击展开服务列表，选择后跳转对应工作台
 */
export default function ServiceSwitcher({ currentHref }: { currentHref?: string }) {
  const navigate = useNavigate();
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({ x: winW() - SIZE / 2, y: winH() - SIZE - 80 }));
  const [open, setOpen] = useState(false);
  const drag = useRef({ down: false, moved: false, offX: 0, offY: 0, startX: 0, startY: 0 });

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { down: true, moved: false, offX: e.clientX - pos.x, offY: e.clientY - pos.y, startX: e.clientX, startY: e.clientY };
    setOpen(false);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.down) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
    const nx = Math.min(Math.max(-SIZE / 2, e.clientX - d.offX), winW() - SIZE / 2);
    const ny = Math.min(Math.max(8, e.clientY - d.offY), winH() - SIZE - 8);
    setPos({ x: nx, y: ny });
  }
  function onPointerUp() {
    const d = drag.current;
    d.down = false;
    if (!d.moved) { setOpen(o => !o); return; }
    // 松手靠近左右边缘 → 回贴（隐藏半边）
    const cx = pos.x + SIZE / 2;
    if (cx > winW() - SIZE) setPos(p => ({ ...p, x: winW() - SIZE / 2 }));
    else if (cx < SIZE) setPos(p => ({ ...p, x: -SIZE / 2 }));
  }

  function go(href: string) {
    setOpen(false);
    if (href !== currentHref) navigate(href);
  }

  const dockedRight = pos.x > winW() - SIZE;
  const dockedLeft = pos.x < 0;
  const docked = dockedRight || dockedLeft;

  const menuLeft = Math.min(Math.max(8, pos.x + SIZE - MENU_W), winW() - MENU_W - 8);
  const menuTop = pos.y - MENU_H - 12 >= 8 ? pos.y - MENU_H - 12 : pos.y + SIZE + 12;

  return (
    <>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2147483640 }} />
          <div
            style={{
              position: 'fixed', left: menuLeft, top: menuTop, width: MENU_W, zIndex: 2147483646,
              background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14,
              boxShadow: '0 18px 50px rgba(38,35,32,0.24)', overflow: 'hidden',
              fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
            }}
          >
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${LINE}`, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: SUB }}>
              切换服务
            </div>
            <div style={{ padding: 8 }}>
              {SERVICES.map(s => {
                const cur = s.href === currentHref;
                return (
                  <button
                    key={s.id}
                    onClick={() => go(s.href)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                      padding: '10px 12px', borderRadius: 10, border: 'none',
                      background: cur ? '#F5F1EA' : 'transparent', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (!cur) e.currentTarget.style.background = '#F5F1EA'; }}
                    onMouseLeave={e => { if (!cur) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ width: 38, height: 38, borderRadius: 10, background: s.tint, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>{s.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: INK }}>{s.name}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: SUB }}>{s.desc}</span>
                    </span>
                    {cur && <span style={{ fontSize: 10.5, fontWeight: 700, color: ACCENT, letterSpacing: '0.06em' }}>当前</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="服务切换 · 可拖动"
        style={{
          position: 'fixed', left: pos.x, top: pos.y, width: SIZE, height: SIZE, zIndex: 2147483645,
          borderRadius: '50%', background: INK, border: `2px solid ${PANEL}`,
          boxShadow: open ? `0 0 0 3px rgba(174,86,64,0.25), 0 10px 26px rgba(38,35,32,0.34)` : '0 8px 22px rgba(38,35,32,0.32)',
          cursor: 'grab', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'box-shadow 0.18s',
        }}
      >
        <span style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, pointerEvents: 'none',
          // 贴边时把图标推向露出的一侧，把手感更明确
          transform: dockedRight ? 'translateX(-7px)' : dockedLeft ? 'translateX(7px)' : 'none',
        }}>
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: INK_TXT, opacity: docked ? 0.95 : 0.92 }} />
          ))}
        </span>
      </button>
    </>
  );
}
