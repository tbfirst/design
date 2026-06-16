package com.tbfirst.gateway.filter;

import com.tbfirst.common.core.constant.CommonConstants;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 生图日额配额硬熔断（V5.XVII.K.4 + K.9）。
 *
 * <p>定位：在 {@link AuthGlobalFilter}（Order=-100）之后、RequestRateLimiter（Order≈10000）之前
 * 拦截 {@code /api/image\/**\/generate} 的所有调用，按 {@code X-User-Personal-Cap} JWT claim 做日额硬熔断。</p>
 *
 * <p>K.9 设计调整：</p>
 * <ul>
 *   <li><b>移除 X-Image-Step 信任路径</b>：原设计想让 DNA 不计入配额，依赖客户端发 header；
 *       但 (a) 前端从未发该 header → 误伤；(b) 任何客户端都能伪造该 header → 形同虚设。
 *       现统一计入配额，cap 调高到 200 以容纳 DNA 实验所需的次数。</li>
 *   <li><b>cap=0 表示吊销</b>：parseCap 不再把 0 当作"无效值落回 default"，
 *       admin 可签发 personalModelCap=0 的 JWT 立即阻断特定用户。</li>
 *   <li><b>拒绝时 DECR 回滚</b>：避免被锁用户疯狂重试导致计数虚高、429 body 中 used 失真。</li>
 *   <li><b>时区配置化</b>：{@code app.quota.image.zone}（默认 Asia/Shanghai），
 *       不再依赖容器 JVM 默认时区，配额"日重置"对齐用户体感时间。</li>
 * </ul>
 *
 * <p>放行场景：</p>
 * <ul>
 *   <li>非 {@code /api/image/**}/generate：本过滤器不参与</li>
 *   <li>未注入 X-User-Id：白名单 / 异常态，放行交下游处理</li>
 *   <li>Redis 不可达：fail-open + WARN，避免 Redis 抖动导致全站 429</li>
 * </ul>
 *
 * <p>计数 key：{@code tbfirst:quota:image:user:{uid}:{yyyyMMdd}}（日期按配置时区）。</p>
 */
@Slf4j
@Component
public class QuotaCheckFilter implements GlobalFilter, Ordered {

    private static final String QUOTA_KEY_PREFIX = "tbfirst:quota:image:user:";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");
    /** 代码层最终兜底（配置中心、application.yml 都没值时）。K.9 从 100 拉到 200 以容纳 DNA 实验。 */
    private static final long DEFAULT_USER_CAP_FALLBACK = 200L;

    private final ReactiveStringRedisTemplate redis;
    private final long userDailyDefault;
    private final String zoneIdStr;

    public QuotaCheckFilter(
            ReactiveStringRedisTemplate redis,
            @Value("${app.quota.image.user-daily-default:200}") long userDailyDefault,
            @Value("${app.quota.image.zone:Asia/Shanghai}") String zoneIdStr) {
        this.redis = redis;
        // K.9: 允许 cap=0=吊销；只有 < 0 / 解析失败才落回 default
        this.userDailyDefault = userDailyDefault >= 0 ? userDailyDefault : DEFAULT_USER_CAP_FALLBACK;
        this.zoneIdStr = zoneIdStr;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest req = exchange.getRequest();
        String path = req.getURI().getPath();

        // 只关注生图主干路径
        if (!path.startsWith("/api/image/") || !path.endsWith("/generate")) {
            return chain.filter(exchange);
        }

        String uid = req.getHeaders().getFirst(CommonConstants.HEADER_USER_ID);
        if (uid == null || uid.isBlank()) {
            // 白名单已在 AuthGlobalFilter 处理；这里到达说明是已鉴权请求但缺 UID → 异常状态，放行交下游
            return chain.filter(exchange);
        }

        long cap = parseCap(req.getHeaders().getFirst(CommonConstants.HEADER_USER_PERSONAL_CAP), userDailyDefault);
        // K.9: cap=0 表示吊销，不需要 INCR，直接 reject
        if (cap == 0L) {
            log.warn("[Quota] user={} cap=0 (revoked)", uid);
            return reject429(exchange, 0L, 0L);
        }

        ZoneId zone = resolveZone();
        String key = QUOTA_KEY_PREFIX + uid + ":" + LocalDate.now(zone).format(DATE_FMT);

        return redis.opsForValue().increment(key)
                .flatMap(count -> {
                    // 首次 INCR（counter=1）才设过期到次日凌晨，避免每次都续期
                    Mono<Boolean> ttlSetup = (count != null && count == 1L)
                            ? redis.expire(key, ttlUntilTomorrow(zone))
                            : Mono.just(true);
                    return ttlSetup.then(Mono.defer(() -> {
                        long c = count == null ? 0 : count;
                        if (c > cap) {
                            log.warn("[Quota] user={} reached daily cap, count={}/{}", uid, c, cap);
                            // K.9: 回滚刚才的 INCR，避免被锁用户疯狂重试导致计数虚高
                            return redis.opsForValue().decrement(key)
                                    .onErrorResume(de -> {
                                        log.warn("[Quota] decrement on reject failed user={}: {}", uid, de.getMessage());
                                        return Mono.just(0L);
                                    })
                                    .then(reject429(exchange, cap, c));
                        }
                        log.debug("[Quota] user={} count={}/{}", uid, c, cap);
                        return chain.filter(exchange);
                    }));
                })
                .onErrorResume(e -> {
                    // fail-open：Redis 抖动不应导致全站 429
                    log.warn("[Quota] redis unavailable, fail-open user={}: {}", uid, e.getMessage());
                    return chain.filter(exchange);
                });
    }

    /**
     * 解析 JWT claim 透传的 personalModelCap header。
     * 优先级：header > 配置 (app.quota.image.user-daily-default) > 代码兜底 DEFAULT_USER_CAP_FALLBACK。
     * K.9: 允许 v=0 表示吊销；只有 v<0 或解析失败才落回 default。
     */
    private static long parseCap(String s, long defaultCap) {
        if (s == null || s.isBlank()) return defaultCap;
        try {
            long v = Long.parseLong(s.trim());
            return v >= 0 ? v : defaultCap;
        } catch (NumberFormatException ignored) {
            return defaultCap;
        }
    }

    private ZoneId resolveZone() {
        try {
            return ZoneId.of(zoneIdStr);
        } catch (Exception e) {
            log.warn("[Quota] invalid app.quota.image.zone='{}', falling back to systemDefault", zoneIdStr);
            return ZoneId.systemDefault();
        }
    }

    private static Duration ttlUntilTomorrow(ZoneId zone) {
        ZonedDateTime now = ZonedDateTime.now(zone);
        ZonedDateTime tomorrowMidnight = now.toLocalDate().plusDays(1).atStartOfDay(zone);
        Duration d = Duration.between(now, tomorrowMidnight);
        // 防御：万一时间倒挂给个最小 60s
        return d.isNegative() || d.isZero() ? Duration.ofSeconds(60) : d;
    }

    private static Mono<Void> reject429(ServerWebExchange ex, long cap, long count) {
        ex.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        ex.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        String body = "{\"code\":429,\"msg\":\"daily image quota exceeded\",\"cap\":" + cap
                + ",\"used\":" + count + "}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return ex.getResponse().writeWith(Mono.just(ex.getResponse().bufferFactory().wrap(bytes)));
    }

    /**
     * Order = -50：在 AuthGlobalFilter（-100，注入 X-User-*）之后、
     * Spring Cloud Gateway 内置 RequestRateLimiter（默认 10000+）之前执行。
     * 这样配额判定基于 JWT 已校验的真实用户，配额拒绝早于令牌桶消耗。
     */
    @Override
    public int getOrder() {
        return -50;
    }
}
