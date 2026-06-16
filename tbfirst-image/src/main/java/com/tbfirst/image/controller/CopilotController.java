package com.tbfirst.image.controller;

import com.tbfirst.common.core.response.R;
import com.tbfirst.image.dto.CopilotDtos;
import com.tbfirst.image.service.ImageGenerateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI Copilot 对话与品牌分析入口（/api/image/copilot）。
 *
 * 架构角色：
 *  - 转发前端聊天请求到 tbfirst-ai-python 的 /copilot/* 接口
 *  - 支持多轮 history、上下文 context 与参考图输入
 *
 * 使用场景：
 *  - chat：用户在 Copilot 面板和 AI 对话获取 prompt 建议
 *  - analyze-brand：输入品牌官网 URL，AI 返回 audience/tone/remark 做冷启动画像
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/image/copilot")
public class CopilotController {

    private final ImageGenerateService service;

    /**
     * 与 Copilot 进行多轮对话。
     *
     * @param req 含 userInput、history、context、referenceImages
     * @return AI 回复的文本
     */
    @PostMapping("/chat")
    public R<CopilotDtos.ChatResponse> chat(@Valid @RequestBody CopilotDtos.ChatRequest req) {
        return R.ok(service.copilotChat(req));
    }

    /**
     * 根据品牌官网 URL 分析目标受众、语调和备注。
     *
     * @param req 含品牌 URL
     * @return audience / tone / remark 三元组
     */
    @PostMapping("/analyze-brand")
    public R<CopilotDtos.AnalyzeResponse> analyzeBrand(@Valid @RequestBody CopilotDtos.AnalyzeRequest req) {
        return R.ok(service.analyzeBrand(req));
    }

    /**
     * 灵感按钮：无 userInput，后端根据当前 context + referenceImages 随机
     * 生成一条简短 prompt 灵感。
     *
     * @param req 含 context + referenceImages
     * @return 灵感 prompt 文本
     */
    @PostMapping("/inspire")
    public R<CopilotDtos.InspireResponse> inspire(@RequestBody CopilotDtos.InspireRequest req) {
        return R.ok(service.copilotInspire(req));
    }
}
