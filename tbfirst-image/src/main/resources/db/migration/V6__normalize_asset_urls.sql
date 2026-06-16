-- V6__normalize_asset_urls.sql
--
-- 背景：v3 S1 把 StorageService 抽象重构为「DB 存 assetKey、响应组装时 resolveUrl」。
-- 历史 image.generation_job.asset_urls 列里残留 v2 时代的 "/static/<bucket>/<filename>" 形式 URL，
-- 此次迁移把所有 "/static/" 前缀剥除，使行内值统一为 assetKey 形态（形如 "generated/phase1/uuid.png"）。
--
-- 字段类型说明：
--   asset_urls 是 TEXT，多 URL 用 \n 换行分隔。REPLACE 整段文本里的 "/static/"，
--   因为该子串只可能出现在每段 URL 开头，整段 REPLACE 等价于逐段 REPLACE，安全。
--
-- 幂等：在已无 /static/ 的字符串上 REPLACE 是 no-op，本迁移可重复执行。
--
-- 关联 cloud_plan.md § 8.1 迁移脚本 Step 2、§ 10.2 坑 3。

UPDATE image.generation_job
SET asset_urls = REPLACE(asset_urls, '/static/', '')
WHERE asset_urls LIKE '%/static/%';

-- brand_model.image_key 自表创建起就是 key 形态，无需处理
-- shared_asset.asset_key 自表创建起就是 key 形态，无需处理
--
-- 验证 SQL（不入迁移，作为人工 smoke check）：
--   SELECT COUNT(*) FROM image.generation_job WHERE asset_urls LIKE '%/static/%';
--   -- 期望 0
