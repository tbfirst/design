import { api } from '@/services/api';
import type { PreProduction, Shot, StoryboardProject, StoryboardDoc } from './StoryboardTypes';

interface BibleResp {
  projectId: number; // 服务端创建的项目主键
  preProduction: string; // JSON string of PreProduction
}

interface DraftResp {
  shots: string; // JSON string of Shot[]
}

interface FrameResp {
  imageDataUri: string;
}

export const storyboardService = {
  generateBible: (req: {
    storyText: string;
    mode?: 'script' | 'images' | 'auto';
    imageRefs?: string[];
    model?: string;
  }): Promise<BibleResp> =>
    api.post<BibleResp>('/api/cinestitch/storyboard/bible', req),

  /**
   * @deprecated 出图已改为「服装图直传 + 硬约束」，不再调用 AI 文字分析。
   * 保留仅为兼容；UI 已移除入口。
   */
  analyzeGarment: (req: {
    imageRefs: string[];
    notes?: string;
    model?: string;
  }): Promise<{ consistencyProtocol: string; usedModel?: string }> =>
    api.post('/api/cinestitch/storyboard/analyze-garment', req),

  /** 视频解析脚本：上传短视频(base64 data URI)或链接，返回中文分镜脚本 markdown */
  parseVideo: (req: {
    videoDataUri?: string;
    videoUrl?: string;
    prompt?: string;
    sceneCount?: number;
    model?: string;
  }): Promise<{ markdown: string; usedModel?: string }> =>
    api.post('/api/cinestitch/parse-video', req),

  generateDraft: (
    projectId: number,
    req: {
      storyText: string;
      preProductionJson: string;
      consistencyProtocol?: string;
      dynamicScript?: string;
      gridCount?: number; // 关键帧数 N = 分镜数 = 宫格数：让后端恰好生成 N 个分镜
      model?: string;
    },
  ): Promise<DraftResp> =>
    api.post<DraftResp>(`/api/cinestitch/storyboard/draft?projectId=${projectId}`, req),

  /** 一次性生成整张 N 宫格图，返回 data URI（前端再 uploadDataUrisToGcs 换 /img/ 短链） */
  generateGrid: (
    projectId: number,
    req: {
      shots: { description?: string; action?: string; cameraMovement?: string; shotSize?: string }[];
      gridCount: number;
      aspectRatio: string;
      imageSize?: string;
      garmentRefs?: string[];
      modelRefs?: string[];
      consistencyProtocol?: string;
      model?: string;
    },
  ): Promise<string> =>
    api.post<string>(`/api/cinestitch/storyboard/grid?projectId=${projectId}`, req),

  generateFrame: (
    projectId: number,
    shotIdx: number,
    frameIdx: number,
    req: {
      shotDescription: string;
      frameIndex: number;
      frameTotal?: number;
      motionType: string;
      aspectRatio: string;
      imageSize?: string;
      garmentRefs?: string[];
      modelRefs?: string[];
      prevFrameRef?: string;
      prevSameShot?: boolean;
      consistencyProtocol?: string;
      action?: string;
      cameraMovement?: string;
      frameLabel?: string;
      model?: string;
    },
  ): Promise<string> =>
    api.post<string>(
      `/api/cinestitch/storyboard/frame?projectId=${projectId}&shotIdx=${shotIdx}&frameIdx=${frameIdx}`,
      req,
    ),

  /** 启动 Seedance 2.0（callxyq）视频生成，返回 operationName（= task_id） */
  startVideoClip: (req: {
    imageDataUris?: string[]; // 参考图列表：排版宫格图 / 故事板 / 分镜表图（最多 9 张）
    prompt: string;
    durationSeconds?: number; // Seedance ≤15s
    aspectRatio?: string;
    resolution?: string; // 如 720p
    model?: string;
  }): Promise<{ operationName: string }> =>
    api.post('/api/cinestitch/storyboard/video-clip', req),

  /** 轮询 Seedance 视频任务状态 */
  pollVideoClip: (req: { operationName: string }): Promise<{ done: boolean; videoUri?: string; error?: string }> =>
    api.post('/api/cinestitch/storyboard/poll-video-clip', req),

  saveDoc: (projectId: number, docJson: string, stage?: string, title?: string): Promise<void> =>
    api.put<void>(`/api/cinestitch/storyboard/${projectId}`, { docJson, stage, title }),

  getProject: (id: number): Promise<StoryboardProject> =>
    api.get<StoryboardProject>(`/api/cinestitch/storyboard/${id}`),

  listProjects: (): Promise<StoryboardProject[]> =>
    api.get<StoryboardProject[]>('/api/cinestitch/storyboard'),

  deleteProject: (id: number): Promise<void> =>
    api.delete<void>(`/api/cinestitch/storyboard/${id}`),
};

/** Parse preProduction JSON string to PreProduction object */
export function parsePreProduction(json: string): PreProduction {
  try {
    return JSON.parse(json) as PreProduction;
  } catch {
    return { characters: [], scenes: [] };
  }
}

/** Parse shots JSON string to Shot[] */
export function parseShots(json: string): Shot[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse doc JSON string to StoryboardDoc */
export function parseDocJson(json: string | undefined): StoryboardDoc {
  if (!json) return { shots: [] };
  try {
    return JSON.parse(json) as StoryboardDoc;
  } catch {
    return { shots: [] };
  }
}
