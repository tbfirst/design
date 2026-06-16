package com.tbfirst.auth.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 共享组模特库"扩容申请"实体，对应 {@code auth.group_capacity_application} 表。
 */
@Getter
@Setter
@TableName("auth.group_capacity_application")
public class GroupCapacityApplication extends BaseEntity {

    @TableField("group_id")
    private Long groupId;

    @TableField("applicant_id")
    private Long applicantId;

    @TableField("current_cap")
    private Integer currentCap;

    @TableField("requested_cap")
    private Integer requestedCap;

    @TableField("reason")
    private String reason;

    /** TODO：扩容对应的费用金额；当前支付流程未接入 */
    @TableField("fee_amount")
    private BigDecimal feeAmount;

    /** pending | approved | rejected */
    @TableField("status")
    private String status = "pending";

    @TableField("reviewer_id")
    private Long reviewerId;

    @TableField("review_note")
    private String reviewNote;

    @TableField("review_time")
    private LocalDateTime reviewTime;
}
