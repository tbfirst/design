import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import ServiceSwitcher from '../components/ServiceSwitcher';
import {
  DesignArtifact,
  DesignBrief,
  DesignProject,
  PlanResponse,
  designAgentService,
} from '../services/designAgent';
import { uploadFilesToGcs } from '../services/uploadService';
import { makeImgErrorFallback, toProxiedSrc } from '../services/shared/imageSrc';

const blankBrief = (): DesignBrief => ({
  objective: '',
  deliverable: 'ecommerce_ad',
  product_images: [],
  reference_images: [],
  audience: '',
  channel: '电商详情页',
  aspect_ratios: ['3:4'],
  creative_direction: '',
  copywriting: {},
  hard_constraints: [],
  acceptance_criteria: [],
  unknown_fields: [],
  status: 'draft',
  version: 1,
});

const statusLabel: Record<string, string> = {
  draft: '待补充', active: '设计中', waiting_approval: '待批准', completed: '已定稿', failed: '需处理',
};

const evaluationLabel: Record<string, string> = {
  passed: '质检通过', needs_review: '建议复核', failed: '未通过', unknown: '未完成质检',
};

export default function DesignAgentPage() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [active, setActive] = useState<DesignProject | null>(null);
  const [brief, setBrief] = useState<DesignBrief>(blankBrief());
  const [artifacts, setArtifacts] = useState<DesignArtifact[]>([]);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [candidateCount, setCandidateCount] = useState(2);
  const [revisionInstruction, setRevisionInstruction] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'product' | 'reference' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seenEventKeysRef = useRef(new Set<string>());

  const selected = useMemo(
    () => artifacts.find(item => item.id === active?.selected_artifact_id || item.status === 'selected' || item.status === 'final'),
    [artifacts, active?.selected_artifact_id],
  );

  async function refreshProjects(selectUuid?: string) {
    const list = await designAgentService.listProjects();
    setProjects(list);
    const uuid = selectUuid || active?.project_uuid || list[0]?.project_uuid;
    if (uuid) await openProject(uuid);
  }

  async function openProject(uuid: string) {
    setError(null);
    const detail = await designAgentService.getProject(uuid);
    setActive(detail.project);
    setBrief(detail.project.brief);
    setArtifacts(detail.artifacts.filter(item => ['candidate', 'revision', 'final'].includes(item.role)));
    setPlanResponse(detail.pending || null);
    setEvents([]);
    seenEventKeysRef.current.clear();
    setRevisionInstruction('');
  }

  useEffect(() => {
    designAgentService.listProjects()
      .then(async list => {
        setProjects(list);
        if (list[0]) await openProject(list[0].project_uuid);
      })
      .catch(err => setError(err.message || String(err)));
  }, []);

  async function createProject() {
    setBusy(true);
    setError(null);
    try {
      const project = await designAgentService.createProject('新广告设计');
      setProjects(prev => [project, ...prev]);
      setActive(project);
      setBrief(project.brief);
      setArtifacts([]);
      setPlanResponse(null);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveBrief(nextBrief = brief): Promise<DesignProject> {
    if (!active) throw new Error('请先创建设计项目');
    const project = await designAgentService.updateBrief(active.project_uuid, {
      objective: nextBrief.objective,
      product_images: nextBrief.product_images,
      reference_images: nextBrief.reference_images,
      audience: nextBrief.audience,
      channel: nextBrief.channel,
      aspect_ratios: nextBrief.aspect_ratios,
      creative_direction: nextBrief.creative_direction,
      copywriting: nextBrief.copywriting,
      hard_constraints: nextBrief.hard_constraints,
      acceptance_criteria: nextBrief.acceptance_criteria,
      expected_version: active.brief_version,
    });
    setActive(project);
    setBrief(project.brief);
    setPlanResponse(null);
    setProjects(prev => prev.map(item => item.project_uuid === project.project_uuid ? project : item));
    return project;
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveBrief();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(files: FileList | null, role: 'product' | 'reference') {
    if (!files?.length || !active) return;
    setUploading(role);
    setError(null);
    try {
      const urls = await uploadFilesToGcs(Array.from(files), 'design-agent');
      await Promise.all(urls.map(url => designAgentService.registerAsset(
        active.project_uuid,
        url,
        role === 'product' ? 'source' : 'reference',
      )));
      const next = {
        ...brief,
        product_images: role === 'product' ? [...brief.product_images, ...urls].slice(0, 4) : brief.product_images,
        reference_images: role === 'reference' ? [...brief.reference_images, ...urls].slice(0, 4) : brief.reference_images,
      };
      setBrief(next);
      await saveBrief(next);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setUploading(null);
    }
  }

  async function createPlan(revision = false) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const project = await saveBrief();
      const response = await designAgentService.createPlan(project.project_uuid, {
        request_id: crypto.randomUUID(),
        candidate_count: candidateCount,
        ...(revision && selected ? {
          revision_of_artifact_id: selected.id,
          revision_instruction: revisionInstruction,
        } : {}),
      });
      setPlanResponse(response);
      setEvents(['计划已生成，等待批准']);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndExecute() {
    if (!active || !planResponse) return;
    setBusy(true);
    setError(null);
    setEvents(['正在批准计划']);
    try {
      if (planResponse.approval.status === 'pending') {
        await designAgentService.approve(active.project_uuid, planResponse.approval);
      }
      const controller = new AbortController();
      abortRef.current = controller;
      await designAgentService.execute(
        active.project_uuid,
        planResponse.run.id,
        event => {
          const eventKey = event.run_id != null && event.sequence != null
            ? `${event.run_id}:${event.sequence}`
            : null;
          if (eventKey && seenEventKeysRef.current.has(eventKey)) return;
          if (eventKey) seenEventKeysRef.current.add(eventKey);
          if (event.type === 'tool_started') setEvents(prev => [...prev, `执行 ${event.tool}`]);
          if (event.type === 'tool_completed') setEvents(prev => [...prev, event.summary || '生成完成']);
          if (event.type === 'artifact_created' && event.artifact) {
            setArtifacts(prev => prev.some(item => item.id === event.artifact!.id) ? prev : [...prev, event.artifact!]);
          }
          if (event.type === 'evaluation_completed') setEvents(prev => [...prev, '候选已完成质检']);
          if (event.type === 'run_failed') setError(event.error || '设计执行失败');
        },
        controller.signal,
      );
      await refreshProjects(active.project_uuid);
      setPlanResponse(null);
      setRevisionInstruction('');
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err.message || String(err));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function rejectPlan() {
    if (!active || !planResponse) return;
    try {
      await designAgentService.reject(active.project_uuid, planResponse.approval);
      setPlanResponse(null);
      setEvents(['计划已取消，Brief 保持不变']);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  }

  async function selectArtifact(artifact: DesignArtifact) {
    if (!active) return;
    try {
      const selectedArtifact = await designAgentService.selectArtifact(active.project_uuid, artifact.id);
      setArtifacts(prev => prev.map(item => ({
        ...item,
        status: item.id === selectedArtifact.id ? selectedArtifact.status : (item.status === 'selected' ? 'ready' : item.status),
      })) as DesignArtifact[]);
      setActive({ ...active, selected_artifact_id: artifact.id });
    } catch (err: any) {
      setError(err.message || String(err));
    }
  }

  async function finalize() {
    if (!active || !selected) return;
    try {
      const finalArtifact = await designAgentService.finalize(active.project_uuid);
      setArtifacts(prev => prev.map(item => item.id === finalArtifact.id ? finalArtifact : item));
      setActive({ ...active, status: 'completed' });
    } catch (err: any) {
      setError(err.message || String(err));
    }
  }

  function removeImage(role: 'product' | 'reference', index: number) {
    setBrief(prev => ({
      ...prev,
      product_images: role === 'product' ? prev.product_images.filter((_, i) => i !== index) : prev.product_images,
      reference_images: role === 'reference' ? prev.reference_images.filter((_, i) => i !== index) : prev.reference_images,
    }));
  }

  return (
    <div className="relative grid min-h-[calc(100vh-56px)] grid-cols-1 bg-[#f6f7f8] lg:h-[calc(100vh-56px)] lg:grid-cols-[240px_410px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="flex min-h-48 flex-col border-r border-gray-200 bg-white lg:min-h-0">
        <div className="flex h-12 items-center justify-between border-b border-gray-200 px-3">
          <span className="text-sm font-semibold text-gray-800">设计项目</span>
          <button title="新建设计项目" onClick={createProject} disabled={busy} className="grid size-8 place-items-center rounded-md border-0 bg-gray-900 text-white hover:bg-black disabled:opacity-40">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {projects.map(project => (
            <button key={project.project_uuid} onClick={() => openProject(project.project_uuid)} className={`mb-1 w-full border-0 px-3 py-2 text-left ${active?.project_uuid === project.project_uuid ? 'bg-gray-100' : 'bg-transparent hover:bg-gray-50'}`}>
              <div className="truncate text-sm font-medium text-gray-800">{project.title}</div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                <span>{statusLabel[project.status] || project.status}</span>
                <ChevronRight size={13} />
              </div>
            </button>
          ))}
          {projects.length === 0 && <p className="px-3 py-6 text-center text-xs text-gray-500">创建第一个设计项目</p>}
        </div>
        <Link to="/agent/chat" className="m-3 flex items-center justify-center gap-2 border-t border-gray-200 pt-3 text-xs text-gray-600 no-underline hover:text-gray-950">
          <MessageSquare size={14} /> 通用 Agent 对话
        </Link>
      </aside>

      <main className="overflow-y-auto border-r border-gray-200 bg-white">
        <div className="flex h-12 items-center justify-between border-b border-gray-200 px-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">设计 Brief</div>
            <div className="text-[10px] text-gray-500">{active ? `v${active.brief_version} · ${brief.status === 'ready' ? '信息完整' : '需要补充'}` : '尚未选择项目'}</div>
          </div>
          <button title="保存 Brief" onClick={handleSave} disabled={!active || busy} className="grid size-8 place-items-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            <Save size={15} />
          </button>
        </div>

        {!active ? (
          <div className="p-8 text-center text-sm text-gray-500">从左侧新建或选择项目</div>
        ) : (
          <div className="space-y-5 p-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-700">设计目标</span>
              <textarea value={brief.objective} onChange={e => setBrief({ ...brief, objective: e.target.value })} rows={4} placeholder="例如：为新品香水制作克制、现代的电商首屏广告，突出瓶身和木质香调" className="w-full resize-none rounded-md border border-gray-300 p-2.5 text-sm outline-none focus:border-gray-600" />
            </label>

            <ImageField title="商品素材" images={brief.product_images} busy={uploading === 'product'} onUpload={files => handleUpload(files, 'product')} onRemove={index => removeImage('product', index)} />
            <ImageField title="参考图（可选）" images={brief.reference_images} busy={uploading === 'reference'} onUpload={files => handleUpload(files, 'reference')} onRemove={index => removeImage('reference', index)} />

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-700">画幅</span>
                <select value={brief.aspect_ratios[0] || '3:4'} onChange={e => setBrief({ ...brief, aspect_ratios: [e.target.value] })} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm">
                  <option value="1:1">1:1</option><option value="3:4">3:4</option><option value="4:5">4:5</option><option value="16:9">16:9</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-700">渠道</span>
                <input value={brief.channel || ''} onChange={e => setBrief({ ...brief, channel: e.target.value })} className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm" />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-700">创意方向</span>
              <textarea value={brief.creative_direction || ''} onChange={e => setBrief({ ...brief, creative_direction: e.target.value })} rows={3} placeholder="色彩、光线、构图、氛围和需要避免的表达" className="w-full resize-none rounded-md border border-gray-300 p-2.5 text-sm outline-none focus:border-gray-600" />
            </label>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-gray-700">候选数量</span>
              <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                {[1, 2, 3].map(count => <button key={count} onClick={() => setCandidateCount(count)} className={`h-8 w-10 border-0 text-sm ${candidateCount === count ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{count}</button>)}
              </div>
            </div>

            {!planResponse && (
              <button onClick={() => createPlan(false)} disabled={busy || brief.status === 'draft'} className="flex h-10 w-full items-center justify-center gap-2 rounded-md border-0 bg-gray-900 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} 生成设计计划
              </button>
            )}

            {planResponse && (
              <section className="border-y border-gray-200 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">计划需要批准</div>
                    <div className="text-xs text-gray-500">{planResponse.run.plan.candidate_count} 个候选 · 最多 {planResponse.run.plan.max_generation_calls} 次生成调用</div>
                  </div>
                  <span className="text-xs text-amber-700">{planResponse.approval.risk_level}</span>
                </div>
                <ol className="mb-4 space-y-1 pl-5 text-xs text-gray-600">
                  {planResponse.run.plan.steps.map(step => <li key={step.id}>{step.title}</li>)}
                </ol>
                <div className="flex gap-2">
                  <button onClick={approveAndExecute} disabled={busy} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40"><Check size={15} />批准并执行</button>
                  <button title="拒绝计划" onClick={rejectPlan} disabled={busy} className="grid size-9 place-items-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"><X size={15} /></button>
                </div>
              </section>
            )}

            {events.length > 0 && <div className="border-l-2 border-gray-300 pl-3 text-xs leading-6 text-gray-600">{events.map((event, index) => <div key={`${event}-${index}`}>{event}</div>)}</div>}
            {error && <div className="border-l-2 border-red-500 pl-3 text-xs leading-5 text-red-700">{error}</div>}
          </div>
        )}
      </main>

      <section className="flex min-h-[520px] min-w-0 flex-col bg-[#f6f7f8] lg:min-h-0">
        <div className="flex h-12 items-center justify-between border-b border-gray-200 bg-white px-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">作品与版本</div>
            <div className="text-[10px] text-gray-500">{artifacts.length} 个候选</div>
          </div>
          <button title="刷新作品" onClick={() => active && openProject(active.project_uuid)} disabled={!active || busy} className="grid size-8 place-items-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"><RefreshCw size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {artifacts.length === 0 ? (
            <div className="grid h-full min-h-72 place-items-center border border-dashed border-gray-300 bg-white text-center">
              <div className="max-w-56 text-gray-500"><ImageIcon size={24} className="mx-auto mb-3" /><p className="text-sm">批准计划后，候选作品会出现在这里</p></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {artifacts.map(artifact => (
                <article key={artifact.id} className={`overflow-hidden border bg-white ${selected?.id === artifact.id ? 'border-gray-900' : 'border-gray-200'}`}>
                  <button onClick={() => artifact.status !== 'final' && selectArtifact(artifact)} disabled={artifact.status === 'final'} className="block w-full border-0 bg-gray-100 p-0 text-left disabled:cursor-default">
                    {artifact.url ? <img src={toProxiedSrc(artifact.url)} onError={makeImgErrorFallback()} alt={`候选 ${artifact.id}`} className="aspect-[3/4] w-full object-cover" /> : <div className="grid aspect-[3/4] place-items-center"><ImageIcon /></div>}
                  </button>
                  <div className="p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-900">版本 {artifact.revision}</span>
                      <span className={artifact.evaluation?.status === 'failed' ? 'text-red-700' : 'text-gray-500'}>{evaluationLabel[artifact.evaluation?.status || 'unknown']}</span>
                    </div>
                    {artifact.evaluation?.hard_violations?.[0] && <p className="mt-2 text-[11px] leading-4 text-red-700">{artifact.evaluation.hard_violations[0]}</p>}
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => selectArtifact(artifact)} disabled={artifact.status === 'final'} className="h-8 flex-1 rounded-md border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-default">{selected?.id === artifact.id ? '已选择' : '选择'}</button>
                      {artifact.url && <a title="下载作品" href={artifact.url} download className="grid size-8 place-items-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"><Download size={14} /></a>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="border-t border-gray-200 bg-white p-4">
            <div className="mb-2 text-xs font-medium text-gray-700">基于版本 {selected.revision} 修改</div>
            <div className="flex gap-2">
              <input value={revisionInstruction} onChange={e => setRevisionInstruction(e.target.value)} placeholder="例如：保留商品，只把背景改为浅灰并缩小标题" className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-gray-600" />
              <button title="生成修订计划" onClick={() => createPlan(true)} disabled={busy || !revisionInstruction.trim()} className="grid size-9 place-items-center rounded-md border-0 bg-gray-900 text-white hover:bg-black disabled:opacity-40"><Sparkles size={15} /></button>
              <button title="确认定稿" onClick={finalize} disabled={busy || selected.status === 'final'} className="flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40"><Check size={14} />定稿</button>
            </div>
          </div>
        )}
      </section>

      <ServiceSwitcher currentHref="/agent" />
    </div>
  );
}

function ImageField({ title, images, busy, onUpload, onRemove }: {
  title: string;
  images: string[];
  busy: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">{title}</span>
        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50">
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />} 上传
          <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={event => onUpload(event.target.files)} />
        </label>
      </div>
      <div className="grid min-h-20 grid-cols-4 gap-2 border border-dashed border-gray-300 p-2">
        {images.map((url, index) => (
          <div key={`${url}-${index}`} className="group relative aspect-square overflow-hidden bg-gray-100">
            <img src={toProxiedSrc(url)} onError={makeImgErrorFallback()} alt="" className="size-full object-cover" />
            <button title="移除素材" onClick={() => onRemove(index)} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full border-0 bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"><X size={12} /></button>
          </div>
        ))}
        {images.length === 0 && <div className="col-span-4 grid place-items-center text-[11px] text-gray-400">最多 4 张</div>}
      </div>
    </div>
  );
}
