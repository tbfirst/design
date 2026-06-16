-- V4: 把 image.brand_model 从"每用户私有"改造为"全局共享"。
--
-- 背景：原实现用 user_id 物理隔离，每个账号有独立模特库。现在改为：
--   - 全局一个共享库，所有已登录用户可 GET 查看
--   - 仅 image:manage-models 权限的账号可 POST/PUT/DELETE
--   - 全局 50 张上限（Service 层 count 校验，见 BrandModelService.upload）
--   - user_id 字段保留，但语义从"所有者"改为"上传者"（审计用途）
--
-- 用户决定：**清空历史数据从空库重新开始**，避免把原本私有的模特
-- 意外暴露给所有人（errorConclude #37）。
--
-- 同步清理 asset.shared_asset 里 bucket='brand-model' 的旧记录，保持一致。
-- 物理文件（UPLOADS_PATH/brand-model/*）由清理任务处理，本次不动。

DELETE FROM image.brand_model;

DELETE FROM asset.shared_asset WHERE bucket = 'brand-model';
