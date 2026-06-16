package com.tbfirst.image.controller;

import com.tbfirst.common.core.response.R;
import com.tbfirst.image.client.AiPythonClient;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;

/**
 * V6.M2.F.4: Agent 路由转发（/api/image/agent/*）。
 *
 * 非 SSE 端点：通过 AiPythonClient Feign 转发，用 R.ok() 包装成统一响应格式。
 * SSE 聊天端点：使用 HttpURLConnection 代理流式响应，绕过 Feign 不支持 SSE 的限制。
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/image/agent")
public class AgentController {

    private final AiPythonClient aiPythonClient;

    @Value("${app.ai-python.url:http://localhost:8200}")
    private String aiPythonUrl;

    // ===== Sessions =====

    @PostMapping("/sessions")
    public R<Map<String, Object>> createSession(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestBody(required = false) Map<String, Object> payload) {
        return R.ok(aiPythonClient.agentCreateSession(userId, payload != null ? payload : Map.of()));
    }

    @GetMapping("/sessions")
    public R<Map<String, Object>> listSessions(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return R.ok(aiPythonClient.agentListSessions(userId, limit, offset));
    }

    @GetMapping("/sessions/{uuid}/messages")
    public R<Map<String, Object>> getSessionMessages(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable String uuid) {
        return R.ok(aiPythonClient.agentGetSessionMessages(userId, uuid));
    }

    @DeleteMapping("/sessions/{uuid}")
    public R<Void> deleteSession(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable String uuid) {
        aiPythonClient.agentDeleteSession(userId, uuid);
        return R.ok();
    }

    // ===== Chat (SSE proxy — Feign 不支持流式 SSE，直接用 HttpURLConnection 透传) =====

    @PostMapping(value = "/chat", produces = "text/event-stream;charset=UTF-8")
    public void chat(
            @RequestBody byte[] rawBody,
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            HttpServletResponse response) throws IOException {
        response.setContentType("text/event-stream;charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.setBufferSize(0);
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("X-Accel-Buffering", "no");
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(aiPythonUrl + "/agent/chat").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            if (userId != null) conn.setRequestProperty("X-User-Id", userId.toString());
            conn.setReadTimeout(600_000);
            conn.setConnectTimeout(10_000);
            conn.setDoOutput(true);
            conn.getOutputStream().write(rawBody);
            conn.getOutputStream().flush();
            byte[] buf = new byte[64];
            int n;
            jakarta.servlet.ServletOutputStream out = response.getOutputStream();
            try (java.io.InputStream in = conn.getInputStream()) {
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    out.flush();
                    response.flushBuffer();
                }
            }
        } catch (IOException e) {
            String detail = e.getMessage() != null ? e.getMessage().replace("\"", "'") : "upstream error";
            byte[] errBytes = ("data: {\"type\":\"error\",\"detail\":\"" + detail + "\"}\n\n"
                    + "data: [DONE]\n\n")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            response.getOutputStream().write(errBytes);
            response.getOutputStream().flush();
        }
    }

    // ===== Profile Memory =====

    @GetMapping("/profile/memory")
    public R<Map<String, Object>> getProfileMemory(
            @RequestHeader(value = "X-User-Id", required = false) Long userId) {
        return R.ok(aiPythonClient.agentGetProfileMemory(userId));
    }

    @PutMapping("/profile/memory/preference/{id}")
    public R<Map<String, Object>> updatePreference(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.agentUpdatePreference(userId, id, payload));
    }

    @DeleteMapping("/profile/memory/preference/{id}")
    public R<Void> deletePreference(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable Long id) {
        aiPythonClient.agentDeletePreference(userId, id);
        return R.ok();
    }

    // ===== Tools =====

    @GetMapping("/tools")
    public R<Map<String, Object>> listTools() {
        return R.ok(aiPythonClient.agentListTools());
    }

    // ===== Admin: Constitution =====

    @GetMapping("/admin/constitution")
    public R<List<Map<String, Object>>> listConstitution(
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles) {
        return R.ok(aiPythonClient.agentListConstitution(userRoles));
    }

    @PostMapping("/admin/constitution")
    public R<Map<String, Object>> createConstitution(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.agentCreateConstitution(userId, userRoles, payload));
    }

    @PutMapping("/admin/constitution/{id}")
    public R<Map<String, Object>> updateConstitution(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles,
            @PathVariable Long id,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.agentUpdateConstitution(userId, userRoles, id, payload));
    }

    @DeleteMapping("/admin/constitution/{id}")
    public R<Void> deleteConstitution(
            @RequestHeader(value = "X-User-Roles", required = false) String userRoles,
            @PathVariable Long id) {
        aiPythonClient.agentDeleteConstitution(userRoles, id);
        return R.ok();
    }
}
