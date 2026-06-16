package com.tbfirst.image.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 品牌模特 DTO 集合 —— 用于 {@link com.tbfirst.image.controller.BrandModelController} 入参 / 出参。
 */
public class BrandModelDtos {

    /** 上传请求：前端以 base64 data URI 形式传图，避免 multipart 复杂性 */
    @Data
    public static class UploadRequest {
        /** base64 data URI, e.g. "data:image/png;base64,..." */
        @NotBlank
        private String dataUri;
        /** 用户自定义模特名，可选 */
        private String name;
    }

    /** 重命名请求：仅允许修改展示名，图片本身不动 */
    @Data
    public static class RenameRequest {
        @NotBlank
        private String name;
    }

    /**
     * 列表/上传响应：url 为 /static/** 下可直接访问的路径。
     *
     * 共享库改造后（errorConclude #37）:
     *  - userId 语义为"上传者 ID"（用于审计与未来筛选），不再做隔离
     *  - createTime 即上传时间
     *
     * TODO（扩展字段，本轮先不做，见 errorConclude #37 的 metadata roadmap）：
     *  - sourceService: 来源标记（"local" / "modellink" / ...）
     *  - tags: 标签数组，用于前端筛选
     */
    @Data
    public static class BrandModelResponse {
        private Long id;
        private String name;
        /** 可直接通过 Gateway /static/** 访问的图片 URL */
        private String url;
        private String mimeType;
        private Long fileSize;
        /** 上传者 ID；前端据此判断当前用户是否有"删除 / 改名"权限（uploader 自有） */
        private Long userId;
        /**
         * 所属组 ID：null = 个人库（仅上传者可见）；非 null = 该组共享库。
         * 前端可据此渲染"共享"徽章。
         */
        private Long groupId;
        /** 上传时间 */
        private LocalDateTime createTime;
    }
}
