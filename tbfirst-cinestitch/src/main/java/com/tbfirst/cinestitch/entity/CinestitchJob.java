package com.tbfirst.cinestitch.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

/**
 * Cinestitch 生成作业实体。对应 {@code cinestitch.cinestitch_job}。
 */
@Getter
@Setter
@TableName("cinestitch.cinestitch_job")
public class CinestitchJob extends BaseEntity {

    @TableField("user_id")
    private Long userId;

    @TableField("model")
    private String model;

    @TableField("prompt")
    private String prompt;

    @TableField("result")
    private String result;

    /** pending / success / failed */
    @TableField("status")
    private String status;

    /** product / video */
    @TableField("job_type")
    private String jobType;

    /** 参考图 /img/... 路径，用于历史缩略图展示 */
    @TableField("image_url")
    private String imageUrl;
}
