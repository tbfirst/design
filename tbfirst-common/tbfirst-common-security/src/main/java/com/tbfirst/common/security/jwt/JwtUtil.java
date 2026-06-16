package com.tbfirst.common.security.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

/**
 * 简单 HS256 JWT 工具。
 * <p>
 * 用于 auth 服务签发 token，以及 Gateway 验证 token 的共享实现。
 * 生产环境建议用 RS256 + Nacos 下发公钥（私钥签名/公钥验签），本类作为开发期便捷实现。
 * </p>
 *
 * @author tbfirst
 */
/** todo 未来改为双 token+httponly+RBAC
    access token 过期时间短，refresh token 过期时间长，refresh token 存储在 HttpOnly Cookie 中，access token 存储在内存中，
    每次请求携带 access token，过期后自动使用 refresh token 获取新的 access token **/
public class JwtUtil {

    /** HMAC 密钥，HS256 要求至少 256 bit (32 byte) */
    private final SecretKey key;
    /** token 过期时间（毫秒） */
    private final long expirationMs;

    /**
     * 构造 JWT 工具实例。
     *
     * @param secret       密钥明文（来自配置）；不足 32 字节会被零填充
     * @param expirationMs token 有效期（毫秒）
     */
    public JwtUtil(String secret, long expirationMs) {
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        // 保证密钥长度达到 HS256 最低要求，否则 jjwt 会抛异常
        this.key = Keys.hmacShaKeyFor(bytes.length >= 32 ? bytes : padTo32(bytes));
        this.expirationMs = expirationMs;
    }

    /**
     * 不足 32 字节时补零到 32 字节。
     * <p>仅为开发便捷；生产应强制要求足够长度的随机密钥。</p>
     */
    private static byte[] padTo32(byte[] src) {
        byte[] out = new byte[32];
        System.arraycopy(src, 0, out, 0, Math.min(src.length, 32));
        return out;
    }

    /**
     * 生成 JWT。
     * <p>⚠️ 不要使用 {@code .claims(Map)}：在 jjwt 0.12.x 中该方法是"完整替换"语义，
     * 会把之前 {@link #generate} 通过 {@code .subject()} / {@code .claim()} 设置的
     * sub/username 全部清空，导致 gateway 解析后 {@code claims.getSubject()} 为 null，
     * X-User-Id 丢失，下游 UserContextHolder 拿不到用户 ID（errorConclude: user_id 永远为 null）。
     * 统一改为逐条 {@code .claim(key, value)} 调用，语义为追加。</p>
     *
     *一个标准的JWT通常包含以下几个部分：
     * 1. Header（头部）：包含了令牌的类型（通常是JWT）和所使用的签名算法（如HS256）。
     * 2. Payload（负载）：包含了实际的数据（称为claims），如用户ID、用户名、角色等信息。这个部分是JWT的主体内容。
     * 3. Signature（签名）：由Header和Payload经过编码后，使用指定的算法和密钥进行签名生成的字符串，用于验证JWT的完整性和真实性。
     *
     * @param userId   用户 ID（写入 sub）
     * @param username 用户名（写入 claim）
     * @param extra    附加 claims（如 roles），可为 null
     * @return 签名后的紧凑 token 字符串
     */
    public GeneratedToken generate(Long userId, String username, Map<String, Object> extra) {
        String jti = UUID.randomUUID().toString();
        Date now = new Date();
        var builder = Jwts.builder()
                .id(jti)                                // JWT 的 jti（id）字段，单点登录强制时由 gateway 比对 Redis 中"当前 jti"
                .subject(String.valueOf(userId))        // JWT 的 sub（subject）字段写 userId，作为"这个 token 代表谁"的主键
                .claim("username", username)         // 额外写个 username claim，方便调试和日志记录；gateway 不使用该字段
                .issuedAt(now)                          // 签发时间
                .expiration(new Date(now.getTime() + expirationMs));    // 过期时间
        if (extra != null) {
            for (Map.Entry<String, Object> e : extra.entrySet()) {
                // 跳过保留字段，避免意外覆盖 sub/iat/exp/jti
                String k = e.getKey();
                if ("sub".equals(k) || "iat".equals(k) || "exp".equals(k) || "jti".equals(k)) continue;
                builder.claim(k, e.getValue());
            }
        }
        return new GeneratedToken(builder.signWith(key).compact(), jti);
    }

    /**
     * 签发结果：紧凑 JWT 字符串 + 同步生成的 jti。
     * 调用方（auth 服务）需要把 jti 写到 Redis 作为"当前会话标识"，gateway 再据此校验单点登录。
     */
    public record GeneratedToken(String token, String jti) {}

    /**
     * 校验并解析 JWT。
     *
     * @param token JWT 字符串
     * @return 解析后的 Claims
     * @throws io.jsonwebtoken.JwtException 签名错误/过期/格式异常
     */
    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
