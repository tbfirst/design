import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Film, ArrowUpRight, LogOut, Settings } from 'lucide-react';
import { authService } from '../Auth/authService';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type ServiceDef = {
  id: string;
  num: string;
  title: string;
  en: string;
  desc: string;
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  cardGlow: string;
  hoverBorder: string;
  href: string | null;
  active: boolean;
};

const SERVICES: ServiceDef[] = [
  {
    id: 'image',
    num: '01',
    title: '图像生成',
    en: 'Image Studio',
    desc: '三段式创意生图流程：资产工厂 → 创意生成 → 精修调色。支持虚拟人台、模特换装、场景合成，多风格一键出图。',
    Icon: Sparkles,
    iconBg: 'rgba(56,189,248,0.12)',
    iconColor: '#7DD3FC',
    cardGlow: '0 0 60px 6px rgba(56,189,248,0.10)',
    hoverBorder: 'rgba(56,189,248,0.28)',
    href: '/workspace',
    active: true,
  },
  {
    id: 'storyboard',
    num: '02',
    title: '分镜生成',
    en: 'Storyboard',
    desc: '四阶段分镜流水线：创作圣经 → 可编辑分镜表 → 多关键帧出图 → CSS 排版，端到端一站式交付。',
    Icon: Film,
    iconBg: 'rgba(139,92,246,0.12)',
    iconColor: '#a78bfa',
    cardGlow: '0 0 60px 6px rgba(139,92,246,0.10)',
    hoverBorder: 'rgba(139,92,246,0.28)',
    href: '/cinestitch',
    active: true,
  },
];

const ServiceCard: React.FC<{ s: ServiceDef; delay: number }> = ({ s, delay }) => {
  const navigate = useNavigate();
  const [hov, setHov] = useState(false);
  const { Icon } = s;

  return (
    <motion.article
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${hov && s.active ? s.hoverBorder : 'rgba(255,255,255,0.06)'}`,
        cursor: s.active ? 'pointer' : 'default',
        boxShadow: hov && s.active ? s.cardGlow : 'none',
        transition: 'border-color 0.3s, box-shadow 0.4s',
      }}
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, delay, ease: EASE }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => s.active && s.href && navigate(s.href)}
      whileHover={s.active ? { y: -6, transition: { duration: 0.35, ease: EASE } } : undefined}
    >
      <div className="p-8 flex flex-col" style={{ minHeight: 300 }}>
        {/* top row */}
        <div className="flex items-start justify-between mb-auto">
          <span
            className="text-xs font-black tracking-[0.3em]"
            style={{ color: 'rgba(255,255,255,0.14)' }}
          >
            {s.num}
          </span>
          {s.active ? (
            <motion.div
              animate={{ opacity: hov ? 1 : 0, x: hov ? 0 : 6 }}
              transition={{ duration: 0.2 }}
            >
              <ArrowUpRight className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </motion.div>
          ) : (
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              建设中
            </span>
          )}
        </div>

        {/* icon + title block */}
        <div className="pt-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
            style={{ background: s.iconBg }}
          >
            <Icon className="w-6 h-6" style={{ color: s.iconColor }} />
          </div>
          <h3
            className="text-xl font-black mb-1"
            style={{ color: s.active ? '#fff' : 'rgba(255,255,255,0.22)' }}
          >
            {s.title}
          </h3>
          <p
            className="text-xs font-bold tracking-[0.22em] uppercase mb-3"
            style={{ color: s.active ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)' }}
          >
            {s.en}
          </p>
        </div>

        {/* hover description */}
        <AnimatePresence>
          {hov && s.active && (
            <motion.p
              className="text-sm leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.5)' }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22 }}
            >
              {s.desc}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
};

const ServiceHub: React.FC = () => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="min-h-screen" style={{ background: '#09090b', color: '#fff' }}>
      {/* fixed header */}
      <header
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-8 py-5"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(9,9,11,0.85)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <motion.div
          className="flex items-center gap-5"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <span
            className="text-xs font-bold tracking-widest uppercase"
            style={{ color: 'rgba(255,255,255,0.3)' }}
          >
            {user?.username}
          </span>
          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-1.5 text-xs font-bold transition-colors"
              style={{ color: 'rgba(255,255,255,0.35)' }}
            >
              <Settings className="w-3.5 h-3.5" />
              Admin
            </button>
          )}
          <button
            onClick={() => authService.logout()}
            className="flex items-center gap-1.5 text-xs font-bold transition-colors"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            <LogOut className="w-3.5 h-3.5" />
            退出
          </button>
        </motion.div>
      </header>

      {/* hero */}
      <section className="pt-48 pb-24 px-8 max-w-7xl mx-auto">
        <motion.p
          className="text-xs font-black tracking-[0.4em] uppercase mb-6"
          style={{ color: 'rgba(255,255,255,0.25)' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          内部协作平台 · AI 工具集
        </motion.p>

        <motion.h1
          className="font-black leading-none tracking-tighter mb-8"
          style={{ fontSize: 'clamp(3rem, 8vw, 6rem)' }}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
        >
          选择工具
          <br />
          <span style={{ color: 'rgba(255,255,255,0.18)' }}>开始创作</span>
        </motion.h1>

        <motion.p
          className="text-base max-w-md leading-relaxed"
          style={{ color: 'rgba(255,255,255,0.38)' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16, ease: EASE }}
        >
          电商智能创作工具集。从图像生成到买家秀合成，多个 AI 工作流
          在此集成，支撑内部约 100 位成员的日常创作需求。
        </motion.p>

        {/* divider */}
        <motion.div
          className="mt-14 h-px"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          initial={{ scaleX: 0, originX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, delay: 0.25, ease: EASE }}
        />
      </section>

      {/* service grid */}
      <section className="px-8 pb-32 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {SERVICES.map((s, i) => (
            <ServiceCard key={s.id} s={s} delay={0.18 + i * 0.07} />
          ))}
        </div>
      </section>

      {/* footer */}
      <footer
        className="px-8 py-6 flex items-center justify-between"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.18)' }}
      >
        <span className="text-xs font-bold tracking-widest uppercase">BrandGenius AI · Internal</span>
        <span className="text-xs">
          {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
};

export default ServiceHub;
