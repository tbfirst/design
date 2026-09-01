package com.tbfirst.image.controller;

import com.tbfirst.common.core.response.R;
import com.tbfirst.image.dto.GenerateDtos;
import com.tbfirst.image.dto.HistoryDtos;
import com.tbfirst.image.dto.InpaintDtos;
import com.tbfirst.image.entity.AuditLog;
import com.tbfirst.image.service.AuditLogService;
import com.tbfirst.image.service.ImageGenerateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 生图 REST 入口 —— 所有前端生图请求经 Gateway 路由到这里。
 *
 * 路由表（均需 JWT）：
 *   POST /api/image/{phase}/generate   — 四阶段 + 子模式生图，phase 由路径变量注入 request
 *   POST /api/image/inpaint            — 局部重绘（红色蒙版）
 *   GET  /api/image/history            — 拉取当前用户最近 200 条未软删生图记录（历史 Modal 按日期分组用）
 *   POST /api/image/jobs/{id}/save     — "下载并收藏"：置 saved=true + 刷新 last_access_at（续命 30 天）
 *   DELETE /api/image/jobs/{id}        — 用户主动删除单条（仅作者本人；同步删 GCS/本地文件 + 软删 DB 行）
 *   POST /api/image/jobs/batch-delete  — 批量删除（仅作者本人；非本人 id 静默跳过；返回 deleted/skipped 摘要）
 *   GET  /api/image/jobs/{id}/urls     — 重拉某 job 的图片 URL（GCS 预签名续命）
 *   GET  /api/image/audit              — 当前用户审计流水
 *
 * 返回全部包裹 R<T>（见 tbfirst-common-core）：{code, msg, data, traceId}。
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/image")
public class ImageController {

    private final ImageGenerateService service;
    private final AuditLogService auditLogService;

    /**
     * 生图（四阶段统一入口）。
     * phase 作为路径变量注入到 req.phase，Service 层据此组装 Feign payload；
     * ai-python {@code _dispatch_by_phase} 按 phase + phase_config.step 路由到具体 prompt 构建器。
     *
     * @param phase 阶段标识，取值：
     *              <ul>
     *                <li>{@code phase0} —— 资产工厂（DNA 提取 → 三视图重建）。phase_config.step=dna/asset。</li>
     *                <li>{@code phase1} —— 创意生图（模特 + 场景 + 主产品 + 配饰 + 构图/色调/氛围）。</li>
     *                <li>{@code phase2} —— 标准精修（姿势 / 表情 / 焦点 / 平铺 / 面料微距）。</li>
     *                <li>{@code phase2Color} —— 色彩实验室（HEX 换色 / 参考纹理映射，几何严格保持）。</li>
     *                <li>{@code phase3} —— 影调大师（DaVinci 式整体调色）。phase_config.step：
     *                  <ul>
     *                    <li>{@code dna} —— 从灵感图提取视觉 DNA，返回 12-15 个英文 tag + 四维中文笔记
     *                        (JSON 文本走 response.rawResponse 给前端 JSON.parse)。</li>
     *                    <li>{@code generate} —— 单底片渲染，phase_config 透传 styleDNA / intensity /
     *                        grain / contrast / targetQuality / remark(P0 高优先级直出指令) 给
     *                        Python build_phase3_prompt；图像走 PRO 顶链首 + 失败降级 flash。</li>
     *                  </ul>
     *                </li>
     *              </ul>
     *              落盘桶名直接复用 phase 字段（{@code image/<phase>/<uuid>.png}）。
     * @param req   生图参数（prompt、模型、参考图、阶段配置等）
     * @return 统一响应体，data 为 {@link GenerateDtos.GenerateResponse}（jobId + 图片 URL 列表 +
     *         rawResponse[phase3:dna 路径承载 JSON 文本]）
     */
    @PostMapping("/{phase}/generate")
    public R<GenerateDtos.GenerateResponse> generate(@PathVariable String phase,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                      @Valid @RequestBody GenerateDtos.GenerateRequest req) {
        req.setPhase(phase);
        if ((req.getRequestId() == null || req.getRequestId().isBlank()) && idempotencyKey != null) {
            req.setRequestId(idempotencyKey);
        }
        return R.ok(service.generate(req));
    }

    /**
     * 生图任务状态查询（异步轮询入口）。
     * <p>generate 改异步后，POST 立即返回 {jobId, status=pending}；前端凭 jobId 轮询本端点，
     * 直到 status 变为 success（取 urls / rawResponse）或 failed（取 errorMsg）。</p>
     *
     * <p>权限：仅作者本人或同组可见，否则 NOT_FOUND（不暴露存在性）。</p>
     *
     * @param id 生图记录主键（POST 返回的 jobId）
     * @return data 为 {@link GenerateDtos.GenerateResponse}：status + urls(success) + rawResponse(文本阶段) + errorMsg(failed)
     */
    @GetMapping("/jobs/{id}/status")
    public R<GenerateDtos.GenerateResponse> jobStatus(@PathVariable Long id) {
        return R.ok(service.getJobStatus(id));
    }

    /**
     * 局部重绘（SmartInpaint）—— maskedImage 已由前端标注红色蒙版区域。
     *
     * @param req 含 masked_image / prompt / aspectRatio / referenceImage
     * @return 单张重绘结果 URL 及 jobId
     */
    @PostMapping("/inpaint")
    public R<InpaintDtos.InpaintResponse> inpaint(@Valid @RequestBody InpaintDtos.InpaintRequest req) {
        return R.ok(service.inpaint(req));
    }

    /**
     * V5.XVII.E：通用参考图上传 —— 把 base64 data URI 落到 GCS / 本地存储，返回前端短链。
     *
     * <p><b>解决的问题：</b>Phase2/Phase3 用户拖拽 / 粘贴参考图时，前端原本把 base64 直接塞进
     * selectedBaseImages，导致后续 phase2/generate 请求 body 累加几 MB 至 10MB+，常被浏览器或
     * vite-proxy 在传输途中断开（fetch TypeError "Failed to fetch"，被误判为"网关未启动"）。</p>
     *
     * <p>前端 processFiles 改为：File → FileReader → dataUri → 本端点 → 短链；之后
     * selectedBaseImages 永远只存短链，phase2/generate 请求体始终小于几 KB。</p>
     *
     * <p><b>不创建 generation_job、不写 audit_log</b>；纯字节落盘 + 短链返回。</p>
     *
     * @param req {@code { dataUris: [String], phase: "upload" }}
     *            phase 仅用于桶子目录隔离，可缺省，默认 "upload"
     * @return 与入参 dataUris 等长的短链 URL 列表
     */
    @PostMapping("/upload")
    public R<GenerateDtos.UploadResponse> upload(@Valid @RequestBody GenerateDtos.UploadRequest req) {
        List<String> urls = service.uploadAssets(req.getDataUris(), req.getPhase());
        GenerateDtos.UploadResponse resp = new GenerateDtos.UploadResponse();
        resp.setUrls(urls);
        return R.ok(resp);
    }

    /**
     * 历史记录 —— 仅当用户点击前端"历史生图"按钮时触发，按日期分组展示未软删的生图记录。
     * 若 testpicture/ 目录删了但 DB 记录还在 → 前端列表里每张图都是 404；
     * 若 DB 清了但文件在 → 用户看不到任何历史。两者由 GenerationJobLruCleaner 定时同步清理。
     *
     * @return 当前用户最近 200 条 未软删 GenerationJob（视图 DTO），按 id 倒序。
     */
    @GetMapping("/history")
    public R<List<HistoryDtos.HistoryJobView>> history() {
        return R.ok(service.history());
    }

    /**
     * 收藏生图记录（前端"下载并收藏"按钮触发）：置 saved=true 且刷新 last_access_at = now()。
     * 所有权校验在 service 层 SQL 的 WHERE 里（userId 匹配），他人枚举 jobId 会 NOT_FOUND。
     *
     * @param id 生图记录主键
     * @return 空响应；失败抛 BizException
     */
    @PostMapping("/jobs/{id}/save")
    public R<Void> saveJob(@PathVariable Long id) {
        service.markSaved(id);
        return R.ok();
    }

    /**
     * 用户主动删除一条历史生图记录（前端历史 Modal 上的"删除"按钮触发）。
     *
     * <p><b>权限：</b>仅作者本人可删（{@code job.user_id == currentUser}）；
     * 同组成员 / 组长 / admin 越权调用会被 Service 层判 NOT_FOUND（不暴露存在性）。
     * 删除是不可逆动作，相比 {@code save}/{@code urls} 的"作者+同组都可"权限故意收紧。</p>
     *
     * <p><b>副作用：</b>同步执行：
     * <ol>
     *   <li>逐个 {@code storage.delete(assetKey)} —— provider=gcs 走 Cloud Storage API
     *       <em>真物理删除 Blob</em>，provider=local 删本地磁盘文件；外链/data URI 跳过。</li>
     *   <li>{@code mapper.deleteById} —— 走 BaseEntity 的 {@code @TableLogic} 软删
     *       （{@code deleted=1}）。后续 history 查询的 {@code WHERE deleted=0} 自动过滤掉。</li>
     *   <li>写一条 audit_log（{@code phase=<原 phase>, action=user-delete}）。</li>
     * </ol>
     * </p>
     *
     * @param id 生图记录主键
     * @return 空响应；失败抛 BizException（UNAUTHORIZED / NOT_FOUND）
     */
    @DeleteMapping("/jobs/{id}")
    public R<Void> deleteJob(@PathVariable Long id) {
        service.deleteJob(id);
        return R.ok();
    }

    /**
     * 批量删除历史生图（前端历史 Modal 的"批量删除"工具栏触发）。
     *
     * <p><b>权限：</b>仅作者本人的 id 会被处理；非本人 / 不存在 / 已软删的 id 静默跳过
     * （不报错），由响应 {@code data.skipped} 字段告诉前端跳过了多少。这样前端不需要
     * 在客户端再做一次 mine 过滤，传入的 id 列表可以是用户多选的全集，由后端统一裁决。</p>
     *
     * <p><b>副作用：</b>对每条本人 job：
     * <ol>
     *   <li>遍历 asset_urls 逐个 {@code storage.delete(assetKey)} —— provider=gcs 走 GCS
     *       API 真物理删 Blob；provider=local 删本地磁盘文件；外链/data URI 跳过。
     *       单个文件失败仅 log.warn，不阻塞后续。</li>
     *   <li>一条 {@code deleteBatchIds} 完成全部 DB 软删（@TableLogic 把 deleted 置 1）。</li>
     *   <li>每条写一条 audit_log（action="user-batch-delete"）。</li>
     * </ol>
     * </p>
     *
     * @param req 含 {@code ids: List<Long>} 字段；ids 为空 / null 时直接返回 deleted=0
     * @return R.data 是 {@code Map<String, Object>}：
     *         <pre>{ deleted: N, skipped: M, filesOk: X, filesFail: Y }</pre>
     */
    @PostMapping("/jobs/batch-delete")
    public R<Map<String, Object>> batchDeleteJobs(@RequestBody GenerateDtos.BatchDeleteRequest req) {
        return R.ok(service.deleteJobs(req.getIds()));
    }

    /**
     * 重拉某个生图任务的图片 URL 列表（v3 S2 起新增）。
     * <p>provider=gcs 时预签名 URL 默认 15min 过期；前端 {@code <img onError>}
     * 监听到 403 后调用本端点拿一份新 URL 替换 src，避免整页刷新。
     * provider=local 时返回的就是 {@code /static/...}，与原 URL 相同——前端零改动同样适用。</p>
     *
     * @param id 生图记录主键
     * @return data 为该 job 的当前可访问 URL 列表（顺序与 asset_urls 存储顺序一致）
     */
    @GetMapping("/jobs/{id}/urls")
    public R<List<String>> refreshJobUrls(@PathVariable Long id) {
        return R.ok(service.refreshJobUrls(id));
    }

    /**
     * 审计流水 —— 管理后台 / 员工自查都走这个端点。
     * todo 预留接口，当前暂未实现
     *
     * @return 当前用户审计日志列表（按创建时间倒序、未软删）
     */
    @GetMapping("/audit")
    public R<List<AuditLog>> audit() {
        return R.ok(auditLogService.getMyLogs());
    }
}
