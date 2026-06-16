package com.tbfirst.auth.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源共享组实体，对应 {@code auth.share_group} 表。
 */
@Getter
@Setter
@TableName("auth.share_group")
public class ShareGroup extends BaseEntity {

    @TableField("name")
    private String name;

    @TableField("description")
    private String description;

    @TableField("leader_id")
    private Long leaderId;

    /** active | archived */
    @TableField("status")
    private String status = "active";

    @TableField("member_count")
    private Integer memberCount = 1;

    /** 组模特库容量上限的覆盖值（null 按默认 30） */
    @TableField("model_cap")
    private Integer modelCap;
}
