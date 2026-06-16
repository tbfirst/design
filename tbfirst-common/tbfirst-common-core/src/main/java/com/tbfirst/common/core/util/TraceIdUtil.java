package com.tbfirst.common.core.util;

import cn.hutool.core.lang.UUID;

/**
 * TraceId 工具类。
 * <p>
 * 在分布式微服务架构下，当请求经 Gateway 未携带 X-Trace-Id 时，由首个接收服务生成
 * 新的 TraceId 并注入 MDC + 响应头，下游通过 Feign 透传，确保同一业务请求的日志可聚合。
 * </p>
 *
 * @author tbfirst
 */
public final class TraceIdUtil {

    private TraceIdUtil() {}

    /**
     * 生成新的 TraceId（去除中划线的 32 位字符串）。
     * <p>使用 Hutool 的 {@code fastUUID}，性能优于 JDK {@link java.util.UUID}，在高并发下减少开销。</p>
     *
     * @return 32 位全局唯一字符串
     */
    public static String newTraceId() {
        // true 参数 = 去掉中划线，便于在日志/header 中紧凑展示
        return UUID.fastUUID().toString(true);
    }
}
