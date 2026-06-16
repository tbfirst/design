package com.tbfirst.gateway.config;

import com.tbfirst.common.core.constant.CommonConstants;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Mono;

/**
 * Spring Cloud Gateway 限流配置（V5.XVII.K.4）。
 *
 * <p>本配置仅提供 KeyResolver，限流参数（replenishRate / burstCapacity）由
 * application.yml 中各路由 filters 下的 RequestRateLimiter 节配置。</p>
 *
 * <p>限流粒度：按 X-User-Id 维度（已由 {@code AuthGlobalFilter#forward} 注入到下游请求头，
 * 在 RequestRateLimiter Bean 解析 KeyResolver 时已经处于"AuthGlobalFilter 通过"状态，
 * 拿到的 header 是网关 mutate 后的 subject）。未登录 / 白名单路径 → anon 归并桶，
 * 防止匿名洪水放大公共桶。</p>
 *
 * <p>不引入：</p>
 * <ul>
 *   <li>按 IP 限流：JWT 主体已经能唯一定位用户；IP 易被 NAT/网关重写</li>
 *   <li>按 phase 细分：模型级精细配额留给 future.md §1.7 token_ledger 上线后做</li>
 * </ul>
 */
@Configuration
public class RateLimitConfig {

    /**
     * 按用户身份做限流键。X-User-Id 由 {@link com.tbfirst.gateway.filter.AuthGlobalFilter}
     * 在 JWT 校验通过后写入；白名单路径（/api/auth/login 等）此时尚无 header，
     * 归并到 "anon" 桶，防止匿名调用消耗用户额度。
     */
    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> {
            String uid = exchange.getRequest().getHeaders().getFirst(CommonConstants.HEADER_USER_ID);
            return Mono.just((uid == null || uid.isBlank()) ? "anon" : "u:" + uid);
        };
    }
}
