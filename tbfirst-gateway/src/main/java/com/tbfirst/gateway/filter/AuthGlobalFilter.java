package com.tbfirst.gateway.filter;

import com.tbfirst.common.core.constant.CommonConstants;
import com.tbfirst.common.security.jwt.JwtUtil;
import io.jsonwebtoken.Claims;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.Arrays;
import java.util.List;

/**
 * 全局 JWT 鉴权过滤器（GlobalFilter）——————第一层的网关鉴权
 *
 * <p>架构角色：tbfirst 网关层的统一鉴权切面，对所有经由网关的请求进行前置 JWT 校验，
 * 避免每个下游微服务都重复实现鉴权逻辑；下游服务只需从 X-User-* 请求头读取身份信息。</p>
 *
 * 处理流程：
 * 1、白名单路径（登录/注册/健康检查/静态资源等）直接放行
 * 2、非白名单路径要求 {@code Authorization: Bearer <token>}，缺失或非法返回 401
 * 3、JWT 解析成功后，校验 jti 是否与 Redis 中"该用户当前会话 jti"一致（单点登录强制）
 * 4、校验通过则将 userId / username / roles 等写入下游请求头，供业务服务使用
 *
 * <p><b>单点登录语义</b>：每次 auth 服务签发 token 都会随机生成 jti，并以
 * {@code tbfirst:session:user:{userId}} 为键写入 Redis（覆盖语义）。本过滤器在每个请求上
 * 把 token 中的 jti 与 Redis 当前值比对：不一致 = 已被异地登录顶下 / 已被踢 / 已 logout，
 * 一律 401。Redis key 不存在（自然过期 / kick 清除）同样 401。</p>
 */
@Slf4j
@Component
public class AuthGlobalFilter implements GlobalFilter, Ordered {

    // 白名单路径集合：登录/注册/刷新 token、健康检查、OpenAPI 文档及静态资源在鉴权之前必须可访问
    // V5.XV.12: /img/** 是 GCS 反代公开端点（UUID key 不可枚举，无需鉴权）。
    // V5.XV.6 前端把所有 <img src> 改走同源 /img/<key>，但 <img> 标签不会发
    // Authorization 头 → 全部 401 「missing token」。把 /img/ 加进白名单还原原设计意图：
    // ImageProxyController javadoc 已声明 "Gateway 已校 JWT，下游不重新校验"，意指
    // 图片字节走代理时 gateway 应放行；此前漏配是 V5.XV.6 才暴露出来的潜在缺陷。
    /**
     * 网关层白名单默认值（外部路径前缀）。可由 Nacos 共享配置 {@code tbfirst.security.gateway-whitelist}
     * （逗号分隔）覆盖，与下游 {@code tbfirst.security.service-exempt-prefixes} 集中维护、需对齐。
     * 留空 / Nacos 不可用时回落到本默认，避免白名单为空导致登录被锁死。
     */
    private static final List<String> DEFAULT_WHITELIST = List.of(
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/refresh",
            "/actuator/health",
            "/static/",
            "/img/",
            "/v3/api-docs",
            "/swagger-ui",
            "/webjars",
            "/favicon.ico"
    );

    private static final String SESSION_KEY_PREFIX = "tbfirst:session:user:";

    private final JwtUtil jwtUtil;
    private final ReactiveStringRedisTemplate redis;
    /** 实际生效的白名单前缀（来自配置；为空则用 {@link #DEFAULT_WHITELIST}）。 */
    private final List<String> whitelistPrefixes;

    // 从配置文件读取 JWT 密钥和过期时间构建 JwtUtil 实例
    public AuthGlobalFilter(@Value("${app.jwt.secret:oumUxneCYI3+bJVH3PnaVyxhXrVCjUMbu8zb9kO1hUU=}") String secret,
                            @Value("${app.jwt.expiration-ms:86400000}") long expirationMs,
                            ReactiveStringRedisTemplate redis,
                            @Value("${tbfirst.security.gateway-whitelist:}") String whitelistCsv) {
        this.jwtUtil = new JwtUtil(secret, expirationMs);
        this.redis = redis;
        List<String> parsed = whitelistCsv == null ? List.of()
                : Arrays.stream(whitelistCsv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        this.whitelistPrefixes = parsed.isEmpty() ? DEFAULT_WHITELIST : parsed;
    }

    /**
     * 过滤器核心逻辑：执行白名单判定 → Authorization 头校验 → JWT 解析 → 单点登录 jti 校验 → 请求头改写 → 放行。
     *
     * @param exchange 当前响应式 HTTP 请求/响应上下文
     * @param chain    过滤器链，调用 {@code chain.filter} 继续后续处理
     * @return {@link Mono} 表示异步完成信号；401 场景由 {@link #reject} 直接写回响应
     */
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest req = exchange.getRequest();
        String path = req.getURI().getPath();
        // 无条件打印，方便前端排查"请求是否真的经过了 gateway"。
        // 如果生图时这行没出现，说明前端绕过了 gateway（直连 image:8102 或 Vite proxy 没生效）。
        log.info("[Gateway] {} {} ", req.getMethod(), path);

        // 1. 获取请求路径，判断是否在白名单中，是则直接放行
        if (isWhitelisted(path)) {
            return chain.filter(exchange);
        }

        // 2. 获取 Authorization 请求头，判断是否存在且以 "Bearer " 开头，不满足则拒绝访问
        String auth = req.getHeaders().getFirst("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) {
            return reject(exchange, "missing token");
        }

        // 3. 解析 JWT
        Claims claims;
        try {
            claims = jwtUtil.parse(auth.substring(7));
        } catch (Exception e) {
            log.warn("[Gateway] invalid token: {}", e.getMessage());
            return reject(exchange, "invalid token");
        }

        // 防御：sub 为空意味着签发端把 sub claim 丢了（历史上 jjwt 0.12 的 .claims(Map) 替换语义导致过），
        // 这时透传 null header 会让下游 UserContextFilter 静默失效，所有业务数据的 user_id 都为 null。
        // 必须立即 401 并在日志里显式提示，不要让问题潜伏。
        String subject = claims.getSubject();
        if (subject == null || subject.isBlank()) {
            log.warn("[Gateway] JWT missing subject (userId), claims={}", claims);
            return reject(exchange, "invalid token: missing subject");
        }

        // 4. 单点登录强制：校验 token jti 是否与 Redis 中"该用户当前会话 jti"一致。
        //    老 token（升级前签发，无 jti）一律拒绝 → 全员强制重登一次，这是单点登录上线的一次性切换成本。
        String jti = claims.getId();
        if (jti == null || jti.isBlank()) {
            log.warn("[Gateway] token has no jti (issued before single-session rollout), reject user={}", subject);
            return reject(exchange, "session invalidated (please re-login)");
        }

        String sessionKey = SESSION_KEY_PREFIX + subject;
        return redis.opsForValue().get(sessionKey)
                .defaultIfEmpty("")
                .flatMap(currentJti -> {
                    if (currentJti.isBlank()) {
                        log.warn("[Gateway] no session for user {} (TTL expired or kicked)", subject);
                        return reject(exchange, "session invalidated (logged out or kicked)");
                    }
                    if (!jti.equals(currentJti)) {
                        log.warn("[Gateway] jti mismatch for user {}: token={} current={}", subject, jti, currentJti);
                        return reject(exchange, "session invalidated (logged in elsewhere)");
                    }
                    return forward(exchange, chain, req, claims, subject);
                })
                .onErrorResume(e -> {
                    // Redis 不可达：fail-closed，保证安全
                    log.warn("[Gateway] redis unavailable when checking session for user {}: {}", subject, e.getMessage());
                    return reject(exchange, "session check failed");
                });
    }

    /**
     * jti 校验通过后，注入下游 X-User-* 请求头并继续过滤链。
     */
    private Mono<Void> forward(ServerWebExchange exchange, GatewayFilterChain chain,
                               ServerHttpRequest req, Claims claims, String subject) {
        String username = claims.get("username", String.class);
        log.info("[Gateway] inject X-User-Id={} X-User-Name={} path={}", subject, username, req.getURI().getPath());
        // groupId / groupRole 从 JWT 取出并注入下行头；不写 claim 时退化成空串（= 无组）
        Object gid = claims.get("groupId");
        String groupId = gid == null ? "" : String.valueOf(gid);
        String groupRole = claims.get("groupRole", String.class);
        if (groupRole == null) groupRole = "";
        // 可配置容量：claim 不存在或为 null 时留空串 → 下游走默认值
        Object pcap = claims.get("personalModelCap");
        String personalCap = pcap == null ? "" : String.valueOf(pcap);
        Object gcap = claims.get("groupModelCap");
        String groupCap = gcap == null ? "" : String.valueOf(gcap);
        ServerHttpRequest mutated = req.mutate()
                .header(CommonConstants.HEADER_USER_ID, subject)
                .header(CommonConstants.HEADER_USER_NAME, username == null ? "" : username)
                .header(CommonConstants.HEADER_USER_ROLES, rolesOf(claims))
                .header(CommonConstants.HEADER_USER_GROUP_ID, groupId)
                .header(CommonConstants.HEADER_USER_GROUP_ROLE, groupRole)
                .header(CommonConstants.HEADER_USER_PERSONAL_CAP, personalCap)
                .header(CommonConstants.HEADER_USER_GROUP_CAP, groupCap)
                .build();
        return chain.filter(exchange.mutate().request(mutated).build());
    }

    /**
     * 从 JWT Claims 中提取用户角色，兼容字符串 / 字符串列表两种历史格式。
     * 兼容性考虑：早期版本用逗号分隔字符串存储，后续可能改为 List，此处统一归一化为逗号分隔字符串下发。
     *
     * @param claims JWT 解析出的载荷
     * @return 逗号分隔的角色字符串，无角色时返回空串
     */
    private String rolesOf(Claims claims) {
        Object roles = claims.get("roles");
        if (roles instanceof List<?> l) {
            return String.join(",", l.stream().map(String::valueOf).toList());
        }
        if (roles instanceof String s) {
            return s;
        }
        return "";
    }

    /**
     * 判断请求路径是否命中白名单。
     * <p>
     * 两类规则：
     * <ol>
     *   <li>{@link #WHITELIST} 前缀匹配 —— 覆盖登录/健康检查/直访 swagger-ui 静态资源等。</li>
     *   <li>路径中包含 {@code /v3/api-docs}、{@code /swagger-ui}、{@code /webjars}
     *       —— 覆盖通过网关访问下游时前端按服务名拼接的
     *       {@code /tbfirst-image/swagger-ui/index.html} 这种带服务名前缀的路径。
     *       不能用 startsWith 判断，因为前缀是动态服务名（由 discovery.locator
     *       自动 RewritePath 后转发到下游 /swagger-ui/**、/v3/api-docs/**、/webjars/**）。</li>
     * </ol>
     * <p>
     * <b>安全说明</b>：swagger-ui 页面 + OpenAPI 描述本身不含敏感数据；真正敏感的是
     * 「Try it out」按钮调用业务接口的请求，那些请求 URL 形如 /api/auth/users 等，
     * 仍然要经过 JWT 校验（不在此白名单里），由 swagger UI 的 Authorize 按钮在
     * 用户登录后注入 Authorization: Bearer 头来满足。
     *
     * @param path 请求 URI 路径
     * @return true 表示白名单放行，无需鉴权
     */
    private boolean isWhitelisted(String path) {
        if (whitelistPrefixes.stream().anyMatch(path::startsWith)) {
            return true;
        }
        return path.contains("/v3/api-docs")
                || path.contains("/swagger-ui")
                || path.contains("/webjars");
    }

    /**
     * 拒绝访问，直接向响应体写入 401 JSON，不再继续过滤链。
     *
     * @param ex  当前交换上下文
     * @param msg 错误描述，写入响应体 msg 字段
     * @return 完成信号的 {@link Mono}
     */
    private Mono<Void> reject(ServerWebExchange ex, String msg) {
        ex.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        byte[] bytes = ("{\"code\":401,\"msg\":\"" + msg + "\"}").getBytes();
        return ex.getResponse().writeWith(Mono.just(ex.getResponse().bufferFactory().wrap(bytes)));
    }

    /**
     * 设置当前过滤器执行顺序：越小越先执行。
     * 取 -100 使本过滤器在大多数内置过滤器之前执行，保证鉴权在路由/转发之前完成。
     *
     * @return 排序值
     */
    @Override
    public int getOrder() {
        return -100;
    }
}
