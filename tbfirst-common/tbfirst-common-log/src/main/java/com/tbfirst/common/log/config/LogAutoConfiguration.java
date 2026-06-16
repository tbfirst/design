package com.tbfirst.common.log.config;

import com.tbfirst.common.log.filter.TraceIdFilter;
import jakarta.servlet.Filter;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;

/**
 * 日志自动装配。
 * <p>
 * 仅在 Servlet 栈激活，为业务服务注册 {@link TraceIdFilter}。
 * 与 logback 中 {@code %X{X-Trace-Id}} 配合输出 TraceId，贯穿每条日志。
 * </p>
 *
 * @author tbfirst
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class LogAutoConfiguration {

    /**
     * 注册 TraceIdFilter，优先级高于任何业务 Filter。
     *
     * @return 过滤器注册 Bean
     */
    @Bean
    @ConditionalOnMissingBean(name = "tbfirstTraceIdFilter")
    public FilterRegistrationBean<Filter> tbfirstTraceIdFilter() {
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>();
        reg.setFilter(new TraceIdFilter());
        reg.addUrlPatterns("/*");
        // HIGHEST_PRECEDENCE 确保 TraceId 在所有后续 Filter 之前注入 MDC
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
        reg.setName("tbfirstTraceIdFilter");
        return reg;
    }
}
