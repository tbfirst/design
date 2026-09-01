package com.tbfirst.image.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;
import java.util.Map;

public class McpDtos {

    @Data
    public static class ImageGenerateRequest {
        @NotBlank
        private String prompt;
        private List<String> productImages;
        private String templateImage;
        private List<String> referenceImages;
        private List<String> referenceLabels;
        private String style;
        private String brandNotes;
        private Map<String, String> copywriting;
        @Min(1)
        @Max(4)
        private Integer count = 1;
        private String phase = "phase3";
        private String model = "gemini-2.5-flash-image";
        private String aspectRatio = "3:4";
        private String imageSize = "1K";
        private Map<String, Object> phaseConfig;
        private Map<String, Object> extra;
    }

    @Data
    public static class UploadAssetsRequest {
        @NotEmpty
        private List<String> dataUris;
        private String phase = "mcp-upload";
    }

    @Data
    public static class ToolResponse {
        private String tool;
        private String status;
        private String message;
        private Long jobId;
        private List<String> urls;
        private String rawResponse;
        private String pollPath;
        private Map<String, Object> context;
    }
}

