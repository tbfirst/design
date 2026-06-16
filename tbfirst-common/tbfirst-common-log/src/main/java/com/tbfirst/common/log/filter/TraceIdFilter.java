package com.tbfirst.common.log.filter;

import com.tbfirst.common.core.constant.CommonConstants;
import com.tbfirst.common.core.util.TraceIdUtil;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * TraceId 过滤器。
 * <p>
 * 从请求头读取或生成 TraceId，写入 MDC 与响应头，保障全链路日志可按 traceId 串联。
 * 由 {@code LogAutoConfiguration} 显式装配，优先级设为最高，在所有业务 Filter 之前执行。
 * </p>
 *
 * @author tbfirst
 */
public class TraceIdFilter extends OncePerRequestFilter {

    /**
     * 过滤处理：注入 MDC，请求结束必须清理，避免线程池污染。
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
        String traceId = req.getHeader(CommonConstants.HEADER_TRACE_ID);
        // 第一次请求（前端 → 网关）请求头里没有 X-Trace-Id 时本地生成，保证始终有值，后续链路（Gateway → 服务）会复用这个 TraceId
        // 下游服务的 TraceIdFilter 看到请求头里已有 X-Trace-Id，不会再生成新的，直接复用
        // 整条链路（前端 → 网关 → image → auth → ai-python）用的是同一个 TraceId。
        if (traceId == null || traceId.isBlank()) {
            traceId = TraceIdUtil.newTraceId();
        }
        MDC.put(CommonConstants.HEADER_TRACE_ID, traceId);
        // 回写响应头，方便客户端/前端日志关联
        resp.setHeader(CommonConstants.HEADER_TRACE_ID, traceId);
        try {
            chain.doFilter(req, resp);
        } finally {
            // 必须清理 MDC，防止线程复用时泄漏到下一个请求
            MDC.remove(CommonConstants.HEADER_TRACE_ID);
        }
    }
}
