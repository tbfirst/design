package com.tbfirst.image.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

/**
 * 审计日志实体（image.audit_log）。
 */
@Getter
@Setter
@TableName("image.audit_log")
public class AuditLog extends BaseEntity {

    @TableField("user_id")
    private Long userId;

    /** phase0 / phase1 / phase2 / phase2Color / SmartInpaint / Copilot */
    @TableField("phase")
    private String phase;

    @TableField("action_detail")
    private String actionDetail;

    @TableField("generation_job_id")
    private Long generationJobId;
}
