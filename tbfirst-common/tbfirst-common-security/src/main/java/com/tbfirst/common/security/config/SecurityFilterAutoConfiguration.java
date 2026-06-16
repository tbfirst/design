package com.tbfirst.common.security.config;

import com.tbfirst.common.security.filter.UserContextFilter;
import jakarta.servlet.Filter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;

import java.util.Arrays;
import java.util.List;

/**
 * 安全过滤器自动装配。
 * <p>
 * 仅在 Servlet 栈下激活，WebFlux 应用（如 Gateway）不会加载本类。
 * 为业务微服务注册 {@link UserContextFilter}，把 Gateway 透传的用户头放入 ThreadLocal。
 * </p>
 *
 * @author tbfirst
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityFilterAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(SecurityFilterAutoConfiguration.class);

    /**
     * 显式注册 UserContextFilter 到 Servlet 容器，排在日志 Filter 之后、业务之前。
     *
     * @return 过滤器注册 Bean
     */
    @Bean
    // 历史坑（errorConclude #23/#29 共同根因）：这里曾写 `@ConditionalOnMissingBean` 不带参数，
    // Spring 会按"方法返回类型"（FilterRegistrationBean，泛型被擦除为 raw type）做存在性判断——
    // 而 Spring Boot Servlet 自动装配 / common-web 的 CorsFilter 包装出来的 FilterRegistrationBean
    // 已经先占位，导致本 @Bean 根本不会被实例化：UserContextFilter 没注册 → 下游永远 X-User-Id 缺失 →
    // user_id 写 null。必须限定按 bean 名比较，否则该条件永远为假。
    @ConditionalOnMissingBean(name = "tbfirstUserContextFilter")
    public FilterRegistrationBean<Filter> tbfirstUserContextFilter(
            // 服务层豁免前缀从 Nacos 共享配置注入；缺省空串 → UserContextFilter 回落内置默认（Nacos 不可用也安全）
            @Value("${tbfirst.security.service-exempt-prefixes:}") String exemptCsv) {
        // 启动日志打在 INFO：若某个服务启动后看不到这行，基本可断定加载的是旧 common-security jar（见 errorConclude #26/#29），
        // 需要按 README / CLAUDE.md 的步骤彻底清 ~/.m2/repository/com/tbfirst 再整站重编
        List<String> exempt = (exemptCsv == null || exemptCsv.isBlank())
                ? List.of()
                : Arrays.stream(exemptCsv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        log.info("[common-security] registering UserContextFilter (hard-reject missing X-User-Id on /api/**, exemptPrefixes={})",
                exempt.isEmpty() ? "<default>" : exempt);
        FilterRegistrationBean<Filter> reg = new FilterRegistrationBean<>();
        reg.setFilter(new UserContextFilter(exempt));
        reg.addUrlPatterns("/*");
        // HIGHEST_PRECEDENCE+20：确保在 TraceIdFilter(+10) 之后执行，但先于业务逻辑
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);
        reg.setName("tbfirstUserContextFilter");
        return reg;
    }
}
