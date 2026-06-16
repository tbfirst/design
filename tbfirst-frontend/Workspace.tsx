
import React, { useState, useRef, useEffect } from 'react';
import { ImageModal } from './components/ImageModal';
import { HistoryModal } from './components/HistoryModal';
import { ProductGuide } from './components/ProductGuide';
import { Phase1 } from './components/Phase1';
import { Phase2 } from './components/Phase2';
import { Phase2Color } from './components/Phase2Color';
import { Phase3 } from './components/Phase3';
import { InpaintModal } from './features/SmartInpaint/InpaintModal';
import { CopilotContainer } from './features/Copilot/CopilotContainer';
import { Phase0 } from './components/Phase0';
import { ConnectionManager } from './components/ConnectionManager';
import { authService } from './features/Auth/authService';
import CurrentUserBadge from './features/Auth/CurrentUserBadge';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import ServiceSwitcher from './components/ServiceSwitcher';
import { useUserPersistedState } from './services/shared/userPersistedState';
import {
  InputFiles,
  InputLabels,
  Phase1Settings,
  Phase2Settings,
  Phase2ColorSettings,
  Phase3Settings,
  AssetStudioSettings,
  GeneratedImage,
  ImageSize,
  ResolvedCompositionIntent,
} from './types';
import { defaultPhase3Settings } from './services/shared/toneIntent';
import { toProxiedSrc, makeImgErrorFallback } from './services/shared/imageSrc';
import { extractToneDNA, generateSinglePhase3Image } from './services/geminiService';
import { uploadFilesToGcs } from './services/uploadService';
import {
  SHOT_TYPES,
  TONES,
  ATMOSPHERES,
  LIGHTING_OPTIONS,
  ACTIONS,
  EXPRESSIONS,
  FOCUS_OPTIONS,
  LIFESTYLE_DETAILS
} from './constants';

/**
 * 将图片压缩到适合存储的大小，默认最大边为800px，质量为0.7。
 *
 * 入参必须是 data:/blob: URI —— 不要直接把 GCS 直链或 /img/<key> 反代路径丢进来，
 * 否则 <img> 跨源加载会让 canvas 被 taint，toDataURL 抛 SecurityError。
 * 需要从 HTTP URL 入口时请先用 fetchAsDataUri() 拉成 data URI 再喂给本函数。
 */
const compressForStorage = (dataUri: string, maxDim = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    // 即使是 data:/blob: 也显式声明，避免极端情况下被浏览器判为跨源
    img.crossOrigin = 'anonymous';
    img.src = dataUri;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUri);
      try {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        // canvas 被 taint（理论上不会走到这里，调用方应先走 fetchAsDataUri）
        console.error('[compressForStorage] toDataURL failed, fallback to original:', e);
        resolve(dataUri);
      }
    };
    img.onerror = () => resolve(dataUri);
  });
};

/**
 * 把 GCS 直链 / /img 反代路径拉成 data URI。
 *
 * 关键：先经 toProxiedSrc() 改成同源 /img/<key>，fetch 走同源直接拿到 Blob，
 * 再用 FileReader 转 base64 data URI。这样后续 <img>.src = dataUri 时浏览器
 * 完全把它当本地字节，不会污染 canvas。
 *
 * 之前 handleAddToLibrary 直接把 img.url（可能是 GCS 直链）丢给 compressForStorage，
 * <img> 跨源加载导致 canvas tainted → toDataURL SecurityError → 请求体永远拼不出来，
 * 表现为"存入个人模特库"按钮一直 loading 不返回。
 */
const fetchAsDataUri = async (url: string): Promise<string> => {
  if (url.startsWith('data:')) return url;
  const proxied = toProxiedSrc(url);
  const resp = await fetch(proxied, { credentials: 'same-origin' });
  if (!resp.ok) {
    throw new Error(`图片拉取失败：${resp.status}`);
  }
  const blob = await resp.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 读取失败'));
    reader.readAsDataURL(blob);
  });
};

/**
 * 主工作区组件 —— 四段式生图流程：
 *   Phase 0（资产工厂） · Phase 1（创意） · Phase 2（精修） · Phase 3（影调大师）
 *
 * 状态划分：
 *   inputs / previews              —— 原始上传（人台、模特、产品、场景、配饰）
 *   p0Settings / p1Settings / p2Settings / p3Settings
 *                                  —— 各阶段配置；p1/p2/p3 由 useUserPersistedState 按用户 id 落 localStorage
 *   resultsPhase0/1/2/3            —— 各阶段生成结果（仅当次会话，不再挂载时回灌历史）
 *   modelLibrary                   —— 品牌模特库，Phase 1 可选参考图
 *   appUser                        —— 从 /api/auth/me 拉取的用户信息，决定是否显示 "admin" 按钮
 *
 * Phase 3 影调大师专属状态（达芬奇式整体调色，禁改服装本色，只动 LUT/曝光/白平衡/颗粒）：
 *   p3Queue                        —— 待处理底片队列（从 Phase 2 「影调精修」按钮 / 本地导入进队）
 *   resultsPhase3                  —— 渲染结果，img.originalUrl 保留原图供 hover 对比
 *   lastP3RenderSig + p3RenderSig() —— "复刻签名"：
 *       styleDNA|intensity|grain|contrast|imageSize|remark
 *       签名变化 + 队列空 + 成品库有 originalUrl ⇒ 允许「重新复刻渲染」按钮（对成品库整批用 originalUrl 重渲染）
 *   handleP3ExtractDNA             —— 调 extractToneDNA → 灵感图视觉 DNA 12-15 个英文 tag + 四维中文笔记
 *   handleBatchRender              —— 队列/成品库并发渲染，phase_config 全字段透传到 Python build_phase3_prompt
 *   handleApplyPrompt              —— Copilot 「应用到当前描述」：按滚动位置分别落 p0/p1/p2/p3.remark
 *                                     scrollY>2800 → p3Settings.remark（P0 最高优先级,覆盖默认调色倾向）
 *
 * 挂载副作用（useEffect [] 里完成）：
 *   1. 拉取品牌模特库
 *   2. 拉取用户详情 → appUser（用于头部 admin 按钮判定；个人模特库 USER 也可写，不再额外门禁）
 *   3. 注：v3 起不再挂载时回灌 history，仅 "历史生图" 按钮 → <HistoryModal> 触发拉取
 *
 * 右下角浮窗 = CopilotContainer（感知 p3Settings + activePhase, Phase 3 时切到 DaVinci 调色师模式）；
 * 顶部 "admin" 按钮仅 admin 角色可见。
 */
const Workspace: React.FC = () => {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();

  const [keyReady, setKeyReady] = useState(true); // Default to true as backend handles key
  const [showGuide, setShowGuide] = useState(false);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  const handleReconnect = () => {
    setReconnectTrigger(prev => prev + 1);
  };

  // Shared States
  const [modelLibrary, setModelLibrary] = useState<Array<{ id: number; url: string }>>([]);
  const [savedToLibraryIds, setSavedToLibraryIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [appUser, setAppUser] = useState<any>(null);
  const [hoveredModel, setHoveredModel] = useState<{url: string, x: number, y: number} | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const [inputs, setInputs] = useState<InputFiles>({});
  const [previews, setPreviews] = useState<{[key: string]: string | string[]}>({});
  // 每张参考图的用户标签；与 inputs/previews 同形状，但只在需要区分多张时使用。
  // 提升到 Workspace 级别是为了 Phase 切换时保留标签状态，避免用户填了又丢。
  const [inputLabels, setInputLabels] = useState<InputLabels>({});

  // Results
  const [resultsPhase0, setResultsPhase0] = useState<GeneratedImage[]>([]);
  const [resultsPhase1, setResultsPhase1] = useState<GeneratedImage[]>([]);
  const [resultsPhase2, setResultsPhase2] = useState<GeneratedImage[]>([]);
  const [resultsPhase3, setResultsPhase3] = useState<GeneratedImage[]>([]);

  // === 新增：局部重绘状态 ===
  const [inpaintTarget, setInpaintTarget] = useState<GeneratedImage | null>(null);

  // 阶段状态设置初始化
  const [p0Settings, setP0Settings] = useState<AssetStudioSettings>({
    tasks: ['3D_FRONT'],
    smartRetouch: true,
    aspectRatio: '3:4',
    imageSize: ImageSize.K1,
    remark: '',
  });

  const [p1Settings, setP1Settings] = useUserPersistedState<Phase1Settings>('p1Settings', {
    shotType: SHOT_TYPES[1].value,
    tone: TONES[1].value,
    atmosphere: ATMOSPHERES[1].value,
    remark: '',
    count: 2,
    imageSize: ImageSize.K1,
    aspectRatio: '3:4',
    compositionScope: 'inherit',
    compositionTarget: '',
  });

  const [p2Settings, setP2Settings] = useUserPersistedState<Phase2Settings>('p2Settings', {
    selectedBaseImages: [],
    actions: [],
    expression: EXPRESSIONS[0].value,
    focus: FOCUS_OPTIONS[0].value,
    detailFocus: '',
    fabricDetail: '',
    lighting: LIGHTING_OPTIONS[0].value,
    aspectRatio: '3:4',
    remark: '',
    imageSize: ImageSize.K2,
    count: 1,
    compositionScope: 'inherit',
    compositionTarget: '',
    poseAction: '',
    gestureAction: '',
    customAction: '',
  });

  const [lastCompositionIntent, setLastCompositionIntent] = useUserPersistedState<ResolvedCompositionIntent | null>('lastCompositionIntent', null);

  const [p3Settings, setP3Settings] = useUserPersistedState<Phase3Settings>('phase3:settings:v1', defaultPhase3Settings());
  const [p3Queue, setP3Queue] = useState<GeneratedImage[]>([]);
  // 上次"一键复刻渲染"触发时的影调签名（styleDNA + intensity + grain + contrast + imageSize）
  // 用于：队列空但用户调整了控制面板参数时，仍允许对已有结果重新渲染
  const [lastP3RenderSig, setLastP3RenderSig] = useState<string | null>(null);

  const p3RenderSig = (s: Phase3Settings) =>
    `${s.styleDNA}|${s.intensity.toFixed(2)}|${s.grain ? 1 : 0}|${s.contrast}|${s.imageSize}|${(s.remark || '').trim()}`;

  const sendToGradeMaster = (img: GeneratedImage) => {
    setP3Queue(prev => prev.some(i => i.id === img.id) ? prev : [...prev, img]);
    setTimeout(() => {
      gradeMasterSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  };

  const removeFromP3Queue = (id: string) => {
    setP3Queue(prev => prev.filter(i => i.id !== id));
  };

  // V5.XVI.15：跨 Phase 透传 garmentAttrs。p1 → p2 / p3 仅在目标 Phase 自己
  // 还没填写时同步，避免覆盖用户在下游 Phase 的编辑。V5.XVI.16 在 Phase2/3
  // 加 GarmentAttrsForm 后用户依旧可继续编辑。
  useEffect(() => {
    const src = p1Settings.garmentAttrs;
    if (!src || src.length === 0) return;
    setP2Settings(prev => (prev.garmentAttrs && prev.garmentAttrs.length > 0)
      ? prev
      : { ...prev, garmentAttrs: src });
    setP3Settings(prev => (prev.garmentAttrs && prev.garmentAttrs.length > 0)
      ? prev
      : { ...prev, garmentAttrs: src });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1Settings.garmentAttrs]);

  const [isP3Analyzing, setIsP3Analyzing] = useState(false);
  const [isP3Rendering, setIsP3Rendering] = useState(false);

  // V5.XVII.K.2：forceRefresh=true 时旁路 ai-python 的 DNA Redis 缓存（24h TTL），
  // 用于「DNA 提取出来效果不理想，希望重新跑一次」场景；普通点击仍走缓存。
  const handleP3ExtractDNA = async (forceRefresh = false) => {
    if (!p3Settings.inspirationImage) return;
    setIsP3Analyzing(true);
    setP3Settings(prev => ({ ...prev, styleDNA: '', dnaTranslation: undefined }));
    try {
      const dna = await extractToneDNA(p3Settings.inspirationImage, forceRefresh);
      setP3Settings(prev => ({ ...prev, styleDNA: dna.tags, dnaTranslation: dna.translation }));
    } catch (err) {
      console.error('DNA Extraction failed:', err);
      alert('DNA 提取失败：' + (err as Error).message);
    } finally {
      setIsP3Analyzing(false);
    }
  };

  const handleBatchRender = async () => {
    if (!p3Settings.styleDNA || isP3Rendering) return;
    const currentSig = p3RenderSig(p3Settings);

    // 确定底片来源：① 队列非空 → 用队列；② 队列空但设置变化且有可用原图 → 用结果库中的 originalUrl 重新渲染
    let bases: { sourceId: string; url: string; aspectRatio?: string }[] = [];
    if (p3Queue.length > 0) {
      bases = p3Queue.map(j => ({ sourceId: j.id, url: j.url, aspectRatio: j.aspectRatio }));
    } else {
      const doneWithOrig = resultsPhase3.filter(i => i.status === 'done' && i.originalUrl);
      if (doneWithOrig.length === 0) return;
      if (lastP3RenderSig !== null && currentSig === lastP3RenderSig) return; // 设置未变，无意义渲染
      bases = doneWithOrig.map(j => ({ sourceId: j.id, url: j.originalUrl!, aspectRatio: j.aspectRatio }));
    }

    setIsP3Rendering(true);
    // 底片队列保留（不自动清空），由用户自行通过 × 按钮删除；
    // 允许重复渲染同一批底片（搭配控制面板参数变更场景）。
    setLastP3RenderSig(currentSig);

    const placeholders: GeneratedImage[] = bases.map(b => ({
      id: `p3-${b.sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url: b.url,
      originalUrl: b.url,
      promptUsed: '',
      aspectRatio: b.aspectRatio || '3:4',
      status: 'pending' as const,
      phase: 3 as const,
      actionLabel: '影调注入中...',
    }));
    setResultsPhase3(prev => [...placeholders, ...prev]);
    // V5.XIV.5: 单图失败自动重试 1 次。Phase3 失败常见因素是模型链尾延迟 /
    // 临时 502；attempt=0 失败 → 切 status='retrying' 提示用户 → attempt=1 再试；
    // 仍失败才落 status='error'。重试不阻塞其他 placeholder（仍并行）。
    const runOne = async (ph: GeneratedImage, attempt: number = 0): Promise<void> => {
      try {
        const result = await generateSinglePhase3Image({
          baseDataUri: ph.originalUrl!,
          styleDNA: p3Settings.styleDNA,
          inspirationImage: p3Settings.inspirationImage,
          intensity: p3Settings.intensity,
          grain: p3Settings.grain,
          contrast: p3Settings.contrast,
          imageSize: p3Settings.imageSize,
          remark: p3Settings.remark,
          garmentAttrs: p3Settings.garmentAttrs,
        });
        setResultsPhase3(prev => prev.map(img =>
          img.id === ph.id ? { ...img, url: result.url, status: 'done' as const, actionLabel: '品牌成品 (Rose)' } : img
        ));
      } catch (err: any) {
        if (attempt === 0) {
          console.warn('[Phase3] render attempt 0 failed, retrying:', ph.id, err?.message);
          setResultsPhase3(prev => prev.map(img =>
            img.id === ph.id ? { ...img, status: 'retrying' as const, actionLabel: '失败，重试中...' } : img
          ));
          return runOne(ph, 1);
        }
        console.error('[Phase3] render attempt 1 failed, giving up:', ph.id, err?.message);
        setResultsPhase3(prev => prev.map(img =>
          img.id === ph.id ? { ...img, status: 'error' as const, errorMessage: err.message, actionLabel: undefined } : img
        ));
      }
    };
    await Promise.all(placeholders.map(ph => runOne(ph)));
    setIsP3Rendering(false);
  };

  const handleP3InspirationChange = (dataUri: string) => {
    setP3Settings(prev => ({ ...prev, inspirationImage: dataUri || undefined, styleDNA: dataUri ? prev.styleDNA : '', dnaTranslation: dataUri ? prev.dnaTranslation : undefined }));
  };

  // V5.XVII.F：Phase3 本地导入底片改走 GCS 上传 → 拿短链。
  //
  // 之前：File → FileReader → base64 data URI → 进 p3Queue.url → 批量渲染时每个
  // placeholder 把这个 ~889KB 的 base64 当作 referenceImages[0] 发 phase3/generate；
  // 多个并发 + Phase3 模型本身 30-60s → vite-proxy / 浏览器在 socket idle 时 RST，
  // 表现为 TypeError: Failed to fetch（请求体 ~889KB，远小于 8MB 阈值但仍失败）。
  //
  // 现在：File → /api/image/upload → GCS 短链 → 进 p3Queue.url → 渲染时 body 几 KB，
  // 即便批量并发也不会拖垮 proxy；占位预览用短链通过 /img/** 加载，也比直接渲染
  // 大块 base64 data URI 流畅。
  const handleP3LocalImport = async (file: File) => {
    try {
      const [shortUrl] = await uploadFilesToGcs([file], 'phase3');
      if (!shortUrl) {
        alert('本地底片上传失败：返回了空 URL');
        return;
      }
      const img: GeneratedImage = {
        id: `p3-local-${Date.now()}`,
        url: shortUrl,
        promptUsed: '',
        aspectRatio: '3:4',
        phase: 3,
        status: 'done',
        actionLabel: '本地导入底片',
      };
      sendToGradeMaster(img);
    } catch (err) {
      console.error('[Phase3] local import upload failed:', err);
      alert('本地底片上传失败，请检查网络或稍后重试');
    }
  };

  const [phase2Mode, setPhase2Mode] = useState<'standard' | 'color'>('standard');
  const [p2ColorSettings, setP2ColorSettings] = useUserPersistedState<Phase2ColorSettings>('p2ColorSettings', {
    targetColor: '#FF0000',
    targetArea: 'Whole Outfit',
    remark: '',
    intensity: 80,
    count: 1,
    aspectRatio: '3:4',
    imageSize: ImageSize.K2,
    referenceImageUrl: null,
  });

  // UI State
  const [viewingCollection, setViewingCollection] = useState<'p0' | 'p1' | 'p2' | 'p3' | null>(null);
  const [viewingIndex, setViewingIndex] = useState<number>(0);
  const [assetPreviewUrl, setAssetPreviewUrl] = useState<string | null>(null);

  // Refs for auto-scroll
  const assetStudioSectionRef = useRef<HTMLDivElement>(null);
  const creationSectionRef = useRef<HTMLDivElement>(null);
  const refinementSectionRef = useRef<HTMLDivElement>(null);
  const gradeMasterSectionRef = useRef<HTMLDivElement>(null);
  const resultsRef0 = useRef<HTMLDivElement>(null);
  const resultsRef1 = useRef<HTMLDivElement>(null);
  const resultsRef2 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await authService.fetchWithAuth('/api/image/models');
        if (response.ok) {
          const body = await response.json();
          const data = body.data || body;  // R<T> 解包
          setModelLibrary(data.map((m: any) => ({ id: m.id as number, url: m.url as string })));
        }
      } catch (err) {
        console.error("Failed to fetch brand models:", err);
      }
    };
    fetchModels();

    const user = authService.getCurrentUser();
    if (user) {
      authService.getUserData(user.id).then(userData => {
        setAppUser(userData);
      });
    }

    // 注意：此处原有"挂载时自动拉历史生图回灌 resultsPhase0/1/2"的逻辑已**移除**。
    // 登录/刷新后主界面只展示当次会话的新生成结果（results.length===0 时"结果库"段落自然隐藏）。
    // 要查历史 → 顶部 "历史生图" 按钮 → <HistoryModal>，按日期分组展示用户所有未软删的记录，
    // 对应后端生命周期：last_access_at + 30 天 LRU 自动清理（见 GenerationJobLruCleaner）。
  }, []);

  const handleAddToLibrary = async (id: string, url: string) => {
    if (savedToLibraryIds.has(id)) return;
    setSavingIds(prev => new Set(prev).add(id));
    try {
      // url 通常是 GCS 直链 / /img/<key> 反代路径，直接喂给 <img>.src 会让 canvas 被 taint
      // → toDataURL 抛 SecurityError → 按钮永远 pending。先 fetch 同源代理拿到 blob → data URI。
      const dataUri = await fetchAsDataUri(url);
      const compressedUrl = await compressForStorage(dataUri);

      const response = await authService.fetchWithAuth('/api/image/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUri: compressedUrl })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.msg || errorData.error || 'Failed to save to library');
      }

      const body = await response.json();
      // 后端 BizException 走 GlobalExceptionHandler 时仍是 HTTP 200，但 code != 0
      // （如个人模特库已满会返回 code=CONFLICT，msg="个人模特库已满（5/5），请先删除后再上传"）
      // 必须显式检查 code 字段，否则 newModel.url 会是 undefined，列表里会出现脏数据。
      if (body && typeof body.code === 'number' && body.code !== 0) {
        throw new Error(body.msg || '存入模特库失败');
      }
      const newModel = body.data || body;
      setModelLibrary(prev => [{ id: newModel.id as number, url: newModel.url as string }, ...prev]);
      setSavedToLibraryIds(prev => new Set(prev).add(id));
      setIsLibraryOpen(true);
    } catch (err: any) {
      console.error("Save to library failed:", err);
      alert(err.message || "存入模特库失败");
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  /**
   * 删除模特库中的一条模特。
   *
   * scope='personal'：直接从 modelLibrary state 取已存储的 id 发 DELETE，
   *   不再重新 GET 列表 + URL 比对（旧方案在 GCS presigned 模式下 URL 每次不同，比对失败 → DELETE
   *   从未发出，后端模特仍在，上限计数不减，下次上传仍报"已满"）。
   *
   * scope='group'：组模特 id 在 Phase1 的 groupModels 子 state 中，父组件无法直接访问；
   *   改用路径规范化比较（strip query params），兼容 presigned URL。
   */
  const handleDeleteFromLibrary = async (e: React.MouseEvent, url: string, scope: 'personal' | 'group' = 'personal') => {
    e.preventDefault();
    e.stopPropagation();

    setHoveredModel(null);
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);

    try {
      let modelId: number | undefined;

      if (scope === 'personal') {
        // 直接从本地 state 取 id，无需重新 GET
        const entry = modelLibrary.find(m => m.url === url);
        if (!entry) {
          setModelLibrary(prev => prev.filter(m => m.url !== url));
          return;
        }
        modelId = entry.id;
      } else {
        // group scope：重新 GET 列表，用路径规范化比较兼容 presigned URL
        const response = await authService.fetchWithAuth('/api/image/models?scope=group');
        if (!response.ok) throw new Error('Failed to fetch group models for deletion');
        const body = await response.json();
        const models: any[] = body.data || body;
        const urlPath = (u: string) => { try { return new URL(u, window.location.origin).pathname; } catch { return u; } };
        const found = models.find(m => urlPath(m.url) === urlPath(url));
        if (!found) return;
        modelId = found.id;
      }

      const delResponse = await authService.fetchWithAuth(`/api/image/models/${modelId}`, {
        method: 'DELETE',
      });
      if (!delResponse.ok) {
        const errorData = await delResponse.json().catch(() => ({}));
        throw new Error(errorData.msg || errorData.error || 'Failed to delete model');
      }

      if (scope === 'personal') {
        setModelLibrary(prev => prev.filter(m => m.url !== url));
      }
      // group scope 的本地 state 由 Phase1 的 refetchGroupModels 负责回填
    } catch (err: any) {
      console.error("Delete from library failed:", err);
      alert(err.message || "删除失败");
    }
  };

  const selectFromLibrary = (url: string) => {
    setPreviews(prev => ({ ...prev, model: url }));
    setInputs(prev => ({ ...prev, model: url as any }));
  };

  const onModelMouseEnter = (url: string, e: React.MouseEvent) => {
    const { clientX: x, clientY: y } = e;
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredModel({ url, x, y });
    }, 2000);
  };

  const onModelMouseMove = (e: React.MouseEvent) => {
    if (hoveredModel) {
      setHoveredModel(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
    }
  };

  const onModelMouseLeave = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    setHoveredModel(null);
  };

  const handleDeleteImage = (phase: 0 | 1 | 2, id: string, url?: string) => {
    if (phase === 0) setResultsPhase0(prev => prev.filter(img => img.id !== id));
    else if (phase === 1) {
      setResultsPhase1(prev => prev.filter(img => img.id !== id));
      if (url) setP2Settings(prev => ({ ...prev, selectedBaseImages: prev.selectedBaseImages.filter(u => u !== url) }));
    } else setResultsPhase2(prev => prev.filter(img => img.id !== id));
  };

  const getFriendlyError = (error: any): string => {
    const msg = error?.message || "";
    const name = error?.name || "";
    // V5.XV.9: 网络层失败（fetch 拿不到任何响应）—— 网关 / 上游不可达，区分于"业务 502"
    // V5.XVII.E：api.ts 现在会把"请求体 > 8MB"提示拼进 message，这里据此分流，
    // 避免 gateway 在跑却报"网关未启动"误导。
    if (name === 'TypeError' && msg.includes('Failed to fetch')) {
      if (msg.includes('请求体 >')) {
        return "请求体过大（多张参考图 base64 累加），浏览器或开发代理直接断开了连接。请减少参考图数量、压缩图片，或先把图片落盘后用短链复用。";
      }
      return "网关连接失败：tbfirst-gateway 未启动或不可达。请检查后端服务是否在跑（localhost:8000）。完整错误已打到浏览器控制台。";
    }
    if (name === 'AbortError' || msg.includes('aborted')) {
      return "请求超时或被中止，请重试";
    }
    if (msg.includes('NetworkError')) return "网络异常，请检查连接后重试";
    if (msg.includes("API_KEY_INVALID")) return "API 密钥无效或未找到";
    if (msg.includes("quota")) return "API 配额已耗尽，请检查账单";
    if (msg.includes("safety") || msg.includes("blocked")) return "触及安全策略拦截";
    if (msg.includes("overloaded") || msg.includes("503")) return "服务器繁忙，请稍后重试";
    if (msg.includes('HTTP 502') || msg.includes('HTTP 504')) return "上游服务暂时不可用，请稍后重试";
    if (msg.includes('HTTP 413') || msg.includes('too large')) return "请求体过大，请减少参考图数量或降低分辨率后重试";
    return msg ? `生成失败：${msg.slice(0, 120)}` : "生成失败，请检查配置";
  };

  const handleRetryImage = async (img: GeneratedImage) => {
    const setter = img.phase === 0 ? setResultsPhase0 : img.phase === 1 ? setResultsPhase1 : setResultsPhase2;
    setter(prev => prev.map(i => i.id === img.id ? { ...i, status: 'pending', errorMessage: undefined } : i));
  };

  const handleP0Success = (url: string) => {
    setPreviews(prev => {
      const existing = prev.product;
      const currentList = Array.isArray(existing) ? existing : (existing ? [existing] : []);
      return { ...prev, product: [...currentList, url] };
    });
    setInputs(prev => {
      const existing = prev.product || [];
      return { ...prev, product: [...existing, url as any] };
    });
    creationSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleSelectionForRefine = (img: GeneratedImage) => {
    let shouldScroll = false;
    setP2Settings(prev => {
      const isAlreadySelected = prev.selectedBaseImages.includes(img.url);
      if (!isAlreadySelected && prev.selectedBaseImages.length === 0) shouldScroll = true;
      const newImages = isAlreadySelected ? prev.selectedBaseImages.filter(u => u !== img.url) : [...prev.selectedBaseImages, img.url];
      return { ...prev, selectedBaseImages: newImages, aspectRatio: img.aspectRatio, actions: prev.actions.length > 0 ? prev.actions : [ACTIONS[1].value] };
    });
    if (shouldScroll) setTimeout(() => refinementSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  };

  const toggleAction = (val: string) => {
    setP2Settings(prev => {
      const isSelected = prev.actions.includes(val);
      return { ...prev, actions: isSelected ? prev.actions.filter(a => a !== val) : [...prev.actions, val] };
    });
  };

  const handleDetailFocusChange = (val: string) => {
    setP2Settings(prev => {
      let newFocus = prev.focus;
      const isUpper = LIFESTYLE_DETAILS[0].options.some(o => o.value === val);
      const isAccessory = LIFESTYLE_DETAILS[1].options.some(o => o.value === val);
      const isLower = LIFESTYLE_DETAILS[2].options.some(o => o.value === val);
      if (isUpper || isAccessory) newFocus = FOCUS_OPTIONS[1].value;
      else if (isLower) newFocus = FOCUS_OPTIONS[2].value;
      return { ...prev, detailFocus: val, focus: newFocus };
    });
  };

  const handleFabricDetailChange = (val: string) => {
    setP2Settings(prev => ({ ...prev, fabricDetail: val, focus: val ? FOCUS_OPTIONS[1].value : prev.focus }));
  };

  const handleInpaintSave = (newUrl: string, promptUsed: string) => {
    if (!inpaintTarget) return;

    const newImage: GeneratedImage = {
      id: `${inpaintTarget.id}-fix-${Date.now()}`,
      taskId: inpaintTarget.taskId,
      taskNumber: inpaintTarget.taskNumber,
      url: newUrl,
      promptUsed: promptUsed,
      aspectRatio: inpaintTarget.aspectRatio,
      phase: inpaintTarget.phase,
      status: 'done',
      actionLabel: '局部修补'
    };

    // V5.XIV.7: 按 phase 路由到正确的 results bucket（修复原逻辑把 phase3 fall through 到
    // setResultsPhase2 的 bug，导致 Phase3 局部重绘结果错落 Phase2 库）
    const setter = inpaintTarget.phase === 0 ? setResultsPhase0
      : inpaintTarget.phase === 1 ? setResultsPhase1
      : inpaintTarget.phase === 3 ? setResultsPhase3
      : setResultsPhase2;
    setter(prev => {
      const idx = prev.findIndex(img => img.id === inpaintTarget.id);
      if (idx === -1) return [newImage, ...prev];
      const newArr = [...prev];
      newArr.splice(idx, 0, newImage);
      return newArr;
    });
  };

  const handleApplyPrompt = (prompt: string) => {
    const scrollPos = window.scrollY;
    if (scrollPos < 800) {
      setP0Settings(prev => ({ ...prev, remark: prompt }));
    } else if (scrollPos < 1800) {
      setP1Settings(prev => ({ ...prev, remark: prompt }));
    } else if (scrollPos < 2800) {
      setP2Settings(prev => ({ ...prev, remark: prompt }));
    } else {
      // Phase3 影调大师区域：把 Copilot 输出落到控制面板的"补充描述"字段
      setP3Settings(prev => ({ ...prev, remark: prompt }));
    }
  };

  const renderScaleMarks = () => (
    <div className="flex justify-between px-1 mt-1 text-[10px] font-bold text-slate-400 select-none">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <span key={n}>{n}</span>)}
    </div>
  );

  const renderImageItem = (img: GeneratedImage, index: number, phase: 0 | 1 | 2) => {
    const isSelected = p2Settings.selectedBaseImages.includes(img.url);
    const isSaving = savingIds.has(img.id);
    const isSaved = savedToLibraryIds.has(img.id);

    if (img.status === 'pending' || img.status === 'queued') {
      return (
        <div key={img.id} className="bg-slate-50 rounded-3xl flex flex-col items-center justify-center border border-slate-100 relative transition-all duration-500 animate-pulse" style={{ aspectRatio: img.aspectRatio.replace(':', '/') }}>
          <div className="absolute top-4 left-4 z-10">
            <span className={`text-white text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest shadow-sm ${phase === 0 ? 'bg-emerald-500' : phase === 1 ? 'bg-indigo-500' : 'bg-purple-500'}`}>
              任务 #{img.taskNumber || index + 1}
            </span>
          </div>
          <div className={`w-10 h-10 border-4 rounded-full mb-3 animate-spin ${phase === 0 ? 'border-emerald-100 border-t-emerald-600' : 'border-indigo-200 border-t-indigo-600'}`}></div>
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center px-4">{img.actionLabel || '生成中...'}</span>
        </div>
      );
    }

    if (img.status === 'error') {
      return (
        <div key={img.id} className="bg-red-50 rounded-3xl p-6 flex flex-col items-center justify-center border border-red-100 text-center" style={{ aspectRatio: img.aspectRatio.replace(':', '/') }}>
          <p className="text-xs font-bold text-red-800 mb-2">生成失败</p>
          <p className="text-[10px] text-red-500 mb-4">{img.errorMessage}</p>
          <div className="flex gap-2 w-full">
            <button onClick={() => handleRetryImage(img)} className="flex-1 py-2 bg-red-600 text-white rounded-xl text-[10px] font-bold">重试</button>
            <button onClick={() => handleDeleteImage(phase, img.id, img.url)} className="px-3 py-2 bg-white text-red-600 border border-red-200 rounded-xl text-[10px] font-bold">删除</button>
          </div>
        </div>
      );
    }

    const [wPart, hPart] = img.aspectRatio.split(':').map(Number);
    // Wide images (16:9, 21:9, h/w < 0.65) switch to horizontal row so buttons fit in shorter height.
    // Portrait/square (3:4, 1:1, 4:3 etc.) keep the vertical stack.
    const wide = hPart / wPart < 0.65;
    // Shared button size: compact for wide, full for portrait
    const btnCls = wide
      ? 'flex-1 py-2 text-[11px] font-bold rounded-xl transition-all active:scale-95'
      : 'w-full py-3 text-sm font-bold rounded-xl shadow-xl transition-all active:scale-95';

    return (
      <div
        key={img.id}
        className="group relative rounded-[2rem] overflow-hidden shadow-md hover:shadow-2xl transition-all cursor-zoom-in bg-slate-50 border border-slate-100"
        onClick={() => { setViewingCollection(phase === 0 ? 'p0' : phase === 1 ? 'p1' : 'p2'); setViewingIndex(index); }}
      >
        <img src={toProxiedSrc(img.url)} onError={makeImgErrorFallback()} className="w-full h-auto block" alt="Result" />

        <div className="absolute top-4 left-4 z-10">
          <span className={`text-white text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest shadow-lg backdrop-blur-sm ${phase === 0 ? 'bg-emerald-600/90' : phase === 1 ? 'bg-indigo-600/90' : 'bg-purple-600/90'}`}>
            任务 #{img.taskNumber || index + 1}
          </span>
        </div>

        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300">
          <button
           onClick={(e) => { e.stopPropagation(); handleDeleteImage(phase, img.id, img.url); }}
           className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-all shadow-xl active:scale-90 z-10"
           title="删除此图片"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Action buttons — horizontal row for wide images, vertical stack for portrait */}
          <div className={wide
            ? 'absolute bottom-0 left-0 right-0 flex flex-row items-stretch gap-1.5 p-2'
            : 'absolute bottom-0 left-0 right-0 flex flex-col gap-2.5 p-5'
          }>
            <button
              onClick={(e) => { e.stopPropagation(); setInpaintTarget(img); }}
              className={`${btnCls} bg-white/20 backdrop-blur-md text-white border border-white/30 hover:bg-white/30 flex items-center justify-center gap-1.5`}
            >
              {!wide && <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
              局部修补
            </button>

            {phase === 2 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); sendToGradeMaster(img); }}
                  className={`${btnCls} ${p3Queue.some(i => i.id === img.id) ? 'bg-rose-600 text-white' : 'bg-white text-rose-600 hover:bg-rose-50 border border-rose-200'}`}
                >
                  {p3Queue.some(i => i.id === img.id) ? (wide ? '已送精修' : '已送往影调精修') : (wide ? '影调精修' : '影调精修 (Rose)')}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAddToLibrary(img.id, img.url); }}
                  disabled={isSaving || isSaved}
                  className={`${btnCls} flex items-center justify-center ${isSaved ? 'bg-green-500 text-white' : 'bg-white/20 backdrop-blur-md text-white border border-white/30 hover:bg-white/30'}`}
                >
                  {isSaving ? (wide ? '存入中' : '正在存入...') : isSaved ? (wide ? '已存入' : '已存入个人模特库') : (wide ? '存入模特库' : '存入个人模特库')}
                </button>
              </>
            )}

            {phase === 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSelectionForRefine(img); }}
                  className={`${btnCls} ${isSelected ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
                >
                  {isSelected ? (wide ? '已选参考' : '已选为精修参考') : (wide ? '精修参考' : '设为精修参考')}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAddToLibrary(img.id, img.url); }}
                  disabled={isSaving || isSaved}
                  className={`${btnCls} flex items-center justify-center ${isSaved ? 'bg-green-500 text-white' : 'bg-white/20 backdrop-blur-md text-white border border-white/30 hover:bg-white/30'}`}
                >
                  {isSaving ? (wide ? '存入中' : '正在存入...') : isSaved ? (wide ? '已存入' : '已存入个人模特库') : (wide ? '存入模特库' : '存入个人模特库')}
                </button>
              </>
            )}

            {phase === 0 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleP0Success(img.url); }}
                  className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}
                >
                  {wide ? '作为主产品' : '作为 Phase 1 主产品'}
                </button>
                {img.dnaUsed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); alert(`工业制版 DNA 说明书:\n${img.dnaUsed}`); }}
                    className={`${btnCls} bg-white/20 backdrop-blur-md text-white border border-white/30 hover:bg-white/30`}
                  >
                    {wide ? '制版DNA' : '查看制版 DNA'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <ConnectionManager onReconnect={handleReconnect} />

      {keyReady && (
        <>
          {showGuide && <ProductGuide onClose={() => setShowGuide(false)} />}

          {inpaintTarget && (
            <InpaintModal
              originalImageUrl={inpaintTarget.url}
              originalAspectRatio={inpaintTarget.aspectRatio}
              onClose={() => setInpaintTarget(null)}
              onSave={handleInpaintSave}
              getFriendlyError={getFriendlyError}
            />
          )}

          {assetPreviewUrl && (
            <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-8" onClick={() => setAssetPreviewUrl(null)}>
              <img src={toProxiedSrc(assetPreviewUrl)} onError={makeImgErrorFallback()} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" alt="Preview" />
            </div>
          )}

          {hoveredModel && (
            <div className="fixed z-[100] pointer-events-none shadow-2xl rounded-2xl overflow-hidden border-4 border-white bg-white" style={{ left: hoveredModel.x + 20, top: hoveredModel.y - 100, width: '240px' }}>
              <img src={toProxiedSrc(hoveredModel.url)} onError={makeImgErrorFallback()} className="w-full h-full object-cover aspect-[3/4]" alt="Magnified" />
            </div>
          )}

          <header className="bg-white/90 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 shadow-sm h-16 flex items-center">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex items-center justify-between">
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg">B</div>
                <span className="font-bold text-xl tracking-tight">BrandGenius AI</span>
              </div>
              <div className="hidden md:flex items-center gap-4">
                 <button onClick={() => setShowGuide(true)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-2">产品说明</button>
                 <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-full text-xs font-bold text-slate-500 mr-4">
                    <button onClick={() => assetStudioSectionRef.current?.scrollIntoView({ behavior: 'smooth' })} className="px-4 py-2 rounded-full hover:bg-white hover:text-emerald-600 transition-all">0.工厂</button>
                    <button onClick={() => creationSectionRef.current?.scrollIntoView({ behavior: 'smooth' })} className="px-4 py-2 rounded-full hover:bg-white hover:text-indigo-600 transition-all">1.创意</button>
                    <button onClick={() => refinementSectionRef.current?.scrollIntoView({ behavior: 'smooth' })} className="px-4 py-2 rounded-full hover:bg-white hover:text-purple-600 transition-all">2.精修</button>
                    <button onClick={() => gradeMasterSectionRef.current?.scrollIntoView({ behavior: 'smooth' })} className="px-4 py-2 rounded-full hover:bg-white hover:text-rose-600 transition-all">3.调色</button>
                 </nav>
                 <CurrentUserBadge className="mr-1" />
                 <button onClick={() => setIsHistoryOpen(true)} className="text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors" title="查看过去 30 天内所有未清理的生图记录，可在此下载并收藏">历史生图</button>
                 {/* 组徽章：已加入组的用户可快捷进入 /group；未加入组的显示"申请 / 邀请"入口 */}
                 {currentUser?.groupId ? (
                   <button
                     onClick={() => navigate('/group')}
                     className="text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                     title="进入资源共享组管理页"
                   >
                     {currentUser.groupName || '组'} · {currentUser.groupRole === 'leader' ? '组长' : '组员'}
                   </button>
                 ) : (
                   <button
                     onClick={() => navigate('/group')}
                     className="text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors"
                     title="申请成立组或查看收到的邀请"
                   >
                     共享组
                   </button>
                 )}
                 {(appUser?.role === 'admin' || currentUser?.role === 'admin') && (
                   <button onClick={() => navigate('/admin')} className="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors">Admin</button>
                 )}
                 <button onClick={() => authService.logout()} className="text-sm font-bold text-slate-500 hover:text-red-600 transition-colors">退出登录</button>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-4 py-12">
            {/* V5.XVII.D：每个 Phase 块挂 data-phase 锚点，CopilotContainer 用
                IntersectionObserver 探视口中线决定 activePhase；替换原硬编码 scrollY 阈值 */}
            <section data-phase="0">
              <Phase0
                inputs={inputs} setInputs={setInputs}
                previews={previews} setPreviews={setPreviews}
                inputLabels={inputLabels} setInputLabels={setInputLabels}
                settings={p0Settings} setSettings={setP0Settings}
                results={resultsPhase0} setResults={setResultsPhase0}
                setKeyReady={setKeyReady}
                getFriendlyError={getFriendlyError}
                renderImageItem={renderImageItem}
                sectionRef={assetStudioSectionRef}
                resultsRef={resultsRef0}
              />
            </section>

            <section data-phase="1">
              <Phase1
                inputs={inputs} setInputs={setInputs}
                previews={previews} setPreviews={setPreviews}
                inputLabels={inputLabels} setInputLabels={setInputLabels}
                settings={p1Settings} setSettings={setP1Settings}
                results={resultsPhase1} setResults={setResultsPhase1}
                modelLibrary={modelLibrary} setModelLibrary={setModelLibrary}
                isLibraryOpen={isLibraryOpen} setIsLibraryOpen={setIsLibraryOpen}
                selectFromLibrary={selectFromLibrary}
                handleDeleteFromLibrary={handleDeleteFromLibrary}
                onModelMouseEnter={onModelMouseEnter}
                onModelMouseMove={onModelMouseMove}
                onModelMouseLeave={onModelMouseLeave}
                setKeyReady={setKeyReady}
                getFriendlyError={getFriendlyError}
                renderImageItem={renderImageItem}
                renderScaleMarks={renderScaleMarks}
                sectionRef={creationSectionRef}
                resultsRef={resultsRef1}
                lastCompositionIntent={lastCompositionIntent}
                setLastCompositionIntent={setLastCompositionIntent}
              />
            </section>

            <div ref={refinementSectionRef} data-phase="2" className="mt-24 relative">
              <div className="flex justify-center mb-8 sticky top-20 z-20">
                 <div className="bg-white/80 backdrop-blur-md p-1.5 rounded-2xl shadow-xl shadow-indigo-100/50 border border-white flex gap-1 items-center">
                    <button
                      onClick={() => setPhase2Mode('standard')}
                      className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${phase2Mode === 'standard' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-400 hover:text-purple-600 hover:bg-purple-50'}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                      标准精修
                    </button>
                    <div className="w-px h-4 bg-slate-200 mx-1"></div>
                    <button
                      onClick={() => setPhase2Mode('color')}
                      className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${phase2Mode === 'color' ? 'bg-pink-500 text-white shadow-lg' : 'text-slate-400 hover:text-pink-600 hover:bg-pink-50'}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg>
                      色彩实验室
                    </button>
                 </div>
              </div>

              {phase2Mode === 'standard' ? (
                <Phase2
                  settings={p2Settings} setSettings={setP2Settings}
                  results={resultsPhase2} setResults={setResultsPhase2}
                  toggleAction={toggleAction}
                  handleFabricDetailChange={handleFabricDetailChange}
                  handleDetailFocusChange={handleDetailFocusChange}
                  setAssetPreviewUrl={setAssetPreviewUrl}
                  setKeyReady={setKeyReady}
                  getFriendlyError={getFriendlyError}
                  renderImageItem={renderImageItem}
                  renderScaleMarks={renderScaleMarks}
                  sectionRef={null}
                  resultsRef={resultsRef2}
                  _lastCompositionIntent={lastCompositionIntent}
                  _setLastCompositionIntent={setLastCompositionIntent}
                />
              ) : (
                <Phase2Color
                  baseSettings={p2Settings} setBaseSettings={setP2Settings}
                  colorSettings={p2ColorSettings} setColorSettings={setP2ColorSettings}
                  results={resultsPhase2} setResults={setResultsPhase2}
                  setAssetPreviewUrl={setAssetPreviewUrl}
                  setKeyReady={setKeyReady}
                  getFriendlyError={getFriendlyError}
                  renderImageItem={renderImageItem}
                  resultsRef={resultsRef2}
                />
              )}
            </div>

            {/* Phase 3: 影调大师 */}
            <div data-phase="3" className="mt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full pb-8">
              <Phase3
                p3Settings={p3Settings}
                setP3Settings={setP3Settings}
                p3Queue={p3Queue}
                resultsPhase3={resultsPhase3}
                setResultsPhase3={setResultsPhase3}
                removeFromP3Queue={removeFromP3Queue}
                onLocalImport={handleP3LocalImport}
                onInspirationChange={handleP3InspirationChange}
                onExtractDNA={handleP3ExtractDNA}
                onBatchRender={handleBatchRender}
                isAnalyzing={isP3Analyzing}
                isRendering={isP3Rendering}
                sectionRef={gradeMasterSectionRef}
                onOpenModal={(imgs, idx) => { setViewingCollection('p3'); setViewingIndex(idx); }}
                currentRenderSig={p3RenderSig(p3Settings)}
                lastRenderSig={lastP3RenderSig}
              />
            </div>

            {viewingCollection && (
              <ImageModal
                images={viewingCollection === 'p0' ? resultsPhase0 : viewingCollection === 'p1' ? resultsPhase1 : viewingCollection === 'p3' ? resultsPhase3 : resultsPhase2}
                currentIndex={viewingIndex}
                onNavigate={setViewingIndex}
                onClose={() => setViewingCollection(null)}
                onRefine={toggleSelectionForRefine}
                selectedBaseImages={p2Settings.selectedBaseImages}
                onSendToTone={sendToGradeMaster}
                p3Queue={p3Queue}
                onInpaint={(img) => { setViewingCollection(null); setInpaintTarget(img); }}
              />
            )}

            <CopilotContainer
              inputs={inputs}
              p1Settings={p1Settings}
              p2Settings={p2Settings}
              p3Settings={p3Settings}
              onApplyPrompt={handleApplyPrompt}
            />

            {isHistoryOpen && <HistoryModal onClose={() => setIsHistoryOpen(false)} />}
          </main>
        </>
      )}

      <ServiceSwitcher currentHref="/workspace" />
    </div>
  );
};

export default Workspace;
