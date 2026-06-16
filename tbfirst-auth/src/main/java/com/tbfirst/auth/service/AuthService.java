package com.tbfirst.auth.service;

import com.tbfirst.auth.dto.AuthDtos;

/**
 * 认证服务接口。
 *
 * <p><b>职责：</b>面向终端用户的登录/注册/刷新能力。
 * 所有接口只处理"凭证 ↔ Token"的转换，不做业务权限判定；
 * 业务权限由网关 + UserContextFilter + 角色头合作完成。</p>
 *
 * <p><b>注册流程（dual path）：</b></p>
 * <ul>
 *   <li>普通用户注册 → {@link #register(AuthDtos.RegisterRequest)} → 落库 status=pending，
 *       等一级管理员在 AdminService 中 approve。</li>
 *   <li>管理员直接建号 → 走 AdminService.createUser → 落库 status=active，跳过审核。</li>
 * </ul>
 */
public interface AuthService {

    /**
     * 注册新用户（普通路径）。
     *
     * <p>行为：校验邮箱/用户名唯一、BCrypt 哈希密码、写入 sys_user（status=pending）。
     * 若 req.applyGroup 非空，会同步写一条 group_application（status=pending）。
     * 当前实现<b>不签发 token</b>，返回体中 token 字段为占位，待 admin approve 后用户需重新登录。</p>
     *
     * @param req 注册入参（username / email / password / nickname / 可选 applyGroup）
     * @return 占位 TokenResponse（token 字段可能为 null，前端按 status=pending 逻辑处理）
     * @throws com.tbfirst.common.core.exception.BizException 邮箱或用户名重复、参数非法
     */
    AuthDtos.TokenResponse register(AuthDtos.RegisterRequest req);

    /**
     * 登录并签发 JWT。
     *
     * <p>邮箱大小写不敏感匹配（LOWER(email) = LOWER(?)）；密码走 BCrypt 校验；
     * status != active 的用户会被拒绝（pending/banned/rejected）。</p>
     *
     * @param req 登录入参（usernameOrEmail / password）
     * @return TokenResponse，含 HS256 JWT（默认 12h 过期）及用户概要
     * @throws com.tbfirst.common.core.exception.BizException 用户不存在、密码错误、账号未激活
     */
    AuthDtos.TokenResponse login(AuthDtos.LoginRequest req);

    /**
     * 用既有有效身份续签 JWT。
     *
     * <p>仅当 UserContextFilter 已解析到合法 userId 时调用（由网关鉴权保证）。
     * 本接口不检查密码，只根据 userId 重查 sys_user 重签 token。</p>
     *
     * @param userId 当前已登录用户 id（来源：X-User-Id header）
     * @return 新的 TokenResponse
     */
    AuthDtos.TokenResponse refresh(Long userId);

    /**
     * 主动登出：清除该用户在 Redis 中的当前会话标识，下次再带任何 token 经网关都会 401。
     *
     * <p>幂等：用户不存在 / Redis 无 key 时不抛错。</p>
     *
     * @param userId 当前已登录用户 id（来源：X-User-Id header）
     */
    void logout(Long userId);
}
