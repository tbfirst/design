package com.tbfirst.image.client;

import com.tbfirst.common.core.response.R;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.util.Collection;
import java.util.Map;

/**
 * tbfirst-auth 服务的 Feign 客户端 —— 目前仅用于批量查 userId -> username 映射，
 * 让 History Modal 能把组员历史图左上角徽标从 "组员 {id}" 换成 "组员 {username}"。
 *
 * <p>寻址：name=tbfirst-auth 走 Nacos 服务发现 + 负载均衡。若 auth 服务临时不可达，
 * 调用方（ImageGenerateService.history）应 try/catch 兜底空 Map，保证历史接口本身不挂。</p>
 */
@FeignClient(name = "tbfirst-auth", path = "/api/auth/internal")
public interface AuthClient {

    /**
     * 批量解析用户名：入参是 userId 集合（去重由调用方保证），返回 {String(id) -> username}。
     *
     * <p>注意 key 是 String —— JSON 规范里对象 key 只能是字符串，Jackson 不会把 "1" 自动
     * 反序列化成 Long key。与 {@code ImageStatsClient#generationCount} 保持相同契约，调用方
     * 在 Service 层自己 Long.valueOf 转回。之前误用 {@code Map<Long, String>} 会导致 Feign 侧
     * 反序列化得到空 Map，前端徽标静默退化到 "#{authorId}" fallback。</p>
     *
     * @param ids 用户 ID 集合，空集合调用方应短路不发请求
     * @return 仅包含存在用户的 Map；软删用户仍返回其 username
     */
    @PostMapping("/users-by-ids")
    R<Map<String, String>> usersByIds(@RequestBody Collection<Long> ids);
}
