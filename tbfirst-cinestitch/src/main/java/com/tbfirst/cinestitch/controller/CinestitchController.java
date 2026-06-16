package com.tbfirst.cinestitch.controller;

import com.tbfirst.cinestitch.dto.CinestitchDtos;
import com.tbfirst.cinestitch.dto.StoryboardDtos;
import com.tbfirst.cinestitch.service.CinestitchService;
import com.tbfirst.cinestitch.service.StoryboardService;
import com.tbfirst.common.core.response.R;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Cinestitch（分镜生成）服务的 REST 控制器。
 *
 * <p>架构角色：对外暴露 {@code /api/cinestitch/**} 路由，由 Gateway 网关统一转发。
 * 用户 ID 通过 Gateway 注入的 {@code X-User-Id} 请求头读取，不在此层验 JWT。</p>
 */
@Validated
@RestController
@RequestMapping("/api/cinestitch")
@RequiredArgsConstructor
public class CinestitchController {

    private final CinestitchService service;
    private final StoryboardService storyboardService;

    @GetMapping("/health")
    public R<Map<String, Object>> health() {
        return R.ok(Map.of("service", "tbfirst-cinestitch", "status", "UP"));
    }

    /**
     * 分镜生成接口。
     *
     * @param userId 由 Gateway 注入的当前用户 ID
     * @param req    分镜生成请求（imageUrl 必填）
     * @return 包含 Markdown 分镜表格的响应
     */
    @PostMapping("/generate")
    public R<CinestitchDtos.GenerateResponse> generate(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid CinestitchDtos.GenerateRequest req) {
        return R.ok(service.generate(userId, req));
    }

    /**
     * 视频分镜解析接口。
     *
     * @param userId 由 Gateway 注入的当前用户 ID
     * @param req    视频解析请求（videoUrl 必填）
     * @return 包含 Markdown 分镜表格的响应
     */
    @PostMapping("/parse-video")
    public R<CinestitchDtos.VideoParseResponse> parseVideo(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid CinestitchDtos.VideoParseRequest req) {
        return R.ok(service.parseVideo(userId, req));
    }

    /**
     * 视频提示词生成接口（无状态，不落库）。
     *
     * @param req 分镜 Markdown + 可选模型
     * @return 每幕英文视频生成提示词列表
     */
    @PostMapping("/generate-video-prompts")
    public R<CinestitchDtos.VideoPromptsResponse> generateVideoPrompts(
            @RequestBody @Valid CinestitchDtos.VideoPromptsRequest req) {
        return R.ok(service.generateVideoPrompts(req));
    }

    /**
     * 历史作业列表接口。
     *
     * @param userId   由 Gateway 注入的当前用户 ID
     * @param page     页码（默认 1）
     * @param size     每页条数（默认 20）
     * @return 成功状态的历史分镜作业列表
     */
    @DeleteMapping("/{id}")
    public R<Void> delete(
            @RequestHeader("X-User-Id") Long userId,
            @PathVariable Long id) {
        service.deleteJob(userId, id);
        return R.ok(null);
    }

    @GetMapping("/list")
    public R<List<CinestitchDtos.JobListItem>> list(
            @RequestHeader("X-User-Id") Long userId,
            @RequestParam(defaultValue = "1") @Min(1) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(200) int size) {
        return R.ok(service.listJobs(userId, page, size));
    }

    @PostMapping("/parse-script")
    public R<CinestitchDtos.ScriptParseResponse> parseScript(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid CinestitchDtos.ScriptParseRequest req) {
        return R.ok(service.parseScript(userId, req));
    }

    @PostMapping("/generate-shot-image")
    public R<CinestitchDtos.GenerateShotImageResponse> generateShotImage(
            @RequestBody @Valid CinestitchDtos.GenerateShotImageRequest req) {
        return R.ok(service.generateShotImage(req));
    }

    // ---- 分镜四阶段 V6.SB.1 端点组 ----

    @PostMapping("/storyboard/bible")
    public R<StoryboardDtos.BibleResp> storyboardBible(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid StoryboardDtos.BibleReq req) {
        return R.ok(storyboardService.generateBible(userId, req));
    }

    @PostMapping("/storyboard/analyze-garment")
    public R<StoryboardDtos.AnalyzeGarmentResp> storyboardAnalyzeGarment(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid StoryboardDtos.AnalyzeGarmentReq req) {
        return R.ok(storyboardService.analyzeGarment(userId, req));
    }

    @PostMapping("/storyboard/draft")
    public R<StoryboardDtos.DraftResp> storyboardDraft(
            @RequestHeader("X-User-Id") Long userId,
            @RequestParam Long projectId,
            @RequestBody @Valid StoryboardDtos.DraftReq req) {
        return R.ok(storyboardService.generateDraft(userId, projectId, req));
    }

    @PostMapping("/storyboard/frame")
    public R<String> storyboardFrame(
            @RequestHeader("X-User-Id") Long userId,
            @RequestParam Long projectId,
            @RequestParam @Min(0) int shotIdx,
            @RequestParam @Min(0) int frameIdx,
            @RequestBody @Valid StoryboardDtos.FrameReq req) {
        String imgUrl = storyboardService.generateFrame(userId, projectId, shotIdx, frameIdx, req);
        return R.ok(imgUrl);
    }

    @PostMapping("/storyboard/grid")
    public R<String> storyboardGrid(
            @RequestHeader("X-User-Id") Long userId,
            @RequestParam Long projectId,
            @RequestBody @Valid StoryboardDtos.GridReq req) {
        String imgUrl = storyboardService.generateGrid(userId, projectId, req);
        return R.ok(imgUrl);
    }

    @PostMapping("/storyboard/video-clip")
    public R<StoryboardDtos.VideoClipStartResp> storyboardVideoClip(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid StoryboardDtos.VideoClipReq req) {
        return R.ok(storyboardService.startVideoClip(userId, req));
    }

    @PostMapping("/storyboard/poll-video-clip")
    public R<StoryboardDtos.PollVideoClipResp> storyboardPollVideoClip(
            @RequestHeader("X-User-Id") Long userId,
            @RequestBody @Valid StoryboardDtos.PollVideoClipReq req) {
        return R.ok(storyboardService.pollVideoClip(userId, req));
    }

    @PutMapping("/storyboard/{id}")
    public R<Void> storyboardSaveDoc(
            @RequestHeader("X-User-Id") Long userId,
            @PathVariable Long id,
            @RequestBody @Valid StoryboardDtos.SaveDocReq req) {
        storyboardService.saveDoc(userId, id, req);
        return R.ok(null);
    }

    @GetMapping("/storyboard/{id}")
    public R<StoryboardDtos.ProjectDetail> storyboardGetProject(
            @RequestHeader("X-User-Id") Long userId,
            @PathVariable Long id) {
        return R.ok(storyboardService.getProject(userId, id));
    }

    @GetMapping("/storyboard")
    public R<java.util.List<StoryboardDtos.ProjectListItem>> storyboardList(
            @RequestHeader("X-User-Id") Long userId,
            @RequestParam(defaultValue = "1") @Min(1) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return R.ok(storyboardService.listProjects(userId, page, size));
    }

    @DeleteMapping("/storyboard/{id}")
    public R<Void> storyboardDelete(
            @RequestHeader("X-User-Id") Long userId,
            @PathVariable Long id) {
        storyboardService.deleteProject(userId, id);
        return R.ok(null);
    }
}
