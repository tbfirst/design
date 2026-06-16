-- V1: 引入「资源共享组」相关的表和字段。
--
-- 背景：在原扁平用户模型基础上，新增"组共享"第二层：
--   - share_group: 组本体；每组一名组长（leader_id）+ 若干成员
--   - group_application: 用户向一级管理员提交"成立组"申请（注册时勾选 / 登录后主动申请都走这里）
--   - group_invitation: 组长向已登录用户发出的入组邀请
--   - sys_user 增加 group_id / group_role 两列承载"每人最多一个组"的单组制
--
-- 与 init.sql 的关系：init.sql 在首次建库时已执行，这里使用 IF NOT EXISTS
-- 做幂等兜底；已有数据库亦可顺利升级。
-- baseline-on-migrate=true 保证既有 sys_user 数据不被 Flyway 当成需要初始化。

-- 1) 共享组本体
CREATE TABLE IF NOT EXISTS auth.share_group (
    id             BIGSERIAL    PRIMARY KEY,
    name           VARCHAR(64)  NOT NULL UNIQUE,                  -- 组名全局唯一
    description    TEXT,
    leader_id      BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    status         VARCHAR(16)  NOT NULL DEFAULT 'active',        -- active | archived
    member_count   INT          NOT NULL DEFAULT 1,               -- 冗余计数，避免每次 COUNT 查询
    create_time    TIMESTAMP,
    update_time    TIMESTAMP,
    create_by      BIGINT,
    update_by      BIGINT,
    deleted        SMALLINT     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_share_group_leader ON auth.share_group(leader_id) WHERE deleted = 0;

-- 2) 为 sys_user 补充组成员字段（IF NOT EXISTS 保证幂等）
ALTER TABLE auth.sys_user ADD COLUMN IF NOT EXISTS group_id   BIGINT REFERENCES auth.share_group(id);
ALTER TABLE auth.sys_user ADD COLUMN IF NOT EXISTS group_role VARCHAR(16);         -- leader | member；null = 无组
CREATE INDEX IF NOT EXISTS idx_sys_user_group ON auth.sys_user(group_id) WHERE deleted = 0 AND group_id IS NOT NULL;

-- 3) 成立组申请
CREATE TABLE IF NOT EXISTS auth.group_application (
    id                   BIGSERIAL    PRIMARY KEY,
    applicant_id         BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    proposed_name        VARCHAR(64)  NOT NULL,
    proposed_description TEXT,
    status               VARCHAR(16)  NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    reviewer_id          BIGINT,
    review_note          TEXT,
    review_time          TIMESTAMP,
    approved_group_id    BIGINT REFERENCES auth.share_group(id),
    create_time          TIMESTAMP,
    update_time          TIMESTAMP,
    create_by            BIGINT,
    update_by            BIGINT,
    deleted              SMALLINT     NOT NULL DEFAULT 0
);
-- 同一申请人同时只能有一条 pending 申请；软删记录不占名额
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_app_applicant_pending
    ON auth.group_application(applicant_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_app_status ON auth.group_application(status) WHERE deleted = 0;

-- 4) 入组邀请
CREATE TABLE IF NOT EXISTS auth.group_invitation (
    id            BIGSERIAL    PRIMARY KEY,
    group_id      BIGINT       NOT NULL REFERENCES auth.share_group(id),
    inviter_id    BIGINT       NOT NULL,                           -- 发出邀请的组长
    invitee_id    BIGINT       NOT NULL,                           -- 被邀请的用户
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',         -- pending | accepted | rejected | canceled
    respond_time  TIMESTAMP,
    create_time   TIMESTAMP,
    update_time   TIMESTAMP,
    create_by     BIGINT,
    update_by     BIGINT,
    deleted       SMALLINT     NOT NULL DEFAULT 0
);
-- 同一 invitee 同时只允许一条 pending 邀请（任何组）；避免同时被两个组拉人导致冲突
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invitation_invitee_pending
    ON auth.group_invitation(invitee_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_invitation_group ON auth.group_invitation(group_id) WHERE deleted = 0;
