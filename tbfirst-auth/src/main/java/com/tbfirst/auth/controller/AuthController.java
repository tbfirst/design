package com.tbfirst.auth.controller;

import com.tbfirst.auth.dto.AuthDtos;
import com.tbfirst.auth.service.AuthService;
import com.tbfirst.common.core.response.R;
import com.tbfirst.common.security.context.UserContext;
import com.tbfirst.common.security.context.UserContextHolder;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 认证相关 REST 接口控制器。
 *
 * <p>架构角色：面向前端暴露登录、注册、当前用户查询等公开接口，
 * 位于 auth 服务的表现层，仅做参数校验与编排，不含业务逻辑。</p>
 *
 * <p>路由前缀：{@code /api/auth}。网关白名单中放行了 login/register/refresh。</p>
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    /**
     * 用户注册。
     * 可选参数 applyGroup：注册时同时提交"成立共享组"申请，进入 pending 状态；
     * 普通注册直接签发 token，可立即登录使用。
     *
     * @param req 注册请求，包含用户名、密码、昵称、邮箱、可选的 applyGroup
     * @return 统一响应体；若带 applyGroup 则不返回 token，仅 pendingApplicationId
     */
    @PostMapping("/register")
    public R<AuthDtos.TokenResponse> register(@Valid @RequestBody AuthDtos.RegisterRequest req) {
        return R.ok(authService.register(req));
    }

    /**
     * 重新签发 token。
     * 用途：组成员资格发生变化（批准建组 / 加入 / 被踢 / 解散）后，前端调本接口换新 token，
     * 使得后续请求携带正确的 X-User-Group-Id 头。
     */
    @PostMapping("/refresh")
    public R<AuthDtos.TokenResponse> refresh() {
        Long uid = UserContextHolder.currentUserId();
        if (uid == null) {
            throw new com.tbfirst.common.core.exception.BizException(
                    com.tbfirst.common.core.response.ErrorCode.UNAUTHORIZED, "未登录");
        }
        return R.ok(authService.refresh(uid));
    }

    /**
     * 用户登录接口。校验账号密码后签发 JWT。
     *
     * @param req 登录请求，包含用户名、密码
     * @return 统一响应体，成功时携带 token、过期时间、角色、权限等
     */
    @PostMapping("/login")
    public R<AuthDtos.TokenResponse> login(@Valid @RequestBody AuthDtos.LoginRequest req) {
        return R.ok(authService.login(req));
    }

    /**
     * 获取当前登录用户信息。
     * 依赖网关/过滤器事先把 X-User-* 请求头解析到 {@link UserContextHolder} ThreadLocal。
     *
     * @return 当前用户上下文
     */
    @GetMapping("/me")
    public R<UserContext> me() {
        return R.ok(UserContextHolder.get());
    }

    /**
     * 主动登出。清除 Redis 中该用户的当前会话 jti，旧 token 下次过网关即 401。
     *
     * <p>幂等：未登录 / Redis 已无 key 也返回 ok。前端在跳登录页前先调本接口，失败不阻塞。</p>
     */
    @PostMapping("/logout")
    public R<Void> logout() {
        Long uid = UserContextHolder.currentUserId();
        authService.logout(uid);
        return R.ok();
    }
}
