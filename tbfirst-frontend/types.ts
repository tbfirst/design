/**
 * 全局类型定义
 */
export enum AppPhase {
  ASSET_STUDIO = 'ASSET_STUDIO',
  CREATION = 'CREATION',
  REFINEMENT = 'REFINEMENT',
}

export enum ImageSize {
  K1 = '1K',
  K2 = '2K',
  K4 = '4K',
}

/**
 * Phase0/1 上传素材槽位 —— 槽位值可以是：
 *   - File：用户刚拖拽 / 粘贴选择的文件，尚未上传换短链（极短暂中间态）
 *   - string：已上传到 GCS / 已从模特库选中，本身就是短链 URL（生图请求体走这条路）
 *
 * V5.XVII.G：在此之前 processFiles 只塞 File 然后生图时 fileToDataUri 现场转 base64，
 * 导致 phase1/generate 请求体动辄数 MB，浏览器 / vite-proxy 易在 socket idle 时 RST。
 * 现在 processFiles 上传换短链后直接把短链塞回 inputs[field] 与 previews[field]，
 * 生图链路 referenceImages 始终是短链字符串，请求体降到几 KB。
 *
 * 类型仍保留 File 是为了两种历史路径：① 库选图 selectFromLibrary 直接传 url string；
 * ② 若某条上传链路失败兜底 fallback 到 fileToDataUri（已支持 string 透传）。
 */
export interface InputFiles {
  mannequinFront?: File | string;
  mannequinSide?: File | string;
  mannequinBack?: File | string;
  mannequinDetail?: (File | string)[];
  model?: File | string;
  product?: (File | string)[];
  scene?: File | string;
  accessory?: (File | string)[];
}

/**
 * 参考图标签映射（errorConclude #41）。字段与 InputFiles 严格对齐：
 * - 单图字段（mannequinFront/Side/Back、model、scene）对应 string | undefined
 * - 多图字段（mannequinDetail、product、accessory）对应 string[]（按索引对齐）
 *
 * 空串或 undefined 表示"用户没打标"，后端按位置走默认 label_map（保持向后兼容）。
 * 不持久化：关标签 / 刷新页面即失效；只在当前生图批次内语义有效。
 */
export interface InputLabels {
  mannequinFront?: string;
  mannequinSide?: string;
  mannequinBack?: string;
  mannequinDetail?: string[];
  model?: string;
  product?: string[];
  scene?: string;
  accessory?: string[];
}

export interface AssetStudioSettings {
  tasks: string[];
  smartRetouch: boolean;
  aspectRatio: string;
  imageSize: ImageSize;
  remark: string;
}

export type CompositionScope = 'inherit' | 'overall' | 'half_or_region' | 'segment' | 'detail' | 'macro';

export interface CompositionIntent {
  scope: CompositionScope;
  target: string;
}

export interface ResolvedCompositionIntent {
  scope: Exclude<CompositionScope, 'inherit'>;
  target: string;
}

/**
 * Sprint V5.XVI.7：结构化服装属性槽（可选填）。
 * 不填 → 后端走纯参考图路径（旧行为完全兼容）。
 * 填了 → 后端用 AUTHORITATIVE GARMENT SPEC 段编织进 prompt。
 * 数组索引与 `InputFiles.product[idx]` 对齐，缺位即 undefined。
 */
export interface GarmentAttrs {
  dominantColor?: string;     // hex 或中文色名，如 "#B4252A" / "酒红"
  print?: string;             // 印花描述，如 "小碎花 / 几何条纹 / 纯色"
  hardware?: string;          // 五金材质，如 "亚光银金属扣 / 树脂扣 / 无"
  logo?: string;              // logo 位置与样式，如 "左胸刺绣 / 后领织标 / 无"
  stitching?: string;         // 走线特征，如 "明线撞色 / 暗线同色"
}

export interface Phase1Settings {
  shotType: string;
  tone: string;
  atmosphere: string;
  remark: string;
  count: number;
  imageSize: ImageSize;
  aspectRatio: string;
  compositionScope: CompositionScope;
  compositionTarget: string;
  garmentAttrs?: GarmentAttrs[];
}

export interface Phase2Settings {
  selectedBaseImages: string[];
  actions: string[];
  expression: string;
  focus: string;
  detailFocus?: string;
  fabricDetail?: string;
  flatLayDetail?: string;
  lighting: string;
  aspectRatio: string;
  remark: string;
  imageSize: ImageSize;
  count: number;
  compositionScope: CompositionScope;
  compositionTarget: string;
  poseAction: string;
  gestureAction: string;
  customAction: string;
  garmentAttrs?: GarmentAttrs[];
}

// === 新增：色彩实验室独立配置 ===
export interface Phase2ColorSettings {
  targetColor: string; // HEX 色值
  targetArea: string;  // 目标区域 (如 Dress, Background)
  remark: string; // 补充描述
  intensity: number;   // 0-100 强度
  count: number;
  aspectRatio: string; // 新增：比例控制
  imageSize: ImageSize; // 新增：画质控制
  referenceImageUrl: string | null; // 新增：多模态参考图
}

export interface GeneratedImage {
  id: string;
  taskId?: string;
  taskNumber?: number;
  url: string;
  promptUsed: string;
  dnaUsed?: string; // Phase 0 专属：记录解析出的结构参数
  aspectRatio: string;
  phase: 0 | 1 | 2 | 3;
  status?: 'pending' | 'queued' | 'done' | 'error' | 'retrying';
  errorMessage?: string;
  actionLabel?: string;
  compositionSummary?: string;
  usedFallback?: boolean;
  originalUrl?: string; // Phase3 专用：渲染前底片 url（hover 对比用）
  variationIndex?: number; // 批量生成时的变体序号（0-based），创建时写入，避免闭包陈旧
  variationTotal?: number; // 本批总数
}

export interface Phase3Settings {
  inspirationImage?: string;            // 灵感参考图 data URI
  styleDNA: string;                      // 英文 prompt tags 逗号分隔
  dnaTranslation?: {                     // 4 维度中文翻译
    color: string;
    lighting: string;
    texture: string;
    mood: string;
  };
  intensity: number;                     // 0-1 浮点（slider step 0.1）
  grain: boolean;                        // 颗粒感开关
  contrast: 'Low' | 'Standard' | 'High'; // 3 档对比度
  imageSize: ImageSize;                  // 复用现有枚举
  remark: string;                        // 用户补充描述（高优先级 P0，覆盖 DNA 默认调色倾向）
  garmentAttrs?: GarmentAttrs[];
}

export interface ImageBatch {
  id: string;
  batchNumber: number;
  timestamp: number;
  phase: 0 | 1 | 2 | 3;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  configSummary: string;
  progress: {
    current: number;
    total: number;
  };
  images: GeneratedImage[];
}

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";

export interface ApiKeyModalProps {
  onSuccess: () => void;
}