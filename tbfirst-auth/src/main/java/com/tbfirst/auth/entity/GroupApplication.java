package com.tbfirst.auth.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 成立共享组申请实体，对应 {@code auth.group_application} 表。
 */
@Getter
@Setter
@TableName("auth.group_application")
public class GroupApplication extends BaseEntity {

    @TableField("applicant_id")
    private Long applicantId;

    @TableField("proposed_name")
    private String proposedName;

    @TableField("proposed_description")
    private String proposedDescription;

    /** pending | approved | rejected */
    @TableField("status")
    private String status = "pending";

    @TableField("reviewer_id")
    private Long reviewerId;

    @TableField("review_note")
    private String reviewNote;

    @TableField("review_time")
    private LocalDateTime reviewTime;

    @TableField("approved_group_id")
    private Long approvedGroupId;
}
