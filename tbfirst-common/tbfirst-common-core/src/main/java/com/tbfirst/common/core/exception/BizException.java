package com.tbfirst.common.core.exception;

import com.tbfirst.common.core.response.ErrorCode;
import lombok.Getter;

/**
 * 自定义业务异常
 * <p>
 * 所有业务代码在遇到可预期的错误（校验失败、状态非法、资源不存在等）时，应抛出本异常，
 * 由 {@code GlobalExceptionHandler} 统一捕获并转换为 {@link com.tbfirst.common.core.response.R} 响应。
 * 继承 {@link RuntimeException}，避免业务方法签名被 checked 异常污染。
 * </p>
 *
 * @author tbfirst
 */
@Getter
public class BizException extends RuntimeException {

    /** 关联的错误码，决定最终响应的 code 字段 */
    private final ErrorCode errorCode;

    /**
     * 仅携带自定义消息，错误码默认为 {@link ErrorCode#BIZ_ERROR}。
     *
     * @param message 错误描述
     */
    public BizException(String message) {
        super(message);
        this.errorCode = ErrorCode.BIZ_ERROR;
    }

    /**
     * 使用错误码的默认提示构造异常。
     *
     * @param errorCode 错误码枚举
     */
    public BizException(ErrorCode errorCode) {
        super(errorCode.getMsg());
        this.errorCode = errorCode;
    }

    /**
     * 指定错误码并覆盖默认提示。
     *
     * @param errorCode 错误码枚举
     * @param message   自定义错误描述
     */
    public BizException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    /**
     * 指定错误码、自定义提示并保留根因。
     *
     * @param errorCode 错误码枚举
     * @param message   自定义错误描述
     * @param cause     根因异常，便于日志与问题定位
     */
    public BizException(ErrorCode errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }
}
