package com.tbfirst.common.security.context;

/**
 * 用户上下文持有者（基于 ThreadLocal）。
 * <p>
 * 业务代码通过 {@link #get()} / {@link #currentUserId()} 读取当前请求的登录用户，
 * 必须由 {@link com.tbfirst.common.security.filter.UserContextFilter} 在请求结束时
 * 调用 {@link #clear()} 清理，否则在线程池场景会串用户、甚至内存泄漏。
 * </p>
 *
 * @author tbfirst
 */
public final class UserContextHolder {

    // ThreadLocal 保障请求间隔离；线程池复用需配合 clear
    private static final ThreadLocal<UserContext> HOLDER = new ThreadLocal<>();

    private UserContextHolder() {}

    /**
     * 设置当前线程的用户上下文。
     *
     * @param ctx 用户上下文（不应为 null）
     */
    public static void set(UserContext ctx) {
        HOLDER.set(ctx);
    }

    /**
     * 获取当前线程的用户上下文。
     *
     * @return 用户上下文；未登录或过滤器未处理时返回 null
     */
    public static UserContext get() {
        return HOLDER.get();
    }

    /**
     * 快捷获取当前用户 ID。
     * 本质还是先获取用户上下文，再从中提取用户 ID；但在业务代码里更常用用户 ID，提供此方法避免重复调用 get() + null 判断。
     *
     * @return 用户 ID；未登录时返回 null
     */
    public static Long currentUserId() {
        UserContext ctx = HOLDER.get();
        return ctx == null ? null : ctx.getUserId();
    }

    /**
     * 判断当前用户是否具备 ADMIN 角色。
     *
     * <p>历史 `hasPermission(code)` 与整套 permissions 体系已于 2026-04-22 完全下线
     * （permissions 字段、X-User-Permissions header、@RequirePermission 切面、
     * ServicePermissionChecker 接口全部移除）。当前权限模型是纯角色路线：
     * ADMIN = 全开；USER = 固有基础权限。
     * 细粒度资源归属（如"个人库 vs 组共享"）请在各服务 Service 层自行判定
     * （参考 {@code BrandModelService.loadAndAuthorize}）。</p>
     *
     * @return true 表示当前请求持有 ADMIN 角色
     */
    public static boolean isAdmin() {
        UserContext ctx = HOLDER.get();
        if (ctx == null) return false;
        return ctx.getRoles() != null && ctx.getRoles().contains("ADMIN");
    }

    /**
     * 清理 ThreadLocal，防止线程池场景下的内存泄漏与数据串扰。
     */
    public static void clear() {
        HOLDER.remove();
    }
}
