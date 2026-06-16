package com.tbfirst.image.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

/**
 * 品牌模特实体（image.brand_model）—— 单组制。
 *
 * group_id = null 个人库；非 null 组共享库。
 */
@Getter
@Setter
@TableName("image.brand_model")
public class BrandModel extends BaseEntity {

    @TableField("name")
    private String name;

    @TableField("image_key")
    private String imageKey;

    @TableField("mime_type")
    private String mimeType;

    @TableField("file_size")
    private Long fileSize;

    /** 上传者 user_id，作为权限控制的所有者字段 */
    @TableField("user_id")
    private Long userId;

    /** private / shared / public，保留作审计 */
    @TableField("visibility")
    private String visibility = "private";

    /** null = 个人库；非 null = 组共享库 */
    @TableField("group_id")
    private Long groupId;
}
