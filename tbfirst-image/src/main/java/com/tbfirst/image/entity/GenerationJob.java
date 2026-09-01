package com.tbfirst.image.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.common.datasource.entity.BaseEntity;
import com.tbfirst.image.typehandler.PgJsonbStringTypeHandler;
import lombok.Getter;
import lombok.Setter;
import org.apache.ibatis.type.JdbcType;

import java.time.LocalDateTime;

/**
 * 生图任务记录（image.generation_job）。
 *
 * phaseConfig 列是 PostgreSQL JSONB；Java 字段直接保留 JSON 字符串（业务已序列化/反序列化一层）。
 * 配合 autoResultMap = true，MyBatis 的 selectList / selectById 走 @TableField 驱动的 ResultMap；
 * PostgreSQL 驱动能把字符串按 OTHER -> JSONB 自动转换，因此这里不需要额外 TypeHandler。
 */
@Getter
@Setter
@TableName(value = "image.generation_job", autoResultMap = true)
public class GenerationJob extends BaseEntity {

    /** phase0 / phase1 / phase2 / phase2Color */
    @TableField("phase")
    private String phase;

    @TableField("user_id")
    private Long userId;

    @TableField("request_id")
    private String requestId;

    @TableField("model")
    private String model;

    @TableField("prompt")
    private String prompt;

    /** 已生成资产的 URL，以换行分隔 */
    @TableField("asset_urls")
    private String assetUrls;

    /** pending / success / failed */
    @TableField("status")
    private String status;

    @TableField("error_msg")
    private String errorMsg;

    /** 异步化(V8)：AI 文本结果（dna 提取 JSON、纯文本阶段输出）；图片类阶段为空，结果走 assetUrls */
    @TableField("result_text")
    private String resultText;

    /** 阶段配置（JSONB），用自定义 TypeHandler 在 String ↔ PGobject(jsonb) 之间转换 */
    @TableField(value = "phase_config", jdbcType = JdbcType.OTHER, typeHandler = PgJsonbStringTypeHandler.class)
    private String phaseConfig;

    @TableField("reference_count")
    private Integer referenceCount = 0;

    /** 生成时作者所属组快照，保证历史可见性稳定 */
    @TableField("group_id")
    private Long groupId;

    /** 用户显式"下载并收藏"标记；不影响 LRU */
    @TableField("saved")
    private Boolean saved = Boolean.FALSE;

    /** LRU 基准；生成时 = now，点收藏时刷新为 now */
    @TableField("last_access_at")
    private LocalDateTime lastAccessAt;
}
