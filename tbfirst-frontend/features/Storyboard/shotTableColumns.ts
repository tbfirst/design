// 分镜表列规格（单一真源）：被 Stage2Storyboard（可编辑）、ShotTableView（只读）、
// shotTableCanvas（导出 PNG）三处复用，避免列定义漂移。

/** 景别中文白话选项（与后端 prompt 一致） */
export const SHOT_SIZE_OPTIONS = ['大特写', '特写', '近景', '中近景', '中景', '中远景', '远景', '全景'];

export type TextCol = 'scene' | 'shotSize' | 'description' | 'action' | 'cameraMovement' | 'dialogue' | 'duration' | 'notes';

// w = 列宽百分比（tableLayout:fixed）；与镜号(4)+操作(4) 合计 100，全部列在框内显示、不横向滚动
export const TEXT_COLS: { key: TextCol; label: string; w: number; multiline?: boolean }[] = [
  { key: 'scene', label: '场次', w: 9 },
  { key: 'shotSize', label: '景别', w: 7 },
  { key: 'description', label: '画面内容', w: 18, multiline: true },
  { key: 'action', label: '角色动作', w: 15, multiline: true },
  { key: 'cameraMovement', label: '镜头运动', w: 9 },
  { key: 'dialogue', label: '台词/旁白', w: 15, multiline: true },
  { key: 'duration', label: '时长', w: 5 },
  { key: 'notes', label: '备注', w: 14, multiline: true },
];
