package com.tbfirst.cinestitch.service.impl;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tbfirst.cinestitch.client.AiPythonClient;
import com.tbfirst.cinestitch.dto.StoryboardDtos;
import com.tbfirst.cinestitch.entity.StoryboardProject;
import com.tbfirst.cinestitch.mapper.StoryboardProjectMapper;
import com.tbfirst.cinestitch.service.StoryboardService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 分镜四阶段流水线 Service 实现（V6.SB.1）。
 *
 * <p>写入规则：任何写 doc_json 的路径在入口强校验不含 "data:image"，违反则抛异常。
 * 出图返回的 data URI 不在 Java 落库——由前端经 {@code /api/image/upload}（image 服务，
 * 唯一持有 GCS 凭据）换 /img/... 短链后再 {@code saveDoc} 整份写回。cinestitch 不直连 GCS。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StoryboardServiceImpl implements StoryboardService {

    private final AiPythonClient aiClient;
    private final StoryboardProjectMapper mapper;
    private final ObjectMapper objectMapper;

    // ---- 公共守卫 ----

    private static void assertNoBase64(String json, String context) {
        if (json != null && json.contains("data:image")) {
            throw new IllegalArgumentException(
                    "[base64-leak] " + context + " 中发现 data:image，禁止写入 doc_json");
        }
    }

    private StoryboardProject requireOwner(Long userId, Long projectId) {
        StoryboardProject project = mapper.selectById(projectId);
        if (project == null || project.getDeleted() != 0) {
            throw new IllegalArgumentException("项目不存在: " + projectId);
        }
        if (!userId.equals(project.getUserId())) {
            throw new IllegalArgumentException("无权操作该项目");
        }
        return project;
    }

    // ---- Stage 1: 圣经生成 ----

    @Override
    public StoryboardDtos.BibleResp generateBible(Long userId, StoryboardDtos.BibleReq req) {
        StoryboardProject project = new StoryboardProject();
        project.setUserId(userId);
        String titlePreview = req.getStoryText() != null && req.getStoryText().length() > 50
                ? req.getStoryText().substring(0, 50) : req.getStoryText();
        project.setTitle(titlePreview);
        project.setStatus("pending");
        project.setStage("stage1");
        mapper.insert(project);

        try {
            Map<String, Object> bibleMap = aiClient.generateBible(req);
            String preProductionJson = objectMapper.writeValueAsString(bibleMap);
            assertNoBase64(preProductionJson, "generateBible");

            String docJson = buildDocJson(preProductionJson, null);
            project.setDocJson(docJson);
            project.setStatus("success");
            mapper.updateById(project);

            return StoryboardDtos.BibleResp.builder()
                    .projectId(project.getId())
                    .preProduction(preProductionJson)
                    .build();
        } catch (Exception e) {
            project.setStatus("failed");
            mapper.updateById(project);
            throw e instanceof RuntimeException ? (RuntimeException) e
                    : new RuntimeException(e);
        }
    }

    // ---- Stage 2: 分镜表生成 ----

    @Override
    public StoryboardDtos.DraftResp generateDraft(Long userId, Long projectId,
                                                   StoryboardDtos.DraftReq req) {
        StoryboardProject project = requireOwner(userId, projectId);
        // 存后调：进 AI 前先置 pending，使中断/崩溃的项目状态可辨识（不动 docJson）
        project.setStatus("pending");
        mapper.updateById(project);

        try {
            // Parse preProductionJson string → Map so Python receives it as a JSON object
            Map<String, Object> preProductionMap = objectMapper.readValue(
                    req.getPreProductionJson(),
                    new TypeReference<Map<String, Object>>() {});

            Map<String, Object> aiReqMap = new LinkedHashMap<>();
            aiReqMap.put("storyText", req.getStoryText());
            aiReqMap.put("preProduction", preProductionMap);
            if (req.getConsistencyProtocol() != null) {
                aiReqMap.put("consistencyProtocol", req.getConsistencyProtocol());
            }
            if (req.getDynamicScript() != null) {
                aiReqMap.put("dynamicScript", req.getDynamicScript());
            }
            if (req.getGridCount() != null) {
                aiReqMap.put("gridCount", req.getGridCount());
            }
            if (req.getModel() != null) aiReqMap.put("model", req.getModel());

            Map<String, Object> aiResp = aiClient.generateDraft(aiReqMap);
            Object shotsRaw = aiResp.get("shots");
            String shotsJson = objectMapper.writeValueAsString(shotsRaw);
            assertNoBase64(shotsJson, "generateDraft.shots");

            // 后端配额校验：shots 数量 > 40 拒绝
            if (shotsRaw instanceof List && ((List<?>) shotsRaw).size() > 40) {
                throw new IllegalArgumentException(
                        "shots 数量超出限制（最大 40，收到 " + ((List<?>) shotsRaw).size() + "）");
            }

            project.setStage("stage2");
            project.setDocJson(mergeDocJsonShots(project.getDocJson(), shotsJson));
            project.setStatus("success");
            mapper.updateById(project);

            return StoryboardDtos.DraftResp.builder().shots(shotsJson).build();
        } catch (Exception e) {
            project.setStatus("failed");
            mapper.updateById(project);
            throw e instanceof RuntimeException ? (RuntimeException) e
                    : new RuntimeException(e);
        }
    }

    // ---- 服装一致性档案（无状态代理）----

    @Override
    public StoryboardDtos.AnalyzeGarmentResp analyzeGarment(
            Long userId, StoryboardDtos.AnalyzeGarmentReq req) {
        // 无 DB 写：re-analyze 不建项目；纯透传 Python
        return aiClient.analyzeGarment(req);
    }

    // ---- Stage 3: 单帧出图 ----

    @Override
    public String generateFrame(Long userId, Long projectId, int shotIdx, int frameIdx,
                                StoryboardDtos.FrameReq req) {
        if (frameIdx > 4) {
            throw new IllegalArgumentException("frameIndex 超出限制（最大 4，收到 " + frameIdx + "）");
        }
        // 鉴权：确认项目归属后再消耗一次 AI 出图（不落库——cinestitch 无 GCS 凭据）。
        // 返回 Python 生成的 data URI，由前端 uploadDataUrisToGcs 换 /img/ 短链后 saveDoc 写回。
        requireOwner(userId, projectId);

        StoryboardDtos.FrameResp aiResp = aiClient.generateFrame(req);
        String dataUri = aiResp.getImageDataUri();
        if (dataUri == null || dataUri.isBlank()) {
            throw new IllegalStateException("Python 返回空 imageDataUri");
        }
        return dataUri;
    }

    // ---- Stage 生成图：宫格出图 ----

    @Override
    public String generateGrid(Long userId, Long projectId, StoryboardDtos.GridReq req) {
        // 鉴权后消耗一次 AI 出图（不落库——cinestitch 无 GCS 凭据）。
        // 返回 Python 生成的 data URI，由前端 uploadDataUrisToGcs 换 /img/ 短链后 saveDoc 写回。
        requireOwner(userId, projectId);

        StoryboardDtos.FrameResp aiResp = aiClient.generateGrid(req);
        String dataUri = aiResp.getImageDataUri();
        if (dataUri == null || dataUri.isBlank()) {
            throw new IllegalStateException("Python 返回空 imageDataUri");
        }
        return dataUri;
    }

    // ---- Stage 5: 视频生成（Seedance 2.0 / callxyq，纯透传，前端轮询 task_id） ----

    @Override
    public StoryboardDtos.VideoClipStartResp startVideoClip(Long userId, StoryboardDtos.VideoClipReq req) {
        return aiClient.generateVideoClip(req);
    }

    @Override
    public StoryboardDtos.PollVideoClipResp pollVideoClip(Long userId, StoryboardDtos.PollVideoClipReq req) {
        return aiClient.pollVideoClip(req);
    }

    // ---- Stage 4 / CRUD ----

    @Override
    public void saveDoc(Long userId, Long projectId, StoryboardDtos.SaveDocReq req) {
        assertNoBase64(req.getDocJson(), "saveDoc");
        StoryboardProject project = requireOwner(userId, projectId);
        project.setDocJson(req.getDocJson());
        if (req.getStage() != null) project.setStage(req.getStage());
        if (req.getTitle() != null) project.setTitle(req.getTitle());
        mapper.updateById(project);
    }

    @Override
    public StoryboardDtos.ProjectDetail getProject(Long userId, Long projectId) {
        StoryboardProject p = requireOwner(userId, projectId);
        return StoryboardDtos.ProjectDetail.builder()
                .id(p.getId())
                .title(p.getTitle())
                .status(p.getStatus())
                .stage(p.getStage())
                .docJson(p.getDocJson())
                .coverImageUrl(p.getCoverImageUrl())
                .createTime(p.getCreateTime())
                .build();
    }

    @Override
    public List<StoryboardDtos.ProjectListItem> listProjects(Long userId, int page, int size) {
        int offset = (page - 1) * size;
        List<StoryboardProject> rows = mapper.listByUserIdNoDocJson(userId, size, offset);
        List<StoryboardDtos.ProjectListItem> result = new ArrayList<>();
        for (StoryboardProject p : rows) {
            result.add(StoryboardDtos.ProjectListItem.builder()
                    .id(p.getId())
                    .title(p.getTitle())
                    .status(p.getStatus())
                    .stage(p.getStage())
                    .coverImageUrl(p.getCoverImageUrl())
                    .createTime(p.getCreateTime())
                    .build());
        }
        return result;
    }

    @Override
    public void deleteProject(Long userId, Long projectId) {
        StoryboardProject project = requireOwner(userId, projectId);
        mapper.deleteById(project.getId());
    }

    // ---- 内部工具 ----

    private String buildDocJson(String preProductionJson, String shotsJson) {
        try {
            ObjectNode doc = objectMapper.createObjectNode();
            if (preProductionJson != null) {
                doc.set("preProduction", objectMapper.readTree(preProductionJson));
            }
            if (shotsJson != null) {
                doc.set("shots", objectMapper.readTree(shotsJson));
            }
            return objectMapper.writeValueAsString(doc);
        } catch (Exception e) {
            log.warn("[Storyboard] buildDocJson failed: {}", e.getMessage());
            return preProductionJson != null ? preProductionJson : "{}";
        }
    }

    private String mergeDocJsonShots(String existingDocJson, String shotsJson) {
        try {
            ObjectNode doc = existingDocJson != null
                    ? (ObjectNode) objectMapper.readTree(existingDocJson)
                    : objectMapper.createObjectNode();
            doc.set("shots", objectMapper.readTree(shotsJson));
            return objectMapper.writeValueAsString(doc);
        } catch (Exception e) {
            log.warn("[Storyboard] mergeDocJsonShots failed: {}", e.getMessage());
            return existingDocJson;
        }
    }
}
