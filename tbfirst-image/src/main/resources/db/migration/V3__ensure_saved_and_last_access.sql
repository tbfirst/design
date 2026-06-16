-- V3: 防御性确保 saved / last_access_at 列存在
--
-- 背景：开发机上观察到 V2 被 flyway_schema_history 标为"已应用"，但实际只有部分列生效
-- （很可能是在 V2 迭代早期、半成品被执行过一次）。repair() 只改 checksum 不会重跑脚本，
-- 导致 Hibernate 启动时 schema-validation 报 "missing column last_access_at"。
--
-- 本脚本全部使用 IF NOT EXISTS，幂等且无害：
--   - 列/索引已存在 → no-op
--   - 列/索引缺失  → 补齐
-- 因此对历次 V2 的各种中间态都能收敛到一致状态。

ALTER TABLE image.generation_job
    ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE image.generation_job
    ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMP;

UPDATE image.generation_job
SET last_access_at = create_time
WHERE last_access_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_generation_job_last_access
    ON image.generation_job (last_access_at)
    WHERE deleted = 0;
