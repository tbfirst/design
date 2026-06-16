package com.tbfirst.common.core.response;

import lombok.Getter;

/**
 * 全局错误码枚举。
 * <p>
 * tbfirst 平台所有微服务共享一套错误码规范，便于前端统一处理。
 * 约定：0=成功；4xx/5xx 对齐 HTTP 语义；1xxx 业务异常；2xxx 上游（AI）异常。
 * 新增业务码时，各业务模块应在独立段位扩展，避免冲突。
 * </p>
 *
 * @author tbfirst
 */
@Getter
public enum ErrorCode {

    /** 成功 */
    OK(0, "success"),
    /** 参数校验/格式错误（对应 HTTP 400） */
    BAD_REQUEST(400, "请求参数错误"),
    /** 未登录或 token 失效 */
    UNAUTHORIZED(401, "未认证"),
    /** 已认证但缺少权限 */
    FORBIDDEN(403, "无权访问"),
    /** 目标资源不存在 */
    NOT_FOUND(404, "资源不存在"),
    /** 资源状态冲突（如重复创建） */
    CONFLICT(409, "资源冲突"),
    /** 触发限流 */
    TOO_MANY_REQUESTS(429, "请求过于频繁"),
    /** 未分类的服务端异常 */
    INTERNAL_ERROR(500, "服务器内部错误"),
    /** 下游/依赖服务不可用 */
    SERVICE_UNAVAILABLE(503, "依赖服务不可用"),

    /** 通用业务异常兜底码 */
    BIZ_ERROR(1000, "业务异常"),
    /** 调用上游 AI（Gemini 等）失败 */
    AI_UPSTREAM_ERROR(2000, "上游 AI 服务异常"),
    /** 上游 AI 调用超时 */
    AI_TIMEOUT(2001, "上游 AI 服务超时"),
    /** 上游 AI 配额耗尽（如 Gemini quota） */
    AI_QUOTA_EXCEEDED(2002, "上游 AI 服务配额耗尽");

    /** 对外数值码，前端依据此判断业务结果 */
    private final int code;
    /** 默认中文提示信息 */
    private final String msg;

    ErrorCode(int code, String msg) {
        this.code = code;
        this.msg = msg;
    }
}
