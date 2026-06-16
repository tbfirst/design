-- V7: group_invitation 新增 invitee_email 字段（邀请时的 email 快照）
-- 动机：
--   - 之前只存 invitee_id 外键，组长当时输入的 email 原文未留痕；
--   - 审计 / 前端卡片展示 / 将来"邀请未注册用户"三个场景都需要这个 email 快照。
-- 语义：
--   - 组长提交邀请时 email 原文（小写归一化）落入本字段；
--   - 不是外键，不随 invitee 后续改邮箱而变动；
--   - 存量 pending 邀请无法回填（没有数据源），保持 NULL。
ALTER TABLE auth.group_invitation
    ADD COLUMN IF NOT EXISTS invitee_email VARCHAR(128);

COMMENT ON COLUMN auth.group_invitation.invitee_email IS '邀请时组长输入的邮箱（小写归一化，snapshot；非外键）';
