package com.tbfirst.image.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.common.security.context.UserContextHolder;
import com.tbfirst.image.entity.AuditLog;
import com.tbfirst.image.mapper.AuditLogMapper;
import com.tbfirst.image.service.AuditLogService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 审计流水服务实现。
 *
 * <p><b>职责：</b>{@link AuditLogService} 的唯一实现，向 image.audit_log 表插入审计行。
 * {@link #log} 把所有异常吞掉仅记 warn 日志 —— 审计失败<b>不能</b>影响主业务链路。</p>
 *
 * <p><b>读接口：</b>{@link #getMyLogs} 走 UserContextHolder 拿当前 userId；
 * {@link #countByUser} 供 auth 服务 Feign 调用（对 audit_log 计数，不是 generation_job 计数，
 * 因此是"有过哪些动作"而非"成功生成多少张"；若后续需要"成功生成数"应另加方法或改读 generation_job）。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuditLogServiceImpl implements AuditLogService {

    private final AuditLogMapper mapper;

    public void log(String phase, String actionDetail, Long jobId) {
        try {
            Long userId = UserContextHolder.currentUserId();
            if (userId == null) return;

            AuditLog entry = new AuditLog();
            entry.setUserId(userId);
            entry.setPhase(phase);
            entry.setActionDetail(actionDetail);
            entry.setGenerationJobId(jobId);
            // SQL: INSERT INTO image.audit_log (user_id, phase, action_detail, generation_job_id,
            //      create_time, update_time, create_by, update_by, deleted)
            //      VALUES (?, ?, ?, ?, now(), now(), ?, ?, 0)
            mapper.insert(entry);
        } catch (Exception e) {
            log.warn("[Audit] log failed: {}", e.getMessage());
        }
    }

    public List<AuditLog> getMyLogs() {
        Long userId = UserContextHolder.currentUserId();
        if (userId == null) return List.of();
        // SQL: SELECT * FROM image.audit_log
        //      WHERE user_id = ? AND deleted = 0 ORDER BY create_time DESC
        return mapper.selectList(new LambdaQueryWrapper<AuditLog>()
                .eq(AuditLog::getUserId, userId)
                .orderByDesc(AuditLog::getCreateTime));
    }

    public long countByUser(Long userId) {
        // SQL: SELECT COUNT(*) FROM image.audit_log WHERE user_id = ? AND deleted = 0
        return mapper.selectCount(new LambdaQueryWrapper<AuditLog>().eq(AuditLog::getUserId, userId));
    }
}
