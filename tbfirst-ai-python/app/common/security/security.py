"""内网 Token 校验（FastAPI 依赖注入形式）。

调用方（Java 侧 Feign）在请求头中携带：
  X-Internal-Token     : HMAC-SHA256(shared_secret, timestamp_str) 的 hex 摘要
  X-Internal-Timestamp : Unix 秒字符串（如 "1748123456"）

Python 侧路由通过 Depends(verify_internal_token) 注入，执行：
  1. 时间戳在 ±30 秒窗口内（防重放攻击）
  2. 时序安全（constant-time）比较 HMAC 摘要，防止 timing attack

兼容模式：若 X-Internal-Timestamp 缺失，降级为静态 token 比较并打 DEPRECATED 日志，
待 Java Feign 拦截器升级后可删除此兼容分支。

Gateway 外部流量由 Gateway 负责 JWT 校验，此处只做内网层防护。

Java Feign 拦截器参考实现：
  long ts = System.currentTimeMillis() / 1000;
  String token = hmacSha256Hex(internalSecret, String.valueOf(ts));
  template.header("X-Internal-Timestamp", String.valueOf(ts));
  template.header("X-Internal-Token", token);
"""
import hashlib
import hmac
import logging
import time

from fastapi import Header, HTTPException, status

from app.config import get_settings

logger = logging.getLogger(__name__)

_TIMESTAMP_TOLERANCE_SEC = 30   # ±30 秒窗口，覆盖合理的网络延迟和时钟偏差
_DEFAULT_TOKEN = "tbfirst-internal"


def warn_default_token() -> None:
    """启动时检测 token 是否为默认值，生产环境须在 .env 中覆盖 INTERNAL_TOKEN。"""
    settings = get_settings()
    if settings.internal_token == _DEFAULT_TOKEN:
        logger.error(
            "[security] CRITICAL: internal_token is still the default value '%s'. "
            "Set INTERNAL_TOKEN in .env before deploying to production!",
            _DEFAULT_TOKEN,
        )


def _compute_expected_hmac(secret: str, timestamp: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_internal_token(
    x_internal_token: str | None = Header(default=None),
    x_internal_timestamp: str | None = Header(default=None),
) -> None:
    """校验内网调用合法性。

    HMAC 模式（推荐）：X-Internal-Timestamp 存在时，校验 HMAC-SHA256(secret, timestamp) + ±30s 窗口。
    兼容模式：X-Internal-Timestamp 缺失时，降级为静态 token 比较（打 DEPRECATED 日志）。
    internal_token 为空字符串时跳过所有校验（开发模式）。
    """
    settings = get_settings()
    if not settings.internal_token:
        return

    if x_internal_timestamp is not None:
        # ── HMAC 模式 ─────────────────────────────────────────────────────────
        try:
            ts = int(x_internal_timestamp)
        except ValueError:
            logger.warning(
                "[security] invalid X-Internal-Timestamp: %r", x_internal_timestamp
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid internal token",
            )

        delta = abs(int(time.time()) - ts)
        if delta > _TIMESTAMP_TOLERANCE_SEC:
            logger.warning(
                "[security] replay rejected: timestamp delta=%ds (limit=%ds)",
                delta,
                _TIMESTAMP_TOLERANCE_SEC,
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid internal token",
            )

        expected = _compute_expected_hmac(settings.internal_token, x_internal_timestamp)
        if not hmac.compare_digest(x_internal_token or "", expected):
            logger.warning(
                "[security] HMAC mismatch (token prefix: %s...)",
                (x_internal_token or "")[:4],
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid internal token",
            )

    else:
        # ── 兼容模式（静态 token）─────────────────────────────────────────────
        logger.debug(
            "[security] DEPRECATED: caller missing X-Internal-Timestamp; "
            "update Feign interceptor to send HMAC headers."
        )
        if not hmac.compare_digest(x_internal_token or "", settings.internal_token):
            logger.warning(
                "[security] static token mismatch (prefix: %s...)",
                (x_internal_token or "")[:4],
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid internal token",
            )
