-- V2: 模特库容量可配置化（errorConclude #39）。
--
-- 背景：上一轮把容量 5 / 50 / 30 硬编码在 BrandModelService 常量里，
-- 无法对个别用户 / 组做精调。一级管理员希望在 /admin 页面按需调整。
--
-- 语义：
--   - sys_user.personal_model_cap：null = 按角色走默认（USER=5 / ADMIN=50）；非 null = 覆盖
--   - share_group.model_cap：null = 按全局默认 30；非 null = 覆盖
-- 这样新用户 / 新组无需迁移，老数据也无需批量回填。

ALTER TABLE auth.sys_user    ADD COLUMN IF NOT EXISTS personal_model_cap INT;
ALTER TABLE auth.share_group ADD COLUMN IF NOT EXISTS model_cap          INT;
