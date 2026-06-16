package com.tbfirst.cinestitch;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tbfirst.cinestitch.client.AiPythonClient;
import com.tbfirst.cinestitch.dto.StoryboardDtos;
import com.tbfirst.cinestitch.entity.StoryboardProject;
import com.tbfirst.cinestitch.mapper.StoryboardProjectMapper;
import com.tbfirst.cinestitch.service.impl.StoryboardServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class StoryboardServiceTest {

    @Mock
    private AiPythonClient aiClient;

    @Mock
    private StoryboardProjectMapper mapper;

    @Spy
    private ObjectMapper objectMapper = new ObjectMapper();

    @InjectMocks
    private StoryboardServiceImpl service;

    @Test
    void generateBible_success_insertsAndUpdates() {
        StoryboardDtos.BibleReq req = StoryboardDtos.BibleReq.builder()
                .storyText("INT. LAB - DAY").build();

        Map<String, Object> aiResult = Map.of(
                "logline", "A scientist discovers time travel",
                "characters", List.of(Map.of("name", "Dr. Smith", "appearance", "tall")),
                "scenes", List.of(Map.of("name", "Laboratory", "location", "city"))
        );

        when(mapper.insert(any(StoryboardProject.class))).thenReturn(1);
        when(aiClient.generateBible(any())).thenReturn(aiResult);
        when(mapper.updateById(any(StoryboardProject.class))).thenReturn(1);

        StoryboardDtos.BibleResp resp = service.generateBible(1L, req);

        assertNotNull(resp);
        assertNotNull(resp.getPreProduction());
        assertFalse(resp.getPreProduction().contains("data:image"));
        assertTrue(resp.getPreProduction().contains("characters"));
        verify(mapper).insert(any(StoryboardProject.class));
        verify(mapper).updateById(ArgumentMatchers.<StoryboardProject>argThat(p ->
                "success".equals(p.getStatus())));
        verify(mapper).updateById(ArgumentMatchers.<StoryboardProject>argThat(p ->
                p.getDocJson() != null && !p.getDocJson().contains("data:image")));
    }

    @Test
    void generateBible_aiFailure_setsStatusFailed() {
        StoryboardDtos.BibleReq req = StoryboardDtos.BibleReq.builder()
                .storyText("test").build();

        when(mapper.insert(any(StoryboardProject.class))).thenReturn(1);
        when(aiClient.generateBible(any())).thenThrow(new RuntimeException("AI error"));
        when(mapper.updateById(any(StoryboardProject.class))).thenReturn(1);

        assertThrows(RuntimeException.class, () -> service.generateBible(1L, req));
        verify(mapper).updateById(ArgumentMatchers.<StoryboardProject>argThat(p ->
                "failed".equals(p.getStatus())));
    }

    @Test
    void generateDraft_success_setsPendingThenWritesShots() {
        StoryboardProject project = new StoryboardProject();
        project.setId(1L);
        project.setUserId(1L);
        project.setDocJson("{\"preProduction\":{\"characters\":[]}}");
        project.setStatus("success");
        project.setStage("stage1");
        project.setDeleted((short) 0);

        StoryboardDtos.DraftReq req = StoryboardDtos.DraftReq.builder()
                .storyText("INT. LAB - DAY")
                .preProductionJson("{\"characters\":[],\"scenes\":[]}")
                .build();

        Map<String, Object> aiResp = Map.of(
                "shots", List.of(Map.of(
                        "shotNo", 1, "description", "wide shot",
                        "motionType", "static", "frameCount", 1)));

        when(mapper.selectById(1L)).thenReturn(project);
        when(aiClient.generateDraft(any())).thenReturn(aiResp);
        when(mapper.updateById(any(StoryboardProject.class))).thenReturn(1);

        StoryboardDtos.DraftResp resp = service.generateDraft(1L, 1L, req);

        assertNotNull(resp);
        assertNotNull(resp.getShots());
        assertTrue(resp.getShots().contains("shotNo"));
        assertFalse(resp.getShots().contains("data:image"));

        // 存后调：pending(进 AI 前) + success(写回) 共两次 updateById；最终态为 stage2/success
        ArgumentCaptor<StoryboardProject> captor = ArgumentCaptor.forClass(StoryboardProject.class);
        verify(mapper, times(2)).updateById(captor.capture());
        StoryboardProject finalState = captor.getValue();
        assertEquals("success", finalState.getStatus());
        assertEquals("stage2", finalState.getStage());
        assertTrue(finalState.getDocJson().contains("shotNo"));
        assertFalse(finalState.getDocJson().contains("data:image"));
    }

    @Test
    void generateFrame_frameIndexTooLarge_throwsBeforeAiCall() {
        StoryboardDtos.FrameReq req = StoryboardDtos.FrameReq.builder()
                .shotDescription("test").frameIndex(5)
                .motionType("motion").aspectRatio("16:9").build();

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> service.generateFrame(1L, 1L, 0, 5, req));
        assertTrue(ex.getMessage().contains("frameIndex"));
        verify(aiClient, never()).generateFrame(any());
    }

    @Test
    void generateFrame_success_returnsDataUriWithoutPersisting() {
        // 校验项目归属后，generateFrame 仅透传 Python 的 data URI，不落库
        // （cinestitch 无 GCS 凭据；前端换 /img/ 短链后由 saveDoc 写回）。
        StoryboardProject project = new StoryboardProject();
        project.setId(1L);
        project.setUserId(1L);
        project.setDocJson("{\"shots\":[]}");
        project.setDeleted((short) 0);

        StoryboardDtos.FrameReq req = StoryboardDtos.FrameReq.builder()
                .shotDescription("close-up").frameIndex(1)
                .motionType("static").aspectRatio("16:9").build();

        StoryboardDtos.FrameResp frameResp = StoryboardDtos.FrameResp.builder()
                .imageDataUri("data:image/png;base64,dGVzdA==").build();

        when(mapper.selectById(1L)).thenReturn(project);
        when(aiClient.generateFrame(any())).thenReturn(frameResp);

        String result = service.generateFrame(1L, 1L, 0, 1, req);

        assertEquals("data:image/png;base64,dGVzdA==", result);
        // 不落库：generateFrame 不应触碰 updateById
        verify(mapper, never()).updateById(any(StoryboardProject.class));
    }

    @Test
    void generateFrame_wrongOwner_throwsBeforeAiCall() {
        StoryboardProject project = new StoryboardProject();
        project.setId(1L);
        project.setUserId(99L);
        project.setDeleted((short) 0);

        StoryboardDtos.FrameReq req = StoryboardDtos.FrameReq.builder()
                .shotDescription("x").frameIndex(1)
                .motionType("static").aspectRatio("16:9").build();

        when(mapper.selectById(1L)).thenReturn(project);

        assertThrows(IllegalArgumentException.class,
                () -> service.generateFrame(1L, 1L, 0, 1, req));
        verify(aiClient, never()).generateFrame(any());
    }

    @Test
    void saveDoc_withBase64_throwsIllegalArgument() {
        StoryboardDtos.SaveDocReq req = StoryboardDtos.SaveDocReq.builder()
                .docJson("data:image/png;base64,abc").build();
        assertThrows(IllegalArgumentException.class, () -> service.saveDoc(1L, 1L, req));
        verify(mapper, never()).updateById(any(StoryboardProject.class));
    }

    @Test
    void deleteProject_wrongOwner_throwsIllegalArgument() {
        StoryboardProject project = new StoryboardProject();
        project.setId(1L);
        project.setUserId(99L);
        project.setDeleted((short) 0);
        when(mapper.selectById(1L)).thenReturn(project);
        assertThrows(IllegalArgumentException.class, () -> service.deleteProject(1L, 1L));
        verify(mapper, never()).deleteById(any());
    }
}
