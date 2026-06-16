package com.tbfirst.image.controller;

import com.tbfirst.common.core.constant.CommonConstants;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.core.response.R;
import com.tbfirst.image.mapper.GenerationJobMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 内部聚合统计接口 —— 仅供同内网其它微服务通过 Feign 调用。
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/image/internal")
public class InternalStatsController {

    private final GenerationJobMapper mapper;

    @Value("${INTERNAL_TOKEN:tbfirst-internal}")
    private String expectedInternalToken;

    /**
     * 按 userId 批量统计成功生图数量。返回 Map&lt;String, Long&gt;（JSON key 规范）。
     */
    @PostMapping("/generation-count")
    public R<Map<String, Long>> generationCount(
            @RequestHeader(value = CommonConstants.HEADER_INTERNAL_TOKEN, required = false) String internalToken,
            @RequestBody Collection<Long> userIds) {
        log.info("[InternalStats] generation-count called, userIds={}, hasToken={}",
                userIds, internalToken != null);
        if (internalToken == null || !internalToken.equals(expectedInternalToken)) {
            log.warn("[InternalStats] internal token mismatch");
            throw new BizException(ErrorCode.FORBIDDEN, "internal token mismatch");
        }
        if (userIds == null || userIds.isEmpty()) {
            return R.ok(Collections.emptyMap());
        }
        List<Map<String, Object>> rows = mapper.countSuccessByUserIds(userIds);
        log.info("[InternalStats] returned {} group rows for userIds={}", rows.size(), userIds);
        if (rows.isEmpty()) {
            List<Map<String, Object>> dist = mapper.debugStatusDistribution();
            long nullUserIdCount = mapper.debugCountNullUserId();
            log.warn("[InternalStats] no success rows matched. status distribution:");
            for (Map<String, Object> r : dist) {
                log.warn("  status={}, total={}, nonNullUserId={}",
                        r.get("status"), r.get("total"), r.get("non_null_user_id"));
            }
            log.warn("[InternalStats] rows with user_id IS NULL: {}", nullUserIdCount);
        }
        Map<String, Long> result = new HashMap<>(rows.size() * 2);
        for (Map<String, Object> row : rows) {
            Object userId = row.get("userId");
            Object cnt = row.get("cnt");
            if (userId != null && cnt != null) {
                result.put(String.valueOf(userId), ((Number) cnt).longValue());
            }
        }
        return R.ok(result);
    }
}
