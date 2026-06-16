package com.tbfirst.cinestitch;

import com.tbfirst.cinestitch.client.AiPythonClient;
import com.tbfirst.cinestitch.dto.CinestitchDtos;
import com.tbfirst.cinestitch.entity.CinestitchJob;
import com.tbfirst.cinestitch.mapper.CinestitchJobMapper;
import com.tbfirst.cinestitch.service.impl.CinestitchServiceImpl;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import org.mockito.ArgumentMatchers;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CinestitchServiceTest {

    @Mock
    private AiPythonClient aiClient;

    @Mock
    private CinestitchJobMapper mapper;

    @InjectMocks
    private CinestitchServiceImpl service;

    @Test
    void generate_success_returnsMarkdown() {
        CinestitchDtos.GenerateRequest req = CinestitchDtos.GenerateRequest.builder()
                .imageUrl("https://storage.googleapis.com/test/image.jpg")
                .sceneCount(6)
                .build();

        CinestitchDtos.GenerateResponse aiResp = CinestitchDtos.GenerateResponse.builder()
                .markdown("| 镜号 | 景别 |\n|---|---|\n| 1 | 全景 |")
                .usedModel("gemini-3-flash-preview")
                .build();

        when(mapper.insert(any(CinestitchJob.class))).thenReturn(1);
        when(aiClient.generate(any(CinestitchDtos.GenerateRequest.class))).thenReturn(aiResp);
        when(mapper.updateById(any(CinestitchJob.class))).thenReturn(1);

        CinestitchDtos.GenerateResponse result = service.generate(1L, req);

        assertNotNull(result);
        assertNotNull(result.getMarkdown());
        assertTrue(result.getMarkdown().contains("镜号"));
        assertEquals("gemini-3-flash-preview", result.getUsedModel());

        verify(mapper).insert(any(CinestitchJob.class));
        verify(aiClient).generate(any(CinestitchDtos.GenerateRequest.class));
        verify(mapper).updateById(any(CinestitchJob.class));
    }

    @Test
    void generate_aiFailure_setsJobStatusFailed() {
        CinestitchDtos.GenerateRequest req = CinestitchDtos.GenerateRequest.builder()
                .imageUrl("https://storage.googleapis.com/test/image.jpg")
                .build();

        when(mapper.insert(any(CinestitchJob.class))).thenReturn(1);
        when(aiClient.generate(any(CinestitchDtos.GenerateRequest.class)))
                .thenThrow(new RuntimeException("AI unavailable"));
        when(mapper.updateById(any(CinestitchJob.class))).thenReturn(1);

        assertThrows(RuntimeException.class, () -> service.generate(1L, req));

        // Verify that updateById was called (to set status=failed)
        verify(mapper).updateById(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "failed".equals(job.getStatus())));
    }

    @Test
    void parseVideo_success_returnsMarkdown() {
        CinestitchDtos.VideoParseRequest req = CinestitchDtos.VideoParseRequest.builder()
                .videoUrl("http://example.com/v.mp4")
                .sceneCount(6)
                .build();

        CinestitchDtos.VideoParseResponse aiResp = CinestitchDtos.VideoParseResponse.builder()
                .markdown("| 镜号 | 景别 |\n|---|---|\n| 1 | 全景 |")
                .usedModel("gemini-2.5-flash")
                .build();

        when(mapper.insert(any(CinestitchJob.class))).thenReturn(1);
        when(aiClient.parseVideo(any(CinestitchDtos.VideoParseRequest.class))).thenReturn(aiResp);
        when(mapper.updateById(any(CinestitchJob.class))).thenReturn(1);

        CinestitchDtos.VideoParseResponse result = service.parseVideo(1L, req);

        assertNotNull(result);
        assertNotNull(result.getMarkdown());
        assertTrue(result.getMarkdown().contains("镜号"));
        verify(mapper).insert(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "video".equals(job.getJobType())));
        verify(mapper).updateById(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "success".equals(job.getStatus())));
    }

    @Test
    void parseVideo_aiFailure_setsJobStatusFailed() {
        CinestitchDtos.VideoParseRequest req = CinestitchDtos.VideoParseRequest.builder()
                .videoUrl("http://example.com/v.mp4")
                .build();

        when(mapper.insert(any(CinestitchJob.class))).thenReturn(1);
        when(aiClient.parseVideo(any(CinestitchDtos.VideoParseRequest.class)))
                .thenThrow(new RuntimeException("AI unavailable"));
        when(mapper.updateById(any(CinestitchJob.class))).thenReturn(1);

        assertThrows(RuntimeException.class, () -> service.parseVideo(1L, req));

        verify(mapper).updateById(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "failed".equals(job.getStatus())));
    }

    @Test
    void generateVideoPrompts_success_returnsPrompts() {
        CinestitchDtos.VideoPromptsRequest req = CinestitchDtos.VideoPromptsRequest.builder()
                .scenesMarkdown("| 1 | 全景 | ... |")
                .build();

        CinestitchDtos.VideoPromptsResponse aiResp = CinestitchDtos.VideoPromptsResponse.builder()
                .prompts(List.of("Close-up of jacket lapel", "Model on runway full body"))
                .usedModel("gemini-2.5-flash")
                .build();

        when(aiClient.generateVideoPrompts(any(CinestitchDtos.VideoPromptsRequest.class))).thenReturn(aiResp);

        CinestitchDtos.VideoPromptsResponse result = service.generateVideoPrompts(req);

        assertNotNull(result);
        assertEquals(2, result.getPrompts().size());
        verify(mapper, never()).insert(any(CinestitchJob.class));
        verify(mapper, never()).updateById(any(CinestitchJob.class));
    }

    @Test
    void parseScript_success() {
        CinestitchDtos.ScriptParseRequest req = CinestitchDtos.ScriptParseRequest.builder()
                .scriptContent("INT. OFFICE - DAY\nA meeting happens.")
                .sceneCount(4)
                .build();

        CinestitchDtos.ScriptParseResponse aiResp = CinestitchDtos.ScriptParseResponse.builder()
                .markdown("| 镜号 | 景别 | 角度 | 运镜 | 人物 | 环境/背景 | 动作与台词 | 视觉描述(EN) |\n"
                        + "|---|---|---|---|---|---|---|---|\n"
                        + "| 1 | LS | 正面 | 固定 | 主角 | 办公室 | 开会 | meeting room, natural light |")
                .usedModel("gemini-2.5-flash")
                .build();

        when(mapper.insert(any(CinestitchJob.class))).thenReturn(1);
        when(aiClient.parseScript(any(CinestitchDtos.ScriptParseRequest.class))).thenReturn(aiResp);
        when(mapper.updateById(any(CinestitchJob.class))).thenReturn(1);

        CinestitchDtos.ScriptParseResponse result = service.parseScript(1L, req);

        assertNotNull(result);
        assertNotNull(result.getMarkdown());
        assertTrue(result.getMarkdown().contains("镜号"));
        verify(mapper).insert(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "script".equals(job.getJobType())));
        verify(mapper).updateById(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "success".equals(job.getStatus())));
    }

    @Test
    void parseScript_aiFailure_setsJobFailed() {
        CinestitchDtos.ScriptParseRequest req = CinestitchDtos.ScriptParseRequest.builder()
                .scriptContent("INT. OFFICE - DAY")
                .build();

        when(mapper.insert(any(CinestitchJob.class))).thenReturn(1);
        when(aiClient.parseScript(any(CinestitchDtos.ScriptParseRequest.class)))
                .thenThrow(new RuntimeException("AI unavailable"));
        when(mapper.updateById(any(CinestitchJob.class))).thenReturn(1);

        assertThrows(RuntimeException.class, () -> service.parseScript(1L, req));

        verify(mapper).updateById(ArgumentMatchers.<CinestitchJob>argThat(job ->
                "failed".equals(job.getStatus())));
    }

    @Test
    void generateShotImage_success_returnsImageUrl() {
        CinestitchDtos.GenerateShotImageRequest req = CinestitchDtos.GenerateShotImageRequest.builder()
                .visualDescription("A man walks in rain, cinematic lighting")
                .build();

        CinestitchDtos.GenerateShotImageResponse aiResp = CinestitchDtos.GenerateShotImageResponse.builder()
                .imageUrl("data:image/png;base64,abc")
                .usedModel("imagen-3")
                .build();

        when(aiClient.generateShotImage(any(CinestitchDtos.GenerateShotImageRequest.class))).thenReturn(aiResp);

        CinestitchDtos.GenerateShotImageResponse result = service.generateShotImage(req);

        assertNotNull(result);
        assertEquals("data:image/png;base64,abc", result.getImageUrl());
        verify(mapper, never()).insert(any(CinestitchJob.class));
        verify(mapper, never()).updateById(any(CinestitchJob.class));
    }
}
