package com.tbfirst.cinestitch.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tbfirst.cinestitch.client.AiPythonClient;
import com.tbfirst.cinestitch.dto.CinestitchDtos;
import com.tbfirst.cinestitch.entity.CinestitchJob;
import com.tbfirst.cinestitch.mapper.CinestitchJobMapper;
import com.tbfirst.cinestitch.service.CinestitchService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * {@link CinestitchService} 的默认实现。
 *
 * <p>架构角色：业务编排层，协调 Python AI 客户端（{@link AiPythonClient}）与 MyBatis-Plus
 * Mapper（{@link CinestitchJobMapper}）完成分镜生成任务。</p>
 *
 * <p>幂等性保障：每次调用先落库 pending，AI 调用成功后回写 result + success，失败回写 failed；
 * 历史可查询，便于运维审计与失败追溯。</p>
 */
@Service
@RequiredArgsConstructor
public class CinestitchServiceImpl implements CinestitchService {

    private final AiPythonClient aiClient;
    private final CinestitchJobMapper mapper;

    @Override
    public CinestitchDtos.GenerateResponse generate(Long userId, CinestitchDtos.GenerateRequest req) {
        int effectiveSceneCount = req.getSceneCount() > 0 ? req.getSceneCount() : 6;

        CinestitchJob job = new CinestitchJob();
        job.setUserId(userId);
        job.setModel(req.getModel() != null ? req.getModel() : "gemini-3-flash-preview");
        job.setPrompt(req.getPrompt());
        job.setImageUrl(req.getImageUrl());
        job.setStatus("pending");
        mapper.insert(job);

        CinestitchDtos.GenerateRequest aiReq = CinestitchDtos.GenerateRequest.builder()
                .imageUrl(req.getImageUrl())
                .prompt(req.getPrompt())
                .model(req.getModel())
                .sceneCount(effectiveSceneCount)
                .build();

        try {
            CinestitchDtos.GenerateResponse aiResp = aiClient.generate(aiReq);
            job.setResult(aiResp.getMarkdown());
            job.setModel(aiResp.getUsedModel() != null ? aiResp.getUsedModel() : job.getModel());
            job.setStatus("success");
            mapper.updateById(job);
            return aiResp;
        } catch (Exception e) {
            job.setStatus("failed");
            mapper.updateById(job);
            throw e;
        }
    }

    @Override
    public CinestitchDtos.VideoParseResponse parseVideo(Long userId, CinestitchDtos.VideoParseRequest req) {
        // videoUrl / videoDataUri 二选一，至少一个非空
        boolean hasUrl = req.getVideoUrl() != null && !req.getVideoUrl().isBlank();
        boolean hasDataUri = req.getVideoDataUri() != null && !req.getVideoDataUri().isBlank();
        if (!hasUrl && !hasDataUri) {
            throw new IllegalArgumentException("请提供视频文件或视频链接");
        }

        int effectiveSceneCount = req.getSceneCount() > 0 ? req.getSceneCount() : 6;

        CinestitchJob job = new CinestitchJob();
        job.setUserId(userId);
        job.setModel(req.getModel() != null ? req.getModel() : "gemini-2.5-flash");
        job.setPrompt(req.getPrompt());
        job.setStatus("pending");
        job.setJobType("video");
        mapper.insert(job);

        CinestitchDtos.VideoParseRequest aiReq = CinestitchDtos.VideoParseRequest.builder()
                .videoUrl(req.getVideoUrl())
                .videoDataUri(req.getVideoDataUri())
                .prompt(req.getPrompt())
                .model(req.getModel())
                .sceneCount(effectiveSceneCount)
                .build();

        try {
            CinestitchDtos.VideoParseResponse aiResp = aiClient.parseVideo(aiReq);
            job.setResult(aiResp.getMarkdown());
            job.setModel(aiResp.getUsedModel() != null ? aiResp.getUsedModel() : job.getModel());
            job.setStatus("success");
            mapper.updateById(job);
            return aiResp;
        } catch (Exception e) {
            job.setStatus("failed");
            mapper.updateById(job);
            throw e;
        }
    }

    @Override
    public CinestitchDtos.VideoPromptsResponse generateVideoPrompts(CinestitchDtos.VideoPromptsRequest req) {
        return aiClient.generateVideoPrompts(req);
    }

    @Override
    public void deleteJob(Long userId, Long jobId) {
        CinestitchJob job = mapper.selectById(jobId);
        if (job == null || !job.getUserId().equals(userId)) {
            throw new IllegalArgumentException("记录不存在或无权删除");
        }
        mapper.deleteById(jobId);
    }

    @Override
    public CinestitchDtos.ScriptParseResponse parseScript(Long userId, CinestitchDtos.ScriptParseRequest req) {
        int effectiveSceneCount = (req.getSceneCount() != null && req.getSceneCount() > 0) ? req.getSceneCount() : 8;

        CinestitchJob job = new CinestitchJob();
        job.setUserId(userId);
        job.setModel(req.getModel() != null ? req.getModel() : "gemini-2.5-flash");
        job.setPrompt(req.getPrompt());
        job.setStatus("pending");
        job.setJobType("script");
        mapper.insert(job);

        CinestitchDtos.ScriptParseRequest aiReq = CinestitchDtos.ScriptParseRequest.builder()
                .scriptContent(req.getScriptContent())
                .prompt(req.getPrompt())
                .model(req.getModel())
                .sceneCount(effectiveSceneCount)
                .build();

        try {
            CinestitchDtos.ScriptParseResponse aiResp = aiClient.parseScript(aiReq);
            job.setResult(aiResp.getMarkdown());
            job.setModel(aiResp.getUsedModel() != null ? aiResp.getUsedModel() : job.getModel());
            job.setStatus("success");
            mapper.updateById(job);
            return aiResp;
        } catch (Exception e) {
            job.setStatus("failed");
            mapper.updateById(job);
            throw e;
        }
    }

    @Override
    public CinestitchDtos.GenerateShotImageResponse generateShotImage(CinestitchDtos.GenerateShotImageRequest req) {
        return aiClient.generateShotImage(req);
    }

    @Override
    public List<CinestitchDtos.JobListItem> listJobs(Long userId, int pageNum, int pageSize) {
        Page<CinestitchJob> page = new Page<>(pageNum, pageSize);
        LambdaQueryWrapper<CinestitchJob> wrapper = new LambdaQueryWrapper<CinestitchJob>()
                .eq(CinestitchJob::getUserId, userId)
                .eq(CinestitchJob::getStatus, "success")
                .orderByDesc(CinestitchJob::getCreateTime);
        mapper.selectPage(page, wrapper);
        return page.getRecords().stream()
                .map(job -> CinestitchDtos.JobListItem.builder()
                        .id(job.getId())
                        .userId(job.getUserId())
                        .model(job.getModel())
                        .prompt(job.getPrompt())
                        .result(job.getResult())
                        .status(job.getStatus())
                        .imageUrl(job.getImageUrl())
                        .createTime(job.getCreateTime())
                        .build())
                .collect(Collectors.toList());
    }
}
