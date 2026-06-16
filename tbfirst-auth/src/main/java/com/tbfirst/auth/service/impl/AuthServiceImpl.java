package com.tbfirst.auth.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.auth.dto.AuthDtos;
import com.tbfirst.auth.entity.ShareGroup;
import com.tbfirst.auth.entity.User;
import com.tbfirst.auth.mapper.ShareGroupMapper;
import com.tbfirst.auth.mapper.UserMapper;
import com.tbfirst.auth.service.AuthService;
import com.tbfirst.auth.service.GroupService;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.security.jwt.JwtUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.Map;

/**
 * 认证服务实现。
 *
 * <p><b>职责：</b>{@link AuthService} 的唯一实现，承担用户"注册 / 登录 / 刷新 token"三个动作。
 * 本类不处理业务权限（角色判定由 gateway + UserContextFilter 负责），只做：
 * 凭证校验 → BCrypt hash / match → JWT 签发 → last_active_at 更新。</p>
 *
 * <p><b>事务边界：</b>register 为 @Transactional（含可能的内嵌 applyGroup 写入），
 * login / refresh 读多写少（最后只更新 last_active_at）未声明事务，依赖 JDBC 默认 auto-commit。</p>
 *
 * <p><b>关键依赖：</b>
 * {@link UserMapper}（用户表）、
 * {@link ShareGroupMapper}（读组 model_cap 填进 JWT claims）、
 * {@link GroupService}（注册时顺带提交 group_application）、
 * {@link JwtUtil}（HS256 签发，密钥与过期从配置 app.jwt.* 注入）。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final UserMapper userMapper;
    private final ShareGroupMapper groupMapper;
    private final GroupService groupService;
    private final StringRedisTemplate redis;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    /**
     * 单点登录会话键格式：tbfirst:session:user:{userId} → 当前 jti（UUID）。
     * gateway 在 {@code AuthGlobalFilter} 中按 userId 拼 key、比对 jti，不一致即视为旧 token，401。
     * TTL = JWT 过期时长，token 自然过期则 key 自动清理，无需后台清理任务。
     */
    static final String SESSION_KEY_PREFIX = "tbfirst:session:user:";

    static String sessionKey(Long userId) {
        return SESSION_KEY_PREFIX + userId;
    }

    @Value("${app.jwt.secret:oumUxneCYI3+bJVH3PnaVyxhXrVCjUMbu8zb9kO1hUU=}")
    private String jwtSecret;

    @Value("${app.jwt.expiration-ms:86400000}")
    private long expirationMs;

    /**
     * 用户注册。新用户落库为 pending，等待一级管理员审批；可选同事务提交建组申请。
     */
    @Transactional
    public AuthDtos.TokenResponse register(AuthDtos.RegisterRequest req) {
        if (existsByUsername(req.getUsername())) {
            throw new BizException(ErrorCode.CONFLICT, "用户名已存在");
        }
        String email = req.getEmail() == null ? null : req.getEmail().trim();
        if (email == null || email.isEmpty()) {
            throw new BizException(ErrorCode.BAD_REQUEST, "邮箱必填");
        }
        if (userMapper.existsByEmailIgnoreCaseAndNotDeleted(email)) {
            throw new BizException(ErrorCode.CONFLICT, "邮箱已被注册");
        }
        User u = new User();
        u.setUsername(req.getUsername());
        u.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        u.setNickname(req.getNickname());
        u.setEmail(email);
        u.setRoles("USER");
        u.setStatus("pending");
        userMapper.insert(u);

        Long pendingAppId = null;
        if (req.getApplyGroup() != null) {
            pendingAppId = groupService
                    .apply(u.getId(), req.getApplyGroup().getName(), req.getApplyGroup().getDescription())
                    .getId();
        }

        AuthDtos.TokenResponse r = new AuthDtos.TokenResponse();
        r.setUsername(u.getUsername());
        r.setUserId(u.getId());
        r.setRoles(u.getRoles());
        r.setStatus(u.getStatus());
        r.setPendingRegistrationId(u.getId());
        if (pendingAppId != null) r.setPendingApplicationId(pendingAppId);
        return r;
    }

    public AuthDtos.TokenResponse login(AuthDtos.LoginRequest req) {
        User u = findByUsername(req.getUsername());
        if (u == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "用户不存在");
        }
        if (!passwordEncoder.matches(req.getPassword(), u.getPasswordHash())) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "密码错误");
        }
        return issue(u);
    }

    public AuthDtos.TokenResponse refresh(Long userId) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "用户不存在");
        }
        return issue(u);
    }

    @Override
    public void logout(Long userId) {
        if (userId == null) {
            return;
        }
        try {
            Boolean deleted = redis.delete(sessionKey(userId));
            log.info("[Auth] logout user {} (redis key deleted={})", userId, deleted);
        } catch (Exception e) {
            log.warn("[Auth] logout user {} redis delete failed: {}", userId, e.getMessage());
        }
    }

    private AuthDtos.TokenResponse issue(User u) {
        if ("pending".equals(u.getStatus())) {
            throw new BizException(ErrorCode.FORBIDDEN, "账号待一级管理员审核通过后方可登录");
        }
        if (!"active".equals(u.getStatus())) {
            throw new BizException(ErrorCode.FORBIDDEN, "账号已被禁用");
        }

        JwtUtil jwt = new JwtUtil(jwtSecret, expirationMs);
        Map<String, Object> claims = new java.util.HashMap<>();
        claims.put("roles", u.getRoles() != null ? u.getRoles() : "USER");
        Integer groupModelCap = null;
        if (u.getGroupId() != null) {
            claims.put("groupId", u.getGroupId());
            claims.put("groupRole", u.getGroupRole() != null ? u.getGroupRole() : "member");
            ShareGroup g = groupMapper.selectById(u.getGroupId());
            if (g != null) {
                groupModelCap = g.getModelCap();
                if (groupModelCap != null) claims.put("groupModelCap", groupModelCap);
            }
        }
        if (u.getPersonalModelCap() != null) {
            claims.put("personalModelCap", u.getPersonalModelCap());
        }
        JwtUtil.GeneratedToken gt = jwt.generate(u.getId(), u.getUsername(), claims);

        // 写入 Redis 单点登录会话键：覆盖语义 → 旧 token 的 jti 被顶替 → 旧 token 下一次过网关时 jti 不匹配 → 401，挤号生效。
        // TTL 与 JWT 过期一致，避免脏数据残留。
        try {
            redis.opsForValue().set(sessionKey(u.getId()), gt.jti(), Duration.ofMillis(expirationMs));
        } catch (Exception e) {
            // Redis 暂时不可达不阻塞登录；网关侧采用 fail-closed（key 不存在则 401），
            // 用户最多重试一次即可恢复。
            log.warn("[Auth] write session key failed for user {}: {}", u.getId(), e.getMessage());
        }

        AuthDtos.TokenResponse r = new AuthDtos.TokenResponse();
        r.setToken(gt.token());
        r.setExpiresAt(System.currentTimeMillis() + expirationMs);
        r.setUsername(u.getUsername());
        r.setUserId(u.getId());
        r.setRoles(u.getRoles());
        r.setStatus(u.getStatus());
        r.setGroupId(u.getGroupId());
        r.setGroupRole(u.getGroupRole());
        r.setPersonalModelCap(u.getPersonalModelCap());
        r.setGroupModelCap(groupModelCap);
        if (u.getGroupId() != null) {
            ShareGroup g = groupMapper.selectById(u.getGroupId());
            if (g != null) r.setGroupName(g.getName());
        }

        u.setLastActiveAt(java.time.LocalDateTime.now());
        userMapper.updateById(u);

        return r;
    }

    private User findByUsername(String username) {
        // SQL: SELECT * FROM auth.sys_user WHERE username = ? AND deleted = 0 LIMIT 1
        //      (deleted=0 由 @TableLogic 自动拼接)
        return userMapper.selectOne(new LambdaQueryWrapper<User>().eq(User::getUsername, username));
    }

    private boolean existsByUsername(String username) {
        // SQL: SELECT COUNT(*) FROM auth.sys_user WHERE username = ? AND deleted = 0
        return userMapper.selectCount(new LambdaQueryWrapper<User>().eq(User::getUsername, username)) > 0;
    }
}
