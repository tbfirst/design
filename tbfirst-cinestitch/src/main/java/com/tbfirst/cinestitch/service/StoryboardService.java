package com.tbfirst.cinestitch.service;

import com.tbfirst.cinestitch.dto.StoryboardDtos;

import java.util.List;

/**
 * 分镜四阶段流水线 Service 接口（V6.SB.1）。
 */
public interface StoryboardService {

    StoryboardDtos.BibleResp generateBible(Long userId, StoryboardDtos.BibleReq req);

    StoryboardDtos.DraftResp generateDraft(Long userId, Long projectId, StoryboardDtos.DraftReq req);

    /** 服装视觉一致性档案提取（无状态，不落库） */
    StoryboardDtos.AnalyzeGarmentResp analyzeGarment(Long userId, StoryboardDtos.AnalyzeGarmentReq req);

    /**
     * 单帧出图。返回 Python 生成的 data URI（不落库）；
     * 由前端经 image 服务换 /img/... 短链后 {@link #saveDoc} 整份写回 doc_json。
     */
    String generateFrame(Long userId, Long projectId, int shotIdx, int frameIdx,
                         StoryboardDtos.FrameReq req);

    /**
     * 一次性生成整张 N 宫格图。返回 Python 生成的 data URI（不落库）；
     * 由前端经 image 服务换 /img/... 短链后 {@link #saveDoc} 整份写回 doc_json。
     */
    String generateGrid(Long userId, Long projectId, StoryboardDtos.GridReq req);

    /** 启动 Veo 图转视频，返回 operationName（不落库） */
    StoryboardDtos.VideoClipStartResp startVideoClip(Long userId, StoryboardDtos.VideoClipReq req);

    /** 轮询 Veo 任务状态（不落库） */
    StoryboardDtos.PollVideoClipResp pollVideoClip(Long userId, StoryboardDtos.PollVideoClipReq req);

    void saveDoc(Long userId, Long projectId, StoryboardDtos.SaveDocReq req);

    StoryboardDtos.ProjectDetail getProject(Long userId, Long projectId);

    List<StoryboardDtos.ProjectListItem> listProjects(Long userId, int page, int size);

    void deleteProject(Long userId, Long projectId);
}
