package com.tbfirst.cinestitch.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tbfirst.cinestitch.typehandler.PgJsonbStringTypeHandler;
import com.tbfirst.common.datasource.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import org.apache.ibatis.type.JdbcType;

/**
 * 分镜项目实体。对应 {@code cinestitch.storyboard_project} 表。
 */
@Getter
@Setter
@TableName(value = "cinestitch.storyboard_project", autoResultMap = true)
public class StoryboardProject extends BaseEntity {

    @TableField("user_id")
    private Long userId;

    @TableField("title")
    private String title;

    /** pending / success / failed / draft */
    @TableField("status")
    private String status;

    /** stage1 / stage2 / stage3 / stage4 */
    @TableField("stage")
    private String stage;

    @TableField(value = "doc_json", jdbcType = JdbcType.OTHER,
                typeHandler = PgJsonbStringTypeHandler.class)
    private String docJson;

    @TableField("cover_image_url")
    private String coverImageUrl;
}
