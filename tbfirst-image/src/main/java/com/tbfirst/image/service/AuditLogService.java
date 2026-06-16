package com.tbfirst.image.service;

import com.tbfirst.image.entity.AuditLog;

import java.util.List;

/**
 * 审计流水服务接口。
 *
 * <p><b>职责：</b>写入和查询生图任务维度的审计记录（phase / actionDetail / jobId）。
 * 这是 tbfirst-image 内部的审计，粒度细到"任务某一阶段做了什么动作"。</p>
 *
 * <p><b>使用方：</b></p>
 * <ul>
 *   <li>{@link ImageGenerateService} 在每个生成阶段调用 {@link #log} 记录；</li>
 *   <li>auth 服务通过 Feign 调用 {@link #countByUser} 汇总"每个用户的成功生成数"，
 *       用于 admin 的用户列表页。</li>
 * </ul>
 *
 * <p><b>实现：</b>{@link com.tbfirst.image.service.impl.AuditLogServiceImpl}。</p>
 */
public interface AuditLogService {

    /**
     * 追加一条审计流水。
     *
     * @param phase        阶段标识（如 phase0/phase1/phase2）
     * @param actionDetail 动作文本（前端直接展示）
     * @param jobId        关联的生成任务 id，可为 null（未绑定具体任务时）
     */
    void log(String phase, String actionDetail, Long jobId);

    /**
     * 查询当前登录用户的审计流水。
     * <p>只返回 user_id = currentUser 且 deleted=0 的记录，按 id 倒序。</p>
     */
    List<AuditLog> getMyLogs();

    /**
     * 统计某用户历史上成功完成的生图任务总数（status=success）。
     * <p>注意：计数走 generation_job 表而非 audit_log 表 —— 审计流水可能多条对一任务。</p>
     */
    long countByUser(Long userId);
}
