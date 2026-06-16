-- V6: 组模特库扩容申请表
-- 组长（二级管理员）发起扩容请求，一级管理员审批；批准时同事务更新 share_group.model_cap。
-- 幂等：老库 baseline-on-migrate=true 下首次启动不会执行；本脚本仅用于后续滚动升级 / 测试库重建。

CREATE TABLE IF NOT EXISTS auth.group_capacity_application (
    id                BIGSERIAL    PRIMARY KEY,
    group_id          BIGINT       NOT NULL REFERENCES auth.share_group(id),
    applicant_id      BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    current_cap       INT,                                                 -- 提交时 model_cap 的快照（审计）
    requested_cap     INT          NOT NULL,                               -- 目标容量
    reason            TEXT         NOT NULL,
    fee_amount        NUMERIC(12, 2),                                      -- TODO 费用；当前允许空
    status            VARCHAR(16)  NOT NULL DEFAULT 'pending',             -- pending | approved | rejected
    reviewer_id       BIGINT,
    review_note       TEXT,
    review_time       TIMESTAMP,
    create_time       TIMESTAMP,
    update_time       TIMESTAMP,
    create_by         BIGINT,
    update_by         BIGINT,
    deleted           SMALLINT     NOT NULL DEFAULT 0
);

-- 同一组同时只允许一条 pending 申请；软删记录不占名额
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_cap_app_group_pending
    ON auth.group_capacity_application(group_id) WHERE status = 'pending' AND deleted = 0;

CREATE INDEX IF NOT EXISTS idx_group_cap_app_status
    ON auth.group_capacity_application(status) WHERE deleted = 0;
