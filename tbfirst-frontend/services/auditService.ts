/**
 * 审计日志 — 后端已自动记录，此处为兼容旧调用（静默空操作）
 */
export const auditService = {
  logGeneration(_phase: string, _actionDetail?: string) {
    // 后端 ImageGenerateService 已自动写审计日志，前端不再需要显式调用
  }
};
