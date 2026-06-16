package com.tbfirst.image.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.image.entity.AuditLog;

/**
 * 审计流水 Mapper：对应 {@code image.audit_log}。
 *
 * <p>纯 {@link BaseMapper}；按用户 id / phase / 时间的筛选都在 AuditLogServiceImpl
 * 用 LambdaQueryWrapper 组装。</p>
 */
public interface AuditLogMapper extends BaseMapper<AuditLog> {
}
