package com.tbfirst.image.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tbfirst.common.core.response.R;
import com.tbfirst.image.client.AiPythonClient;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * V6.M2.F.4: Agent 路由转发（/api/image/agent/*）。
 *
 * 非 SSE 端点：通过 AiPythonClient Feign 转发，用 R.ok() 包装成统一响应格式。
 * SSE 端点：使用进程级 JDK HttpClient 连接池代理流式响应，绕过 Feign 不支持 SSE 的限制。
 */
@RestController
@Slf4j
@RequestMapping("/api/image/agent")
public class AgentController {

    private final AiPythonClient aiPythonClient;
    private final HttpClient agentHttpClient;
    private final ObjectMapper objectMapper;

    @Value("${app.ai-python.url:http://localhost:8200}")
    private String aiPythonUrl;

    @Value("${app.ai-python.response-timeout:30s}")
    private Duration responseTimeout;

    public AgentController(
            AiPythonClient aiPythonClient,
            @Qualifier("agentHttpClient") HttpClient agentHttpClient,
            ObjectMapper objectMapper) {
        this.aiPythonClient = aiPythonClient;
        this.agentHttpClient = agentHttpClient;
        this.objectMapper = objectMapper;
    }

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

    // ===== Chat (SSE proxy) =====

    @PostMapping(value = "/chat", produces = "text/event-stream;charset=UTF-8")
    public void chat(
            @RequestBody byte[] rawBody,
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        proxySse("/agent/chat", rawBody, request, response, "error");
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

    // ===== Artifact-centric Design Agent =====

    @PostMapping("/design/projects")
    public R<Map<String, Object>> designCreateProject(
            HttpServletRequest request,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.designCreateProject(forwardHeaders(request), payload));
    }

    @GetMapping("/design/projects")
    public R<Map<String, Object>> designListProjects(HttpServletRequest request) {
        return R.ok(aiPythonClient.designListProjects(forwardHeaders(request)));
    }

    @GetMapping("/design/projects/{uuid}")
    public R<Map<String, Object>> designGetProject(
            HttpServletRequest request,
            @PathVariable String uuid) {
        return R.ok(aiPythonClient.designGetProject(forwardHeaders(request), uuid));
    }

    @PatchMapping("/design/projects/{uuid}/brief")
    public R<Map<String, Object>> designUpdateBrief(
            HttpServletRequest request,
            @PathVariable String uuid,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.designUpdateBrief(forwardHeaders(request), uuid, payload));
    }

    @PostMapping("/design/projects/{uuid}/plans")
    public R<Map<String, Object>> designCreatePlan(
            HttpServletRequest request,
            @PathVariable String uuid,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.designCreatePlan(forwardHeaders(request), uuid, payload));
    }

    @PostMapping("/design/projects/{uuid}/actions/{actionUuid}/approve")
    public R<Map<String, Object>> designApproveAction(
            HttpServletRequest request,
            @PathVariable String uuid,
            @PathVariable String actionUuid,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.designApproveAction(
                forwardHeaders(request), uuid, actionUuid, payload));
    }

    @PostMapping("/design/projects/{uuid}/actions/{actionUuid}/reject")
    public R<Map<String, Object>> designRejectAction(
            HttpServletRequest request,
            @PathVariable String uuid,
            @PathVariable String actionUuid,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.designRejectAction(
                forwardHeaders(request), uuid, actionUuid, payload));
    }

    @PostMapping(value = "/design/projects/{uuid}/runs/{runId}/execute", produces = "text/event-stream;charset=UTF-8")
    public void designExecuteRun(
            @PathVariable String uuid,
            @PathVariable Long runId,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        proxySse(
                "/agent/design/projects/" + uuid + "/runs/" + runId + "/execute",
                new byte[0],
                request,
                response,
                "run_failed");
    }

    @GetMapping("/design/projects/{uuid}/artifacts")
    public R<Map<String, Object>> designListArtifacts(
            HttpServletRequest request,
            @PathVariable String uuid) {
        return R.ok(aiPythonClient.designListArtifacts(forwardHeaders(request), uuid));
    }

    @PostMapping("/design/projects/{uuid}/assets")
    public R<Map<String, Object>> designRegisterAsset(
            HttpServletRequest request,
            @PathVariable String uuid,
            @RequestBody Map<String, Object> payload) {
        return R.ok(aiPythonClient.designRegisterAsset(forwardHeaders(request), uuid, payload));
    }

    @PostMapping("/design/projects/{uuid}/artifacts/{artifactId}/select")
    public R<Map<String, Object>> designSelectArtifact(
            HttpServletRequest request,
            @PathVariable String uuid,
            @PathVariable Long artifactId) {
        return R.ok(aiPythonClient.designSelectArtifact(forwardHeaders(request), uuid, artifactId));
    }

    @PostMapping("/design/projects/{uuid}/finalize")
    public R<Map<String, Object>> designFinalize(
            HttpServletRequest request,
            @PathVariable String uuid) {
        return R.ok(aiPythonClient.designFinalize(forwardHeaders(request), uuid));
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

    private static final List<String> FORWARDED_HEADERS = List.of(
            "Authorization",
            "X-Trace-Id",
            "X-User-Id",
            "X-User-Name",
            "X-User-Roles",
            "X-User-Group-Id",
            "X-User-Group-Role",
            "Idempotency-Key",
            "X-MCP-Request-Id"
    );

    private Map<String, String> forwardHeaders(HttpServletRequest request) {
        Map<String, String> headers = new LinkedHashMap<>();
        for (String name : FORWARDED_HEADERS) {
            String value = request.getHeader(name);
            if (value != null && !value.isBlank()) {
                headers.put(name, value);
            }
        }
        return headers;
    }

    private void proxySse(
            String upstreamPath,
            byte[] rawBody,
            HttpServletRequest request,
            HttpServletResponse response,
            String errorType) throws IOException {
        response.setContentType("text/event-stream;charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.setBufferSize(8192);
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("X-Accel-Buffering", "no");

        HttpRequest.Builder upstreamRequest = HttpRequest.newBuilder()
                .uri(URI.create(aiPythonUrl + upstreamPath))
                .timeout(responseTimeout)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofByteArray(rawBody));
        forwardHeaders(request).forEach(upstreamRequest::header);

        HttpResponse<InputStream> upstream;
        try {
            upstream = agentHttpClient.send(upstreamRequest.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            writeSseError(response, errorType, "upstream request interrupted", null);
            return;
        } catch (IOException | RuntimeException e) {
            writeSseError(response, errorType, safeMessage(e), null);
            return;
        }

        try (InputStream in = upstream.body()) {
            if (upstream.statusCode() < 200 || upstream.statusCode() >= 300) {
                String body = new String(in.readNBytes(4096), StandardCharsets.UTF_8);
                String detail = body.isBlank()
                        ? "upstream returned HTTP " + upstream.statusCode()
                        : body;
                writeSseError(response, errorType, detail, upstream.statusCode());
                return;
            }

            byte[] buffer = new byte[8192];
            jakarta.servlet.ServletOutputStream out = response.getOutputStream();
            while (true) {
                final int read;
                try {
                    read = in.read(buffer);
                } catch (IOException e) {
                    writeSseError(response, errorType, safeMessage(e), upstream.statusCode());
                    return;
                }
                if (read == -1) {
                    return;
                }
                try {
                    out.write(buffer, 0, read);
                    out.flush();
                } catch (IOException clientDisconnected) {
                    log.debug("SSE client disconnected: path={}", upstreamPath);
                    return;
                }
            }
        }
    }

    private void writeSseError(
            HttpServletResponse response,
            String errorType,
            String detail,
            Integer upstreamStatus) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("type", errorType);
            payload.put("detail", detail);
            if ("run_failed".equals(errorType)) {
                payload.put("error", detail);
            }
            if (upstreamStatus != null) {
                payload.put("upstream_status", upstreamStatus);
            }
            String event = "data: " + objectMapper.writeValueAsString(payload) + "\n\n"
                    + "data: [DONE]\n\n";
            response.getOutputStream().write(event.getBytes(StandardCharsets.UTF_8));
            response.getOutputStream().flush();
        } catch (IOException clientDisconnected) {
            log.debug("unable to write SSE error because client disconnected");
        }
    }

    private String safeMessage(Exception error) {
        return error.getMessage() == null || error.getMessage().isBlank()
                ? "upstream error"
                : error.getMessage();
    }
}
