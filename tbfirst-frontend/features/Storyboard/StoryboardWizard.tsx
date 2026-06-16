import React, { useRef, useState } from 'react';
import Stage1Bible from './Stage1Bible';
import Stage2Storyboard from './Stage2Storyboard';
import StageGrid from './Stage3Images';
import StageLayout from './Stage4Layout';
import Stage5Video from './Stage5Video';
import { storyboardService, parseDocJson } from './storyboardService';
import { gridGenStore } from './gridGenerationStore';
import type { PreProduction, Shot, StoryboardProject, GarmentInfo, ModelInfo, GenParams, GridImage, LayoutSlot, VideoClip } from './StoryboardTypes';
import { DEFAULT_GEN_PARAMS } from './StoryboardTypes';
import ServiceSwitcher from '@/components/ServiceSwitcher';
import { C, FONT_BODY, FONT_DISPLAY, label as labelStyle } from './theme';

type WizardStage = 1 | 2 | 3 | 4;

const STAGE_LABELS = ['脚本 · 分镜', '审片台', '排版', '视频'];

// 视频生成（第四阶段）：上传分镜表 + 排版宫格图 / 故事板 → Seedance 2.0 合成一条视频。
const VIDEO_STAGE_ENABLED = true;
const stageEnabled = (s: WizardStage) => s !== 4 || VIDEO_STAGE_ENABLED;

export default function StoryboardWizard() {
  // 流式单页：flow 是只增的进度水位（完成一步即在下方展开下一区块）；activeSection 仅供步骤条高亮
  const [flow, setFlow] = useState<WizardStage>(1);
  const [activeSection, setActiveSection] = useState<WizardStage>(1);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<StoryboardProject[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0); // 变化即强制各 Stage 重挂载（载入/新建时刷新）
  const [loadingProject, setLoadingProject] = useState(false);
  // 「立即生图并进入审片台」按钮自增 → 审片台据此追加一批（nonce 而非布尔：常驻挂载下可重复触发）
  const [gridAutoGenNonce, setGridAutoGenNonce] = useState(0);
  // 生成参数（N=gridCount / M=imageCount / 画幅 / 画质）：唯一真源，Stage1+Stage2 共享
  const [genParams, setGenParams] = useState<GenParams>({ ...DEFAULT_GEN_PARAMS });
  // 大纲编辑后触发重渲染，使下方「分镜表」拿到最新大纲（仅在大纲结构字段变动时触发，非主输入框）
  const [, bumpBible] = useState(0);
  // 排版改动后触发重渲染，使已展开的「视频」区块同步最新排布（参考图实时重合成）
  const [, bumpVideoSync] = useState(0);

  // 各阶段数据持久化到 useRef（不随区块展开/重渲染丢失）
  const storyTextRef = useRef<string>('');
  const preProductionRef = useRef<PreProduction | null>(null);
  const preProductionJsonRef = useRef<string>('');
  const shotsRef = useRef<Shot[]>([]);
  const garmentRef = useRef<GarmentInfo | null>(null);
  const modelRef = useRef<ModelInfo | null>(null);
  const gridImagesRef = useRef<GridImage[]>([]);
  const layoutRef = useRef<LayoutSlot[]>([]);
  const videoScriptRef = useRef<string>('');
  const videoClipsRef = useRef<VideoClip[]>([]);

  // 流式单页：滚动容器 + 各区块锚点 ref（完成一步即平滑滚动到新区块）
  const scrollRef = useRef<HTMLDivElement>(null);
  const storyboardSecRef = useRef<HTMLDivElement>(null);
  const gridSecRef = useRef<HTMLDivElement>(null);
  const layoutSecRef = useRef<HTMLDivElement>(null);
  const videoSecRef = useRef<HTMLDivElement>(null);

  const reveal = (n: WizardStage) => setFlow(f => (n > f ? n : f));
  function scrollToSection(ref: React.RefObject<HTMLDivElement | null>) {
    // 区块刚在同一 commit 挂载，等一帧布局再滚
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  function scrollToStage(s: WizardStage) {
    setActiveSection(s);
    if (s === 1) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    else scrollToSection(s === 2 ? gridSecRef : s === 3 ? layoutSecRef : videoSecRef);
  }

  async function loadProjects() {
    try {
      setProjects(await storyboardService.listProjects());
    } catch {
      // ignore
    }
  }

  // Stage1Bible 生成故事大纲成功：写回 ref + 设 projectId（同页露出分镜表）
  function onProjectCreated(
    pid: number, pp: PreProduction, ppJson: string,
    storyText: string, garment: GarmentInfo | null, model: ModelInfo | null,
  ) {
    // 重新生成大纲会产生新 projectId → 软重置下游，避免新大纲下方残留旧项目的审片台/排版数据。
    // flow=1 即让区块 2-4 卸载（不渲染）；新 projectId 让 gridGenStore 走新键，无需 bump loadNonce
    // （避免连带重挂载 Stage1Bible，丢掉刚生成的大纲展示）。
    if (projectId != null && pid !== projectId) {
      gridImagesRef.current = [];
      layoutRef.current = [];
      videoClipsRef.current = [];
      setFlow(1);
      setActiveSection(1);
      setGridAutoGenNonce(0);
    }
    preProductionRef.current = pp;
    preProductionJsonRef.current = ppJson;
    storyTextRef.current = storyText;
    garmentRef.current = garment;
    modelRef.current = model;
    setProjectId(pid);
  }

  function onShotsChange(shots: Shot[]) {
    shotsRef.current = shots; // 连续同步，确保自由切 stage 不丢编辑
  }

  // Stage1 故事大纲生成/编辑后同步回 ref（不含 genParams——genParams 走 setGenParams 单独管理）
  function onBibleChange(
    pp: PreProduction, ppJson: string,
    garment: GarmentInfo | null, model: ModelInfo | null, storyText: string,
  ) {
    preProductionRef.current = pp;
    preProductionJsonRef.current = ppJson;
    garmentRef.current = garment;
    modelRef.current = model;
    storyTextRef.current = storyText;
    if (projectId != null) bumpBible(n => n + 1); // 已露出分镜表时，编辑大纲即刷新其上下文
  }

  // 展开「审片台」并自动生图（来自「立即生图并进入审片台」按钮）
  function onEnterGrid(shots: Shot[]) {
    shotsRef.current = shots;
    setGridAutoGenNonce(n => n + 1); // 自增 → 审片台追加一批；经步骤条滚动导航不会自增 → 不误触发
    reveal(2);
    setActiveSection(2);
    scrollToSection(gridSecRef);
  }

  function onGridsChange(grids: GridImage[]) {
    gridImagesRef.current = grids;
  }

  // 展开「排版」
  function onEnterLayout(grids: GridImage[]) {
    gridImagesRef.current = grids;
    reveal(3);
    setActiveSection(3);
    scrollToSection(layoutSecRef);
  }

  function onLayoutChange(layout: LayoutSlot[]) {
    layoutRef.current = layout;
    // 已展开视频区块时，排版改动即触发其重渲染 → Stage5Video 据最新 layout 重合成参考图
    if (flow >= 4) bumpVideoSync(n => n + 1);
  }

  // 展开「视频」（暂不上线：禁用时直接 no-op，排版阶段也不再暴露"→ 视频生成"按钮）
  function onEnterVideo() {
    if (!VIDEO_STAGE_ENABLED) return;
    reveal(4);
    setActiveSection(4);
    scrollToSection(videoSecRef);
  }

  function newProject() {
    storyTextRef.current = '';
    preProductionRef.current = null;
    preProductionJsonRef.current = '';
    shotsRef.current = [];
    garmentRef.current = null;
    modelRef.current = null;
    gridImagesRef.current = [];
    layoutRef.current = [];
    videoScriptRef.current = '';
    videoClipsRef.current = [];
    setGenParams({ ...DEFAULT_GEN_PARAMS });
    setProjectId(null);
    setFlow(1);
    setActiveSection(1);
    setGridAutoGenNonce(0);
    setLoadNonce(n => n + 1);
    setSidebarOpen(false);
  }

  async function loadProject(p: StoryboardProject) {
    if (loadingProject) return;
    setLoadingProject(true);
    try {
      // 列表项不含 docJson（后端 listByUserIdNoDocJson）→ 必须拉完整项目才能恢复
      const full = await storyboardService.getProject(p.id);
      const doc = parseDocJson(full.docJson);
      preProductionRef.current = doc.preProduction ?? null;
      preProductionJsonRef.current = doc.preProduction ? JSON.stringify(doc.preProduction) : '';
      shotsRef.current = doc.shots ?? [];
      garmentRef.current = doc.garment ?? null;
      modelRef.current = doc.model ?? null;
      // 后台生成（gridGenStore，按 projectId 在内存中）可能已为该项目生成/正在生成图，但批次未结算时
      // 尚未落库；切走再回来时若只看 doc 会丢这些图、审片台无法展开 → 有 store 数据则以 store 为准。
      const gridState = gridGenStore.getState(full.id);
      gridImagesRef.current = gridState.images.length ? gridState.images.map(g => ({ ...g })) : (doc.gridImages ?? []);
      layoutRef.current = doc.layout ?? [];
      videoScriptRef.current = '';
      videoClipsRef.current = doc.videoClips ?? [];
      setGenParams({ ...DEFAULT_GEN_PARAMS, ...(doc.genParams ?? {}) });
      storyTextRef.current = doc.storyText ?? '';
      setProjectId(full.id);
      // 流式：按已保存数据（含内存中后台生成）+ stage 字段推导进度水位 flow，把已完成区块一次性堆叠展开
      const hasShots = (doc.shots?.length ?? 0) > 0;
      // 有已完成图 或 正在后台生成 → 都应展开审片台（gridImagesRef 已取自 store/doc 较新者）
      const hasDoneGrids =
        gridImagesRef.current.some(g => g.status === 'done' && g.imageUrl) || gridState.generatingCount > 0;
      const hasLayout = (doc.layout ?? []).some(s => s.sourceImageId);
      const hasVideo = (doc.videoClips ?? []).some(c => c.status === 'done');
      const s = full.stage ?? 'stage1';
      // 以 stage 字段为基线（旧 4 阶段 → 新 4 区块：脚本/分镜→1，生成图→2，排版→3，视频→4）
      let f: WizardStage = s === 'stage4' ? 3 : (s === 'stage3' || s === 'stage-grid') ? 2 : 1;
      // 数据回落：缺产物则回退，避免空白区块
      if (f >= 3 && !hasDoneGrids) f = hasShots ? 2 : 1;
      if (f >= 2 && !hasShots && !hasDoneGrids) f = 1;
      // 数据超前：旧 stage 字段不准时，按实际产物补足
      if (hasDoneGrids && f < 2) f = 2;
      if (hasLayout && f < 3) f = 3;
      if (hasVideo && f < 4) f = 4;
      // 视频暂不上线：旧项目即便有视频产物，也不展开第四区块（封顶到排版）。
      if (!VIDEO_STAGE_ENABLED && f > 3) f = 3;
      setFlow(f as WizardStage);
      setActiveSection(f);
      setGridAutoGenNonce(0); // 加载项目不自动生图
      setLoadNonce(n => n + 1);
      setSidebarOpen(false);
    } catch (e) {
      console.error('[Storyboard] loadProject failed', e);
    } finally {
      setLoadingProject(false);
    }
  }

  async function removeProject(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm('确认删除该分镜项目？此操作不可撤销。')) return;
    try {
      await storyboardService.deleteProject(id);
      await loadProjects();
      if (id === projectId) newProject();
    } catch (err) {
      console.error('[Storyboard] deleteProject failed', err);
      window.alert('删除失败，请重试');
    }
  }

  // 步骤条 = 进度指示 + 锚点滚动导航：区块已展开（flow>=s）才可点；未解锁置灰
  // 视频阶段暂不上线 → stageEnabled=false 时恒不可达（灰显 + 点击不跳转）。
  const stageReachable = (target: WizardStage) => stageEnabled(target) && (target === 1 || flow >= target);
  function goStage(s: WizardStage) {
    if (stageReachable(s)) scrollToStage(s);
  }

  const bibleReady = projectId != null && preProductionRef.current != null;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'transparent', color: C.ink, fontFamily: FONT_BODY }}>
      {/* 背景透明：露出 App 层全局固定的 EmbossRevealCanvas（暖白底 + 悬浮浮雕），与 /home 一致 */}
      {/* Sidebar（固定满高，不随正文滚动；正文滚到第三阶段时点开历史仍能看到项目） */}
      <div style={{
        width: sidebarOpen ? 272 : 0, transition: 'width 0.22s ease', overflow: 'hidden',
        background: C.bgTint, borderRight: `1px solid ${C.line}`, flexShrink: 0,
      }}>
        <div style={{ padding: 20, minWidth: 272, height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={labelStyle}>历史项目</span>
            <button
              onClick={newProject}
              style={{
                fontSize: 12, fontWeight: 600, color: C.ctaText, background: C.cta,
                border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
              }}
            >
              + 新建
            </button>
          </div>
          {projects.length === 0 && (
            <p style={{ color: C.inkFaint, fontSize: 12.5 }}>暂无项目，点「新建」开始。</p>
          )}
          {projects.map(p => {
            const cur = p.id === projectId;
            return (
              <div
                key={p.id}
                onClick={() => loadProject(p)}
                style={{
                  position: 'relative', padding: '11px 30px 11px 12px', borderRadius: 10,
                  background: cur ? C.surface : 'transparent',
                  border: `1px solid ${cur ? C.lineStrong : 'transparent'}`,
                  boxShadow: cur ? '0 1px 3px rgba(42,37,30,0.06)' : 'none',
                  cursor: 'pointer', marginBottom: 6,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: C.ink, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.title || '未命名项目'}
                </div>
                <div style={{ color: C.inkFaint, fontSize: 11.5, letterSpacing: '0.03em' }}>{p.stage ?? 'stage1'}</div>
                <button
                  onClick={(e) => removeProject(p.id, e)}
                  title="删除项目"
                  style={{
                    position: 'absolute', top: 8, right: 8, background: 'none', border: 'none',
                    color: C.inkFaint, cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1,
                  }}
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Header / stepper */}
        <div style={{
          padding: '16px 28px',
          // /home 同款磨砂半透明：浮雕背景隐约透过顶栏，强化「悬浮」质感
          background: 'rgba(252,250,246,0.82)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 18,
          position: 'sticky', top: 0, zIndex: 20,
        }}>
          <button
            onClick={() => { setSidebarOpen(o => !o); if (!sidebarOpen) loadProjects(); }}
            style={{
              background: 'transparent', border: `1px solid ${C.lineStrong}`, borderRadius: 9, color: C.inkSoft,
              padding: '6px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            }}
          >
            ☰ 历史
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600, color: C.ink }}>CineStitch</span>
            <span style={{ ...labelStyle, fontSize: 9.5 }}>分镜工作台</span>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {STAGE_LABELS.map((lbl, i) => {
              const s = (i + 1) as WizardStage;
              const enabled = stageEnabled(s);
              const active = activeSection === s;
              const done = flow > s;
              const reachable = stageReachable(s);
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    title={!enabled ? '视频生成暂未上线' : reachable ? '滚动到该区块' : '完成上一步后解锁'}
                    onClick={() => goStage(s)}
                    disabled={!enabled}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999,
                      background: active ? C.cta : 'transparent',
                      border: `1px solid ${active ? C.cta : reachable ? C.lineStrong : 'transparent'}`,
                      color: active ? C.ctaText : reachable ? C.ink : C.inkFaint,
                      cursor: !enabled ? 'not-allowed' : reachable ? 'pointer' : 'not-allowed',
                      opacity: enabled ? 1 : 0.5, fontFamily: FONT_BODY,
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', fontSize: 10.5, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: active ? 'rgba(251,248,242,0.18)' : !enabled ? C.line : done ? C.ok : C.accentSoft,
                      color: active ? C.ctaText : !enabled ? C.inkFaint : done ? '#fff' : C.accent,
                    }}>
                      {!enabled ? '🔒' : done ? '✓' : s}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{lbl}{!enabled ? ' · 暂未上线' : ''}</span>
                  </button>
                  {i < STAGE_LABELS.length - 1 && (
                    <div style={{ width: 22, height: 1, background: C.lineStrong, margin: '0 2px' }} />
                  )}
                </div>
              );
            })}
          </div>
          {loadingProject && <span style={{ fontSize: 12, color: C.accent }}>载入中…</span>}
        </div>

        {/* 流式单页：各区块按完成度（flow）自上而下堆叠展开，已展开区块常驻可回滚编辑。
            key 含 loadNonce：载入/新建时强制重挂载，从 ref 重新初始化。 */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {/* 区块1：基础脚本 + 分镜表 */}
          <React.Fragment key={`s1-${loadNonce}`}>
            <Stage1Bible
              initialProjectId={projectId}
              initialPreProduction={preProductionRef.current}
              initialStoryText={storyTextRef.current}
              initialGarment={garmentRef.current}
              initialModel={modelRef.current}
              initialShots={shotsRef.current}
              initialVideoScript={videoScriptRef.current}
              genParams={genParams}
              onGenParamsChange={setGenParams}
              onBibleChange={onBibleChange}
              onProjectCreated={onProjectCreated}
              onVideoScriptChange={(s) => { videoScriptRef.current = s; }}
            />
            {bibleReady && (
              <div ref={storyboardSecRef}>
                <Stage2Storyboard
                  storyText={storyTextRef.current}
                  preProductionJson={preProductionJsonRef.current}
                  preProduction={preProductionRef.current!}
                  projectId={projectId!}
                  garment={garmentRef.current}
                  model={modelRef.current}
                  genParams={genParams}
                  onGenParamsChange={setGenParams}
                  initialShots={shotsRef.current}
                  onShotsChange={onShotsChange}
                  onComplete={onEnterGrid}
                />
              </div>
            )}
          </React.Fragment>

          {/* 区块2：审片台 */}
          {flow >= 2 && projectId != null && (
            <div ref={gridSecRef} style={{ borderTop: `1px solid ${C.line}` }}>
              <React.Fragment key={`s2-${loadNonce}`}>
                <StageGrid
                  projectId={projectId}
                  preProductionJson={preProductionJsonRef.current}
                  storyText={storyTextRef.current}
                  shots={shotsRef.current}
                  garment={garmentRef.current}
                  model={modelRef.current}
                  genParams={genParams}
                  layout={layoutRef.current}
                  initialGridImages={gridImagesRef.current}
                  autoGenNonce={gridAutoGenNonce}
                  onGridsChange={onGridsChange}
                  onComplete={onEnterLayout}
                />
              </React.Fragment>
            </div>
          )}

          {/* 区块3：排版 */}
          {flow >= 3 && projectId != null && (
            <div ref={layoutSecRef} style={{ borderTop: `1px solid ${C.line}` }}>
              <React.Fragment key={`s3-${loadNonce}`}>
                <StageLayout
                  projectId={projectId}
                  shots={shotsRef.current}
                  genParams={genParams}
                  gridImages={gridImagesRef.current}
                  initialLayout={layoutRef.current}
                  preProductionJson={preProductionJsonRef.current}
                  storyText={storyTextRef.current}
                  garment={garmentRef.current}
                  model={modelRef.current}
                  onLayoutChange={onLayoutChange}
                  onComplete={VIDEO_STAGE_ENABLED ? onEnterVideo : undefined}
                />
              </React.Fragment>
            </div>
          )}

          {/* 区块4：视频（上传分镜表 + 排版宫格图 / 故事板 → Seedance 合成一条视频） */}
          {VIDEO_STAGE_ENABLED && flow >= 4 && projectId != null && (
            <div ref={videoSecRef} style={{ borderTop: `1px solid ${C.line}` }}>
              <React.Fragment key={`s4-${loadNonce}`}>
                <Stage5Video
                  shots={shotsRef.current}
                  gridImages={gridImagesRef.current}
                  layout={layoutRef.current}
                  genParams={genParams}
                />
              </React.Fragment>
            </div>
          )}
        </div>
      </div>

      <ServiceSwitcher currentHref="/cinestitch" />
    </div>
  );
}
