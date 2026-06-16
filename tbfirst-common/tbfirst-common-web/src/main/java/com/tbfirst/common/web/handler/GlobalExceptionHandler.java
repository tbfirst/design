package com.tbfirst.common.web.handler;

import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.core.response.R;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

/**
 * 全局异常处理器。
 * <p>
 * 使用 {@link RestControllerAdvice} 拦截所有 {@code @RestController} 抛出的异常，
 * 统一封装成 {@link R} 响应，避免各控制器重复处理异常。
 * 处理顺序：业务异常 → 参数校验异常 → 未知异常兜底。
 * </p>
 *
 * @author tbfirst
 */
@Slf4j
@RestControllerAdvice   // 相当于 @ControllerAdvice + @ResponseBody，表名当前是一个全局异常处理器，且返回值直接写入响应体
public class GlobalExceptionHandler {

    /**
     * 处理自定义业务异常。
     * <p>业务异常是可预期的，HTTP 状态保持 200，通过 body.code 表达业务失败，降低前端处理成本。</p>
     *
     * @param e 业务异常
     * @return 统一封装的失败响应
     */
    @ExceptionHandler(BizException.class)
    public ResponseEntity<R<Void>> handleBiz(BizException e) {
        // 业务异常用 warn 而非 error，避免噪音日志
        log.warn("[业务异常] {}: {}", e.getErrorCode(), e.getMessage());
        return ResponseEntity.ok(R.fail(e.getErrorCode(), e.getMessage()));
    }

    /**
     * 处理 {@code @RequestBody} 参数校验失败（@Valid 触发）。
     *
     * @param e MethodArgumentNotValidException
     * @return HTTP 400 + 首个字段错误提示
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<R<Void>> handleValid(MethodArgumentNotValidException e) {
        // 只取第一个字段错误，避免返回大量信息给前端
        String msg = e.getBindingResult().getFieldError() == null
                ? "参数校验失败"
                : e.getBindingResult().getFieldError().getDefaultMessage();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(R.fail(ErrorCode.BAD_REQUEST, msg));
    }

    /**
     * 处理表单/查询参数绑定失败。
     *
     * @param e BindException
     * @return HTTP 400
     */
    @ExceptionHandler(BindException.class)
    public ResponseEntity<R<Void>> handleBind(BindException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(R.fail(ErrorCode.BAD_REQUEST, e.getMessage()));
    }

    /**
     * 处理方法参数上的 JSR-303 约束违反（如 @PathVariable @NotBlank）。
     *
     * @param e ConstraintViolationException
     * @return HTTP 400
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<R<Void>> handleConstraint(ConstraintViolationException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(R.fail(ErrorCode.BAD_REQUEST, e.getMessage()));
    }

    /**
     * V5.XV.10: 客户端中途断开连接（浏览器取消请求、tab 关闭、scroll 走、proxy 超时等）。
     * 这种情况下后端继续 write 必然失败，但属于**正常浏览器行为**——尤其在 /img/大图代理 + 成品库多图并发场景下高频出现。
     * <p>处理：
     * <ul>
     *   <li>降级到 DEBUG 级别，不打 stack；运维只看 ERROR 时不会被噪音淹没</li>
     *   <li>HTTP 状态保持 499（"Client Closed Request"，nginx 约定），便于网络层区分客户端取消 vs 服务端 5xx</li>
     *   <li>同时覆盖嵌套的 ClientAbortException（用 Throwable.getCause 链判断）—— 该类来自
     *       tomcat-embed-core，common-web 不直接 import 防 maven 反向依赖，按全限定名匹配字符串</li>
     * </ul>
     */
    @ExceptionHandler(AsyncRequestNotUsableException.class)
    public ResponseEntity<R<Void>> handleClientAbort(AsyncRequestNotUsableException e) {
        log.debug("[客户端断开连接] 异步查看错误消息: {}", e.getMessage());
        return ResponseEntity.status(499).build();
    }

    // todo 后续可加其他常见异常处理，在兜底异常前加即可，减小颗粒度

    /**
     * 兜底未知异常处理，打印完整堆栈便于排查。
     * V5.XV.10: ClientAbortException（tomcat-embed-core）也按客户端断连处理 ——
     * 用类名字符串匹配以避免 common-web 反向依赖 tomcat-embed-core 编译期强约束。
     *
     * @param e 任意未处理异常
     * @return HTTP 500（客户端断连场景返回 499）
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<R<Void>> handleUnknown(Exception e) {
        if (isClientAbort(e)) {
            log.debug("[客户端断开连接] {}: {}", e.getClass().getSimpleName(), e.getMessage());
            return ResponseEntity.status(499).build();
        }
        // error 级别 + 带堆栈，便于线上问题定位
        log.error("[未知异常] {}", e.getMessage(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(R.fail(ErrorCode.INTERNAL_ERROR, e.getMessage()));
    }

    /**
     * V5.XV.10: 沿 cause 链识别"客户端断开连接"异常。
     * 命中条件：
     *   - 类名包含 "ClientAbort" (org.apache.catalina.connector.ClientAbortException)
     *   - 消息包含中文"中止了一个已建立的连接"或英文"Broken pipe"/"Connection reset"
     * 任一层 cause 命中即视为客户端断连。
     */
    private static boolean isClientAbort(Throwable e) {
        Throwable cur = e;
        int depth = 0;
        while (cur != null && depth < 10) {
            String cls = cur.getClass().getName();
            if (cls.contains("ClientAbortException")) return true;
            String msg = cur.getMessage();
            if (msg != null) {
                if (msg.contains("中止了一个已建立的连接")
                        || msg.contains("Broken pipe")
                        || msg.contains("Connection reset")
                        || msg.contains("aborted by the software")) {
                    return true;
                }
            }
            cur = cur.getCause();
            depth++;
        }
        return false;
    }
}
