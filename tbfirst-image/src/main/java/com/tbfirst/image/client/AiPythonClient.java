package com.tbfirst.image.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * tbfirst-ai-python 的 Feign 客户端。
 *
 * 寻址策略：url 优先于服务发现
 *   - app.ai-python.url 有值 → 直连（开发或 Python 未注册 Nacos 时的兜底，见 errorConclude #7）
 *   - 为空字符串 → 按 name 走 Nacos 服务发现 + 负载均衡
 *
 * payload 使用 Map<String,Object> 透传，避免和 Python Pydantic schema 强耦合；
 * 字段命名由调用方（ImageGenerateService）负责转 snake_case。
 */
@FeignClient(name = "tbfirst-ai-python", url = "${app.ai-python.url:}", path = "")
public interface AiPythonClient {

    /** 生图：phase0/1/2 共用，body 含 prompt/phase/reference_images/phase_config 等 */
    @PostMapping("/image/generate")
    Map<String, Object> generate(@RequestBody Map<String, Object> payload);

    /** 局部重绘：body 含 masked_image, prompt, aspect_ratio, reference_image */
    @PostMapping("/image/inpaint")
    Map<String, Object> inpaint(@RequestBody Map<String, Object> payload);

    /** Copilot 聊天：多轮 history + 当前 user_input + 参考图 */
    @PostMapping("/copilot/chat")
    Map<String, Object> copilotChat(@RequestBody Map<String, Object> payload);

    /** 品牌 URL 分析：返回 audience / tone / remark 三字段 */
    @PostMapping("/copilot/analyze-brand")
    Map<String, Object> analyzeBrand(@RequestBody Map<String, Object> payload);

    /** 灵感按钮：无 user_input，仅 context + reference_images */
    @PostMapping("/copilot/inspire")
    Map<String, Object> copilotInspire(@RequestBody Map<String, Object> payload);

    // ===== V6.M2 Agent 路由（F.4）=====

    /** 新建 agent 会话 */
    @PostMapping("/agent/sessions")
    Map<String, Object> agentCreateSession(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestBody Map<String, Object> payload);

    /** 会话列表（分页） */
    @GetMapping("/agent/sessions")
    Map<String, Object> agentListSessions(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset);

    /** 拉取会话历史消息 */
    @GetMapping("/agent/sessions/{uuid}/messages")
    Map<String, Object> agentGetSessionMessages(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("uuid") String uuid);

    /** 软删除会话 */
    @DeleteMapping("/agent/sessions/{uuid}")
    void agentDeleteSession(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("uuid") String uuid);

    /** 获取个人记忆（L3+L4） */
    @GetMapping("/agent/profile/memory")
    Map<String, Object> agentGetProfileMemory(
            @RequestHeader(value = "X-User-Id", required = false) Long userId);

    /** 更新偏好（L4） */
    @PutMapping("/agent/profile/memory/preference/{id}")
    Map<String, Object> agentUpdatePreference(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("id") Long id,
            @RequestBody Map<String, Object> payload);

    /** 删除偏好（L4） */
    @DeleteMapping("/agent/profile/memory/preference/{id}")
    void agentDeletePreference(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable("id") Long id);

    /** 工具元信息列表 */
    @GetMapping("/agent/tools")
    Map<String, Object> agentListTools();

    /** 列出宪法条目（ADMIN 权限） */
    @GetMapping("/agent/admin/constitution")
    List<Map<String, Object>> agentListConstitution(
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles);

    /** 新建/更新宪法条目（ADMIN 权限） */
    @PostMapping("/agent/admin/constitution")
    Map<String, Object> agentCreateConstitution(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles,
            @RequestBody Map<String, Object> payload);

    /** 版本化更新宪法条目（ADMIN 权限） */
    @PutMapping("/agent/admin/constitution/{id}")
    Map<String, Object> agentUpdateConstitution(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles,
            @PathVariable("id") Long id,
            @RequestBody Map<String, Object> payload);

    /** 软删除宪法条目（ADMIN 权限） */
    @DeleteMapping("/agent/admin/constitution/{id}")
    void agentDeleteConstitution(
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles,
            @PathVariable("id") Long id);
}
