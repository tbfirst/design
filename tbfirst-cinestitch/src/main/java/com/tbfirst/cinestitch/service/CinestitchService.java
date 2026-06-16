package com.tbfirst.cinestitch.service;

import com.tbfirst.cinestitch.dto.CinestitchDtos;

import java.util.List;

/**
 * Cinestitch 业务服务接口。
 *
 * <p>架构角色：Controller 层与数据访问/外部 AI 调用之间的抽象层，
 * 定义分镜生成的业务契约；具体实现由
 * {@link com.tbfirst.cinestitch.service.impl.CinestitchServiceImpl} 提供。</p>
 */
public interface CinestitchService {

    /**
     * 执行分镜生成任务。
     *
     * <p>流程：落库 pending → Feign 调 Python AI → 回写结果 success/failed。</p>
     *
     * @param userId 当前登录用户 ID（从 X-User-Id 请求头传入）
     * @param req    分镜生成请求 DTO
     * @return 包含 Markdown 分镜表格的响应 DTO
     */
    CinestitchDtos.GenerateResponse generate(Long userId, CinestitchDtos.GenerateRequest req);

    /**
     * 执行视频分镜解析任务。
     *
     * <p>流程：落库 pending(jobType=video) → Feign 调 Python AI → 回写结果 success/failed。</p>
     *
     * @param userId 当前登录用户 ID
     * @param req    视频解析请求 DTO
     * @return 包含 Markdown 分镜表格的响应 DTO
     */
    CinestitchDtos.VideoParseResponse parseVideo(Long userId, CinestitchDtos.VideoParseRequest req);

    /**
     * 无状态生成视频提示词（不落库）。
     *
     * @param req 分镜 Markdown 文本
     * @return 每幕英文视频生成提示词列表
     */
    CinestitchDtos.VideoPromptsResponse generateVideoPrompts(CinestitchDtos.VideoPromptsRequest req);

    /**
     * 查询用户历史分镜作业列表（仅返回 success 状态）。
     *
     * @param userId   当前登录用户 ID
     * @param pageNum  页码（从 1 开始）
     * @param pageSize 每页条数
     * @return 分镜作业摘要列表
     */
    List<CinestitchDtos.JobListItem> listJobs(Long userId, int pageNum, int pageSize);

    /** 逻辑删除指定作业（仅允许删除自己的记录）。 */
    void deleteJob(Long userId, Long jobId);

    /**
     * 执行脚本分镜解析任务（有状态落库，jobType=script）。
     *
     * @param userId 当前登录用户 ID
     * @param req    脚本解析请求 DTO
     * @return 包含 Markdown 分镜表格的响应 DTO
     */
    CinestitchDtos.ScriptParseResponse parseScript(Long userId, CinestitchDtos.ScriptParseRequest req);

    /**
     * 无状态逐幕生图（不落库，直接透传 Python 侧）。
     *
     * @param req 视觉描述 + 画风预设 + 宽高比
     * @return 包含 base64 data URI 图片 URL 的响应 DTO
     */
    CinestitchDtos.GenerateShotImageResponse generateShotImage(CinestitchDtos.GenerateShotImageRequest req);
}
