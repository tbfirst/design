package com.tbfirst.common.web.config;

import com.tbfirst.common.web.handler.GlobalExceptionHandler;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

/**
 * tbfirst Web 层自动装配。
 * <p>
 * 仅在 Servlet 栈下激活（WebFlux 不会加载本类），避免把 Servlet Filter 误装配到 Gateway。
 * 业务服务（auth/image/...）引入 common-web 后自动获得：统一异常处理 + CORS。
 * </p>
 *
 * @author tbfirst
 */
@AutoConfiguration      // @AutoConfiguration 替代 @Configuration + spring.factories
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)   // 仅在 Servlet 环境下生效
public class WebAutoConfiguration {

    /**
     * 注册全局异常处理器 {@link GlobalExceptionHandler}。
     *
     * @return 单例处理器；业务可覆盖此 Bean 扩展自定义异常
     */
    @Bean
    @ConditionalOnMissingBean
    public GlobalExceptionHandler tbfirstGlobalExceptionHandler() {
        return new GlobalExceptionHandler();
    }

    /**
     * 注册 CORS 过滤器：开发期全放行，生产应改为白名单。
     * 解决浏览器跨域问题，允许前端访问后端接口。Spring Security 也会自动识别此 Bean，无需额外配置。
     *
     * <p>浏览器同源策略限制了不同源（域名、协议、端口任意不同即不同源）的前端 JavaScript 访问后端接口，
     * CORS（跨源资源共享）是服务器声明允许跨域访问的机制。
     * Spring 提供 CorsFilter 来处理 CORS 请求，配置允许的来源、方法和头信息。</p>
     *
     * 当前网关 yml 里其实没有显式配 spring.cloud.gateway.globalcors。
     * 所以目前网关是"默认行为"：不开启 CORS，浏览器跨域请求会失败
     *
     * @return 配置好的 CorsFilter，对所有路径生效
     */
    @Bean
    @ConditionalOnMissingBean(CorsFilter.class) // 当前上下文没有 CorsFilter Bean 时才创建，避免与业务服务或网关的 CORS 配置冲突
    public CorsFilter tbfirstCorsFilter() {
        // 创建 CORS 配置
        CorsConfiguration cfg = new CorsConfiguration();

        // 配置 CORS 规则
        // todo 开发期全放行，生产应改为白名单禁止使用 "*",网关 yml 里显式配 spring.cloud.gateway.globalcors
        cfg.addAllowedOriginPattern("*");       // 允许所有来源（使用 addAllowedOriginPattern 支持通配符）
        cfg.addAllowedHeader("*");              // 允许所有请求头
        cfg.addAllowedMethod("*");              // 允许所有 HTTP 方法（GET、POST、PUT、DELETE 等）
        cfg.setAllowCredentials(true);          // 允许携带凭证（如 Cookies），前端必须设置 withCredentials: true

        // 注册 CORS 规则，/** 表示对所有接口生效
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);

        return new CorsFilter(source);
    }
}
