package com.tbfirst.cinestitch.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Cinestitch 分镜生成接口 DTO 集合。
 */
public class CinestitchDtos {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GenerateRequest {
        /** 服装参考图 GCS 短链（必填），Python 侧用 decode_image_to_inline 拉取 */
        @NotBlank
        @Pattern(regexp = "^(/img/[^\\s].{0,499}|data:image/[a-z+]+;base64,[A-Za-z0-9+/=\r\n]+)$",
                 message = "imageUrl 只接受 /img/... 路径或 data:image/... base64 URI")
        @JsonProperty("imageUrl")
        private String imageUrl;

        /** 导演方向提示词（可选），最长 500 字符 */
        @Size(max = 500)
        private String prompt;

        /** AI 模型标识（可选，空则走 Python 侧默认文本链） */
        private String model;

        /** 生成的分镜幕数，1-12，默认 6 */
        @Min(1)
        @Max(12)
        @Builder.Default
        private int sceneCount = 6;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GenerateResponse {
        /** AI 生成的 Markdown 分镜表格 */
        private String markdown;

        /** 实际使用的 AI 模型 ID */
        @JsonProperty("usedModel")
        private String usedModel;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VideoParseRequest {
        /** http(s) 视频链接（与 videoDataUri 二选一）；@Pattern 对 null 不校验 */
        @Pattern(regexp = "^https?://[^\\s]{1,2000}$", message = "videoUrl 必须是 http(s):// 开头的合法 URL")
        @JsonProperty("videoUrl")
        private String videoUrl;

        /** 上传短视频的 base64 data URI（data:video/...;base64,...），与 videoUrl 二选一 */
        @JsonProperty("videoDataUri")
        private String videoDataUri;

        @Size(max = 500)
        private String prompt;

        private String model;

        @Min(1)
        @Max(12)
        @Builder.Default
        private int sceneCount = 6;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VideoParseResponse {
        private String markdown;

        @JsonProperty("usedModel")
        private String usedModel;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VideoPromptsRequest {
        @NotBlank
        @JsonProperty("scenesMarkdown")
        private String scenesMarkdown;

        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VideoPromptsResponse {
        private List<String> prompts;

        @JsonProperty("usedModel")
        private String usedModel;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class JobListItem {
        private Long id;
        @JsonProperty("userId")
        private Long userId;
        private String model;
        private String prompt;
        private String result;
        private String status;
        @JsonProperty("imageUrl")
        private String imageUrl;

        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
        @JsonProperty("createTime")
        private LocalDateTime createTime;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ScriptParseRequest {
        @NotBlank
        @Size(max = 10000)
        @JsonProperty("scriptContent")
        private String scriptContent;

        @Size(max = 500)
        private String prompt;

        private String model;

        @Min(1)
        @Max(20)
        @Builder.Default
        private Integer sceneCount = 8;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ScriptParseResponse {
        private String markdown;

        @JsonProperty("usedModel")
        private String usedModel;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GenerateShotImageRequest {
        @NotBlank
        @Size(max = 2000)
        @JsonProperty("visualDescription")
        private String visualDescription;

        @Builder.Default
        @JsonProperty("stylePreset")
        private String stylePreset = "cinematic";

        @Builder.Default
        @JsonProperty("aspectRatio")
        private String aspectRatio = "16:9";

        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GenerateShotImageResponse {
        @JsonProperty("imageUrl")
        private String imageUrl;

        @JsonProperty("usedModel")
        private String usedModel;
    }
}
