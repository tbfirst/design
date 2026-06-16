-- V7__rename_asset_key_prefix.sql
--
-- 背景：v3 后续把所有图片资源的物理存储前缀统一收敛到 image/ 命名空间下，
-- 与 GCS 桶（gs://tbfirst-bucket-01/）预建的 image/phaseX/、image/inpaint/ 目录布局对齐。
--
-- 代码侧改动：
--   ImageGenerateServiceImpl: "generated/" + phase  ->  "image/" + phase
--   BrandModelServiceImpl   : BUCKET="brand-model"  ->  STORAGE_PREFIX="image/brand-model"
--                             (LOGICAL_BUCKET 仍保留 "brand-model" 作为 shared_asset.bucket 业务标签)
--
-- 数据迁移目标：把历史行里 assetKey 列的物理前缀同步替换。
--
-- 字段：
--   image.generation_job.asset_urls : TEXT，多 key 用 \n 分隔，开头形如 "generated/phaseX/uuid.png"
--   image.brand_model.image_key      : VARCHAR，单值，形如 "brand-model/uuid.png"
--   asset.shared_asset.asset_key     : VARCHAR，单值，可能为 "generated/..." 或 "brand-model/..."
--   asset.shared_asset.bucket        : VARCHAR，业务分类标签（'generated' / 'brand-model' 等），保留不动
--
-- 幂等：每条 UPDATE 都带 WHERE LIKE 守卫，命中 0 行即 no-op；可重复执行。
--
-- 关联 cloud_plan.md（用户桶布局：image/phase{0,1,2,2Color,3}/、image/inpaint/、modellink/、realshow/）。

-- 1) generation_job 多值列：phase0/1/2/2Color/3 + inpaint，逐一 REPLACE。
--    REPLACE 是字符串级，对 \n 分隔的多段 URL 安全（只替换段首前缀，子串不会误命中段中文本）。
UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, 'generated/phase0/', 'image/phase0/')
WHERE asset_urls LIKE '%generated/phase0/%';

UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, 'generated/phase1/', 'image/phase1/')
WHERE asset_urls LIKE '%generated/phase1/%';

UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, 'generated/phase2Color/', 'image/phase2Color/')
WHERE asset_urls LIKE '%generated/phase2Color/%';

-- phase2 必须放在 phase2Color 之后，否则 'generated/phase2/' 会误命中 'generated/phase2Color/' 的开头
UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, 'generated/phase2/', 'image/phase2/')
WHERE asset_urls LIKE '%generated/phase2/%';

UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, 'generated/phase3/', 'image/phase3/')
WHERE asset_urls LIKE '%generated/phase3/%';

UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, 'generated/inpaint/', 'image/inpaint/')
WHERE asset_urls LIKE '%generated/inpaint/%';

-- 2) brand_model.image_key 单值列：仅段首前缀替换。
UPDATE image.brand_model
SET image_key = 'image/brand-model/' || SUBSTRING(image_key FROM LENGTH('brand-model/') + 1)
WHERE image_key LIKE 'brand-model/%';

-- 3) shared_asset.asset_key：跨服务资源表，对应迁移 generated/* 与 brand-model/* 两类前缀。
--    （V4 已 DELETE bucket='brand-model' 历史脏数据，此处 brand-model 命中通常为 0；保留兜底。）
UPDATE asset.shared_asset
SET asset_key = REPLACE(asset_key, 'generated/phase0/', 'image/phase0/')
WHERE asset_key LIKE 'generated/phase0/%';

UPDATE asset.shared_asset
SET asset_key = REPLACE(asset_key, 'generated/phase1/', 'image/phase1/')
WHERE asset_key LIKE 'generated/phase1/%';

UPDATE asset.shared_asset
SET asset_key = REPLACE(asset_key, 'generated/phase2Color/', 'image/phase2Color/')
WHERE asset_key LIKE 'generated/phase2Color/%';

UPDATE asset.shared_asset
SET asset_key = REPLACE(asset_key, 'generated/phase2/', 'image/phase2/')
WHERE asset_key LIKE 'generated/phase2/%';

UPDATE asset.shared_asset
SET asset_key = REPLACE(asset_key, 'generated/phase3/', 'image/phase3/')
WHERE asset_key LIKE 'generated/phase3/%';

UPDATE asset.shared_asset
SET asset_key = REPLACE(asset_key, 'generated/inpaint/', 'image/inpaint/')
WHERE asset_key LIKE 'generated/inpaint/%';

UPDATE asset.shared_asset
SET asset_key = 'image/brand-model/' || SUBSTRING(asset_key FROM LENGTH('brand-model/') + 1)
WHERE asset_key LIKE 'brand-model/%';

-- 验证 SQL（不入迁移，作为人工 smoke check）：
--   SELECT COUNT(*) FROM image.generation_job WHERE asset_urls LIKE '%generated/%';
--   -- 期望 0
--   SELECT COUNT(*) FROM image.brand_model WHERE image_key LIKE 'brand-model/%';
--   -- 期望 0
--   SELECT COUNT(*) FROM asset.shared_asset
--   WHERE asset_key LIKE 'generated/%' OR asset_key LIKE 'brand-model/%';
--   -- 期望 0
