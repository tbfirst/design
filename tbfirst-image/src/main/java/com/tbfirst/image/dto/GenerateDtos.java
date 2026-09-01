package com.tbfirst.image.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 生图 DTO 集合 —— 供 {@link com.tbfirst.image.controller.ImageController#generate} 使用。
 */
public class GenerateDtos {

    /**
     * 生图请求。字段名以 camelCase，Service 层转为 Python 所需的 snake_case。
     */
    @Data
    public static class GenerateRequest {
        @NotBlank
        private String prompt;
        /** 跨网关重试幂等键；同一用户下唯一，最长 128 字符。 */
        private String requestId;
        // todo 之后改为使用模型链，前端传入一个模型列表，后端根据模型列表调用不同的模型，在不指定模型时使用默认模型（如 "gemini-2.5-flash-image"）
        private String model = "gemini-2.5-flash-image";
        /** 阶段标识：phase0 / phase1 / phase2 / phase2Color */
        private String phase = "phase0";        // 默认是 phase0 ，实际调用时可修改为 phase1 / phase2 / phase2Color
        private Map<String, Object> extra;
        /** base64 data URI 参考图片列表 */
        private List<String> referenceImages;
        /**
         * 每张参考图的用户标签，与 {@link #referenceImages} 严格等长（errorConclude #41）。
         * 空串或整体缺省时，Python prompt_engine 会按位置落默认 label（Main Model / Background / Product Detail）。
         * 非空时将替换为 "[Reference Image: &lt;label&gt;]"，帮助 Gemini 在多图参考下区分语义，
         * 降低对"哪张是正面/背面"产生的幻觉。
         */
        private List<String> referenceLabels;
        private String aspectRatio = "3:4";
        private String imageSize = "1K";
        /** 阶段配置（shotType/tone/atmosphere/action 等） */
        private Map<String, Object> phaseConfig;
    }

    /**
     * 批量删除历史生图请求。
     *
     * <p>由 {@code POST /api/image/jobs/batch-delete} 消费；Service 端会按当前登录用户
     * 一次性过滤所有权，非本人 / 不存在 / 已软删的 id 静默跳过，由响应 {@code skipped}
     * 字段汇报数量。</p>
     */
    @Data
    public static class BatchDeleteRequest {
        /** 待删除的 generation_job 主键集合；空集合直接返回 deleted=0 */
        private List<Long> ids;
    }

    /** 生图响应：jobId 可用于再查 history，urls 是落盘后的静态路径 */
    // todo 未来加历史图片列表，前端可根据 jobId 查询历史记录接口获取历史图片列表
    @Data
    public static class GenerateResponse {
        private Long jobId;
        /** pending / success / failed —— 异步化后 POST 立即返回 pending，前端轮询 /jobs/{id}/status 拿终态 */
        private String status;
        /** 生成图片 URL 列表（/static/image/{phase}/xxx.png 或 GCS 预签名 URL）；pending 时为空 */
        private List<String> urls;
        /** Python 原始文本响应（phase3/phase0 的 dna JSON 等）；异步成功后由 result_text 回填 */
        private String rawResponse;
        /** 失败原因（status=failed 时填充），供前端 getFriendlyError 展示 */
        private String errorMsg;
    }

    /**
     * V5.XVII.E：通用参考图上传请求 —— 把 base64 data URI 列表落到 GCS 换短链。
     *
     * <p><b>禁止内容：</b>非 data:image/... 的字符串（http URL、相对路径）会被 service 直接拒绝
     * （否则 base64 解码会出乱码污染存储）。</p>
     */
    @Data
    public static class UploadRequest {
        /** 必填：data:image/...;base64,... 形式的图片列表 */
        private List<String> dataUris;
        /** 存储桶子目录；缺省为 "upload"（与生图阶段隔离） */
        private String phase = "upload";
    }

    /** V5.XVII.E：上传响应 —— 与入参 dataUris 等长的短链 URL 列表 */
    @Data
    public static class UploadResponse {
        private List<String> urls;
    }
}
