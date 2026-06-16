package com.tbfirst.common.core.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.io.Serializable;
import java.time.Instant;

/**
 * 统一响应体。
 * <p>
 * 所有业务微服务（auth/image/modellink/realshow/cinestitch/adimage 等）的 HTTP 接口
 * 必须使用本类封装返回结果，保证前端在跨服务、跨接口时能用同一套 {code, msg, data, traceId}
 * 约定解析。traceId 与 {@code GlobalExceptionHandler}、{@code TraceIdFilter} 联动，
 * 便于链路追踪。
 * </p>
 *
 * @param <T> 业务数据 payload 的类型
 * @author tbfirst
 */
@Data
// NON_NULL：传输时自动忽略 null 字段，减少网络开销并避免前端误判
@JsonInclude(JsonInclude.Include.NON_NULL)
public class R<T> implements Serializable {

    /** 业务状态码，详见 {@link ErrorCode}，0 表示成功 */
    private int code;
    /** 提示信息，失败时给前端展示或日志排查 */
    private String msg;
    /** 业务数据载荷 */
    private T data;
    /** 链路追踪 ID，由 Gateway/TraceIdFilter 注入，同一请求贯穿全链路 */
    private String traceId;
    /** 响应生成时间戳（毫秒），用于客户端排序与问题定位 */
    private long timestamp = Instant.now().toEpochMilli();

    /**
     * 构造无数据的 ok 成功响应。
     *
     * @param <T> 数据类型
     * @return 成功响应对象，data 为 null
     */
    public static <T> R<T> ok() {
        return ok(null);
    }

    /**
     * 构造带数据的 ok 成功响应。
     *
     * @param data 业务数据
     * @param <T>  数据类型
     * @return 成功响应对象
     */
    public static <T> R<T> ok(T data) {
        R<T> r = new R<>();
        r.code = ErrorCode.OK.getCode();
        r.msg = ErrorCode.OK.getMsg();
        r.data = data;
        return r;
    }

    /**
     * 构造失败响应，允许覆盖默认错误提示。
     *
     * @param code 错误码枚举
     * @param msg  自定义提示信息；为 null 时采用枚举默认提示
     * @param <T>  数据类型
     * @return 失败响应对象，data 为 null
     */
    public static <T> R<T> fail(ErrorCode code, String msg) {
        R<T> r = new R<>();
        r.code = code.getCode();
        // 显式传 null 时回退到枚举默认 msg，避免前端收到空字符串
        r.msg = msg == null ? code.getMsg() : msg;
        return r;
    }

    /**
     * 构造失败响应，使用错误码的默认提示。
     *
     * @param code 错误码枚举
     * @param <T>  数据类型
     * @return 失败响应对象
     */
    public static <T> R<T> fail(ErrorCode code) {
        return fail(code, null);
    }
}
