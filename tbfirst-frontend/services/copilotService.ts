/**
 * Copilot AI 助手 — 对接 tbfirst 后端 /api/image/copilot
 */
import { api } from '@/services/api';
import { CopilotContext, Message } from '@/features/Copilot/types';
import { fileToDataUri } from '@/services/shared/imagePartUtils';

interface ChatResponse {
  text: string;
}

interface InspireResponse {
  text: string;
}

interface BrandAnalyzeResponse {
  audience: string;
  tone: string;
  remark: string;     // 后端字段
  description?: string; // 兼容字段
}

export class CopilotService {
  constructor() {}

  async generateResponse(
    history: Message[],
    userInput: string,
    context: CopilotContext
  ): Promise<string> {
    // 参考图组装（V5.XVII.D）：
    //   1. Phase 1/2/3 都把【产品图】排在最前 —— Gemini 对靠前的 inline_data
    //      权重更高，避免模特图被误识别成"主商品"。
    //   2. 与 images 同长的 roles 数组下发，让后端能按位置给每张图打标签
    //      （第N张 = product / model / inspiration），消除"商品 / 模特 / 灵感图"
    //      笼统措辞带来的识别歧义。
    //   3. Phase 3：灵感参考图仍排首位（DNA 提取核心素材），随后产品 → 模特。
    const referenceImages: string[] = [];
    const referenceImageRoles: string[] = [];
    const inputs = context.inputs as any;

    if (context.activePhase === 3 && context.p3Settings?.inspirationImage) {
      referenceImages.push(context.p3Settings.inspirationImage);
      referenceImageRoles.push('inspiration');
    }
    if (inputs?.product && Array.isArray(inputs.product)) {
      for (const p of inputs.product) {
        if (typeof p === 'string') {
          referenceImages.push(p);
          referenceImageRoles.push('product');
        }
      }
    }
    if (inputs?.model && typeof inputs.model === 'string') {
      referenceImages.push(inputs.model);
      referenceImageRoles.push('model');
    }

    const resp = await api.post<ChatResponse>('/api/image/copilot/chat', {
      userInput,
      history: history.map(m => ({ role: m.role, text: m.text })),
      context: {
        activePhase: context.activePhase,
        brand: context.brand,
        p1Settings: context.p1Settings,
        p2Settings: context.p2Settings,
        p3Settings: context.p3Settings,
      },
      referenceImages,
      referenceImageRoles,
    });

    return resp.text || '抱歉，我无法生成回复。';
  }

  /**
   * 灵感按钮 —— 无用户输入，后端根据当前界面素材随机返回一条简短 prompt。
   * 与 generateResponse 共享 referenceImages 组装逻辑，保持素材一致性。
   *
   * V5.XVII.C: 新增 recentInspirations 参数。前端 ChatWindow 维护最近 N 条
   * 已生成灵感文本，回传给后端，让 Gemini 在 system prompt 中显式避开重复。
   */
  async inspire(context: CopilotContext, recentInspirations: string[] = []): Promise<string> {
    // 与 generateResponse 同样的组装规则（V5.XVII.D）：
    //   - 产品图永远排在模特图前面，避免 Gemini 把模特错当主商品
    //   - 同步下发 referenceImageRoles 让后端给每张图打位置标签
    const referenceImages: string[] = [];
    const referenceImageRoles: string[] = [];
    const inputs = context.inputs as any;

    if (context.activePhase === 3 && context.p3Settings?.inspirationImage) {
      referenceImages.push(context.p3Settings.inspirationImage);
      referenceImageRoles.push('inspiration');
    }
    if (inputs?.product && Array.isArray(inputs.product)) {
      for (const p of inputs.product) {
        if (typeof p === 'string') {
          referenceImages.push(p);
          referenceImageRoles.push('product');
        }
      }
    }
    if (inputs?.model && typeof inputs.model === 'string') {
      referenceImages.push(inputs.model);
      referenceImageRoles.push('model');
    }

    const resp = await api.post<InspireResponse>('/api/image/copilot/inspire', {
      context: {
        activePhase: context.activePhase,
        brand: context.brand,
        p1Settings: context.p1Settings,
        p2Settings: context.p2Settings,
        p3Settings: context.p3Settings,
      },
      referenceImages,
      referenceImageRoles,
      recentInspirations,
    });

    return resp.text || '';
  }

  async analyzeBrand(url: string): Promise<{ audience: string; tone: string; description: string }> {
    const resp = await api.post<BrandAnalyzeResponse>('/api/image/copilot/analyze-brand', { url });
    return {
      audience: resp.audience || '',
      tone: resp.tone || '',
      description: resp.remark || resp.description || '',
    };
  }
}
