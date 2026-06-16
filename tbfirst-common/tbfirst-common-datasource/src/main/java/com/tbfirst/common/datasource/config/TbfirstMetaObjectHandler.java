package com.tbfirst.common.datasource.config;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import com.tbfirst.common.security.context.UserContextHolder;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * MyBatis-Plus 自动填充处理器。
 * <p>
 * 配合 {@link com.tbfirst.common.datasource.entity.BaseEntity} 上的
 * {@code @TableField(fill = FieldFill.INSERT / INSERT_UPDATE)} 注解使用。
 * INSERT 时填充 createTime / updateTime / createBy / updateBy，UPDATE 时刷新 updateTime / updateBy。
 * 使用 strict*Fill 语义避免覆盖业务代码已显式赋值的字段。
 * </p>
 */
@Component
public class TbfirstMetaObjectHandler implements MetaObjectHandler {

    // 该方法配合 BaseEntity 上的 @TableField(fill = FieldFill.INSERT) 注解，在 INSERT 时自动填充字段
    @Override
    public void insertFill(MetaObject metaObject) {
        LocalDateTime now = LocalDateTime.now();
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, now);
        this.strictInsertFill(metaObject, "updateTime", LocalDateTime.class, now);
        Long uid = UserContextHolder.currentUserId();
        this.strictInsertFill(metaObject, "createBy", Long.class, uid);
        this.strictInsertFill(metaObject, "updateBy", Long.class, uid);
    }

    // 该方法配合 BaseEntity 上的 @TableField(fill = FieldFill.INSERT_UPDATE) 注解，在 UPDATE 时自动刷新字段
    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
        Long uid = UserContextHolder.currentUserId();
        if (uid != null) {
            this.strictUpdateFill(metaObject, "updateBy", Long.class, uid);
        }
    }
}
