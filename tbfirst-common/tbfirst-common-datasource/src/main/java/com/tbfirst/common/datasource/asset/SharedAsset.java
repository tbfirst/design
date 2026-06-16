package com.tbfirst.common.datasource.asset;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;

/**
 * 跨服务共享资产注册表实体。
 * <p>
 * 任何业务服务生成的图片 / 文件都可注册到此表，其他服务可查询使用。
 * 表位于独立 asset schema，打破 schema-per-service 原则以便共享；访问权限通过 visibility + userId 控制。
 * </p>
 */
@Getter
@Setter
@TableName("asset.shared_asset")
public class SharedAsset extends BaseEntity {

    /** 存储路径，如 "image/uuid.png" */
    @TableField("asset_key")
    private String assetKey;

    /** 逻辑来源桶，如 "image", "adimage" */
    @TableField("bucket")
    private String bucket;

    /** 来源服务名，如 "tbfirst-image" */
    @TableField("source_service")
    private String sourceService;

    /** 来源服务中的 job ID */
    @TableField("source_job_id")
    private Long sourceJobId;

    /** 所属用户 ID */
    @TableField("user_id")
    private Long userId;

    /** MIME 类型 */
    @TableField("content_type")
    private String contentType;

    /** 文件大小（字节） */
    @TableField("file_size")
    private Long fileSize;

    /** JSON 数组标签，便于搜索 */
    @TableField("tags")
    private String tags;

    /** private | shared | public */
    @TableField("visibility")
    private String visibility = "private";
}
