package com.tbfirst.image.controller;

import com.tbfirst.common.core.response.R;
import com.tbfirst.common.security.context.UserContext;
import com.tbfirst.common.security.context.UserContextHolder;
import com.tbfirst.image.dto.GenerateDtos;
import com.tbfirst.image.dto.McpDtos;
import com.tbfirst.image.service.ImageGenerateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/image/mcp")
public class McpImageController {

    private final ImageGenerateService service;

    @GetMapping("/workspace")
    public R<Map<String, Object>> workspace(
            @RequestHeader(name = "X-MCP-Client", required = false) String mcpClient) {
        UserContext user = UserContextHolder.get();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("service", "tbfirst-image");
        data.put("mcpReady", true);
        data.put("mcpClient", mcpClient == null || mcpClient.isBlank() ? "codex" : mcpClient);
        data.put("user", userContext(user));
        data.put("tools", List.of(
                tool("tbfirst_check_workspace", "Check tbfirst auth/gateway/image availability for MCP use."),
                tool("tbfirst_create_adimage_set", "Create ad image assets through the MCP workflow layer."),
                tool("tbfirst_image_phase2_refine", "Run tbfirst-image phase2 refinement."),
                tool("tbfirst_image_phase2_color", "Run tbfirst-image phase2Color recolor or texture mapping."),
                tool("tbfirst_image_phase3_banner", "Run tbfirst-image phase3 banner/ad generation.")
        ));
        return R.ok(data);
    }

    @PostMapping("/image/generate")
    public R<McpDtos.ToolResponse> generateImage(@Valid @RequestBody McpDtos.ImageGenerateRequest req) {
        GenerateDtos.GenerateRequest generate = toGenerateRequest(req);
        GenerateDtos.GenerateResponse response = service.generate(generate);
        return R.ok(toToolResponse("tbfirst_image_generate", response));
    }

    @GetMapping("/image/jobs/{id}")
    public R<McpDtos.ToolResponse> getJob(@PathVariable Long id) {
        GenerateDtos.GenerateResponse response = service.getJobStatus(id);
        return R.ok(toToolResponse("tbfirst_image_poll_job", response));
    }

    @PostMapping("/image/upload-assets")
    public R<McpDtos.ToolResponse> uploadAssets(@Valid @RequestBody McpDtos.UploadAssetsRequest req) {
        List<String> urls = service.uploadAssets(req.getDataUris(), req.getPhase());
        McpDtos.ToolResponse response = new McpDtos.ToolResponse();
        response.setTool("tbfirst_image_upload_assets");
        response.setStatus("success");
        response.setMessage("Uploaded assets are ready for MCP image workflows.");
        response.setUrls(urls);
        return R.ok(response);
    }

    private static GenerateDtos.GenerateRequest toGenerateRequest(McpDtos.ImageGenerateRequest req) {
        GenerateDtos.GenerateRequest generate = new GenerateDtos.GenerateRequest();
        generate.setPrompt(buildPrompt(req));
        generate.setRequestId(req.getRequestId());
        generate.setModel(defaultString(req.getModel(), "gemini-3.1-flash-image"));
        generate.setPhase(defaultString(req.getPhase(), "phase3"));
        generate.setReferenceImages(mergeReferences(req));
        generate.setReferenceLabels(req.getReferenceLabels());
        generate.setAspectRatio(defaultString(req.getAspectRatio(), "3:4"));
        generate.setImageSize(defaultString(req.getImageSize(), "1K"));
        generate.setPhaseConfig(mergePhaseConfig(req));
        generate.setExtra(req.getExtra());
        return generate;
    }

    private static String buildPrompt(McpDtos.ImageGenerateRequest req) {
        StringBuilder prompt = new StringBuilder(req.getPrompt().trim());
        append(prompt, "Style", req.getStyle());
        append(prompt, "Brand notes", req.getBrandNotes());
        if (req.getCopywriting() != null && !req.getCopywriting().isEmpty()) {
            prompt.append("\nCopywriting:");
            req.getCopywriting().forEach((key, value) -> append(prompt, key, value));
        }
        if (req.getCount() != null && req.getCount() > 1) {
            prompt.append("\nCreate ").append(req.getCount()).append(" coherent variants.");
        }
        return prompt.toString();
    }

    private static void append(StringBuilder prompt, String label, String value) {
        if (value != null && !value.isBlank()) {
            prompt.append('\n').append(label).append(": ").append(value.trim());
        }
    }

    private static List<String> mergeReferences(McpDtos.ImageGenerateRequest req) {
        List<String> refs = new ArrayList<>();
        addAll(refs, req.getProductImages());
        if (req.getTemplateImage() != null && !req.getTemplateImage().isBlank()) {
            refs.add(req.getTemplateImage().trim());
        }
        addAll(refs, req.getReferenceImages());
        return refs;
    }

    private static void addAll(List<String> refs, List<String> values) {
        if (values == null) {
            return;
        }
        values.stream()
                .filter(v -> v != null && !v.isBlank())
                .map(String::trim)
                .forEach(refs::add);
    }

    private static Map<String, Object> mergePhaseConfig(McpDtos.ImageGenerateRequest req) {
        Map<String, Object> config = new LinkedHashMap<>();
        if (req.getPhaseConfig() != null) {
            config.putAll(req.getPhaseConfig());
        }
        config.putIfAbsent("source", "mcp");
        if (req.getCount() != null) {
            config.putIfAbsent("count", req.getCount());
        }
        if (req.getStyle() != null && !req.getStyle().isBlank()) {
            config.putIfAbsent("style", req.getStyle().trim());
        }
        return config;
    }

    private static McpDtos.ToolResponse toToolResponse(String tool, GenerateDtos.GenerateResponse source) {
        McpDtos.ToolResponse response = new McpDtos.ToolResponse();
        response.setTool(tool);
        response.setJobId(source.getJobId());
        response.setStatus(source.getStatus());
        response.setUrls(source.getUrls());
        response.setRawResponse(source.getRawResponse());
        if (source.getJobId() != null) {
            response.setPollPath("/api/image/mcp/image/jobs/" + source.getJobId());
        }
        if ("pending".equals(source.getStatus())) {
            response.setMessage("Image workflow accepted. Poll the job until status is success or failed.");
        } else {
            response.setMessage("Image workflow completed with status: " + source.getStatus());
        }
        return response;
    }

    private static Map<String, Object> userContext(UserContext user) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (user == null) {
            data.put("authenticated", false);
            return data;
        }
        data.put("authenticated", true);
        data.put("userId", user.getUserId());
        data.put("username", user.getUsername());
        data.put("roles", user.getRoles());
        data.put("groupId", user.getGroupId());
        data.put("groupRole", user.getGroupRole());
        data.put("personalModelCap", user.getPersonalModelCap());
        data.put("groupModelCap", user.getGroupModelCap());
        return data;
    }

    private static Map<String, String> tool(String name, String description) {
        Map<String, String> tool = new LinkedHashMap<>();
        tool.put("name", name);
        tool.put("description", description);
        return tool;
    }

    private static String defaultString(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}

