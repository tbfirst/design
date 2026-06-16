package com.tbfirst.common.security.filter;

import com.tbfirst.common.core.constant.CommonConstants;
import com.tbfirst.common.security.context.UserContext;
import com.tbfirst.common.security.context.UserContextHolder;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * 用户上下文过滤器。
 * <p>
 * 从 Gateway 下发的 X-User-* 请求头解析用户上下文 UserContext，写入 ThreadLocal。
 * 业务服务信任 Gateway 已完成 JWT 验证，直接读取头信息（网络隔离保障安全）。
 * 继承 {@link OncePerRequestFilter} 确保一次请求只执行一次（含 forward/include）。
 * </p>
 * <p>
 * 本类不带 {@code @Component}，通过 {@code tbfirst-common-security}
 * 的 {@code SecurityFilterAutoConfiguration} 显式装配，避免绑定组件扫描。
 * </p>
 * <p>
 * 失败即快：/api/** 业务请求缺 X-User-Id 时直接 401 拒绝（errorConclude #29）——
 * 历史上此类请求会被下游悄悄当成匿名处理，把 user_id=null 写进 generation_job，
 * 导致管理员看到生图数永远为 0、审计日志丢失主体。现在请求无法静默通过，
 * 前端会立刻收到 401，问题能当场暴露而不是悄悄累积脏数据。内网白名单通过
 * 路径段 {@code /internal/}、Actuator、OpenAPI 文档等放行（见 {@link #isExempt}）。
 * </p>
 *
 * @author tbfirst
 */
public class UserContextFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(UserContextFilter.class);

    /**
     * 服务层 /api 业务路径豁免前缀默认值（缺 X-User-Id 也放行）。可由 Nacos 共享配置
     * {@code tbfirst.security.service-exempt-prefixes}（逗号分隔）覆盖，与网关
     * {@code tbfirst.security.gateway-whitelist} 集中维护、需对齐。留空 / Nacos 不可用时
     * 回落本默认，避免豁免被清空后登录直通被 401。注意 {@code /internal/}（服务间调用，
     * 由 internal-token 保护，按路径段匹配）是结构性规则，固定在 {@link #isExempt} 代码里，不走本列表。
     */
    private static final List<String> DEFAULT_EXEMPT_PREFIXES = List.of(
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/refresh",
            "/api/actuator/",
            "/api/v3/api-docs",
            "/api/doc.html",
            "/api/webjars/",
            "/api/swagger-resources"
    );

    private final List<String> exemptPrefixes;

    /** 默认构造：无配置注入时用内置默认。 */
    public UserContextFilter() {
        this(null);
    }

    /** 由 {@code SecurityFilterAutoConfiguration} 注入配置化豁免前缀；为空回落默认。 */
    public UserContextFilter(List<String> exemptPrefixes) {
        this.exemptPrefixes = (exemptPrefixes == null || exemptPrefixes.isEmpty())
                ? DEFAULT_EXEMPT_PREFIXES : exemptPrefixes;
    }

    /**
     * 解析请求头构造 UserContext，请求结束后必须清理 ThreadLocal。
     *
     * @param req   请求
     * @param resp  响应
     * @param chain 过滤器链
     * @throws ServletException 过滤器异常
     * @throws IOException      IO 异常
     */
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse resp, FilterChain chain)
            throws ServletException, IOException {
        try {
            // 从请求头中获取 UserContext 中的 UserId、Username、Roles 和 TenantId
            String userId = req.getHeader(CommonConstants.HEADER_USER_ID);
            String path = req.getRequestURI();
            boolean isBusinessPath = path != null && path.startsWith("/api/");
            boolean missing = userId == null || userId.isBlank();

            if (missing && isBusinessPath && !isExempt(path)) {
                // 业务请求缺 X-User-Id：要么绕过了网关，要么网关配置/JWT 异常。
                // 直接 401，避免下游悄悄写 user_id=null（errorConclude #29）。
                log.warn("[UserContext] REJECT {} {}: missing {}. Request likely bypassed gateway.",
                        req.getMethod(), path, CommonConstants.HEADER_USER_ID);
                writeUnauthorized(resp, "missing " + CommonConstants.HEADER_USER_ID
                        + " (request bypassed gateway or gateway didn't inject it)");
                return;
            }
            if (missing && isBusinessPath) {
                // 白名单内（/internal/、OpenAPI 等）不拦截，但仍记录一条 debug 便于排查
                log.debug("[UserContext] exempt path without user id: {}", path);
            } else if (!missing) {
                log.debug("[UserContext] {}={} path={}", CommonConstants.HEADER_USER_ID, userId, path);
            }

            if (!missing) {
                String username = req.getHeader(CommonConstants.HEADER_USER_NAME);
                String roleHeader = req.getHeader(CommonConstants.HEADER_USER_ROLES);
                List<String> roles = roleHeader == null || roleHeader.isBlank()
                        ? Collections.emptyList()
                        : Arrays.asList(roleHeader.split(","));
                String tenantStr = req.getHeader(CommonConstants.HEADER_TENANT_ID);
                Long tenantId = tenantStr == null || tenantStr.isBlank() ? null : Long.parseLong(tenantStr);
                // 组成员字段：gateway 从 JWT claims 取出写入 header；空串 = 无组
                String groupIdStr = req.getHeader(CommonConstants.HEADER_USER_GROUP_ID);
                Long groupId = groupIdStr == null || groupIdStr.isBlank() ? null : parseLongSafely(groupIdStr);
                String groupRole = req.getHeader(CommonConstants.HEADER_USER_GROUP_ROLE);
                if (groupRole != null && groupRole.isBlank()) groupRole = null;
                // 可配置容量头：为空串视为 null（走默认）
                String personalCapStr = req.getHeader(CommonConstants.HEADER_USER_PERSONAL_CAP);
                Integer personalCap = personalCapStr == null || personalCapStr.isBlank() ? null : parseIntSafely(personalCapStr);
                String groupCapStr = req.getHeader(CommonConstants.HEADER_USER_GROUP_CAP);
                Integer groupCap = groupCapStr == null || groupCapStr.isBlank() ? null : parseIntSafely(groupCapStr);

                // 构建 UserContext 对象，存入 UserContextHolder
                UserContextHolder.set(UserContext.builder()
                        .userId(Long.parseLong(userId))
                        .username(username)
                        .roles(roles)
                        .tenantId(tenantId)
                        .groupId(groupId)
                        .groupRole(groupRole)
                        .personalModelCap(personalCap)
                        .groupModelCap(groupCap)
                        .build());
            }
            // 继续过滤链执行
            chain.doFilter(req, resp);
        } finally {
            // 请求处理完成后清理 UserContextHolder 中的 ThreadLocal，避免内存泄漏
            UserContextHolder.clear();
        }
    }

    /**
     * /api/** 路径白名单：这些路径即使没有 X-User-Id 也允许通过，用于：
     * <ul>
     *   <li><b>登录前的鉴权入口</b> —— {@code /api/auth/login / register / refresh}，Gateway 的 WHITELIST
     *       同样放行这些路径，不带 JWT 所以也没 X-User-Id。必须在此同步豁免，否则下游 UserContextFilter
     *       会把登录请求 401 掉，用户根本进不来（errorConclude #29 后出现的回归）</li>
     *   <li>Java 服务之间的内部调用（约定路径段 {@code /internal/}，由 {@link CommonConstants#HEADER_INTERNAL_TOKEN} 保护）</li>
     *   <li>Spring Boot Actuator / SpringDoc OpenAPI / swagger-ui 等基础设施端点</li>
     * </ul>
     * 新增路径段请保守——默认应要求带上用户身份，避免再把某个业务接口漏进白名单。
     * <b>维护约束</b>：本列表要和 Gateway {@code AuthGlobalFilter.WHITELIST} 保持对齐（双向）。
     *
     * @param path 请求 URI
     * @return true 表示放行
     */
    private boolean isExempt(String path) {
        // /internal/（服务间调用，由 internal-token 保护）按路径段匹配，结构性规则固定在代码里
        if (path.contains("/internal/")) {
            return true;
        }
        for (String prefix : exemptPrefixes) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /** 宽松解析 Long：遇到非法值记 warn 但不抛，避免把 "foo" 这种脏 header 升级成 500。 */
    private Long parseLongSafely(String raw) {
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            log.warn("[UserContext] cannot parse long from header value={}", raw);
            return null;
        }
    }

    /** 宽松解析 Integer，同 parseLongSafely。 */
    private Integer parseIntSafely(String raw) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            log.warn("[UserContext] cannot parse int from header value={}", raw);
            return null;
        }
    }

    /**
     * 统一返回 401 JSON，与 {@code R<T>} 协议保持一致（code=401/msg=.../data=null）。
     * 前端 api.ts 会在 401 时跳登录页，无需特殊处理。
     */
    private void writeUnauthorized(HttpServletResponse resp, String msg) throws IOException {
        resp.setStatus(HttpStatus.UNAUTHORIZED.value());
        resp.setContentType(MediaType.APPLICATION_JSON_VALUE);
        resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
        String body = "{\"code\":401,\"msg\":\"" + msg.replace("\"", "\\\"") + "\",\"data\":null}";
        resp.getWriter().write(body);
    }
}
