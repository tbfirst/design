package com.tbfirst.image.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.core.response.R;
import com.tbfirst.common.oss.StorageService;
import com.tbfirst.common.security.context.UserContext;
import com.tbfirst.common.security.context.UserContextHolder;
import com.tbfirst.image.client.AiPythonClient;
import com.tbfirst.image.client.AuthClient;
import com.tbfirst.image.dto.CopilotDtos;
import com.tbfirst.image.dto.GenerateDtos;
import com.tbfirst.image.dto.HistoryDtos;
import com.tbfirst.image.dto.InpaintDtos;
import com.tbfirst.image.entity.GenerationJob;
import com.tbfirst.image.mapper.GenerationJobMapper;
import com.tbfirst.image.service.AuditLogService;
import com.tbfirst.image.service.ImageGenerateService;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.stream.Collectors;

/**
 * 生图编排服务实现。
 *
 * <p><b>职责：</b>{@link ImageGenerateService} 的唯一实现，tbfirst-image 的业务核心。
 * 编排"任务落库 → 调 Python AI → 回写结果 → 写审计"的完整 pipeline。</p>
 *
 * <p><b>事务策略：</b>generate / inpaint 各拆成三段短事务 + 一段无事务 AI 调用：
 * 1) INSERT pending → 事务立即提交（释放连接）；
 * 2) aiClient.generate() / inpaint()（60s+，完全在事务外，不占连接池）；
 * 3) UPDATE success / failed → 各一段短事务。
 * 三段事务均通过 {@link TransactionTemplate} 编程式触发，彻底消除"长事务 × 并发 → 连接池耗尽"问题。</p>
 *
 * <p><b>依赖：</b>
 * {@link AiPythonClient}（Feign → Python /api/ai/**）、
 * {@link AuthClient}（Feign → auth /internal/users-by-ids 反查用户名）、
 * {@link GenerationJobMapper}（主表 MP mapper）、
 * {@link AuditLogService}（写 audit_log）、
 * {@link StorageService}（持久化 data-URI 为静态文件）。</p>
 *
 * <p><b>JSONB 字段：</b>phase_config 列由 {@code PgJsonbStringTypeHandler}
 * 在 GenerationJob 实体上承担 String ↔ PGobject 的往返，这里 Service 层只管 String。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ImageGenerateServiceImpl implements ImageGenerateService {

    private final AiPythonClient aiClient;
    private final AuthClient authClient;
    private final GenerationJobMapper mapper;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;
    private final StorageService storageService;
    private final TransactionTemplate txTemplate;
    /** 生图异步线程池（见 ImageAsyncConfig）；按 bean 名 imageGenExecutor 注入 */
    private final ThreadPoolTaskExecutor imageGenExecutor;
    /** 熔断注册表（resilience4j）；ai-python 持续不可用时让生图任务快速失败 */
    private final CircuitBreakerRegistry circuitBreakerRegistry;

    public GenerateDtos.GenerateResponse generate(GenerateDtos.GenerateRequest req) {
        Long uid = UserContextHolder.currentUserId();
        if (uid == null) {
            log.warn("[Image] generate rejected: UserContextHolder.currentUserId() is null");
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context, please re-login via gateway");
        }
        log.info("[Image] generate for userId={} phase={}", uid, req.getPhase());
        // 捕获请求线程的用户上下文，传给后台线程重建（审计 / MetaObjectHandler 的 create_by/update_by 依赖它）
        final UserContext ctx = UserContextHolder.get();
        final Long groupId = ctx != null ? ctx.getGroupId() : null;

        // ── 短事务①：INSERT pending，立即提交释放连接 ──────────────────────────────
        // SQL: INSERT INTO image.generation_job (...) VALUES (..., 'pending', ...)
        final GenerationJob job = Objects.requireNonNull(txTemplate.execute(status -> {
            GenerationJob j = new GenerationJob();
            j.setPhase(req.getPhase());
            j.setPrompt(req.getPrompt());
            j.setModel(req.getModel());
            j.setUserId(uid);
            j.setGroupId(groupId);
            j.setStatus("pending");
            j.setLastAccessAt(LocalDateTime.now());
            if (req.getPhaseConfig() != null) {
                try {
                    j.setPhaseConfig(objectMapper.writeValueAsString(req.getPhaseConfig()));
                } catch (Exception ex) {
                    log.warn("[Image] serialize phaseConfig failed", ex);
                }
            }
            if (req.getReferenceImages() != null) {
                j.setReferenceCount(req.getReferenceImages().size());
            }
            mapper.insert(j);
            return j;
        }));

        // ── 派发后台异步出图；池满则即时标 failed 并回错，避免 job 永久 pending ──────────
        try {
            imageGenExecutor.execute(() -> runGenerateJob(job.getId(), req, ctx));
        } catch (RejectedExecutionException rex) {
            log.warn("[Image] generate rejected by executor (busy), jobId={}", job.getId());
            try {
                txTemplate.execute(status -> {
                    job.setStatus("failed");
                    job.setErrorMsg("server busy, please retry later");
                    mapper.updateById(job);
                    return null;
                });
            } catch (Exception dbEx) {
                log.warn("[Image] failed to mark job failed after rejection jobId={}", job.getId(), dbEx);
            }
            throw new BizException(ErrorCode.AI_UPSTREAM_ERROR, "server busy, please retry later");
        }

        // ── 立即返回 pending（不等待 AI）；前端凭 jobId 轮询 GET /jobs/{id}/status ──────
        GenerateDtos.GenerateResponse resp = new GenerateDtos.GenerateResponse();
        resp.setJobId(job.getId());
        resp.setStatus("pending");
        resp.setUrls(List.of());
        return resp;
    }

    /**
     * 后台执行单个生图任务：调 AI → 落盘 → 回写 success/failed → 写 audit。
     * <p>运行在 imageGenExecutor 线程，故先用传入的 {@link UserContext} 重建 ThreadLocal
     * （审计、MetaObjectHandler 的 create_by/update_by 依赖它），finally 务必 clear 防止线程池串用户。</p>
     */
    private void runGenerateJob(Long jobId, GenerateDtos.GenerateRequest req, UserContext ctx) {
        if (ctx != null) UserContextHolder.set(ctx);
        try {
            final GenerationJob job = mapper.selectById(jobId);
            if (job == null) {
                log.warn("[Image] runGenerateJob: job {} not found (deleted?), skip", jobId);
                return;
            }
            try {
                // ── 无事务：AI 调用（60s+，不持有任何 DB 连接）────────────────────────
                Map<String, Object> payload = new HashMap<>();
                payload.put("prompt", req.getPrompt());
                payload.put("model", req.getModel());
                payload.put("phase", req.getPhase());
                payload.put("aspect_ratio", req.getAspectRatio());
                payload.put("image_size", req.getImageSize());
                if (req.getReferenceImages() != null) payload.put("reference_images", req.getReferenceImages());
                if (req.getReferenceLabels() != null) payload.put("reference_labels", req.getReferenceLabels());
                if (req.getPhaseConfig() != null) payload.put("phase_config", req.getPhaseConfig());
                if (req.getExtra() != null) payload.putAll(req.getExtra());

                // 熔断保护：ai-python 持续故障 → 熔断器 OPEN 后 executeSupplier 直接抛
                // CallNotPermittedException 快速失败，不再白等 600s Feign 超时占线程。
                CircuitBreaker cb = circuitBreakerRegistry.circuitBreaker("ai-python-generate");
                Map<String, Object> raw = cb.executeSupplier(() -> aiClient.generate(payload));
                List<String> persistedUrls = persistImages(parseUrls(raw), req.getPhase());

                // ── 短事务②：UPDATE success（图片走 asset_urls；文本结果落 result_text）──
                String usedModel = raw == null ? null : (String) raw.get("used_model");
                if (raw != null && Boolean.TRUE.equals(raw.get("used_fallback"))) {
                    log.info("[Image] job {} used fallback model {} (chain: {})",
                            job.getId(), usedModel, raw.get("attempts"));
                }
                Object aiText = raw == null ? null : raw.get("text");
                final String resultText = aiText != null ? String.valueOf(aiText) : null;
                txTemplate.execute(status -> {
                    job.setStatus("success");
                    job.setAssetUrls(String.join("\n", persistedUrls));
                    if (resultText != null) job.setResultText(resultText);
                    if (usedModel != null) job.setModel(usedModel);
                    mapper.updateById(job);
                    return null;
                });

                auditLogService.log(req.getPhase(), req.getPrompt(), job.getId());
                log.info("[Image] job {} success, urls={}", job.getId(), persistedUrls.size());
            } catch (Exception e) {
                log.error("[Image] generate job {} failed", job.getId(), e);
                // ── 短事务③：UPDATE failed ──────────────────────────────────────────
                try {
                    txTemplate.execute(status -> {
                        job.setStatus("failed");
                        job.setErrorMsg(e.getMessage());
                        mapper.updateById(job);
                        return null;
                    });
                } catch (Exception dbEx) {
                    log.warn("[Image] failed to persist job failure status for jobId={}", job.getId(), dbEx);
                }
            }
        } finally {
            if (ctx != null) UserContextHolder.clear();
        }
    }

    @Override
    public GenerateDtos.GenerateResponse getJobStatus(Long jobId) {
        UserContext ctx = UserContextHolder.get();
        Long uid = ctx == null ? null : ctx.getUserId();
        if (uid == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context");
        }
        Long gid = ctx.getGroupId();
        GenerationJob job = mapper.selectById(jobId);
        if (job == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "job not found");
        }
        boolean ownedByUser = uid.equals(job.getUserId());
        boolean sharedInGroup = gid != null && gid.equals(job.getGroupId());
        if (!ownedByUser && !sharedInGroup) {
            // 故意返 NOT_FOUND 而非 FORBIDDEN，避免暴露存在性（与 refreshJobUrls 一致）。
            throw new BizException(ErrorCode.NOT_FOUND, "job not found or not accessible");
        }
        GenerateDtos.GenerateResponse resp = new GenerateDtos.GenerateResponse();
        resp.setJobId(job.getId());
        resp.setStatus(job.getStatus());
        resp.setUrls("success".equals(job.getStatus())
                ? resolveStoredUrls(job.getAssetUrls())
                : List.of());
        resp.setRawResponse(job.getResultText());
        resp.setErrorMsg(job.getErrorMsg());
        return resp;
    }

    public InpaintDtos.InpaintResponse inpaint(InpaintDtos.InpaintRequest req) {
        Long uid = UserContextHolder.currentUserId();
        if (uid == null) {
            log.warn("[Image] inpaint rejected: UserContextHolder.currentUserId() is null");
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context, please re-login via gateway");
        }
        final Long groupId = UserContextHolder.get() != null ? UserContextHolder.get().getGroupId() : null;

        // ── 短事务①：INSERT pending ──────────────────────────────────────────────
        final GenerationJob job = Objects.requireNonNull(txTemplate.execute(status -> {
            GenerationJob j = new GenerationJob();
            j.setPhase("SmartInpaint");
            j.setPrompt(req.getPrompt());
            j.setUserId(uid);
            j.setGroupId(groupId);
            j.setStatus("pending");
            j.setLastAccessAt(LocalDateTime.now());
            mapper.insert(j);
            return j;
        }));

        try {
            // ── 无事务：AI 调用 ──────────────────────────────────────────────────
            Map<String, Object> payload = new HashMap<>();
            payload.put("masked_image", req.getMaskedImage());
            payload.put("prompt", req.getPrompt());
            payload.put("aspect_ratio", req.getAspectRatio());
            if (req.getReferenceImage() != null) payload.put("reference_image", req.getReferenceImage());

            Map<String, Object> raw = aiClient.inpaint(payload);
            String url = raw != null ? String.valueOf(raw.get("url")) : null;
            if (url != null && url.startsWith("data:")) {
                List<String> saved = persistImages(List.of(url), "inpaint");
                url = saved.isEmpty() ? url : saved.get(0);
            }

            // ── 短事务②：UPDATE success ─────────────────────────────────────────
            String usedModel = raw == null ? null : (String) raw.get("used_model");
            if (raw != null && Boolean.TRUE.equals(raw.get("used_fallback"))) {
                log.info("[Image] inpaint job {} used fallback model {}", job.getId(), usedModel);
            }
            final String finalUrl = url;
            txTemplate.execute(status -> {
                job.setStatus("success");
                job.setAssetUrls(finalUrl);
                if (usedModel != null) job.setModel(usedModel);
                mapper.updateById(job);
                return null;
            });

            auditLogService.log("SmartInpaint", req.getPrompt(), job.getId());

            InpaintDtos.InpaintResponse resp = new InpaintDtos.InpaintResponse();
            resp.setUrl(resolveStoredUrl(url));
            resp.setJobId(job.getId());
            return resp;
        } catch (Exception e) {
            log.error("[Image] inpaint failed", e);
            // ── 短事务③：UPDATE failed ──────────────────────────────────────────
            try {
                txTemplate.execute(status -> {
                    job.setStatus("failed");
                    job.setErrorMsg(e.getMessage());
                    mapper.updateById(job);
                    return null;
                });
            } catch (Exception dbEx) {
                log.warn("[Image] failed to persist inpaint failure status for jobId={}", job.getId(), dbEx);
            }
            throw new BizException(ErrorCode.AI_UPSTREAM_ERROR, e.getMessage());
        }
    }

    public CopilotDtos.ChatResponse copilotChat(CopilotDtos.ChatRequest req) {
        try {
            Map<String, Object> payload = new HashMap<>();
            // model 交由 Python 侧 TEXT_CHAIN 降级链选择；若上层想指定首选可在 req 中加 model 字段
            payload.put("user_input", req.getUserInput());
            if (req.getHistory() != null) payload.put("history", req.getHistory());
            if (req.getContext() != null) payload.put("context", req.getContext());
            if (req.getReferenceImages() != null) payload.put("reference_images", req.getReferenceImages());
            // V5.XVII.D：透传 referenceImageRoles，让 Python 侧能按位置给每张图打标签
            if (req.getReferenceImageRoles() != null) payload.put("reference_image_roles", req.getReferenceImageRoles());

            Map<String, Object> raw = aiClient.copilotChat(payload);
            CopilotDtos.ChatResponse resp = new CopilotDtos.ChatResponse();
            resp.setText(raw != null ? String.valueOf(raw.get("text")) : "");
            return resp;
        } catch (Exception e) {
            log.error("[Copilot] chat failed", e);
            throw new BizException(ErrorCode.AI_UPSTREAM_ERROR, e.getMessage());
        }
    }

    public CopilotDtos.InspireResponse copilotInspire(CopilotDtos.InspireRequest req) {
        try {
            Map<String, Object> payload = new HashMap<>();
            // model 交由 Python 侧 TEXT_CHAIN 降级链选择
            if (req.getContext() != null) payload.put("context", req.getContext());
            if (req.getReferenceImages() != null) payload.put("reference_images", req.getReferenceImages());
            // V5.XVII.D：透传 referenceImageRoles，让 Python 侧能按位置给每张图打标签
            if (req.getReferenceImageRoles() != null) payload.put("reference_image_roles", req.getReferenceImageRoles());
            // V5.XVII.C：透传 recentInspirations，供 Python 侧 build_copilot_inspire 去重使用
            if (req.getRecentInspirations() != null) payload.put("recent_inspirations", req.getRecentInspirations());

            Map<String, Object> raw = aiClient.copilotInspire(payload);
            CopilotDtos.InspireResponse resp = new CopilotDtos.InspireResponse();
            resp.setText(raw != null ? String.valueOf(raw.getOrDefault("text", "")) : "");
            return resp;
        } catch (Exception e) {
            log.error("[Copilot] inspire failed", e);
            throw new BizException(ErrorCode.AI_UPSTREAM_ERROR, e.getMessage());
        }
    }

    public CopilotDtos.AnalyzeResponse analyzeBrand(CopilotDtos.AnalyzeRequest req) {
        try {
            Map<String, Object> payload = Map.of("url", req.getUrl());
            Map<String, Object> raw = aiClient.analyzeBrand(payload);

            CopilotDtos.AnalyzeResponse resp = new CopilotDtos.AnalyzeResponse();
            if (raw != null) {
                resp.setAudience(String.valueOf(raw.getOrDefault("audience", "")));
                resp.setTone(String.valueOf(raw.getOrDefault("tone", "")));
                resp.setRemark(String.valueOf(raw.getOrDefault("remark", "")));
            }
            return resp;
        } catch (Exception e) {
            log.error("[Copilot] brand analysis failed", e);
            throw new BizException(ErrorCode.AI_UPSTREAM_ERROR, e.getMessage());
        }
    }

    /**
     * V5.XVII.E：通用参考图上传 —— 接 base64 data URI 列表 → 落 GCS → 返回前端可消费的短链 URL。
     * 详细语义见接口 javadoc。
     */
    @Override
    public List<String> uploadAssets(List<String> dataUris, String phase) {
        if (dataUris == null || dataUris.isEmpty()) return List.of();
        for (String s : dataUris) {
            if (s == null || !s.startsWith("data:")) {
                throw new BizException(ErrorCode.BAD_REQUEST,
                        "uploadAssets 仅接受 data:image/... base64 形式，禁止透传 http URL / 相对路径");
            }
        }
        // 复用 persistImages 走 storageService.save（魔数判定真实 mime → UUID 落盘 → 返 assetKey）
        List<String> assetKeys = persistImages(dataUris, phase == null || phase.isBlank() ? "upload" : phase);
        // 再走 resolveStoredUrls 把 assetKey 转成前端能直接用的短链
        // （local 模式 → /static/...；gcs 模式 → /img/<key> 反代或 GCS 预签名）
        List<String> out = new ArrayList<>(assetKeys.size());
        for (String key : assetKeys) {
            out.add(resolveStoredUrl(key));
        }
        return out;
    }

    /**
     * 解码 data URI 落盘，返回 assetKey 列表（v3 起不再返回 {@code /static/} 形式 URL）。
     * <p>非 data URI 入参（已是 http URL 或其他外链）原样透传，由响应组装阶段的 resolveUrl 决定如何处理。</p>
     */
    private List<String> persistImages(List<String> urls, String phase) {
        List<String> result = new ArrayList<>();
        for (String url : urls) {
            if (url == null || !url.startsWith("data:")) {
                result.add(url);
                continue;
            }
            try {
                int comma = url.indexOf(',');
                String meta = url.substring(0, comma);
                String b64 = url.substring(comma + 1);
                String declaredMime = meta.replace("data:", "").replace(";base64", "");

                byte[] bytes = Base64.getDecoder().decode(b64);

                // V5.XI-3.5：以字节魔数判定真实 MIME，避免 Gemini 上游返回的 data URI
                // 头部 mime 与实际字节格式不一致（如 application/octet-stream 但字节是
                // PNG）导致后续 ext 推断错乱、下载到本地无法预览。
                String detectedMime = detectImageMimeFromBytes(bytes);
                String mime = detectedMime != null ? detectedMime : declaredMime;
                String ext;
                if (mime.contains("png")) ext = ".png";
                else if (mime.contains("webp")) ext = ".webp";
                else if (mime.contains("gif")) ext = ".gif";
                else if (mime.contains("jpeg") || mime.contains("jpg")) ext = ".jpg";
                else ext = ".jpg"; // 兜底（魔数 + 头部都不识别时仍标 jpg，但极少触发）

                String filename = UUID.randomUUID() + ext;
                String storagePrefix = "image/" + phase;

                String assetKey = storageService.save(storagePrefix, filename, mime, bytes);
                result.add(assetKey);
            } catch (Exception e) {
                // V5.XV.11: 不再退回写 data URI 进 DB。原 fallback 会把几 MB base64 写入
                // generation_job.asset_urls，触发 MyBatis SQL Parameters 日志爆炸 + 前端
                // 拿到 data URI 字符串后无法走 resolveUrl 正常下载。改为抛错让 generate()
                // catch 分支标 job=failed，前端走 V5.XV.9 的 getFriendlyError 友好提示。
                log.warn("[Image] persist image failed, bytes={}, mime={}",
                        url == null ? -1 : url.length(), "data URI", e);
                throw new IllegalStateException("persist image failed: " + e.getMessage(), e);
            }
        }
        return result;
    }

    /**
     * V5.XI-3.5：用字节魔数判定真实图片 MIME，覆盖 Gemini 上游返回的 data URI 头部 mime
     * 与实际字节格式不一致的情况（防"名 .jpg、字节 PNG"脏数据流入 GCS）。
     *
     * @return 识别到的标准 MIME（image/png / image/jpeg / image/gif / image/webp / image/bmp）；
     *         未匹配任何已知魔数时返回 {@code null}，由调用方回落到 data URI 声明的 mime。
     */
    private static String detectImageMimeFromBytes(byte[] bytes) {
        if (bytes == null || bytes.length < 4) return null;
        // PNG: 89 50 4E 47
        if ((bytes[0] & 0xff) == 0x89 && (bytes[1] & 0xff) == 0x50
                && (bytes[2] & 0xff) == 0x4e && (bytes[3] & 0xff) == 0x47) return "image/png";
        // JPEG: FF D8 FF
        if ((bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff)
            return "image/jpeg";
        // GIF: 47 49 46 38
        if ((bytes[0] & 0xff) == 0x47 && (bytes[1] & 0xff) == 0x49
                && (bytes[2] & 0xff) == 0x46 && (bytes[3] & 0xff) == 0x38) return "image/gif";
        // WebP: RIFF....WEBP
        if (bytes.length >= 12
                && (bytes[0] & 0xff) == 0x52 && (bytes[1] & 0xff) == 0x49
                && (bytes[2] & 0xff) == 0x46 && (bytes[3] & 0xff) == 0x46
                && (bytes[8] & 0xff) == 0x57 && (bytes[9] & 0xff) == 0x45
                && (bytes[10] & 0xff) == 0x42 && (bytes[11] & 0xff) == 0x50) return "image/webp";
        // BMP: 42 4D
        if ((bytes[0] & 0xff) == 0x42 && (bytes[1] & 0xff) == 0x4d) return "image/bmp";
        return null;
    }

    /**
     * 把 DB 里 {@code asset_urls} 字段（多 assetKey 换行分隔）展开为前端可消费的 URL 列表。
     * <p>每段先 strip 空白；非空段调 {@link StorageService#resolveUrl(String)}（实现侧透传 http/data 直链）。</p>
     */
    private List<String> resolveStoredUrls(String storedAssetUrls) {
        if (storedAssetUrls == null || storedAssetUrls.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        for (String key : storedAssetUrls.split("\n")) {
            String trimmed = key.strip();
            if (trimmed.isEmpty()) continue;
            out.add(storageService.resolveUrl(trimmed));
        }
        return out;
    }

    /**
     * 单值版（inpaint 等单图场景）。
     */
    private String resolveStoredUrl(String storedAssetUrl) {
        if (storedAssetUrl == null || storedAssetUrl.isBlank()) return storedAssetUrl;
        return storageService.resolveUrl(storedAssetUrl.strip());
    }

    @SuppressWarnings("unchecked")
    private List<String> parseUrls(Map<String, Object> raw) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        Object urls = raw.get("urls");
        if (urls instanceof List<?> l) {
            l.forEach(u -> out.add(String.valueOf(u)));
        }
        return out;
    }

    public List<HistoryDtos.HistoryJobView> history() {
        UserContext ctx = UserContextHolder.get();
        if (ctx == null || ctx.getUserId() == null) return List.of();
        // 自定义 XML (GenerationJobMapper.xml#findTop200VisibleToUser):
        //   SELECT * FROM image.generation_job
        //   WHERE deleted = 0
        //     AND ( user_id = #{userId}
        //           OR ( #{groupId} IS NOT NULL AND group_id = #{groupId} ) )
        //   ORDER BY id DESC LIMIT 200
        List<GenerationJob> jobs = mapper.findTop200VisibleToUser(ctx.getUserId(), ctx.getGroupId());
        if (jobs.isEmpty()) return List.of();

        Set<Long> userIds = jobs.stream()
                .map(GenerationJob::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> idToName = fetchUsernames(userIds);

        return jobs.stream().map(j -> toHistoryView(j, idToName)).toList();
    }

    private Map<Long, String> fetchUsernames(Set<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) return Collections.emptyMap();
        try {
            R<Map<String, String>> resp = authClient.usersByIds(userIds);
            if (resp == null || resp.getCode() != 0 || resp.getData() == null) {
                log.warn("[Image] usersByIds fallback: resp={}", resp);
                return Collections.emptyMap();
            }
            Map<Long, String> out = new HashMap<>(resp.getData().size());
            for (Map.Entry<String, String> e : resp.getData().entrySet()) {
                try {
                    out.put(Long.valueOf(e.getKey()), e.getValue());
                } catch (NumberFormatException ignore) {
                    log.warn("[Image] usersByIds skip non-numeric key: {}", e.getKey());
                }
            }
            return out;
        } catch (Exception e) {
            log.warn("[Image] usersByIds failed, fallback to empty map", e);
            return Collections.emptyMap();
        }
    }

    private HistoryDtos.HistoryJobView toHistoryView(GenerationJob j, Map<Long, String> idToName) {
        HistoryDtos.HistoryJobView v = new HistoryDtos.HistoryJobView();
        v.setId(j.getId());
        v.setPhase(j.getPhase());
        v.setPrompt(j.getPrompt());
        // DB 存 assetKey（换行分隔）；输出给前端时每段过 resolveUrl 再用换行重新拼回，保持线协议不变
        v.setAssetUrls(String.join("\n", resolveStoredUrls(j.getAssetUrls())));
        v.setStatus(j.getStatus());
        v.setSaved(j.getSaved());
        v.setUserId(j.getUserId());
        v.setAuthorName(j.getUserId() == null ? null : idToName.get(j.getUserId()));
        v.setCreateTime(j.getCreateTime());
        v.setLastAccessAt(j.getLastAccessAt());
        v.setPhaseConfig(j.getPhaseConfig());
        return v;
    }

    @Override
    public List<String> refreshJobUrls(Long jobId) {
        UserContext ctx = UserContextHolder.get();
        Long uid = ctx == null ? null : ctx.getUserId();
        if (uid == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context");
        }
        Long gid = ctx.getGroupId();
        // 复用 mapper 的 selectById（@TableLogic 自动过滤 deleted=0），随后在 Service 层校验所有权 ——
        // 与 markSaved 用 SQL WHERE 一次性 join 鉴权不同，这里不更新数据，selectById 更直白。
        GenerationJob job = mapper.selectById(jobId);
        if (job == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "job not found");
        }
        boolean ownedByUser = uid.equals(job.getUserId());
        boolean sharedInGroup = gid != null && gid.equals(job.getGroupId());
        if (!ownedByUser && !sharedInGroup) {
            // 故意返 NOT_FOUND 而非 FORBIDDEN，避免暴露存在性（与 markSaved 行为一致）。
            throw new BizException(ErrorCode.NOT_FOUND, "job not found or not accessible");
        }
        // 直接展开 asset_urls（多 key 换行分隔），逐条过 resolveUrl 拿 fresh URL。
        return resolveStoredUrls(job.getAssetUrls());
    }

    @Override
    @Transactional
    public void deleteJob(Long jobId) {
        UserContext ctx = UserContextHolder.get();
        Long uid = ctx == null ? null : ctx.getUserId();
        if (uid == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context");
        }
        // 故意复用 selectById（@TableLogic 自动过滤 deleted=0）+ Service 层鉴权：
        // 仅作者本人可删；同组成员 / 组长 / admin 一律拒绝（与 markSaved/refreshJobUrls 的
        // "作者 + 同组都可" 不同 —— 删除是不可逆动作，权限收紧）。
        GenerationJob job = mapper.selectById(jobId);
        if (job == null || !uid.equals(job.getUserId())) {
            // 故意返 NOT_FOUND 而非 FORBIDDEN，避免暴露存在性。
            throw new BizException(ErrorCode.NOT_FOUND, "job not found or not accessible");
        }

        // 先物理删存储侧（local 磁盘 / GCS Blob 真删），失败仅 log.warn 不中断；
        // 即使个别文件删不掉，DB 软删后用户也看不到了，与 LRU cleaner 行为一致。
        int fileOk = 0, fileFail = 0;
        if (job.getAssetUrls() != null && !job.getAssetUrls().isBlank()) {
            for (String url : job.getAssetUrls().split("\n")) {
                String trimmed = url == null ? null : url.strip();
                if (trimmed == null || trimmed.isEmpty()) continue;
                // 跳过外链 / data URI —— resolveUrl 阶段会原样透传它们，我们既不拥有也无法删
                if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
                    continue;
                }
                try {
                    storageService.delete(trimmed);
                    fileOk++;
                } catch (Exception e) {
                    log.warn("[Image] user-delete file failed jobId={} key={} err={}", jobId, trimmed, e.getMessage());
                    fileFail++;
                }
            }
        }

        // 软删（BaseEntity @TableLogic 驱动 → UPDATE ... SET deleted=1）。
        // 不走物理删，是为了：
        //  ① 审计场景仍可按 jobId 反查；
        //  ② 与 LRU cleaner 软删保持一致行为；
        //  ③ DB 行体积小，软删压力可忽略，定期清理另起 SQL 即可。
        mapper.deleteById(jobId);
        auditLogService.log(job.getPhase(), "user-delete job=" + jobId, jobId);
        log.info("[Image] job {} deleted by userId={} files_ok={} files_fail={}",
                jobId, uid, fileOk, fileFail);
    }

    @Override
    @Transactional
    public Map<String, Object> deleteJobs(Collection<Long> jobIds) {
        UserContext ctx = UserContextHolder.get();
        Long uid = ctx == null ? null : ctx.getUserId();
        if (uid == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context");
        }
        if (jobIds == null || jobIds.isEmpty()) {
            return Map.of("deleted", 0, "skipped", 0, "filesOk", 0, "filesFail", 0);
        }

        // 一次性把"在 id 列表里 + 本人 + deleted=0"的行全捞出，避免 N 次 selectById；
        // 不在列表里 / 非本人 / 已软删的 id 会自然落到 skipped 数（由前端传入数 - 命中数算出）。
        List<GenerationJob> owned = mapper.selectList(
                new LambdaQueryWrapper<GenerationJob>()
                        .in(GenerationJob::getId, jobIds)
                        .eq(GenerationJob::getUserId, uid));

        int filesOk = 0, filesFail = 0;
        for (GenerationJob job : owned) {
            if (job.getAssetUrls() == null || job.getAssetUrls().isBlank()) continue;
            for (String url : job.getAssetUrls().split("\n")) {
                String trimmed = url == null ? null : url.strip();
                if (trimmed == null || trimmed.isEmpty()) continue;
                // 跳过外链 / data URI —— resolveUrl 阶段会原样透传它们，我们既不拥有也无法删
                if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
                    continue;
                }
                try {
                    storageService.delete(trimmed);
                    filesOk++;
                } catch (Exception e) {
                    log.warn("[Image] batch-delete file failed jobId={} key={} err={}",
                            job.getId(), trimmed, e.getMessage());
                    filesFail++;
                }
            }
        }

        int deleted = 0;
        if (!owned.isEmpty()) {
            // 一次 deleteBatchIds → @TableLogic 改写为 UPDATE ... SET deleted=1 WHERE id IN (...)
            deleted = mapper.deleteBatchIds(owned.stream().map(GenerationJob::getId).toList());
            for (GenerationJob job : owned) {
                auditLogService.log(job.getPhase(), "user-batch-delete job=" + job.getId(), job.getId());
            }
        }

        int skipped = jobIds.size() - owned.size();
        log.info("[Image] batch-delete by userId={} requested={} deleted={} skipped={} files_ok={} files_fail={}",
                uid, jobIds.size(), deleted, skipped, filesOk, filesFail);

        Map<String, Object> summary = new HashMap<>();
        summary.put("deleted", deleted);
        summary.put("skipped", skipped);
        summary.put("filesOk", filesOk);
        summary.put("filesFail", filesFail);
        return summary;
    }

    @Transactional
    public void markSaved(Long jobId) {
        UserContext ctx = UserContextHolder.get();
        Long uid = ctx == null ? null : ctx.getUserId();
        if (uid == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "missing user context");
        }
        Long gid = ctx.getGroupId();
        // 自定义 XML (GenerationJobMapper.xml#markSaved):
        //   UPDATE image.generation_job SET saved = TRUE, last_access_at = #{now}
        //   WHERE id = #{id} AND deleted = 0
        //     AND ( user_id = #{userId}
        //           OR ( #{groupId} IS NOT NULL AND group_id = #{groupId} ) )
        // 返回影响行数：== 0 意味着越权或 job 不存在。
        int updated = mapper.markSaved(jobId, uid, gid, LocalDateTime.now());
        if (updated == 0) {
            throw new BizException(ErrorCode.NOT_FOUND, "job not found or not accessible");
        }
        log.info("[Image] job {} marked as saved by userId={} groupId={}", jobId, uid, gid);
    }
}
