package com.tbfirst.cinestitch.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 分镜四阶段流水线 DTO 集合（V6.SB.1）。
 */
public class StoryboardDtos {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class BibleReq {
        @NotBlank
        @JsonProperty("storyText")
        private String storyText;
        /** 输入模式：script=用户脚本 / images=人物参考图 / auto=AI 自由创作 */
        @JsonProperty("mode")
        private String mode;
        /** mode=images 时的人物参考图引用（/img/... 短链等），透传给 Python 多模态 */
        @JsonProperty("imageRefs")
        private List<String> imageRefs;
        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class BibleResp {
        /** 服务端创建的项目主键，前端据此追踪后续 draft/frame/save */
        @JsonProperty("projectId")
        private Long projectId;
        /** preProduction JSON 字符串（原样透传给前端） */
        @JsonProperty("preProduction")
        private String preProduction;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class DraftReq {
        @NotBlank
        @JsonProperty("storyText")
        private String storyText;
        @NotBlank
        @JsonProperty("preProductionJson")
        private String preProductionJson;
        /** 服装视觉一致性档案（透传给 Python，令分镜描述贴合该服装） */
        @JsonProperty("consistencyProtocol")
        private String consistencyProtocol;
        /** 动态脚本（导演意图，需扩写为逐镜画面） */
        @JsonProperty("dynamicScript")
        private String dynamicScript;
        /** 关键帧数 N（= 分镜数 = 宫格数）：有则要求恰好生成 N 个分镜 */
        @JsonProperty("gridCount")
        private Integer gridCount;
        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class DraftResp {
        /** shots JSON 字符串（原样透传给前端） */
        private String shots;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL) // 透传给 Python 时丢弃 null 字段，避免非 Optional 字段(如 prevSameShot/imageSize)收到 null 触发 422
    public static class FrameReq {
        @NotBlank
        @JsonProperty("shotDescription")
        private String shotDescription;
        @JsonProperty("frameIndex")
        private int frameIndex;
        /** 本镜总帧数（用于动作完成度 N/M，避免各帧重复） */
        @JsonProperty("frameTotal")
        private Integer frameTotal;
        @JsonProperty("motionType")
        private String motionType;
        @JsonProperty("aspectRatio")
        private String aspectRatio;
        /** 渲染画质（1K/2K），映射 Gemini imageConfig.imageSize */
        @JsonProperty("imageSize")
        private String imageSize;
        /** 服装参考图（/img/ 短链等），喂入 Gemini 锁定服装一致性 */
        @JsonProperty("garmentRefs")
        private List<String> garmentRefs;
        /** 模特参考图（共享模特库），作为主模特身份锚点锁定全片人物一致性 */
        @JsonProperty("modelRefs")
        private List<String> modelRefs;
        /** 上一帧画面（同镜运动帧 或 上一镜结尾帧），作为连贯性锚点承接朝向/动作 */
        @JsonProperty("prevFrameRef")
        private String prevFrameRef;
        /** 上一帧是否同镜：true=同镜运动帧，false=上一镜结尾帧（跨镜承接） */
        @JsonProperty("prevSameShot")
        private Boolean prevSameShot;
        @JsonProperty("consistencyProtocol")
        private String consistencyProtocol;
        /** 角色动作（画面 + 动作标注） */
        @JsonProperty("action")
        private String action;
        /** 镜头运动（画面 + 运镜标注 + 俯视机位示意） */
        @JsonProperty("cameraMovement")
        private String cameraMovement;
        /** 分镜面板标题，如 "FRAME 2" */
        @JsonProperty("frameLabel")
        private String frameLabel;
        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class FrameResp {
        @JsonProperty("imageDataUri")
        private String imageDataUri;
    }

    /** 宫格中一个小格对应的分镜信息 */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class GridShot {
        @JsonProperty("description")
        private String description;
        @JsonProperty("action")
        private String action;
        @JsonProperty("cameraMovement")
        private String cameraMovement;
        @JsonProperty("shotSize")
        private String shotSize;
    }

    /** 宫格出图请求：一次性生成整张 N 宫格图（每格一个小图、对应一个分镜） */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL) // 透传 Python 时丢弃 null，避免非 Optional 字段收到 null 触发 422
    public static class GridReq {
        /** N 个分镜（一格一个，按顺序填入宫格） */
        @JsonProperty("shots")
        private List<GridShot> shots;
        /** 关键帧数 N（= 分镜数 = 宫格数） */
        @JsonProperty("gridCount")
        private Integer gridCount;
        @JsonProperty("aspectRatio")
        private String aspectRatio;
        /** 渲染画质（1K/2K），映射 Gemini imageConfig.imageSize */
        @JsonProperty("imageSize")
        private String imageSize;
        /** 服装参考图（/img/ 短链等），喂入 Gemini 锁定服装一致性 */
        @JsonProperty("garmentRefs")
        private List<String> garmentRefs;
        /** 模特参考图（共享模特库），作为主模特身份锚点锁定全图人物一致性 */
        @JsonProperty("modelRefs")
        private List<String> modelRefs;
        @JsonProperty("consistencyProtocol")
        private String consistencyProtocol;
        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class AnalyzeGarmentReq {
        /** 服装参考图引用（正/反/细节）：/img/ 短链、http(s) 或 data URI */
        @JsonProperty("imageRefs")
        private List<String> imageRefs;
        @JsonProperty("notes")
        private String notes;
        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class AnalyzeGarmentResp {
        @JsonProperty("consistencyProtocol")
        private String consistencyProtocol;
        @JsonProperty("usedModel")
        private String usedModel;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class SaveDocReq {
        @JsonProperty("docJson")
        private String docJson;
        private String stage;
        private String title;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ProjectListItem {
        private Long id;
        private String title;
        private String status;
        private String stage;
        @JsonProperty("coverImageUrl")
        private String coverImageUrl;
        @JsonProperty("createTime")
        private LocalDateTime createTime;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class VideoClipReq {
        /** 参考图列表：排版宫格图 / 故事板 / 分镜表图的 data URI（最多 9 张，@Image1..@ImageN）；可空=纯文本生成 */
        @JsonProperty("imageDataUris")
        private List<String> imageDataUris;
        @NotBlank
        private String prompt;
        /** 单条视频时长（Seedance ≤15s） */
        @JsonProperty("durationSeconds")
        private Integer durationSeconds;
        @JsonProperty("aspectRatio")
        private String aspectRatio;
        /** 分辨率，如 720p；Python 据 aspectRatio+resolution 推算 size */
        @JsonProperty("resolution")
        private String resolution;
        private String model;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VideoClipStartResp {
        @JsonProperty("operationName")
        private String operationName;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class PollVideoClipReq {
        @NotBlank
        @JsonProperty("operationName")
        private String operationName;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class PollVideoClipResp {
        private Boolean done;
        @JsonProperty("videoUri")
        private String videoUri;
        private String error;
    }

    /**
     * 单个项目详情出参。仅暴露前端所需字段（含 docJson），
     * 不外泄 BaseEntity 的 deleted/createBy/updateBy 等内部审计列。
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class ProjectDetail {
        private Long id;
        private String title;
        private String status;
        private String stage;
        @JsonProperty("docJson")
        private String docJson;
        @JsonProperty("coverImageUrl")
        private String coverImageUrl;
        @JsonProperty("createTime")
        private LocalDateTime createTime;
    }
}
