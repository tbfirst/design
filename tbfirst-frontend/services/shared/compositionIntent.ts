import { CompositionIntent, ResolvedCompositionIntent, CompositionScope } from '../../types';

/**
 * 将 `inherit` 解析为真实构图层级。
 * - current.scope !== 'inherit' → 直接返回 current resolved 值
 * - current.scope === 'inherit' && last → 沿用 last
 * - current.scope === 'inherit' && !last → 默认 overall + 整体人物
 */
export function resolveCompositionIntent(
  current: CompositionIntent,
  last: ResolvedCompositionIntent | null | undefined,
): ResolvedCompositionIntent {
  if (current.scope !== 'inherit') {
    return { scope: current.scope as Exclude<CompositionScope, 'inherit'>, target: current.target };
  }
  if (last) return last;
  return { scope: 'overall', target: current.target || '整体人物' };
}

/**
 * 关键词规则推断构图意图（第一版，不调用 AI）。
 * 返回 Partial<CompositionIntent>；无法推断时返回 {}。
 */
export function inferCompositionFromText(text: string): Partial<CompositionIntent> {
  if (!text) return {};
  const t = text;

  if (/织纹|纹理|走线|缝线|拉链|纽扣|五金|皮革纹理/.test(t)) {
    return { scope: 'macro' };
  }
  if (/裤脚|脚踝/.test(t) && /膝盖以下/.test(t)) {
    return { scope: 'segment', target: '裤脚' };
  }
  if (/裤脚|脚踝|鞋履|鞋子|鞋/.test(t)) {
    return { scope: 'detail', target: '裤脚' };
  }
  if (/领口|袖口|口袋|裙摆|腰头|门襟/.test(t)) {
    return { scope: 'detail' };
  }
  if (/上半身|头肩/.test(t)) {
    return { scope: 'half_or_region', target: '上半身' };
  }
  if (/下半身/.test(t)) {
    return { scope: 'half_or_region', target: '下半身' };
  }
  if (/腰腹/.test(t)) {
    return { scope: 'segment', target: '腰腹' };
  }
  if (/全身|整体|全景|人物完整/.test(t)) {
    return { scope: 'overall', target: '整体人物' };
  }
  return {};
}

/**
 * 将推断结果合并进设置，但不覆盖用户显式选择的非 inherit scope。
 */
export function mergeInferredComposition(
  settings: { compositionScope: CompositionScope; compositionTarget: string },
  text: string,
): { compositionScope: CompositionScope; compositionTarget: string } {
  if (settings.compositionScope !== 'inherit' && settings.compositionTarget) {
    return settings;
  }
  const inferred = inferCompositionFromText(text);
  return {
    compositionScope: settings.compositionScope !== 'inherit'
      ? settings.compositionScope
      : (inferred.scope ?? settings.compositionScope),
    compositionTarget: settings.compositionTarget || inferred.target || '',
  };
}
