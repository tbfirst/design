-- V8: 清洗历史脏数据 —— sys_user.group_id 指向 archived / 已软删 share_group 的，置空
--
-- 上下文：2026-05-12 前 dissolve / kick / leave 因 MyBatis-Plus FieldStrategy.NOT_NULL 默认行为
--        导致 userMapper.updateById(entity) 跳过 null 字段，user.group_id / group_role 未被清空，
--        留下大量指向 archived 组的孤儿引用。该 bug 已于 V3.2 修复（切到 LambdaUpdateWrapper），
--        本迁移做一次性历史清洗。
--
-- 幂等性：UPDATE 的 WHERE 已经把"应该是 null 的"行选出来；多次执行结果一致（已 null 的不会被再次更新）。
-- Flyway 默认按版本号执行一次，但即使因为 baseline 重置等原因再跑一次也安全。

UPDATE auth.sys_user u
SET group_id   = NULL,
    group_role = NULL,
    update_time = now()
WHERE u.deleted = 0
  AND u.group_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM auth.share_group g
    WHERE g.id = u.group_id
      AND (g.status <> 'active' OR g.deleted = 1)
  );

-- 同步 active 组的 member_count（如历史 bug 导致计数偏差，这里一并校准）。
-- 仅动 active 组：archived 组的 member_count=0 是 dissolve 时的归档快照语义，不动。
UPDATE auth.share_group g
SET member_count = (
        SELECT count(*) FROM auth.sys_user u
        WHERE u.group_id = g.id AND u.deleted = 0
    ),
    update_time = now()
WHERE g.status = 'active' AND g.deleted = 0;
