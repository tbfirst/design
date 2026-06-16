package com.tbfirst.common.datasource.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * MyBatis-Plus 基础实体类。
 * <p>
 * 所有业务实体应继承此类以统一主键 / 审计字段 / 逻辑删除标志。
 * 审计字段由 {@link com.tbfirst.common.datasource.config.TbfirstMetaObjectHandler}
 * 在 insert / update 时自动填充，业务代码无需手动赋值。
 * 逻辑删除由 {@link TableLogic} 驱动，MP 会在 SELECT / UPDATE 上自动拼接 deleted = 0，
 * 调用 BaseMapper.deleteById / removeById 会改成 UPDATE SET deleted = 1。
 * </p>
 */
@Getter
@Setter
public class BaseEntity implements Serializable {

    /** 主键 ID，PostgreSQL 为 BIGSERIAL，走数据库自增 */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /** 创建时间，由 MetaObjectHandler 在 INSERT 时填充 */
    @TableField(value = "create_time", fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    /** 最后修改时间，由 MetaObjectHandler 在 INSERT / UPDATE 时填充 */
    @TableField(value = "update_time", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    /** 创建人用户 ID，来自 UserContextHolder.currentUserId() */
    @TableField(value = "create_by", fill = FieldFill.INSERT)
    private Long createBy;

    /** 最后修改人用户 ID，来自 UserContextHolder.currentUserId() */
    @TableField(value = "update_by", fill = FieldFill.INSERT_UPDATE)
    private Long updateBy;

    /** 逻辑删除标志：0=正常，1=已删除。@TableLogic 驱动 MP 全局过滤。 */
    @TableLogic(value = "0", delval = "1")
    @TableField("deleted")
    private Short deleted = 0;
}
