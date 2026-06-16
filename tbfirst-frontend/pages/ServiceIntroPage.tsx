import React, { useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useScroll, useSpring, useTransform } from 'framer-motion';
import { authService } from '../features/Auth/authService';
import ServiceSwitcher from '../components/ServiceSwitcher';

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  user: '用户',
};

const ServiceIntroPage: React.FC = () => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const pageRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({ container: pageRef });
  const smooth = useSpring(scrollYProgress, { stiffness: 55, damping: 20 });

  // Notify EmbossRevealCanvas of current section as user scrolls
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const dispatch = () => {
      const h = el.clientHeight;
      if (!h) return;
      const idx = Math.min(6, Math.round(el.scrollTop / h));
      window.dispatchEvent(new CustomEvent('emboss-scene-change', { detail: { sceneIndex: idx } }));
    };
    el.addEventListener('scroll', dispatch, { passive: true });
    dispatch();
    return () => el.removeEventListener('scroll', dispatch);
  }, []);

  const heroMediaScale    = useTransform(smooth, [0, 0.18, 0.32], [1, 1.06, 1.35]);
  const heroMediaY        = useTransform(smooth, [0, 0.18, 0.32], [0, -24, -80]);
  const lightStageOpacity = useTransform(smooth, [0, 0.22, 0.34], [1, 0.88, 0]);

  return (
    <div className="flex flex-col h-screen">

      {/* ── 顶部 Header：用户角色 + 各微服务入口 ── */}
      <header className="h-14 shrink-0 bg-white/80 backdrop-blur-sm border-b border-black/5 sticky top-0 z-40 flex items-center px-6 sm:px-10 lg:px-14">
        <div className="max-w-[1800px] w-full mx-auto flex items-center justify-between gap-4">
          {/* 品牌名 */}
          <span className="text-[0.95rem] font-semibold tracking-tight text-[#0a0a0d] shrink-0">
            BrandGenius AI
          </span>

          {/* 微服务入口 */}
          <nav className="flex items-center gap-2">
            <Link
              to="/workspace"
              className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.8rem] font-medium text-[#0a0a0d]/70 hover:bg-black/5 transition-colors"
            >
              <span>🎨</span> 工作台
            </Link>
            <Link
              to="/cinestitch"
              className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.8rem] font-medium text-[#0a0a0d]/70 hover:bg-black/5 transition-colors"
            >
              <span>🎬</span> 分镜
            </Link>
            <Link
              to="/agent"
              className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.8rem] font-medium text-[#0a0a0d]/70 hover:bg-black/5 transition-colors"
            >
              <span>🤖</span> Agent
            </Link>
          </nav>

          {/* 用户信息 */}
          <div className="flex items-center gap-3 shrink-0">
            {user && (
              <>
                <span className="rounded-full border border-black/10 px-3 py-1 text-[0.72rem] font-medium text-[#4b5565]">
                  {ROLE_LABEL[user.role] ?? user.role}
                </span>
                <span className="text-[0.78rem] text-[#4b5565] hidden sm:block">
                  {user.username || `#${user.id}`}
                </span>
              </>
            )}
            <button
              onClick={() => { authService.logout(); navigate('/login'); }}
              className="text-[0.78rem] text-[#4b5565] hover:text-[#0a0a0d] transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </header>

    <div
      ref={pageRef}
      className="flex-1 overflow-y-auto snap-y snap-mandatory text-[#0a0a0d] relative"
    >

      {/* Section 1: Hero */}
      <section className="snap-start min-h-[calc(100vh-56px)] px-6 py-6 sm:px-10 lg:px-14">
        <motion.div style={{ opacity: lightStageOpacity }} className="mx-auto h-full max-w-[1800px] rounded-[2rem] bg-transparent px-8 py-8 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] flex flex-col gap-6">
          {/* 顶部行：品牌名 + pill 按钮 */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="text-[1.6rem] font-semibold tracking-tight">BrandGenius AI</div>
            <div className="flex gap-3">
              <Link
                to="/workspace"
                className="rounded-full bg-[#262834] px-5 py-2.5 text-[#f7f8fb] text-sm font-medium hover:bg-[#2f3244] transition-colors"
              >
                进入工作台
              </Link>
              <button className="rounded-full bg-black/5 px-5 py-2.5 text-[#0a0a0d] text-sm font-medium hover:bg-black/10 transition-colors">
                了解更多
              </button>
            </div>
          </div>

          {/* 超大标题 */}
          <h1 className="max-w-3xl text-[clamp(2.4rem,5.5vw,5.5rem)] leading-[1.0] tracking-[-0.04em] font-bold">
            AI 赋能创作<br />
            <span className="text-[#4b5565] font-normal">让每一帧都成为</span><br />
            品牌表达
          </h1>

          {/* Hero 展示窗 */}
          <motion.div style={{ y: heroMediaY, scale: heroMediaScale }} className="min-h-[200px] sm:flex-1 rounded-[2rem] overflow-hidden bg-[#0d0d12] shadow-[0_12px_60px_rgba(0,0,0,0.28)] relative flex items-center justify-center">
            <motion.div
              className="w-40 h-40 rounded-full border border-white/15 bg-gradient-to-br from-cyan-500/10 to-blue-500/5"
              animate={{ y: [-8, 8] }}
              transition={{ repeat: Infinity, repeatType: 'mirror', duration: 4, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute top-1/3 right-1/4 w-20 h-20 rounded-lg bg-gradient-to-tr from-blue-400/20 to-white/5"
              style={{ rotate: 45 }}
              animate={{ rotate: [45, 60], scale: [1, 1.05] }}
              transition={{ repeat: Infinity, repeatType: 'mirror', duration: 6, ease: 'easeInOut' }}
            />
            {[0, 0.4, 0.8].map((delay, i) => (
              <motion.div
                key={i}
                className="absolute bottom-1/4 h-px bg-white/10"
                style={{ width: `${64 + i * 16}px`, left: `${20 + i * 8}%` }}
                animate={{ x: [-4, 4] }}
                transition={{ repeat: Infinity, repeatType: 'mirror', duration: 2.5 + i * 0.5, delay, ease: 'easeInOut' }}
              />
            ))}
            <span className="absolute bottom-4 right-5 text-white/25 text-lg font-light select-none">+</span>
          </motion.div>

          {/* Scroll to Explore */}
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-[#0a0a0d]/40 pt-1">
            <span className="text-base">+</span>
            <motion.span
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            >
              Scroll to explore
            </motion.span>
            <span className="text-base">+</span>
          </div>
        </motion.div>
      </section>

      {/* Section 2: Image Studio */}
      <section className="snap-start min-h-[calc(100vh-56px)] px-6 py-10 sm:px-10 lg:px-14 flex items-center">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1fr)]">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1] }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="flex flex-col justify-center gap-5"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#4b5565]">
              01 · Image Studio
            </p>
            <h2 className="text-[clamp(2rem,4.5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#0a0a0d]">
              四阶段生图<br />让品牌 DNA<br />驱动每一帧
            </h2>
            <p className="text-[#4b5565] max-w-sm text-base leading-relaxed">
              从 DNA 分析到色彩扩展，每一步都由品牌基因精确校准，输出与品牌高度一致的视觉内容。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1], delay: 0.12 }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="rounded-[2rem] bg-white/80 p-7 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] flex flex-col gap-5"
          >
            {[
              { phase: 'Phase 0', title: 'DNA 分析', desc: '解构品牌基因，提取视觉语义标签与风格约束' },
              { phase: 'Phase 1', title: '图像合成', desc: '多参考图融合生成，品牌风格端到端一致' },
              { phase: 'Phase 2', title: '精修优化', desc: '色彩、光影、细节自动对齐品牌规范' },
              { phase: 'Phase 2-Color', title: '色彩扩展', desc: '同 DNA 下批量生成多色版，快速铺满物料库' },
            ].map(({ phase, title, desc }) => (
              <div key={phase} className="flex gap-4 items-start">
                <div className="mt-1 text-[10px] uppercase tracking-wider text-[#4b5565]/60 w-24 shrink-0">{phase}</div>
                <div>
                  <div className="font-semibold text-[#0a0a0d] text-sm mb-0.5">{title}</div>
                  <div className="text-[#4b5565] text-sm leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Section 3: Agent */}
      <section className="snap-start min-h-[calc(100vh-56px)] px-6 py-10 sm:px-10 lg:px-14 flex items-center">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(360px,1fr)_minmax(0,0.9fr)]">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1] }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="rounded-[2rem] bg-white/80 p-7 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] flex flex-col gap-5"
          >
            {[
              { label: '工具调用', desc: '自动拆解意图，选择最优工具链，串联多步骤操作' },
              { label: '记忆感知', desc: '跨会话理解用户偏好，无需重复解释工作背景' },
              { label: '知识检索', desc: '品牌 DNA、成功案例、行业知识实时召回注入' },
              { label: '流式输出', desc: '逐步展示思考与操作过程，减少等待焦虑' },
            ].map(({ label, desc }) => (
              <div key={label} className="flex gap-4 items-start">
                <div className="mt-2 w-2 h-2 rounded-full bg-[#0a0a0d]/20 shrink-0" />
                <div>
                  <div className="font-semibold text-[#0a0a0d] text-sm mb-0.5">{label}</div>
                  <div className="text-[#4b5565] text-sm leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1], delay: 0.12 }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="flex flex-col justify-center gap-5"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#4b5565]">
              02 · Agent
            </p>
            <h2 className="text-[clamp(2rem,4.5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#0a0a0d]">
              复杂任务<br />分解为<br />协作动作
            </h2>
            <p className="text-[#4b5565] max-w-sm text-base leading-relaxed">
              让系统理解你的意图，自动规划工具链，带你高效完成从策划到出图的完整创作。
            </p>
          </motion.div>
        </div>
      </section>

      {/* Section 4: Copilot */}
      <section className="snap-start min-h-[calc(100vh-56px)] px-6 py-10 sm:px-10 lg:px-14 flex items-center">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1fr)]">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1] }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="flex flex-col justify-center gap-5"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#4b5565]">
              03 · Copilot
            </p>
            <h2 className="text-[clamp(2rem,4.5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#0a0a0d]">
              在工作流中<br />持续修正<br />语义
            </h2>
            <p className="text-[#4b5565] max-w-sm text-base leading-relaxed">
              实时对话，随时校准品牌方向；历史对话沉淀为灵感，跨设备无缝续接。
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1], delay: 0.12 }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="rounded-[2rem] bg-white/80 p-7 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] flex flex-col gap-5"
          >
            {[
              { label: '实时对话', desc: '随时调整 prompt 方向与风格约束，即时看到调整方向' },
              { label: '品牌对齐', desc: '自动检测与品牌基因的偏差，及时提示修正' },
              { label: '历史沉淀', desc: '优质对话自动归档为灵感来源，下次创作时召回' },
              { label: '跨设备同步', desc: '会话记忆存于服务端，换设备不丢失上下文' },
            ].map(({ label, desc }) => (
              <div key={label} className="flex gap-4 items-start">
                <div className="mt-2 w-2 h-2 rounded-full bg-[#0a0a0d]/20 shrink-0" />
                <div>
                  <div className="font-semibold text-[#0a0a0d] text-sm mb-0.5">{label}</div>
                  <div className="text-[#4b5565] text-sm leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Section 5: Profile Memory */}
      <section className="snap-start min-h-[calc(100vh-56px)] px-6 py-10 sm:px-10 lg:px-14 flex items-center">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(360px,1fr)_minmax(0,0.9fr)]">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1] }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="rounded-[2rem] bg-white/60 p-8 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] flex flex-col gap-6"
          >
            {[
              { label: '偏好萃取', desc: '从对话中自动提炼稳定偏好，置信度低于阈值时不写入' },
              { label: '记忆分层', desc: '工作、回顾、语义、流程四层独立管理，互不干扰' },
              { label: '遗忘控制', desc: '随时查看、编辑或删除任意记忆条目，支持永久锁定' },
            ].map(({ label, desc }) => (
              <div key={label}>
                <div className="font-semibold text-[#0a0a0d] mb-1">{label}</div>
                <div className="text-[#4b5565] text-sm leading-relaxed">{desc}</div>
              </div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1], delay: 0.12 }}
            viewport={{ once: true, amount: 0.3, root: pageRef }}
            className="flex flex-col justify-center gap-5"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#4b5565]">
              04 · Profile Memory
            </p>
            <h2 className="text-[clamp(2rem,4.5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.03em] text-[#0a0a0d]">
              系统对你<br />形成长期<br />理解
            </h2>
            <p className="text-[#4b5565] max-w-sm text-base leading-relaxed">
              偏好自动萃取，宪法永不漂移，记忆随时可见可控。每一次对话都让系统更懂你。
            </p>
            <Link
              to="/profile/memory"
              className="self-start rounded-full border border-[#0a0a0d]/15 px-5 py-2.5 text-sm text-[#0a0a0d] hover:bg-[#0a0a0d]/5 transition-colors"
            >
              查看我的记忆 →
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Section 6: Final CTA */}
      <section className="snap-start min-h-[calc(100vh-56px)] px-6 py-10 sm:px-10 lg:px-14 relative flex flex-col items-center justify-center bg-[#050505] text-white gap-10">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1] }}
          viewport={{ once: true, amount: 0.3, root: pageRef }}
          className="text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/35 mb-5">开始创作</p>
          <h2 className="text-[clamp(2.5rem,6.5vw,6.5rem)] font-bold leading-[1.0] tracking-tight">
            准备好了吗？
          </h2>
          <p className="mt-5 text-white/55 max-w-md mx-auto text-base leading-relaxed">
            进入工作台，开始你的第一次 AI 创作；或者打开 Agent，让系统帮你规划整个任务。
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: [0.22, 0, 0.08, 1], delay: 0.15 }}
          viewport={{ once: true, amount: 0.3, root: pageRef }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <Link
            to="/workspace"
            className="rounded-full bg-white px-8 py-4 text-[#0a0a0d] font-semibold text-sm uppercase tracking-wider hover:bg-white/90 transition-colors text-center min-w-[160px]"
          >
            进入工作台
          </Link>
          <Link
            to="/agent"
            className="rounded-full bg-[#262834] px-8 py-4 text-[#f7f8fb] font-semibold text-sm uppercase tracking-wider hover:bg-[#2f3244] transition-colors text-center min-w-[160px]"
          >
            打开 Agent
          </Link>
        </motion.div>

        <p className="absolute bottom-6 text-white/20 text-xs tracking-widest">BrandGenius AI</p>
      </section>

      {/* Section 7: INTO A NEW SPACE — 待完善，暂放页末 */}
      <section className="snap-start min-h-[calc(100vh-56px)] relative overflow-hidden bg-[#050505] text-white flex items-center justify-center">
        <h2 className="relative z-10 text-center text-[clamp(3.5rem,11vw,11rem)] font-bold text-white/25 leading-none tracking-tighter pointer-events-none select-none">
          INTO A NEW<br />SPACE
        </h2>
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-blue-500/5 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-amber-500/3 pointer-events-none" />
      </section>

    </div>

      <ServiceSwitcher currentHref="/home" />
    </div>
  );
};

export default ServiceIntroPage;
