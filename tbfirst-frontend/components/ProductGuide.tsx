/**
 * ProductGuide.tsx — 产品使用手册弹窗组件
 */
import React, { useState } from 'react';

interface ProductGuideProps {
  onClose: () => void;
}

export const ProductGuide: React.FC<ProductGuideProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'intro' | 'workflow' | 'features' | 'tips'>('intro');

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-xl flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-6xl max-h-[94vh] rounded-[3rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
        <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-indigo-100 font-black text-2xl">B</div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">BrandGenius v3.1.0 全链路视觉操作手册</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black rounded-md uppercase tracking-tighter">Enterprise Edition · 含影调大师</span>
                <p className="text-xs text-slate-500 font-medium">致同事：通过此文档，您将在 5 分钟内掌握"工业级"图片生产流（含 Phase 3 整体调色）</p>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-full transition-all group">
            <svg className="w-6 h-6 text-slate-400 group-hover:rotate-90 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div className="px-10 py-2 bg-white flex gap-10 border-b border-slate-50 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'intro', label: '核心逻辑', icon: '🏠' },
            { id: 'workflow', label: '四阶段作业流', icon: '⚙️' },
            { id: 'features', label: '关键功能点', icon: '🎯' },
            { id: 'tips', label: '避坑与提效', icon: '💎' }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`py-4 text-sm font-black transition-all flex items-center gap-2 border-b-2 whitespace-nowrap ${activeTab === tab.id ? 'text-indigo-600 border-indigo-600 translate-y-[1px]' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
              <span className="text-lg">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-grow overflow-y-auto p-10 custom-scrollbar bg-slate-50/30">
          {activeTab === 'intro' && (
            <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4">
              <div className="bg-indigo-600 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
                <h3 className="text-3xl font-black mb-6 relative z-10">为什么我们需要这套系统？</h3>
                <p className="text-indigo-100 leading-relaxed text-sm mb-8 relative z-10">传统的 AI 绘图（如 MJ/SD）具有极大的随机性，无法保证品牌资产（模特脸、服装版型）的一致性。<br /><br /><b>BrandGenius 3.1</b> 的核心逻辑是 <b>"结构锁定 (Structure-Locked) + 影调统一 (Tone-Unified)"</b>。我们将生成过程拆分为<b>工厂制版 / 创意渲染 / 批量精修 / 整体调色</b>四个环节，确保从人台图到最终营销图的每一个像素都受到工业级的控制；最后一环 Phase 3 影调大师采用达芬奇式整体调色——只改光色，不动服装本色。</p>
                <div className="flex gap-4 relative z-10 flex-wrap">
                  <div className="px-4 py-2 bg-white/10 rounded-xl border border-white/20 text-xs font-bold">● 版型 100% 还原</div>
                  <div className="px-4 py-2 bg-white/10 rounded-xl border border-white/20 text-xs font-bold">● 模特生物特征锁定</div>
                  <div className="px-4 py-2 bg-white/10 rounded-xl border border-white/20 text-xs font-bold">● 批量化任务处理</div>
                  <div className="px-4 py-2 bg-rose-500/30 rounded-xl border border-rose-200/40 text-xs font-bold">● Phase 3 整体调色（保留服装本色）</div>
                </div>
                <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center">
                   <div className="text-3xl mb-4">🛡️</div>
                   <h4 className="font-black text-slate-800 mb-2">标准资产化</h4>
                   <p className="text-[10px] text-slate-400 font-medium leading-relaxed">不再直接生成图，而是先将服装重构为可复用的 3D 标准数字资产。</p>
                 </div>
                 <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center">
                   <div className="text-3xl mb-4">🗂️</div>
                   <h4 className="font-black text-slate-800 mb-2">批次化管理</h4>
                   <p className="text-[10px] text-slate-400 font-medium leading-relaxed">同一次点击生成的所有图共享一个任务编号，方便后续追踪与对比。</p>
                 </div>
                 <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center">
                   <div className="text-3xl mb-4">🧬</div>
                   <h4 className="font-black text-slate-800 mb-2">生物特征锁定</h4>
                   <p className="text-[10px] text-slate-400 font-medium leading-relaxed">通过模特库功能，您可以将满意的模特特征保存并在后续所有场景中复用。</p>
                 </div>
              </div>
            </div>
          )}
          {activeTab === 'workflow' && (
            <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4">
              <div className="relative pl-12 border-l-2 border-dashed border-slate-200 space-y-16">
                {/* Phase 0 */}{/* 0 → 1 → 2 → 3：影调大师作为最末段 */}
                <div className="relative">
                  <div className="absolute -left-[3.75rem] top-0 w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center font-black shadow-xl">0</div>
                  <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                    <h4 className="text-lg font-black text-slate-800 mb-2">Phase 0: 标准资产工厂 (The Factory)</h4>
                    <p className="text-xs text-slate-500 mb-6 font-medium">将普通的人台图转化为"无干扰、高清晰、多视角"的 3D 资产。</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-emerald-600 mb-1 uppercase italic tracking-tighter">操作重点</p>
                        <p className="text-[11px] text-slate-600">上传正面人台图，系统会自动生成 **"视觉 DNA"** 描述。点击生成的 3D 结果图下方的按钮，可将其一键推送到 Phase 1 作为"主产品"。</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-emerald-600 mb-1 uppercase italic tracking-tighter">预期结果</p>
                        <p className="text-[11px] text-slate-600">产出背景干净 (#E7E1D8)、质感丝滑、版型绝对精准的正面/侧面/背面图。</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Phase 1 */}
                <div className="relative">
                  <div className="absolute -left-[3.75rem] top-0 w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black shadow-xl">1</div>
                  <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                    <h4 className="text-lg font-black text-slate-800 mb-2">Phase 1: 营销创意生成 (The Creative)</h4>
                    <p className="text-xs text-slate-500 mb-6 font-medium">将 Phase 0 产出的服装，穿在选定的模特身上，放入特定的场景。</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-indigo-600 mb-1 uppercase italic tracking-tighter">操作重点</p>
                        <p className="text-[11px] text-slate-600">在这里组合 **"模特 + 服装 + 场景参考"**。该阶段主要确定大风格。满意的图点击 **"设为精修参考"**，可批量送入下一阶段。</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-indigo-600 mb-1 uppercase italic tracking-tighter">预期结果</p>
                        <p className="text-[11px] text-slate-600">产出具备品牌氛围、光影和谐的初步概念大片。</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Phase 2 */}
                <div className="relative">
                  <div className="absolute -left-[3.75rem] top-0 w-12 h-12 bg-purple-600 text-white rounded-2xl flex items-center justify-center font-black shadow-xl">2</div>
                  <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                    <h4 className="text-lg font-black text-slate-800 mb-2">Phase 2: 生活化延展与精修 (The Mastery)</h4>
                    <p className="text-xs text-slate-500 mb-6 font-medium">基于 Phase 1 的成功样片，进行多姿态、多细节的批量化生产。</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-purple-600 mb-1 uppercase italic tracking-tighter">操作重点</p>
                        <p className="text-[11px] text-slate-600">选择多种姿态（如侧身、背面、坐姿）、表情和光影。AI 将保持参考图的视觉特征，仅改变动作和局部细节。</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-purple-600 mb-1 uppercase italic tracking-tighter">预期结果</p>
                        <p className="text-[11px] text-slate-600">产出风格极度统一的完整商用 Lookbook 套图。</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Phase 3 影调大师 */}
                <div className="relative">
                  <div className="absolute -left-[3.75rem] top-0 w-12 h-12 bg-rose-600 text-white rounded-2xl flex items-center justify-center font-black shadow-xl">3</div>
                  <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                    <h4 className="text-lg font-black text-slate-800 mb-2">Phase 3: 影调大师 (The Colorist)</h4>
                    <p className="text-xs text-slate-500 mb-6 font-medium">把 Phase 2 的成片送入"达芬奇式整体调色台"——通过灵感参考图提取视觉 DNA，再为整批底片套上同一种 LUT 风格的色彩 / 光影 / 颗粒，<b>但绝不修改服装本色</b>。</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-rose-600 mb-1 uppercase italic tracking-tighter">操作重点</p>
                        <p className="text-[11px] text-slate-600">① 在「待处理底片」里从 Phase 2 送图或直接上传本地图；② 上传一张「灵感参考图」并点「提取 DNA」生成 4 维影调笔记；③ 在「控制面板」调整影调浓度 / 对比度 / 颗粒感，并在<b>补充描述（P0 高优先级）</b>里写导演说明（如"偏冷青调"/"保留服装本色"）；④ 点「一键复刻渲染」批量出图。改了参数后还可对成品库做「重新复刻渲染」。</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-rose-600 mb-1 uppercase italic tracking-tighter">预期结果</p>
                        <p className="text-[11px] text-slate-600">整批底片获得统一胶片 / LUT / 复古 / 电影感色调，模特身份、服装颜色、构图 100% 保留；可悬停成品对比原图。适合做 Lookbook 终极调性收尾、品牌系列色彩统一。</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'features' && (
            <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-top-4">
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-xl">🔢</span>
                     <h5 className="font-black text-slate-800">批次统一编号 (Batch Number)</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">每次点击"生成"按钮产生的图片（无论 1 张还是 8 张）都会被赋予相同的 **"任务 #X"** 编号。这能帮您快速锁定"哪一次生成的这一组图效果最好"，避免在海量结果中迷路。</p>
               </div>
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl">📦</span>
                     <h5 className="font-black text-slate-800">多产品挂载 (Product Append)</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">在 Phase 1 中，您可以上传或从 Phase 0 追加多个产品图（如衣服 + 包包）。系统会智能处理穿搭关系，实现多 SKU 组合展示。</p>
               </div>
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-xl">👩</span>
                     <h5 className="font-black text-slate-800">品牌模特库 (Model Library)</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">生成的满意模特，点击"存入模特库"即可永久保存。您可以直接从库中选取模特，系统会自动剥离其原有的衣服，将其作为下一批任务的 **"生物特征指纹"**。</p>
               </div>
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-xl">🎞️</span>
                     <h5 className="font-black text-slate-800">智能精修扩展</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">基于 Phase 1 的结果，点击图片即可设为"参考"。Phase 2 将根据这些参考图的特征，一键延展出多达 15 种专业模特姿态，极大缩短后期修图周期。</p>
               </div>
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-xl">🎨</span>
                     <h5 className="font-black text-slate-800">视觉 DNA 提取 (Phase 3)</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">在 Phase 3 上传一张灵感参考图，AI 会用 Gemini 多模态解析出 12-15 个英文标签 + 色彩 / 光影 / 质感 / 影调 四维中文笔记，作为本批底片的统一调色锚点。</p>
               </div>
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-xl">🎬</span>
                     <h5 className="font-black text-slate-800">达芬奇式整体调色 (Phase 3)</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">影调大师把生成模式严格限定为<b>全局色彩转换</b>——只调色温 / 白平衡 / 高光-阴影色偏 / LUT / 颗粒，<b>绝不重画服装颜色</b>。配合「补充描述 (P0)」可加入具体调色导演说明，覆盖 DNA 默认倾向。</p>
               </div>
               <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <span className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-xl">🔁</span>
                     <h5 className="font-black text-slate-800">一键复刻 + 重渲染 (Phase 3)</h5>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">点击「一键复刻渲染」批量为底片套上 DNA。底片队列保留（手动 × 删除）；改了控制面板参数后，即使队列为空，也可基于成品库的原图<b>重新复刻渲染</b>，反复尝试不同色调。悬停成品可对比原图。</p>
               </div>
            </div>
          )}
          {activeTab === 'tips' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-left-4">
               <div className="p-10 bg-slate-900 rounded-[3rem] text-white shadow-2xl space-y-8">
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">💡</span>
                    <h4 className="text-2xl font-black">专家级提效 Tip</h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-3">
                       <p className="text-indigo-400 font-black text-xs uppercase tracking-widest">关于人台图</p>
                       <p className="text-[11px] text-slate-300 leading-relaxed">尽量使用拍摄清晰、背景纯净的人台。如果在 Phase 0 结果中发现版型偏差，可以微调 **"重构补充描述"**，明确指出是"圆领"还是"V领"。</p>
                    </div>
                    <div className="space-y-3">
                       <p className="text-indigo-400 font-black text-xs uppercase tracking-widest">关于模特选择</p>
                       <p className="text-[11px] text-slate-300 leading-relaxed">模特参考图的 **"表情"和"肤色"** 影响最大。如果您需要生成亚洲模特，请务必在库中选择一张纯正的亚洲面孔作为参考。</p>
                    </div>
                    <div className="space-y-3">
                       <p className="text-indigo-400 font-black text-xs uppercase tracking-widest">关于批量生成</p>
                       <p className="text-[11px] text-slate-300 leading-relaxed">在 Phase 2 开启"多选姿态"时，建议单次生成数量 (Batch Count) 不要超过 4，以免生成任务排队过久。</p>
                    </div>
                    <div className="space-y-3">
                       <p className="text-indigo-400 font-black text-xs uppercase tracking-widest">Prompt 技巧</p>
                       <p className="text-[11px] text-slate-300 leading-relaxed">补充描述请尽量使用英文词汇。例如：*"Morning sunlight"* 比 *"早上的太阳"* 的氛围光感会强烈很多。</p>
                    </div>
                    <div className="space-y-3">
                       <p className="text-rose-400 font-black text-xs uppercase tracking-widest">关于 Phase 3 调色</p>
                       <p className="text-[11px] text-slate-300 leading-relaxed">把它当成<b>达芬奇 LUT 套色</b>而非"换装"。「补充描述」字段写"colorist note"风格的句子最有效：例如 *"cool teal shadows, warm orange highlights, keep garment albedo"*。如发现服装被染色，请显式加一句 *"preserve garment base color"*。</p>
                    </div>
                    <div className="space-y-3">
                       <p className="text-rose-400 font-black text-xs uppercase tracking-widest">关于灵感参考图</p>
                       <p className="text-[11px] text-slate-300 leading-relaxed">挑一张<b>光影对比强、色彩倾向明显</b>的电影截图 / 编辑大片，比同色系的产品图更能产出鲜明的影调 DNA。提取后可在右侧 4 维笔记里快速核对是否符合预期。</p>
                    </div>
                  </div>
                  <div className="pt-8 border-t border-white/10">
                    <p className="text-center text-[10px] text-slate-500 font-black uppercase tracking-[0.3em]">Consistency is Key. Control is King.</p>
                  </div>
               </div>
            </div>
          )}
        </div>
        <div className="px-10 py-8 border-t border-slate-50 bg-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">BrandGenius Vision Engine v3.1.0 Online · 含 Phase 3 影调大师</p>
          </div>
          <button onClick={onClose} className="px-20 py-5 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95">
            我已完全掌握
          </button>
        </div>
      </div>
    </div>
  );
};
