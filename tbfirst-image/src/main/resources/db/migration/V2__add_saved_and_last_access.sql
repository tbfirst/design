-- V2: 生图结果 "收藏续命 + LRU 清理" 支持字段
-- 说明：image.generation_job 原由 infra/postgres/init.sql 创建（V1 baseline），
-- 这里增量新增两列，用 IF NOT EXISTS 防御 init.sql 同步更新后的双写场景。

ALTER TABLE image.generation_job
    ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE image.generation_job
    ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMP;

-- 历史存量：last_access_at 初始化为 create_time，保持"创建时即初次访问"的语义
UPDATE image.generation_job
SET last_access_at = create_time
WHERE last_access_at IS NULL;

-- LRU 定时任务按 last_access_at 过滤未软删记录；加索引避免全表扫
CREATE INDEX IF NOT EXISTS idx_generation_job_last_access
    ON image.generation_job (last_access_at)
    WHERE deleted = 0;
