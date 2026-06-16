// 分镜四阶段 V6.SB.1 — 前端类型定义

export interface BibleCharacter {
  id: string;
  name: string;
  appearance?: string;
}

export interface BibleScene {
  id: string;
  name: string;
  location?: string;
  timeOfDay?: string;
  lighting?: string;
}

export interface PreProduction {
  logline?: string;
  characters: BibleCharacter[];
  scenes: BibleScene[];
  styleRef?: string;
  estShotCount?: number;
}

export type FrameStatus = 'idle' | 'generating' | 'done' | 'error';

export interface ShotFrame {
  frameIndex: number;
  imageUrl?: string;
  status: FrameStatus;
  /** 审片台标记：默认保留；false=弃用（不进入排版） */
  keep?: boolean;
}

/** 一张「N 宫格」整图（Stage2 生成图，每张内含 N 个小图，对应 N 个分镜） */
export interface GridImage {
  id: string;
  imageUrl?: string; // /img/ 短链
  status: FrameStatus;
  /** 生成该图时的分镜表快照（精简列）→ 审片台「查看分镜表」溯源；不同图可相同 */
  shots?: Shot[];
}

/** 排版每个槽位的填充：引用某张宫格图 + 其中第 cellIndex 个小格 */
export interface LayoutSlot {
  sourceImageId?: string;
  cellIndex?: number;
}

export type MotionType = 'static' | 'motion';

export interface Shot {
  shotNo: number;
  sceneId?: string;
  scene?: string; // 场次（可读名）
  characterIds: string[];
  shotSize?: string; // 景别
  description?: string; // 画面内容
  action?: string; // 角色动作
  cameraMovement?: string; // 镜头运动
  dialogue?: string; // 台词/旁白
  duration?: string; // 时长
  notes?: string; // 备注
  motionType: MotionType;
  frameCount: number;
  frames: ShotFrame[];
}

/** 服装资产 + AI 视觉一致性档案（Stage1 服装单品模式） */
export interface GarmentInfo {
  refs: string[]; // /img/ 短链
  consistencyProtocol: string; // 可编辑的视觉一致性档案
}

/** 主模特（来自共享模特库），锁定全片人物一致性 */
export interface ModelInfo {
  refs: string[]; // 模特参考图 /img/ 短链
  name?: string;
  id?: number;
}

/** 生成参数（Stage1 设定，贯穿出图） */
export interface GenParams {
  aspectRatio: string; // '3:4' | '16:9' | '9:16' | '1:1'
  gridCount: number; // 关键帧数 N = 分镜数 = 每张图的宫格数（1/4/6/9/16/25）
  imageCount: number; // 生图数量 M = 生成几张 N 宫格图（滑动条）
  quality: '1K' | '2K'; // 映射 Gemini imageConfig.imageSize
}

export const DEFAULT_GEN_PARAMS: GenParams = { aspectRatio: '3:4', gridCount: 9, imageCount: 4, quality: '1K' };

/** 关键帧数 N（= 分镜数 = 宫格数）可选档位（已取消 6 宫格） */
export const GRID_OPTIONS = [1, 4, 9, 16, 25] as const;

/** N → [行数, 列数]。保留 6=2×3 仅为兼容历史项目（不再作为可选档位），其余为正方形网格 */
export const GRID_DIMS: Record<number, [number, number]> = {
  1: [1, 1], 4: [2, 2], 6: [2, 3], 9: [3, 3], 16: [4, 4], 25: [5, 5],
};

/** 取 N 的网格几何（未登记的 N 退化为最接近的正方形） */
export function gridDims(n: number): [number, number] {
  if (GRID_DIMS[n]) return GRID_DIMS[n];
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  return [side, side];
}

export interface VideoClip {
  shotNo: number;
  operationName?: string;
  status: 'idle' | 'generating' | 'done' | 'error';
  videoUri?: string;
  prompt?: string;
  imageDataUri?: string;
  error?: string;
}

export interface StoryboardDoc {
  preProduction?: PreProduction;
  shots: Shot[];
  garment?: GarmentInfo;
  model?: ModelInfo;
  genParams?: GenParams;
  storyText?: string;
  gridImages?: GridImage[];
  layout?: LayoutSlot[];
  videoClips?: VideoClip[];
}

export interface StoryboardProject {
  id: number;
  title: string;
  status: string;
  stage?: string;
  docJson?: string;
  coverImageUrl?: string;
  createTime?: string;
}
