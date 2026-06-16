package com.tbfirst.common.datasource.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;

/**
 * MyBatis-Plus 全局拦截器自动配置。
 * <p>
 * 装配 PaginationInnerInterceptor（PostgreSQL 方言）和 OptimisticLockerInnerInterceptor。
 * 仅当类路径存在 MybatisConfiguration 时才会启用。
 * </p>
 */
@AutoConfiguration
@ConditionalOnClass(MybatisConfiguration.class)
public class TbfirstMyBatisPlusConfig {

    // 没有这个 Bean，page(...) 不会分页，只会返回全表。
    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 增加 MyBatis-Plus 分页插件，指定数据库方言为 PostgreSQL
        // 业务传 Page<T> 就会自动重写为 LIMIT + OFFSET 或 LIMIT ? OFFSET ?
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.POSTGRE_SQL));
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
