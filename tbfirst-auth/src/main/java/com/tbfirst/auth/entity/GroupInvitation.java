package com.tbfirst.auth.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 组长邀请用户入组实体，对应 {@code auth.group_invitation} 表。
 */
@Getter
@Setter
@TableName("auth.group_invitation")
public class GroupInvitation extends BaseEntity {

    @TableField("group_id")
    private Long groupId;

    @TableField("inviter_id")
    private Long inviterId;

    @TableField("invitee_id")
    private Long inviteeId;

    /**
     * 组长在邀请表单里填入的邮箱原文（小写归一化后存）。
     * <p>语义是"邀请时的 email 快照"，不是外键：即便被邀请人之后改邮箱或注销账号，本字段仍保留组长当时输入的值，方便审计与前端展示。</p>
     */
    @TableField("invitee_email")
    private String inviteeEmail;

    /** pending | accepted | rejected | canceled */
    @TableField("status")
    private String status = "pending";

    @TableField("respond_time")
    private LocalDateTime respondTime;
}
