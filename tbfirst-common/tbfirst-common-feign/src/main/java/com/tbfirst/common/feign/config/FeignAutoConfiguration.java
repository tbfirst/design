package com.tbfirst.common.feign.config;

import com.tbfirst.common.core.constant.CommonConstants;
import feign.Feign;
import feign.Logger;
import feign.Request;
import feign.RequestInterceptor;
import org.slf4j.MDC;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

import java.util.concurrent.TimeUnit;

/**
 * Feign 客户端自动装配。
 * <p>
 * 为所有业务服务提供统一的 Feign 默认配置：日志级别、超时、TraceId 透传、内网 Token 注入。
 * 保证跨服务调用时链路可追踪，并通过 X-Internal-Token 保护内部接口。
 * </p>
 *
 * @author tbfirst
 */
@AutoConfiguration
@ConditionalOnClass(Feign.class)
public class FeignAutoConfiguration {

    /**
     * Feign 日志级别配置
     * 这里设置：BASIC 只打印 method + url + status + cost，避免噪音。其他常见级别如：FULL、HEADERS、CUSTOM 等。
     * 配置好后即可在配置文件中开启日志级别
     *
     * @return 日志级别
     */
    @Bean
    @ConditionalOnMissingBean
    public Logger.Level tbfirstFeignLoggerLevel() {
        return Logger.Level.BASIC;
    }

    /**
     * 超时控制配置。
     * <p>
     * 连接 10s，读取 600s（Phase1/Phase2 AI 生图多 reference + 长 prompt 实测 250s–500s；
     * 600s 给约 10 min 余量）。
     * </p>
     * <p>
     * 注意：URL 模式 Feign Client（{@code @FeignClient(url = "...")} 非空）在 Spring Cloud
     * OpenFeign 4.x 不读 {@code spring.cloud.openfeign.client.config.<name>.read-timeout}
     * yml 配置——本 Bean 才是 effective timeout。AiPythonClient 即是 URL 模式，180s 硬编码
     * 是 V5.XII.5 yml bump 至 300s 未生效的根因（V5.XII.7 修复）。
     * </p>
     * <p>
     * 业务服务仍可声明自己的 {@code Request.Options} Bean 覆盖本兜底（{@code @ConditionalOnMissingBean}）。
     * </p>
     *
     * @return Feign 请求默认选项（全局兜底）
     */
    @Bean
    @ConditionalOnMissingBean
    public Request.Options tbfirstFeignOptions() {
        return new Request.Options(10, TimeUnit.SECONDS, 600, TimeUnit.SECONDS, true);
    }

    /**
     * 透传 TraceId + 内网共享 Token 到下游。
     *
     * @return Feign 请求拦截器
     */
    @Bean
    public RequestInterceptor tbfirstTraceIdInterceptor() {
        return template -> {
            // 从 MDC 取 TraceId，续接调用链；无则说明当前线程未经过 TraceIdFilter
            String traceId = MDC.get(CommonConstants.HEADER_TRACE_ID);
            if (traceId != null) {
                template.header(CommonConstants.HEADER_TRACE_ID, traceId);
            }
            // 默认值仅开发兜底，生产必须通过环境变量注入随机 Token
            String internal = System.getenv().getOrDefault("INTERNAL_TOKEN", "tbfirst-internal");
            template.header(CommonConstants.HEADER_INTERNAL_TOKEN, internal);
        };
    }
}
