package com.tbfirst.auth.client;

import com.tbfirst.common.core.response.R;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.util.Collection;
import java.util.Map;

/**
 * 调用 tbfirst-image 的内部聚合接口，供 AdminService 批量填充用户总生图数量。
 *
 * <p>寻址策略：走 Nacos 服务发现 + LoadBalancer（lb://tbfirst-image），
 * 绕开网关的 AuthGlobalFilter，因此不需要 JWT；为安全起见应在 image 侧
 * 通过 X-Internal-Token 或内网 IP 白名单限制访问。</p>
 *
 * <p>响应为统一响应体 {@code R<Map<String,Long>>}，data 的 key 为 userId 的字符串形式、
 * value 为成功生图次数；未命中的 userId 不会出现在 Map 中，调用方需按 0 处理。
 * <b>注意：</b>Jackson 会把 JSON 对象 key 反序列化为 String，即使声明 {@code Map<Long, Long>}
 * 也会变成 String key，导致按 Long 查询永远 miss；因此统一用 String key 对齐。</p>
 */
@FeignClient(name = "tbfirst-image", contextId = "imageStatsClient")
public interface ImageStatsClient {

    /**
     * 批量查询用户成功生图数量。
     *
     * @param userIds 用户 ID 集合；空集合由服务端短路返回空 Map
     * @return 统一响应体，data 为 userId(String) → count 的映射
     */
    @PostMapping("/api/image/internal/generation-count")
    R<Map<String, Long>> generationCount(@RequestBody Collection<Long> userIds);
}
