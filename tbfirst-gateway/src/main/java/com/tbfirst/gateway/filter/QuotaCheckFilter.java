package com.tbfirst.gateway.filter;

import com.tbfirst.common.core.constant.CommonConstants;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;

/** Atomic daily image quota with idempotent retries. */
@Slf4j
@Component
public class QuotaCheckFilter implements GlobalFilter, Ordered {

    private static final String QUOTA_KEY_PREFIX = "tbfirst:quota:image:user:";
    private static final String DEDUPE_KEY_PREFIX = "tbfirst:quota:image:dedupe:";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final long DEFAULT_USER_CAP_FALLBACK = 200L;

    @SuppressWarnings("rawtypes")
    private static final DefaultRedisScript<List> CONSUME_SCRIPT = new DefaultRedisScript<>("""
            local cap = tonumber(ARGV[1])
            local ttl = tonumber(ARGV[2])
            local dedupe = tonumber(ARGV[3])
            local current = tonumber(redis.call('GET', KEYS[1]) or '0')
            if dedupe == 1 and redis.call('EXISTS', KEYS[2]) == 1 then
              return {1, current, math.max(0, cap - current), 1}
            end
            if current >= cap then
              return {0, current, 0, 0}
            end
            current = redis.call('INCR', KEYS[1])
            if current == 1 then redis.call('PEXPIRE', KEYS[1], ttl) end
            if dedupe == 1 then redis.call('SET', KEYS[2], '1', 'PX', ttl, 'NX') end
            return {1, current, math.max(0, cap - current), 0}
            """, List.class);

    private final ReactiveStringRedisTemplate redis;
    private final long userDailyDefault;
    private final String zoneIdStr;

    public QuotaCheckFilter(
            ReactiveStringRedisTemplate redis,
            @Value("${app.quota.image.user-daily-default:200}") long userDailyDefault,
            @Value("${app.quota.image.zone:Asia/Shanghai}") String zoneIdStr) {
        this.redis = redis;
        this.userDailyDefault = userDailyDefault >= 0 ? userDailyDefault : DEFAULT_USER_CAP_FALLBACK;
        this.zoneIdStr = zoneIdStr;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getURI().getPath();
        if (!path.startsWith("/api/image/") || !path.endsWith("/generate")) {
            return chain.filter(exchange);
        }

        String uid = request.getHeaders().getFirst(CommonConstants.HEADER_USER_ID);
        if (uid == null || uid.isBlank()) {
            return chain.filter(exchange);
        }

        long cap = parseCap(
                request.getHeaders().getFirst(CommonConstants.HEADER_USER_PERSONAL_CAP),
                userDailyDefault
        );
        if (cap == 0L) {
            return reject429(exchange, 0, 0, 60);
        }

        ZoneId zone = resolveZone();
        String day = LocalDate.now(zone).format(DATE_FMT);
        long ttlMillis = ttlUntilTomorrow(zone).toMillis();
        String quotaKey = QUOTA_KEY_PREFIX + uid + ":" + day;
        String idempotencyKey = request.getHeaders().getFirst("Idempotency-Key");
        boolean dedupe = idempotencyKey != null && !idempotencyKey.isBlank();
        String dedupeKey = dedupe
                ? DEDUPE_KEY_PREFIX + uid + ":" + sha256(path + "\n" + idempotencyKey)
                : DEDUPE_KEY_PREFIX + "disabled:" + uid;

        return redis.execute(
                        CONSUME_SCRIPT,
                        List.of(quotaKey, dedupeKey),
                        String.valueOf(cap),
                        String.valueOf(ttlMillis),
                        dedupe ? "1" : "0"
                )
                .next()
                .flatMap(raw -> {
                    QuotaResult result = QuotaResult.from(raw);
                    setRateHeaders(exchange, cap, result.remaining(), ttlMillis);
                    if (!result.allowed()) {
                        long retryAfter = Math.max(1, (ttlMillis + 999) / 1000);
                        log.warn("[Quota] user={} exhausted daily image quota used={}/{}", uid, result.used(), cap);
                        return reject429(exchange, cap, result.used(), retryAfter);
                    }
                    if (result.duplicate()) {
                        log.debug("[Quota] idempotent retry was not charged user={} path={}", uid, path);
                    }
                    return chain.filter(exchange);
                })
                .switchIfEmpty(Mono.defer(() -> chain.filter(exchange)))
                .onErrorResume(error -> {
                    log.warn("[Quota] redis unavailable, fail-open user={}: {}", uid, error.getMessage());
                    return chain.filter(exchange);
                });
    }

    static long parseCap(String value, long defaultCap) {
        if (value == null || value.isBlank()) return defaultCap;
        try {
            long parsed = Long.parseLong(value.trim());
            return parsed >= 0 ? parsed : defaultCap;
        } catch (NumberFormatException ignored) {
            return defaultCap;
        }
    }

    private ZoneId resolveZone() {
        try {
            return ZoneId.of(zoneIdStr);
        } catch (Exception error) {
            log.warn("[Quota] invalid zone '{}', falling back to UTC", zoneIdStr);
            return ZoneId.of("UTC");
        }
    }

    static Duration ttlUntilTomorrow(ZoneId zone) {
        ZonedDateTime now = ZonedDateTime.now(zone);
        ZonedDateTime tomorrow = now.toLocalDate().plusDays(1).atStartOfDay(zone);
        Duration duration = Duration.between(now, tomorrow);
        return duration.isNegative() || duration.isZero() ? Duration.ofSeconds(60) : duration;
    }

    private static void setRateHeaders(
            ServerWebExchange exchange, long cap, long remaining, long resetMillis) {
        HttpHeaders headers = exchange.getResponse().getHeaders();
        headers.set("X-RateLimit-Limit", String.valueOf(cap));
        headers.set("X-RateLimit-Remaining", String.valueOf(Math.max(0, remaining)));
        headers.set("X-RateLimit-Reset", String.valueOf((resetMillis + 999) / 1000));
    }

    private static Mono<Void> reject429(
            ServerWebExchange exchange, long cap, long used, long retryAfterSeconds) {
        exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        exchange.getResponse().getHeaders().set(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfterSeconds));
        String body = "{\"code\":429,\"msg\":\"daily image quota exceeded\",\"cap\":"
                + cap + ",\"used\":" + used + ",\"retryAfterSeconds\":" + retryAfterSeconds + "}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(bytes))
        );
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))
            );
        } catch (Exception impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private record QuotaResult(boolean allowed, long used, long remaining, boolean duplicate) {
        static QuotaResult from(List<?> raw) {
            if (raw == null || raw.size() < 4) {
                throw new IllegalStateException("invalid quota script response");
            }
            return new QuotaResult(
                    number(raw.get(0)) == 1,
                    number(raw.get(1)),
                    number(raw.get(2)),
                    number(raw.get(3)) == 1
            );
        }

        private static long number(Object value) {
            return value instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(value));
        }
    }

    @Override
    public int getOrder() {
        return -50;
    }
}
