package com.tbfirst.auth.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

/**
 * 系统用户实体，对应 {@code auth.sys_user} 表。
 */
@Getter
@Setter
@TableName("auth.sys_user")
public class User extends BaseEntity {

    @TableField("username")
    private String username;

    @TableField("password_hash")
    private String passwordHash;

    @TableField("nickname")
    private String nickname;

    @TableField("email")
    private String email;

    /** 角色字符串：ADMIN / USER */
    @TableField("roles")
    private String roles;

    /** 账号状态：active / disabled / pending */
    @TableField("status")
    private String status = "active";

    @TableField("last_active_at")
    private java.time.LocalDateTime lastActiveAt;

    /** 所属资源共享组 ID，null 表示未加入任何组 */
    @TableField("group_id")
    private Long groupId;

    /** 组内角色：leader | member；null 表示无组 */
    @TableField("group_role")
    private String groupRole;

    /** 个人模特库容量上限的覆盖值（null 按角色默认） */
    @TableField("personal_model_cap")
    private Integer personalModelCap;
}
