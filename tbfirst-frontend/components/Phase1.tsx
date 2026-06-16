/**
 * Phase1.tsx — Phase 1 营销创意生成组件
 */
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Phase1Settings, GeneratedImage, InputFiles, InputLabels, ImageSize, ResolvedCompositionIntent } from '../types';
import { SHOT_TYPES, TONES, ATMOSPHERES, ASPECT_RATIOS, IMAGE_SIZES, getTargetsByShotType, deriveScopeIntentFromShot } from '../constants';
import { toProxiedSrc, makeImgErrorFallback } from '../services/shared/imageSrc';
import { preparePhase1Parts, generateSinglePhase1Image, applyPoseToPhase1Result, VARIATION_HINTS } from '../services/geminiService';
import { fileToDataUri } from '../services/shared/imagePartUtils';
import { uploadFilesToGcs, compressImage } from '../services/uploadService';
import { inferCompositionFromText, mergeInferredComposition, resolveCompositionIntent } from '../services/shared/compositionIntent';
import { auditService } from '../services/auditService';
import { authService } from '../features/Auth/authService';
import { ImageTagger } from './ImageTagger';
import GarmentAttrsForm from './GarmentAttrsForm';
import type { GarmentAttrs } from '../types';

interface Phase1Props {
  inputs: InputFiles; setInputs: React.Dispatch<React.SetStateAction<InputFiles>>;
  previews: {[key: string]: string | string[]}; setPreviews: React.Dispatch<React.SetStateAction<{[key: string]: string | string[]}>>;
  inputLabels: InputLabels; setInputLabels: React.Dispatch<React.SetStateAction<InputLabels>>;
  settings: Phase1Settings; setSettings: React.Dispatch<React.SetStateAction<Phase1Settings>>;
  results: GeneratedImage[]; setResults: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
  modelLibrary: Array<{ id: number; url: string }>; setModelLibrary: React.Dispatch<React.SetStateAction<Array<{ id: number; url: string }>>>;
  isLibraryOpen: boolean; setIsLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectFromLibrary: (url: string) => void;
  handleDeleteFromLibrary: (e: React.MouseEvent, url: string, scope?: 'personal' | 'group') => Promise<void> | void;
  onModelMouseEnter: (url: string, e: React.MouseEvent) => void;
  onModelMouseMove: (e: React.MouseEvent) => void;
  onModelMouseLeave: () => void;
  setKeyReady: (ready: boolean) => void;
  getFriendlyError: (error: any) => string;
  renderImageItem: (img: GeneratedImage, index: number, phase: 0 | 1 | 2) => React.ReactNode;
  renderScaleMarks: () => React.ReactNode;
  sectionRef: React.RefObject<HTMLDivElement | null>;
  resultsRef: React.RefObject<HTMLDivElement | null>;
  lastCompositionIntent?: ResolvedCompositionIntent | null;
  setLastCompositionIntent?: React.Dispatch<React.SetStateAction<ResolvedCompositionIntent | null>>;
}

export const Phase1: React.FC<Phase1Props> = ({
  inputs, setInputs, previews, setPreviews, inputLabels, setInputLabels, settings, setSettings, results, setResults,
  modelLibrary, setModelLibrary, isLibraryOpen, setIsLibraryOpen,
  selectFromLibrary, handleDeleteFromLibrary, onModelMouseEnter, onModelMouseMove, onModelMouseLeave,
  setKeyReady, getFriendlyError, renderImageItem, renderScaleMarks, sectionRef, resultsRef,
  lastCompositionIntent, setLastCompositionIntent,
}) => {
  // === 参考图标签：读 / 写辅助 ===
  // 对于多图字段（product / accessory），用 { field, index } 定位到数组槽。
  // 对于单图字段（model / scene），index 省略。空串 = 清除标签。
  const getLabelAt = (field: keyof InputLabels, index?: number): string => {
    const v = inputLabels[field] as any;
    if (Array.isArray(v)) return (index != null ? v[index] : '') || '';
    return (v as string) || '';
  };
  const setLabelAt = (field: keyof InputLabels, value: string, index?: number) => {
    setInputLabels(prev => {
      if (index == null) {
        return { ...prev, [field]: value || undefined };
      }
      const arr = [...((prev[field] as string[]) || [])];
      while (arr.length <= index) arr.push('');
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  };
  // 删除某一槽的图时，标签同步清理以防索引错位
  const removeLabelAt = (field: keyof InputLabels, index?: number) => {
    setInputLabels(prev => {
      if (index == null) {
        const { [field]: _, ...rest } = prev as any;
        return rest;
      }
      const arr = [...((prev[field] as string[]) || [])];
      if (index < arr.length) arr.splice(index, 1);
      return { ...prev, [field]: arr };
    });
  };

  /**
   * Phase1 各槽的默认标签（中文，用户友好；后端 prompt 采用 role-based 语言，
   * 不再 hard-code 英文 label 字符串，所以中文也能被正确识别 —— 见 #41.5）。
   * 用户可直接在输入框里改成任何字符串（英文 / 更具体的描述都行）。
   */
  const getDefaultLabel = (field: string, index?: number): string => {
    if (field === 'model') return '主模特';
    if (field === 'scene') return '场景';
    if (field === 'product') return `主产品 #${(index ?? 0) + 1}`;
    if (field === 'accessory') return `品牌配饰 #${(index ?? 0) + 1}`;
    return '';
  };
  // 旧 session 里 inputLabels.product / .accessory 可能残留英文默认（#41.4 时代），
  // 用户如果没手动改过这些，就一次性迁移到中文，免得 UI 新老混杂。
  // 识别标准：完全等于老英文默认 → 覆盖为新中文默认。
  useEffect(() => {
    const OLD_ENGLISH_PREFIXES: Record<string, string> = {
      product: 'Main Product Garment #',
      accessory: 'Brand Accessory #',
    };
    setInputLabels(prev => {
      let changed = false;
      const next: any = { ...prev };
      (['product', 'accessory'] as const).forEach(f => {
        const arr = (prev[f] as string[]) || [];
        const migrated = arr.map((v, i) => {
          const oldDefault = `${OLD_ENGLISH_PREFIXES[f]}${i + 1}`;
          if (v === oldDefault) {
            changed = true;
            return getDefaultLabel(f, i);
          }
          return v;
        });
        if (changed) next[f] = migrated;
      });
      if ((prev as any).model === 'Main Model Identity') { next.model = '主模特'; changed = true; }
      if ((prev as any).scene === 'Background/Environment') { next.scene = '场景'; changed = true; }
      return changed ? next : prev;
    });
    // 仅首次 mount 迁移一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const accessoryInputRef = useRef<HTMLInputElement>(null);
  const poseRefInputRef = useRef<HTMLInputElement>(null);
  const [poseRefUrl, setPoseRefUrl] = useState<string | null>(null);
  const [poseRefUploading, setPoseRefUploading] = useState(false);
  const inputRefs: Record<string, React.RefObject<HTMLInputElement | null>> = { model: modelInputRef, library: libraryInputRef, scene: sceneInputRef, product: productInputRef, accessory: accessoryInputRef };

  const processFiles = async (field: string, files: File[], multiple: boolean) => {
    if (files.length === 0) return;
    if (field === 'library') {
      // 新规则（errorConclude #38）：上传动作由 Service 层按 scope + 角色判容量；
      // 前端不再卡"没有 image:manage-models 权限"的 UI 闸门，所有已登录用户都能上传到自己的个人库。
      // 组库场景要求当前用户必须有 groupId（上传失败会由后端 403）。
      try {
        const compressed = await Promise.all(files.map(compressImage));
        const uris = await Promise.all(compressed.map(fileToDataUri));
        for (const uri of uris) {
          const response = await authService.fetchWithAuth(
            `/api/image/models?scope=${libraryScope}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dataUri: uri }),
            }
          );
          if (response.ok) {
            const body = await response.json();
            const newModel = body.data || body;
            if (libraryScope === 'group') {
              setGroupModels(prev => [{ id: newModel.id, url: newModel.url, userId: newModel.userId }, ...prev]);
            } else {
              setModelLibrary(prev => [{ id: newModel.id as number, url: newModel.url as string }, ...prev]);
            }
          } else {
            const err = await response.json();
            throw new Error(err.msg || err.error || '上传失败');
          }
        }
      } catch (err: any) { console.error("Upload to library failed:", err); alert(err.message || "上传模特失败"); }
      return;
    }
    // 立即显示 blob 占位预览，inputs 等上传成功后再填（同 Phase0 策略）
    const fieldKey = field as keyof InputFiles;
    const blobUrls = files.map(f => URL.createObjectURL(f));
    if (multiple) {
      setPreviews(prev => {
        const existing = (prev[fieldKey] as string[] | undefined) || [];
        return { ...prev, [fieldKey]: [...existing, ...blobUrls] };
      });
      setInputLabels(prev => {
        const existingLabels = ((prev[field as keyof InputLabels] as string[]) || []).slice();
        const startIdx = existingLabels.length;
        for (let i = 0; i < files.length; i++) existingLabels.push(getDefaultLabel(field, startIdx + i));
        return { ...prev, [field as keyof InputLabels]: existingLabels };
      });
    } else {
      setPreviews(prev => ({ ...prev, [fieldKey]: blobUrls[0] }));
      const def = getDefaultLabel(field);
      if (def) setInputLabels(prev => ({ ...prev, [field as keyof InputLabels]: def }));
    }
    // 后台上传，完成后更新 inputs + 替换 previews 中的 blob URL
    let shortUrls: string[];
    try {
      shortUrls = await uploadFilesToGcs(files, 'phase1');
    } catch (err) {
      console.error('[Phase1] upload failed:', err);
      if (multiple) {
        setPreviews(prev => {
          const existing = (prev[fieldKey] as string[] | undefined) || [];
          return { ...prev, [fieldKey]: existing.filter(u => !blobUrls.includes(u)) };
        });
      } else {
        setPreviews(prev => ({ ...prev, [fieldKey]: undefined }));
      }
      blobUrls.forEach(u => URL.revokeObjectURL(u));
      alert('参考图上传失败，请检查网络或稍后重试');
      return;
    }
    blobUrls.forEach(u => URL.revokeObjectURL(u));
    if (multiple) {
      setInputs(prev => {
        const existing = (prev[fieldKey] as (File | string)[] | undefined) || [];
        return { ...prev, [fieldKey]: [...existing, ...shortUrls] };
      });
      setPreviews(prev => {
        const existing = [...((prev[fieldKey] as string[] | undefined) || [])];
        blobUrls.forEach((blob, i) => {
          const idx = existing.indexOf(blob);
          if (idx !== -1) existing[idx] = shortUrls[i];
        });
        return { ...prev, [fieldKey]: existing };
      });
    } else {
      setInputs(prev => ({ ...prev, [fieldKey]: shortUrls[0] }));
      setPreviews(prev => ({ ...prev, [fieldKey]: shortUrls[0] }));
    }
  };

  const handleFileChange = async (field: string, e: React.ChangeEvent<HTMLInputElement>, multiple: boolean) => {
    if (e.target.files && e.target.files.length > 0) { await processFiles(field, Array.from(e.target.files), multiple); e.target.value = ''; }
  };
  const handlePaste = async (field: string, e: React.ClipboardEvent, multiple: boolean) => {
    const items = e.clipboardData.items; const files: File[] = [];
    for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { const file = items[i].getAsFile(); if (file) files.push(file); } }
    if (files.length > 0) { e.preventDefault(); await processFiles(field, files, multiple); }
  };
  const handlePoseRefUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const blobUrl = URL.createObjectURL(file);
    setPoseRefUrl(blobUrl);
    setPoseRefUploading(true);
    try {
      const shortUrls = await uploadFilesToGcs([file], 'phase1');
      URL.revokeObjectURL(blobUrl);
      setPoseRefUrl(shortUrls[0]);
    } catch (err) {
      console.error('[Phase1] pose ref upload failed:', err);
      URL.revokeObjectURL(blobUrl);
      setPoseRefUrl(null);
      alert('参考图上传失败，请检查网络或稍后重试');
    } finally {
      setPoseRefUploading(false);
    }
  };

  const handleRemoveFile = (field: keyof InputFiles, index?: number) => {
    setInputs(prev => { const val = prev[field]; if (Array.isArray(val)) { const updated = [...val]; if (index !== undefined) updated.splice(index, 1); return { ...prev, [field]: updated }; } return { ...prev, [field]: undefined }; });
    setPreviews(prev => { const val = prev[field]; if (Array.isArray(val)) { const updated = [...val]; if (index !== undefined) updated.splice(index, 1); return { ...prev, [field]: updated }; } return { ...prev, [field]: undefined }; });
    // 标签同步清理，保持 inputs[i] ↔ labels[i] 对齐
    removeLabelAt(field as keyof InputLabels, index);
    // V5.XVI.10：删除 product[idx] 时同步把 garmentAttrs[idx] 也移除，避免索引漂移
    if (field === 'product') {
      setSettings(prev => {
        const arr = [...(prev.garmentAttrs ?? [])];
        if (typeof index === 'number') {
          arr.splice(index, 1);
          return { ...prev, garmentAttrs: arr };
        }
        return { ...prev, garmentAttrs: [] };
      });
    }
  };

  // V5.XVI.10：单条 product 缩略图下方的服装属性槽更新
  const updateGarmentAttrs = (idx: number, next: GarmentAttrs) => {
    setSettings(prev => {
      const arr = [...(prev.garmentAttrs ?? [])];
      arr[idx] = next;
      return { ...prev, garmentAttrs: arr };
    });
  };

  const [generatingIds] = useState(new Set<string>());
  const [canManage, setCanManage] = useState(false);

  // 单组制扩展（errorConclude #38）：在原 prop modelLibrary 之外再维护组库状态 & scope 切换
  const [libraryScope, setLibraryScope] = useState<'personal' | 'group'>('personal');
  const [groupModels, setGroupModels] = useState<Array<{ id: number; url: string; userId: number }>>([]);
  const [me, setMe] = useState<{
    userId: number | null;
    role: 'admin' | 'employee' | null;
    groupId: number | null;
    groupName: string | null;
    groupRole: string | null;
    personalModelCap: number | null;
    groupModelCap: number | null;
  }>({
    userId: null, role: null, groupId: null, groupName: null, groupRole: null,
    personalModelCap: null, groupModelCap: null,
  });
  useEffect(() => {
    const u = authService.getCurrentUser();
    if (u) {
      setMe({
        userId: u.userId,
        role: u.role ?? null,
        groupId: u.groupId ?? null,
        groupName: u.groupName ?? null,
        groupRole: (u.groupRole as any) ?? null,
        personalModelCap: (u as any).personalModelCap ?? null,
        groupModelCap: (u as any).groupModelCap ?? null,
      });
    }
  }, []);

  // 抽出组库刷新函数：供初次进入 scope='group'、窗口聚焦、20s 轮询、删除后复核共用。
  // 403 表示当前未加入组（比如在另一个标签页退组后 JWT 还没滚），直接退回 personal scope。
  const refetchGroupModels = useCallback(async () => {
    try {
      const resp = await authService.fetchWithAuth('/api/image/models?scope=group');
      if (!resp.ok) {
        setGroupModels([]);
        const body = await resp.json().catch(() => ({}));
        if (resp.status === 403) {
          alert(body?.msg || '当前未加入共享组，无法查看组模特库');
          setLibraryScope('personal');
        }
        return;
      }
      const body = await resp.json();
      const data = body.data || body || [];
      setGroupModels(data.map((m: any) => ({ id: m.id, url: m.url, userId: m.userId })));
    } catch (err) {
      console.error('fetch group models failed', err);
    }
  }, []);

  // 切到 group scope 时拉取组库；回到 personal 时清掉 state 避免显示过期
  useEffect(() => {
    if (libraryScope !== 'group') return;
    refetchGroupModels();
  }, [libraryScope, refetchGroupModels]);

  // scope='group' 期间保持同步：
  //   - 窗口/标签页重新获得焦点时立即 refetch（组长在另一端删除组员模特后切回本端即时可见）
  //   - 每 20s 轮询作为兜底（两端同时打开的场景）
  // scope 回到 personal 或组件卸载时自动清理，不产生无谓的请求。
  useEffect(() => {
    if (libraryScope !== 'group') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchGroupModels();
    };
    const onFocus = () => refetchGroupModels();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(refetchGroupModels, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [libraryScope, refetchGroupModels]);

  // 当前 scope 下应展示的模特列表（URL 数组，以兼容下游 selectFromLibrary 等签名）
  const activeUrls: string[] = libraryScope === 'group' ? groupModels.map(m => m.url) : modelLibrary.map(m => m.url);

  // 容量：优先用用户覆盖值；否则走角色默认。
  //   - 个人库：personalModelCap ?? (role=admin ? 50 : 5)
  //   - 组库：groupModelCap ?? 30
  const personalCap = me.personalModelCap ?? (me.role === 'admin' ? 50 : 5);
  const groupCap = me.groupModelCap ?? 30;
  const activeCap = libraryScope === 'group' ? groupCap : personalCap;

  /** 组库内某条模特当前用户是否可删：上传者本人 or 组长 */
  const canDeleteGroupItem = (url: string): boolean => {
    if (libraryScope !== 'group') return true;
    const m = groupModels.find(g => g.url === url);
    if (!m) return false;
    if (me.userId && m.userId === me.userId) return true;
    return me.groupRole === 'leader';
  };

  useEffect(() => {
    const user = authService.getCurrentUser();
    if (!user) return;

    // 2026-04-21 起权限回退到纯角色模型：仅 ADMIN 可以管模特库。
    // 先用本地缓存判一次，避免 /api/auth/me 在途时管理员看到无权限 UI 的闪烁；再回源一次纠正。
    const cachedAllowed = user.role === 'admin';
    console.info('[Phase1] cached user →', { role: user.role, allowed: cachedAllowed });
    if (cachedAllowed) {
      setCanManage(true);
      setIsLibraryOpen(true);
    }

    authService.getUserData(user.id).then(userData => {
      if (!userData) {
        console.warn('[Phase1] /api/auth/me returned null — 保留本地缓存判断');
        return;
      }
      const allowed = userData.role === 'admin';
      console.info('[Phase1] /api/auth/me →', { role: userData.role, allowed });
      setCanManage(allowed);
      if (allowed) setIsLibraryOpen(true);
    });
  }, []);

  React.useEffect(() => {
    const pending = results.filter(img => img.status === 'pending' && !generatingIds.has(img.id));
    if (pending.length > 0) { pending.forEach(img => { generatingIds.add(img.id); generateImage(img); }); }
  }, [results]);

  const generateImage = async (placeholder: GeneratedImage) => {
    try {
      const prepared = await preparePhase1Parts(inputs, settings, inputLabels);
      // 二步流判断：poseRef 必须已上传完成（非 blob、非上传中）才触发 Step 2
      const hasPoseRef = !!poseRefUrl && !poseRefUploading && !poseRefUrl.startsWith('blob:');

      const resolved = resolveCompositionIntent(
        { scope: settings.compositionScope, target: settings.compositionTarget },
        lastCompositionIntent ?? null,
      );
      const resolvedSettings = { ...settings, compositionScope: resolved.scope, compositionTarget: resolved.target };

      // 变体序号从 placeholder 直接读取，不依赖 results 闭包推算
      const variationIndex = placeholder.variationIndex ?? 0;
      const variationTotal = placeholder.variationTotal ?? 1;
      const variationHint = variationTotal > 1 ? VARIATION_HINTS[variationIndex % VARIATION_HINTS.length] : '';

      // Step 1：生成主产品穿着图（pose ref 不进 refs，由 Step 2 独立处理）
      const slotFlags = { hasModelRef: !!inputs.model, hasSceneRef: !!inputs.scene, hasPoseRef: false };
      console.info('[Phase1] Step1 start', { refs: prepared.refs.length, hasPoseRef });
      const baseResult = await generateSinglePhase1Image(
        prepared.refs, resolvedSettings, prepared.labels,
        { variationIndex, variationTotal, variationHint },
        slotFlags,
      );
      console.info('[Phase1] Step1 ok', { url: !!baseResult.url, hasPoseRef });

      if (!hasPoseRef) {
        // 第一类：无动作参考图，Step 1 结果即最终结果
        setResults(prev => prev.map(img => img.id === placeholder.id ? {
          ...img,
          url: baseResult.url,
          usedFallback: baseResult.usedFallback,
          status: 'done',
          actionLabel: `${resolved.scope} · ${resolved.target || '整体人物'}`,
        } : img));
        if (baseResult.url) {
          setLastCompositionIntent?.(resolved);
          auditService.logGeneration('Phase1', `Generated image`);
        }
      } else {
        // 第二类：有动作参考图，先展示底图（中间态），再执行 Step 2 应用姿态
        setResults(prev => prev.map(img => img.id === placeholder.id ? {
          ...img, url: baseResult.url, actionLabel: '动作应用中…',
        } : img));

        console.info('[Phase1] Step2 pose apply start');
        const poseResult = await applyPoseToPhase1Result(baseResult.url, poseRefUrl!, resolvedSettings);
        console.info('[Phase1] Step2 pose apply ok', { url: !!poseResult.url });

        setResults(prev => prev.map(img => img.id === placeholder.id ? {
          ...img,
          url: poseResult.url,
          usedFallback: false,
          status: 'done',
          actionLabel: `${resolved.scope} · ${resolved.target || '整体人物'} · 参考图姿态`,
        } : img));
        if (poseResult.url) {
          setLastCompositionIntent?.(resolved);
          auditService.logGeneration('Phase1', `Generated image with pose ref (2-step)`);
        }
      }
    } catch (error: any) {
      const msg: string = String(error?.message ?? error ?? 'unknown error');
      console.error('[Phase1] Generation Error:', error, 'extracted message =', msg);
      setResults(prev => prev.map(img => img.id === placeholder.id ? { ...img, status: 'error', errorMessage: getFriendlyError(error) } : img));
      if (msg.includes('API_KEY_INVALID')) setKeyReady(false);
    } finally { generatingIds.delete(placeholder.id); }
  };

  const handleGenerate = async () => {
    if (!inputs.product && !previews.product) { alert("请上传主产品图片"); return; }
    if (poseRefUploading) { alert("动作参考图正在上传中，请稍候再试"); return; }
    const taskId = `task-p1-${Date.now()}`;
    const currentMaxTaskNumber = results.reduce((max, img) => Math.max(max, img.taskNumber || 0), 0);
    const nextTaskNumber = currentMaxTaskNumber + 1;
    const placeholders: GeneratedImage[] = Array.from({ length: settings.count }).map((_, i) => ({ id: `${taskId}-${i}`, taskId, taskNumber: nextTaskNumber, url: '', promptUsed: settings.remark, aspectRatio: settings.aspectRatio, phase: 1, status: 'pending', variationIndex: i, variationTotal: settings.count }));
    setResults(prev => [...placeholders, ...prev]);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const renderUploadBox = (label: string, field: string, multiple: boolean = false) => {
    const preview = previews[field];
    const hasContent = multiple ? Array.isArray(preview) && preview.length > 0 : !!preview;
    return (
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</label>
        <div tabIndex={0} onPaste={(e) => handlePaste(field, e, multiple)} className={`group relative rounded-2xl border-2 border-dashed transition-all overflow-hidden flex flex-col items-center justify-center outline-none ring-offset-2 focus-within:ring-2 focus-within:ring-indigo-500 ${hasContent ? 'border-indigo-100 bg-indigo-50/20' : 'border-slate-200 bg-slate-50 hover:border-indigo-300 h-32'}`}>
          <input type="file" ref={inputRefs[field]} accept="image/*" multiple={multiple} className="hidden" onChange={(e) => handleFileChange(field, e, multiple)} />
          {multiple ? (
            <div className={`p-3 w-full flex flex-col ${hasContent ? '' : 'h-32 justify-center'}`}>
              {Array.isArray(preview) && preview.length > 0 ? (
                <div className="flex flex-nowrap overflow-x-auto gap-4 pb-2 no-scrollbar scroll-smooth">
                  {preview.map((src, i) => (
                    <div key={i} className="relative flex-shrink-0 w-40 flex flex-col">
                      <div className="relative rounded-xl overflow-hidden border border-white shadow-md group/item bg-slate-100">
                        <img src={src} className="w-full h-auto block" alt="prev" />
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveFile(field as keyof InputFiles, i); }} className="absolute top-1.5 right-1.5 p-1.5 bg-red-500 text-white rounded-lg shadow-xl opacity-0 group-hover/item:opacity-100 transition-all z-20"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                      </div>
                      <ImageTagger
                        value={getLabelAt(field as keyof InputLabels, i)}
                        onChange={(v) => setLabelAt(field as keyof InputLabels, v, i)}
                      />
                      {field === 'product' && (
                        <GarmentAttrsForm
                          value={settings.garmentAttrs?.[i]}
                          onChange={(v) => updateGarmentAttrs(i, v)}
                          compact
                        />
                      )}
                    </div>
                  ))}
                  <button onClick={() => inputRefs[field].current?.click()} className="flex-shrink-0 w-40 aspect-[3/4] rounded-xl bg-white border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-slate-300 gap-2 hover:text-indigo-600">
                    <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg></div>
                    <span className="text-[10px] font-bold">追加文件</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <button onClick={() => inputRefs[field].current?.click()} className="flex flex-col items-center group/btn">
                    <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-2 group-hover/btn:border-indigo-300 group-hover/btn:text-indigo-600 text-slate-400 transition-all"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg></div>
                    <p className="text-[11px] font-bold text-slate-500 group-hover/btn:text-indigo-600">点击上传</p><p className="text-[9px] text-slate-400 font-medium mt-0.5">或聚焦后粘贴</p>
                  </button>
                </div>
              )}
            </div>
          ) : hasContent ? (
            // 单图槽（model / scene）：重新挂 ImageTagger（#41.5），带中文默认标签；
            // processFiles 会在上传时把 inputLabels[field] 预填为 getDefaultLabel(field)，
            // 用户可直接改。
            <div className="w-full p-2 flex flex-col">
              <div className="relative group/item bg-slate-100 rounded-xl overflow-hidden">
                <img src={toProxiedSrc(preview as string)} onError={makeImgErrorFallback()} className="w-full h-auto block" alt="prev" />
                <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover/item:opacity-100 transition-all z-20">
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveFile(field as keyof InputFiles); }} className="p-2 bg-red-500 text-white rounded-xl shadow-lg hover:bg-red-600 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
              </div>
              <ImageTagger
                value={getLabelAt(field as keyof InputLabels)}
                onChange={(v) => setLabelAt(field as keyof InputLabels, v)}
                presets={field === 'model' ? ['主模特'] : field === 'scene' ? ['场景', '室内', '户外', '近景', '远景'] : undefined}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <button onClick={() => inputRefs[field].current?.click()} className="flex flex-col items-center group/btn">
                <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-2 group-hover/btn:border-indigo-300 group-hover/btn:text-indigo-600 text-slate-400 transition-all"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg></div>
                <p className="text-[11px] font-bold text-slate-500 group-hover/btn:text-indigo-600">点击上传</p><p className="text-[9px] text-slate-400 font-medium mt-0.5">或聚焦后粘贴</p>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // V5.XV.2: 聚焦对象列表直接按 shotType 过滤（不再经 compositionScope 中转）。
  // compositionScope 仍保留为内部字段供 prompt_engine 后端使用，由 shotType 派生。
  const compositionTargets = useMemo(
    () => getTargetsByShotType(settings.shotType),
    [settings.shotType]
  );
  const isCustomTarget = settings.compositionTarget !== '' && settings.compositionTarget !== ' ' && !compositionTargets.some(t => t.value === settings.compositionTarget);

  return (
    <section ref={sectionRef} className="space-y-12">
      <div className="flex items-center gap-4">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold text-2xl shadow-lg shadow-indigo-100">1</span>
        <div><h1 className="text-3xl font-bold tracking-tight">营销创意生成</h1><h2 className="text-slate-500 text-base">上传模特与产品，生成初步品牌视觉概念</h2></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-4 flex flex-col">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6 overflow-hidden h-full">
            <div className="flex items-center justify-between mb-2">
               <h3 className="font-bold text-lg text-slate-800">视觉资产</h3>
               <button onClick={() => setIsLibraryOpen(!isLibraryOpen)} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border ${isLibraryOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100' : 'bg-white text-indigo-600 border-indigo-100 hover:bg-indigo-50'}`}>
                 <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${isLibraryOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
                 品牌模特库
               </button>
            </div>
            {isLibraryOpen && (
              <div className="animate-in slide-in-from-top duration-300 space-y-4 pt-2 pb-4 border-b border-slate-50">
                 {/* 文件选择器（隐藏 input）—— 永远渲染，这样"空库 CTA"和右上按钮都能 click() 它 */}
                 <input type="file" ref={libraryInputRef} accept="image/*" multiple className="hidden" onChange={(e) => handleFileChange('library', e, true)} />

                 {/* scope 切换 + 容量徽章 */}
                 <div className="flex items-center justify-between gap-3 flex-wrap">
                   <div className="flex items-center gap-2">
                     <div className="inline-flex p-0.5 bg-slate-100 rounded-lg">
                       <button
                         onClick={() => setLibraryScope('personal')}
                         className={`px-3 py-1 text-[11px] font-black uppercase tracking-widest rounded-md transition-all ${libraryScope === 'personal' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                       >
                         个人
                       </button>
                       <button
                         onClick={() => {
                           if (!me.groupId) { alert('你尚未加入共享组'); return; }
                           setLibraryScope('group');
                         }}
                         disabled={!me.groupId}
                         className={`px-3 py-1 text-[11px] font-black uppercase tracking-widest rounded-md transition-all ${libraryScope === 'group' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                         title={me.groupId ? '组共享模特库' : '未加入任何共享组'}
                       >
                         {me.groupName ? `组：${me.groupName}` : '组'}
                       </button>
                     </div>
                     <span
                       className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black"
                       title={libraryScope === 'group' ? '组共享库上限 30' : `个人库上限 ${personalCap}（${me.role === 'admin' ? '一级管理员' : '普通用户'}）`}
                     >
                       {activeUrls.length}<span className="text-slate-400">/{activeCap}</span>
                     </span>
                     {libraryScope === 'group' && (
                       <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-wider" title="组内全员可见">组共享</span>
                     )}
                   </div>
                   <button
                     onClick={() => libraryInputRef.current?.click()}
                     className="flex items-center gap-1 text-indigo-600 text-[10px] font-bold uppercase tracking-widest hover:text-indigo-700 hover:underline transition-colors"
                     title={libraryScope === 'group' ? `上传到组共享库（上限 30 张）` : `上传到个人库（上限 ${personalCap} 张）`}
                   >
                     <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                     导入新模特
                   </button>
                 </div>
                 <div onPaste={(e) => handlePaste('library', e, true)} tabIndex={0} className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto no-scrollbar outline-none p-1">
                    {activeUrls.length > 0 ? activeUrls.map((url, idx) => {
                      const isActive = previews.model === url;
                      const showDelete = canDeleteGroupItem(url);
                      return (
                        <div key={idx} className={`group/item relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${isActive ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-slate-100 hover:border-indigo-200'}`} onClick={() => selectFromLibrary(url)} onMouseEnter={(e) => onModelMouseEnter(url, e)} onMouseMove={onModelMouseMove} onMouseLeave={onModelMouseLeave}>
                           <img src={toProxiedSrc(url)} onError={makeImgErrorFallback()} className="w-full h-full object-cover" alt="Model" />
                           {showDelete && (<button onClick={async (e) => {
                             if (libraryScope === 'group') {
                               // 1. 乐观先本地移除（立刻视觉反馈）
                               setGroupModels(prev => prev.filter(m => m.url !== url));
                               // 2. 等待 DELETE 真正完成（父组件 async 函数；关键：必须 await，否则 refetch 会在 DELETE 落库前跑）
                               await handleDeleteFromLibrary(e, url, 'group');
                               // 3. server-of-truth 回填：后端拒绝时该条会在此刻被放回来；成功时列表与后端保持一致
                               refetchGroupModels();
                             } else {
                               handleDeleteFromLibrary(e, url, 'personal');
                             }
                           }} title="删除此模特" className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-lg shadow-xl opacity-0 group-hover/item:opacity-100 transition-opacity z-[70] hover:scale-110 active:scale-95"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>)}
                           {isActive && <div className="absolute inset-0 bg-indigo-600/10 flex items-center justify-center"><svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg></div>}
                        </div>
                      );
                    }) : (
                      <button
                        onClick={() => libraryInputRef.current?.click()}
                        className="col-span-4 flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed border-indigo-200 bg-indigo-50/40 rounded-2xl text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50 active:scale-[0.99] transition-all cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                        </div>
                        <p className="text-xs font-black tracking-wide">点击或粘贴图片导入新模特</p>
                        <p className="text-[10px] text-indigo-400 font-medium">
                          {libraryScope === 'group' ? '组共享模特库 · 组内互见 · 上限 30 张' : `个人模特库 · 仅自己可见 · 上限 ${personalCap} 张`}
                        </p>
                      </button>
                    )}
                 </div>
              </div>
            )}
            <div className="flex flex-col gap-6 pt-2">
              <div className="grid grid-cols-2 gap-4">{renderUploadBox('当前模特', 'model', false)}{renderUploadBox('场景参考', 'scene', false)}</div>
              {renderUploadBox('主产品 (必填)', 'product', true)}
              {renderUploadBox('品牌配饰', 'accessory', true)}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">动作参考 (可选)</label>
                <input type="file" ref={poseRefInputRef} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handlePoseRefUpload(Array.from(e.target.files)); e.target.value = ''; }} />
                <div className={`relative rounded-2xl border-2 border-dashed transition-all overflow-hidden ${poseRefUrl ? 'border-indigo-100 bg-indigo-50/20' : 'border-slate-200 bg-slate-50 hover:border-indigo-300 h-24'}`}>
                  {poseRefUrl ? (
                    <div className="p-2 relative">
                      <img src={toProxiedSrc(poseRefUrl ?? '')} onError={makeImgErrorFallback()} className={`w-full h-auto rounded-xl block ${poseRefUploading ? 'opacity-50' : ''}`} alt="动作参考" />
                      {poseRefUploading && (
                        <div className="absolute inset-2 rounded-xl flex items-center justify-center bg-white/60">
                          <svg className="w-5 h-5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          <span className="ml-2 text-[11px] font-bold text-indigo-600">上传中…</span>
                        </div>
                      )}
                      {!poseRefUploading && (
                        <button onClick={() => setPoseRefUrl(null)} className="absolute top-3 right-3 p-1.5 bg-red-500 text-white rounded-lg shadow-xl hover:bg-red-600 transition-all">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="h-24 flex flex-col items-center justify-center">
                      <button onClick={() => poseRefInputRef.current?.click()} className="flex flex-col items-center group/btn">
                        <div className="w-9 h-9 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-1.5 group-hover/btn:border-indigo-300 group-hover/btn:text-indigo-600 text-slate-400 transition-all">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                        </div>
                        <p className="text-[11px] font-bold text-slate-500 group-hover/btn:text-indigo-600">上传动作参考图</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">AI 将参考此图的姿态/动作</p>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-8">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col h-full relative overflow-hidden">
            <div className="p-8 pb-4 border-b border-slate-50"><h3 className="font-bold text-lg text-slate-800">创意配置</h3></div>
            <div className="flex-grow overflow-y-auto p-8 pt-6 space-y-8 custom-scrollbar">
              {/* V5.XV.2: 三下拉合并为两下拉 —— 景别（即构图层级）+ 聚焦对象。
                  compositionScope 内部由 shotType 派生（deriveScopeFromShot），后端 prompt_engine
                  契约保持不变。空 shotType ('') = 沿用上一轮，走 lastCompositionIntent 回放。 */}
              <p className="text-[11px] text-slate-400 font-medium px-1 -mb-1">景别（构图层级）→ 聚焦对象 联动；选景别后聚焦列表自动过滤</p>
              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px]">01</span>景别构图</label>
                <select
                  value={settings.shotType}
                  onChange={(e) => {
                    const newShot = e.target.value;
                    const { scope: newScope, defaultTarget } = deriveScopeIntentFromShot(newShot);
                    const newTargets = getTargetsByShotType(newShot);
                    // 已有有效 target → 保留；空/无效 → 用景别默认 target（如"中景"→"上半身"）
                    const currentTarget = settings.compositionTarget;
                    const targetStillValid = currentTarget !== '' && currentTarget !== ' '
                      && newTargets.some(t => t.value === currentTarget);
                    const resolvedTarget = targetStillValid ? currentTarget : defaultTarget;
                    setSettings({
                      ...settings,
                      shotType: newShot,
                      compositionScope: newScope,
                      compositionTarget: resolvedTarget,
                    });
                  }}
                  className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium"
                >
                  {SHOT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {settings.shotType === '' && (
                  <p className="text-[11px] text-indigo-500 font-medium px-1">
                    {lastCompositionIntent
                      ? `将沿用上一轮：${lastCompositionIntent.scope} · ${lastCompositionIntent.target || '整体人物'}`
                      : '首次生成默认整体写照'}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px]">02</span>
                  聚焦对象
                </label>
                <select
                  value={isCustomTarget ? '__custom__' : settings.compositionTarget}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSettings({ ...settings, compositionTarget: v === '__custom__' ? ' ' : v });
                  }}
                  className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                >
                  <option value="">无（沿用景别）</option>
                  {compositionTargets.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  <option value="__custom__">自定义…</option>
                </select>
                {isCustomTarget && (
                  <input
                    type="text"
                    placeholder="自定义聚焦对象（如：腰带、扣子）"
                    value={settings.compositionTarget === ' ' ? '' : settings.compositionTarget}
                    onChange={(e) => setSettings({ ...settings, compositionTarget: e.target.value })}
                    className="w-full bg-slate-50 border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                  />
                )}
              </div>

              <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px]">03</span>色调风格</label><select value={settings.tone} onChange={(e) => setSettings({...settings, tone: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium">{TONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px]">04</span>艺术氛围</label><select value={settings.atmosphere} onChange={(e) => setSettings({...settings, atmosphere: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium">{ATMOSPHERES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div className="space-y-3"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px]">05</span>比例与画质</label><div className="flex gap-4"><select value={settings.aspectRatio} onChange={(e) => setSettings({...settings, aspectRatio: e.target.value})} className="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-sm font-medium">{ASPECT_RATIOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select><select value={settings.imageSize} onChange={(e) => setSettings({...settings, imageSize: e.target.value as ImageSize})} className="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-sm font-medium">{IMAGE_SIZES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div></div>
              <div className="space-y-3 pb-4"><label className="text-sm font-bold text-slate-700 flex items-center gap-2"><span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px]">06</span>补充描述</label><textarea value={settings.remark} onChange={(e) => {
                const text = e.target.value;
                const merged = mergeInferredComposition(settings, text);
                setSettings({ ...settings, remark: text, compositionScope: merged.compositionScope, compositionTarget: merged.compositionTarget });
              }} placeholder="例如：模特身处海边，背景是落日余晖下的沙滩..." className="w-full bg-slate-50 border-none rounded-2xl p-5 h-32 focus:ring-2 focus:ring-indigo-500 transition-all text-sm resize-none" /></div>
            </div>
            <div className="mt-auto p-8 border-t border-slate-100 bg-white sticky bottom-0 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)]">
              <div className="flex flex-col sm:flex-row items-center gap-8">
                <div className="flex-grow w-full space-y-3">
                  <div className="flex justify-between items-center text-sm"><label className="font-bold text-slate-600">生成数量</label><span className="text-indigo-600 font-black text-lg">{settings.count}</span></div>
                  <input type="range" min="1" max="8" step="1" value={settings.count} onChange={(e) => setSettings({...settings, count: parseInt(e.target.value)})} className="w-full h-2 bg-slate-100 rounded-lg appearance-none accent-indigo-600 cursor-pointer" />
                  {renderScaleMarks()}
                </div>
                <button onClick={handleGenerate} className="w-full sm:w-auto px-12 py-5 bg-indigo-600 text-white font-black rounded-[1.25rem] shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-3 whitespace-nowrap">生成创意大片</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div ref={resultsRef}>
        {results.length > 0 && (
          <div className="bg-white rounded-[2.5rem] p-8 sm:p-10 shadow-xl border border-slate-100">
             <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">创意结果库 <span className="text-sm font-normal text-slate-400">| 全部按 Phase 1 任务顺序排列</span></h2>
             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">{results.map((img, index) => renderImageItem(img, index, 1))}</div>
          </div>
        )}
      </div>
    </section>
  );
};
