-- V3__email_unique.sql
-- 目的：邮箱将成为"按邮箱邀请加入共享组"的主键查询字段，因此需要加唯一索引；
-- 同时保留 auth.sys_user.email 允许 NULL 的历史兼容（老账号没有填过邮箱就会是 NULL）。
--
-- 策略：PARTIAL UNIQUE INDEX。
--   - 仅对非 NULL 且未软删（deleted=0）的邮箱做唯一约束
--   - 以 LOWER(email) 建索引实现大小写不敏感（Alice@x.com 与 alice@x.com 视为同一邮箱）
--   - 不影响多个历史 NULL 记录共存，也不影响已软删用户的邮箱被新注册占用
--
-- 该文件仅包含结构变更，不做数据回填；如需给老账号补邮箱应走单独的运维脚本。

CREATE UNIQUE INDEX IF NOT EXISTS ux_sys_user_email_active
    ON auth.sys_user (LOWER(email))
    WHERE email IS NOT NULL AND deleted = 0;
