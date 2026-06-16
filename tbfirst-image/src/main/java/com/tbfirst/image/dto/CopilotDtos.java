package com.tbfirst.image.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * Copilot DTO 集合 —— 供 {@link com.tbfirst.image.controller.CopilotController} 使用。
 * 字段结构保持宽松（Map/List）以便透传给 Python 侧 Pydantic schema。
 */
public class CopilotDtos {

    /** Copilot 多轮对话请求 */
    @Data
    public static class ChatRequest {
        // 用户输入
        @NotBlank
        private String userInput;

        private List<Map<String, Object>> history;

        private Map<String, Object> context;

        // 用户偏爱的模型
        private List<String> referenceImages;

        // V5.XVII.D：与 referenceImages 等长的角色标签数组
        // ('product' / 'model' / 'inspiration')，用于消除 Python 侧"主商品"识别歧义
        private List<String> referenceImageRoles;
    }

    /** Copilot 对话响应：当前仅返回纯文本 */
    @Data
    public static class ChatResponse {
        private String text;
    }

    /** 品牌 URL 分析请求 */
    @Data
    public static class AnalyzeRequest {
        /** 品牌官网或产品页 URL */
        @NotBlank
        private String url;
    }

    /** 品牌 URL 分析响应：受众 / 语调 / 备注 */
    @Data
    public static class AnalyzeResponse {
        /** 目标受众，如 "Gen Z 女性，18-25 岁" */
        private String audience;
        /** 品牌调性，如 "简约、环保、高冷" */
        private String tone;
        /** 其他备注 */
        private String remark;
    }

    /** Copilot 灵感按钮请求：无 userInput，完全由当前界面素材驱动 */
    @Data
    public static class InspireRequest {
        /** 完整 Copilot 上下文（activePhase / brand / p1Settings / p2Settings） */
        private Map<String, Object> context;

        /** 参考图片 data URI 列表（与 chat 相同） */
        private List<String> referenceImages;

        /**
         * V5.XVII.D：与 referenceImages 等长的角色标签数组
         * ('product' / 'model' / 'inspiration')，用于消除 Python 侧"主商品"识别歧义
         */
        private List<String> referenceImageRoles;

        /** V5.XVII.C：前端 localStorage 维护的最近灵感文本，供 Python 侧去重 */
        private List<String> recentInspirations;
    }

    /** Copilot 灵感按钮响应：纯 prompt 文本，无 Markdown / 代码块 */
    @Data
    public static class InspireResponse {
        private String text;
    }
}
