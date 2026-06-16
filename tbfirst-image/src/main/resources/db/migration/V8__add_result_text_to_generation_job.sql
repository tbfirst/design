-- 生图异步化（P1）：generate 改为"立即返回 jobId + 后台出图"后，
-- 原本同步响应里 rawResponse 承载的 AI 文本结果（如 phase3/phase0 的 dna 提取 JSON、
-- 纯文本类阶段输出）必须落库，否则前端轮询 /jobs/{id}/status 取不到文本结果。
-- 新增 result_text 列保存这部分文本；图片类阶段该列为空，结果仍走 asset_urls。
ALTER TABLE image.generation_job ADD COLUMN IF NOT EXISTS result_text TEXT;
