-- V5: 把 V4 的"全站共享"模特库拆成"个人库 + 组共享库"；历史生图加组互见字段。
--
-- 背景（errorConclude #38）：
--   - V4 把 image.brand_model 变成 50 张全局共享库，按 scope + 角色闸门控制写操作
--     （早期用 @RequirePermission('image:manage-models')，2026-04-22 permissions 体系下线后
--      完全改由 BrandModelService.loadAndAuthorize 判定）
--   - 本次改成"每人一份个人库（USER 5 / ADMIN 50）+ 每组一份 30 张共享库"
--   - 既有 50 张数据不清空：统一归到第一个 ADMIN 名下，让其保留为该管理员的个人 50 张库
--
-- 决策：
--   - user_id 在组场景下 = 上传者（用来判定"只能删自己的模特"）
--   - group_id 是新字段：null = 个人库；非 null = 该组共享库
--   - generation_job 加 group_id（生成时的组快照），供"组内历史互见"查询使用
--
-- 注意：auth.sys_user 跨在另一个 schema / 服务 / Flyway 实例；
-- UPDATE 子查询用 EXISTS 保护，裸库（未运行 seeder）时保持 user_id 不变，管理员首次登录后手动认领。

-- 1) 既有 50 张共享库归到第一个 ADMIN 名下
UPDATE image.brand_model bm
SET user_id = (
  SELECT id FROM auth.sys_user
  WHERE roles LIKE '%ADMIN%' AND deleted = 0
  ORDER BY id
  LIMIT 1
)
WHERE deleted = 0
  AND EXISTS (
    SELECT 1 FROM auth.sys_user WHERE roles LIKE '%ADMIN%' AND deleted = 0
  );

-- 2) brand_model 加 group_id：null = 上传者的个人库；非 null = 该组共享库
ALTER TABLE image.brand_model ADD COLUMN IF NOT EXISTS group_id BIGINT;

-- 原 idx_brand_model_user 仍保留（个人库按 user_id 查询时能走索引）
-- 新增组库索引：按 group_id 查询某组全部模特时使用
CREATE INDEX IF NOT EXISTS idx_brand_model_personal
    ON image.brand_model(user_id)
    WHERE deleted = 0 AND group_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_model_group
    ON image.brand_model(group_id)
    WHERE deleted = 0 AND group_id IS NOT NULL;

-- 3) generation_job 加 group_id：生成时作者所属组快照；null = 仅作者可见
ALTER TABLE image.generation_job ADD COLUMN IF NOT EXISTS group_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_generation_job_group
    ON image.generation_job(group_id)
    WHERE deleted = 0 AND group_id IS NOT NULL;
