package com.tbfirst.cinestitch.client;

import com.tbfirst.cinestitch.dto.CinestitchDtos;
import com.tbfirst.cinestitch.dto.StoryboardDtos;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.util.Map;

/**
 * Python prompt_engine 远程调用客户端（Cinestitch 专用）。
 *
 * <p>架构角色：基于 Spring Cloud OpenFeign 声明式 HTTP 客户端，通过 Nacos 服务发现
 * 路由到 {@code tbfirst-ai-python} 服务，将分镜生成请求代理到 Python 侧的
 * FastAPI /cinestitch/generate 端点。</p>
 *
 * <p>使用场景：由 {@link com.tbfirst.cinestitch.service.impl.CinestitchServiceImpl}
 * 调用；{@code contextId} 独立命名以避免多服务共用同一 Feign name 时的 Bean 冲突。</p>
 */
@FeignClient(name = "tbfirst-ai-python", contextId = "cinestitchAiClient", url = "${app.ai-python.url:}", path = "")
public interface AiPythonClient {

    /**
     * 调用 Python 端分镜生成接口。
     *
     * @param req 包含 imageUrl、prompt、model、sceneCount 的请求 DTO
     * @return Python 服务返回的 Markdown 分镜表格 + 使用的模型 ID
     */
    @PostMapping("/cinestitch/generate")
    CinestitchDtos.GenerateResponse generate(@RequestBody CinestitchDtos.GenerateRequest req);

    @PostMapping("/cinestitch/parse-video")
    CinestitchDtos.VideoParseResponse parseVideo(@RequestBody CinestitchDtos.VideoParseRequest req);

    @PostMapping("/cinestitch/generate-video-prompts")
    CinestitchDtos.VideoPromptsResponse generateVideoPrompts(@RequestBody CinestitchDtos.VideoPromptsRequest req);

    @PostMapping("/cinestitch/parse-script")
    CinestitchDtos.ScriptParseResponse parseScript(@RequestBody CinestitchDtos.ScriptParseRequest req);

    @PostMapping("/cinestitch/generate-shot-image")
    CinestitchDtos.GenerateShotImageResponse generateShotImage(@RequestBody CinestitchDtos.GenerateShotImageRequest req);

    // ---- 分镜四阶段 V6.SB.1 端点 ----

    /** 返回 Python StoryBible flat JSON，用 Map 接收避免字段不匹配导致 null */
    @PostMapping("/cinestitch/bible")
    Map<String, Object> generateBible(@RequestBody StoryboardDtos.BibleReq req);

    /** preProduction 以 Map 形式传给 Python（Python 端 DraftRequest.pre_production: dict） */
    @PostMapping("/cinestitch/draft")
    Map<String, Object> generateDraft(@RequestBody Map<String, Object> req);

    @PostMapping("/cinestitch/generate-frame")
    StoryboardDtos.FrameResp generateFrame(@RequestBody StoryboardDtos.FrameReq req);

    /** 一次性生成整张 N 宫格图，返回 data URI（不落库） */
    @PostMapping("/cinestitch/generate-grid")
    StoryboardDtos.FrameResp generateGrid(@RequestBody StoryboardDtos.GridReq req);

    /** 服装视觉一致性档案提取（无状态，不落库） */
    @PostMapping("/cinestitch/analyze-garment")
    StoryboardDtos.AnalyzeGarmentResp analyzeGarment(@RequestBody StoryboardDtos.AnalyzeGarmentReq req);

    /** 启动图转视频，返回 operationName（不落库） */
    @PostMapping("/cinestitch/generate-video-clip")
    StoryboardDtos.VideoClipStartResp generateVideoClip(@RequestBody StoryboardDtos.VideoClipReq req);

    /** 轮询视频生成任务状态（不落库） */
    @PostMapping("/cinestitch/poll-video-clip")
    StoryboardDtos.PollVideoClipResp pollVideoClip(@RequestBody StoryboardDtos.PollVideoClipReq req);
}
