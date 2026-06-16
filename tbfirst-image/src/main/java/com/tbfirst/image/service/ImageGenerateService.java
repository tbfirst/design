package com.tbfirst.image.service;

import com.tbfirst.image.dto.CopilotDtos;
import com.tbfirst.image.dto.GenerateDtos;
import com.tbfirst.image.dto.HistoryDtos;
import com.tbfirst.image.dto.InpaintDtos;

import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 生图编排服务接口。
 *
 * <p><b>职责：</b>是 tbfirst-image 的核心 orchestrator —— 负责把用户的生成请求
 * 分阶段落库 generation_job，调用 Python 侧 AI 能力（Feign /api/ai/**），
 * 回写结果并记录审计。phaseConfig（JSONB）字段会保存每阶段的入参快照以便复放。</p>
 *
 * <p><b>关联表：</b>image.generation_job（主）、image.audit_log（审计）、
 * asset.shared_asset（跨服务资源，由 BrandModelService 间接写入）。</p>
 *
 * <p><b>实现：</b>{@link com.tbfirst.image.service.impl.ImageGenerateServiceImpl}。</p>
 */
public interface ImageGenerateService {

    /**
     * 发起一次多阶段生图任务（异步）。
     * <p>流程：落 pending job（短事务，立即提交）→ <b>立即返回 {jobId, status=pending}</b>
     * → 后台线程池执行"调 AI → 落盘 → 回写 success/failed → 写 audit_log"。
     * 前端凭 jobId 轮询 {@link #getJobStatus(Long)} 获取终态与结果。</p>
     */
    GenerateDtos.GenerateResponse generate(GenerateDtos.GenerateRequest req);

    /**
     * 查询生图任务状态（异步轮询入口）。
     * <p>权限同 {@link #refreshJobUrls(Long)}：仅作者本人或同组可见，否则 NOT_FOUND。</p>
     *
     * @return {jobId, status(pending/success/failed), urls(success 时填充), rawResponse(文本类阶段结果), errorMsg(failed 时填充)}
     */
    GenerateDtos.GenerateResponse getJobStatus(Long jobId);

    /**
     * V5.XVII.E：通用参考图上传 —— 把前端 data URI（base64）落到 GCS，返回前端可消费的短链 URL。
     *
     * <p><b>目的：</b>之前用户在 Phase2/Phase3 直接拖拽 / 粘贴 / 选文件上传时，前端把 base64
     * 直接塞进 selectedBaseImages，导致 phase2/generate 等后续请求的 body 累加 base64 体积，
     * 单次请求可达 10MB+ 直接被浏览器 / vite-proxy 断连（fetch TypeError "Failed to fetch"）。</p>
     *
     * <p><b>语义：</b>纯粹是"把字节存起来并给我一个短链"，<b>不创建 generation_job、不写 audit_log</b>，
     * 仅复用 persistImages 的落盘逻辑 + storageService.resolveUrl 转 GCS presigned 短链。</p>
     *
     * <p><b>幂等性：</b>每次调用生成新的 UUID 文件名，无去重；同一张图被上传两次会有两份副本。
     * 不做去重是为了避免引入 hash 索引表 / 增加 GCS 列表 IO；命中率本就很低（用户重复拖一张图属边缘场景）。</p>
     *
     * @param dataUris 必须是 {@code data:image/...;base64,...} 形式；非 data URI 字符串将抛错（与
     *                 persistImages 行为对齐，避免静默把 http URL 当 base64 解码出乱码）
     * @param phase   存储桶子目录（如 "upload"），与生图阶段隔离；前端上传统一传 "upload"
     * @return 与 dataUris 等长的短链 URL 列表（顺序保持），前端可直接放进 selectedBaseImages
     */
    List<String> uploadAssets(List<String> dataUris, String phase);

    /**
     * 局部重绘（inpaint）。
     * <p>基于既有任务的 base image + mask，仅重绘被 mask 覆盖的区域。</p>
     */
    InpaintDtos.InpaintResponse inpaint(InpaintDtos.InpaintRequest req);

    /** Copilot 对话式生成助理 —— 入口，直接代理到 Python copilot 服务。 */
    CopilotDtos.ChatResponse copilotChat(CopilotDtos.ChatRequest req);

    /** Copilot 灵感推荐 —— 返回若干 prompt 建议。 */
    CopilotDtos.InspireResponse copilotInspire(CopilotDtos.InspireRequest req);

    /** Copilot 品牌分析 —— 根据上传的品牌图推断风格关键词。 */
    CopilotDtos.AnalyzeResponse analyzeBrand(CopilotDtos.AnalyzeRequest req);

    /**
     * 当前用户可见的生成历史（个人 + 所在组）。
     * <p>上限 200 条，按 id 倒序。包含 phase_config 反序列化后的结构化阶段参数。</p>
     */
    List<HistoryDtos.HistoryJobView> history();

    /**
     * 将历史任务标为"已收藏（saved=true）"。
     * <p>仅允许 job.user_id == currentUser 或 job.group_id == currentGroup 的任务被收藏。</p>
     */
    void markSaved(Long jobId);

    /**
     * 用户主动删除一条历史生图记录。
     *
     * <p><b>权限：</b>仅作者本人可删（{@code job.user_id == currentUser}）。
     * 同组成员、组长、admin 一律不可代删 —— 避免组员误删彼此的历史；
     * 这一点与 {@link #markSaved}/{@link #refreshJobUrls} 的"作者 + 同组都可"语义有意区分。</p>
     *
     * <p><b>清理：</b>同 LRU 到期路径，先逐个 {@code storage.delete(assetKey)}
     * 把底层存储（local 磁盘 / GCS Blob）真物理删，再走 {@code mapper.deleteById}
     * 软删 DB 行（@TableLogic 驱动，{@code deleted} 置 1）。文件删除任何一项失败只
     * log.warn 不中断；DB 行最终一定会软删，避免"文件已删但用户还能在历史里看到 404 卡片"。</p>
     *
     * @param jobId generation_job 主键
     * @throws com.tbfirst.common.core.exception.BizException
     *         未登录(UNAUTHORIZED) / job 不存在 / 非本人(NOT_FOUND，故意不暴露存在性)
     */
    void deleteJob(Long jobId);

    /**
     * 批量删除多条历史生图记录（前端历史 Modal 上的"批量删除"按钮触发）。
     *
     * <p><b>权限：</b>与 {@link #deleteJob} 相同，仅作者本人可删；传入的 id 列表里非本人
     * 的会被静默跳过（不报错，由返回值的 {@code skipped} 字段告诉调用方），
     * 这样前端可以乐观地把所有选中的 id 都丢过来，不需要客户端再筛一遍。</p>
     *
     * <p><b>实现策略：</b>单条 SELECT 一次性把"在 id 列表里 + user_id 是本人 + deleted=0"
     * 的行全部捞出来，避免 N+1；之后逐个 storage.delete（容错），最后一条 SQL 批量软删 +
     * 多条 audit 写入。</p>
     *
     * @param jobIds 待删除的 generation_job 主键集合；空 / null 时直接返回 {@code deleted=0}
     * @return 摘要 Map：
     *         <ul>
     *           <li>{@code deleted}   —— 实际删除的行数（属于本人且未软删）</li>
     *           <li>{@code skipped}   —— 跳过的 id 数（不存在 / 已被软删 / 非本人）</li>
     *           <li>{@code filesOk}   —— 底层存储成功删除的对象数</li>
     *           <li>{@code filesFail} —— 底层存储删除失败的对象数（仅记日志，不阻塞 DB 软删）</li>
     *         </ul>
     * @throws com.tbfirst.common.core.exception.BizException UNAUTHORIZED（未登录）
     */
    Map<String, Object> deleteJobs(Collection<Long> jobIds);

    /**
     * 重新签发某个生图任务的图片 URL 列表（v3 S2 起新增）。
     *
     * <p><b>背景：</b>provider=gcs 模式下 {@code resolveUrl} 返回的预签名 URL 默认 TTL=15min；
     * 用户长时间停留页面（历史 modal、Phase2 详情等）会触发 {@code <img>} 403。前端通过
     * {@code <img onError>} 调用本端点拿一份新签 URL 替换 src，无需刷新整页。</p>
     *
     * <p><b>权限：</b>同 {@link #markSaved}，仅当前用户的任务或所在组的任务可见。</p>
     *
     * @param jobId generation_job 主键
     * @return 该任务对应的当前可访问 URL 列表（顺序与原 asset_urls 中存储顺序一致）
     */
    List<String> refreshJobUrls(Long jobId);
}
