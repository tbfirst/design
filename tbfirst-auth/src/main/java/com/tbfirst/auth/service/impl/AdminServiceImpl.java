package com.tbfirst.auth.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.auth.client.ImageStatsClient;
import com.tbfirst.auth.dto.AuthDtos;
import com.tbfirst.auth.entity.ShareGroup;
import com.tbfirst.auth.entity.User;
import com.tbfirst.auth.mapper.ShareGroupMapper;
import com.tbfirst.auth.mapper.UserMapper;
import com.tbfirst.auth.service.AdminService;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.core.response.R;
import com.tbfirst.common.security.context.UserContextHolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 管理员服务实现。
 *
 * <p><b>职责：</b>{@link AdminService} 的唯一实现。
 * 覆盖用户全生命周期的 CRUD + 审核动作。所有写方法均标注 @Transactional，
 * 多张表可能同时写（如 deleteUser 仅动 sys_user，但 updateStatus 等逻辑视后续扩展可能级联）。</p>
 *
 * <p><b>跨服务依赖：</b>{@link ImageStatsClient} 是 Feign 客户端 ——
 * 调用 tbfirst-image 的 /internal/stats/generation-count 接口聚合每人生成数。
 * 该调用失败时走 try-catch 降级为空 map（不影响用户列表主流程）。</p>
 *
 * <p><b>事务约定：</b>@Transactional 留在 Impl 方法上（非接口），Spring 默认 CGLIB 代理生效。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminServiceImpl implements AdminService {

    private final UserMapper userMapper;
    private final ShareGroupMapper groupMapper;
    private final ImageStatsClient imageStatsClient;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    /**
     * 列出所有未软删用户并聚合 image 服务的 total_generations。
     */
    public List<AuthDtos.UserResponse> listUsers() {
        // SQL: SELECT * FROM auth.sys_user WHERE deleted = 0
        // (BaseEntity中使用 @TableLogic 自动拼 deleted=0；wrapper=null 表示无业务过滤)
        List<User> raw = userMapper.selectList(null);
        if (raw.isEmpty()) {
            return Collections.emptyList();
        }

        Set<Long> groupIds = raw.stream()
                .map(User::getGroupId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        // SQL: SELECT * FROM auth.share_group WHERE id IN (?, ?, ...) AND status = 'active' AND deleted = 0
        // 防御：archived 组不再出现在用户列表的"共享组"列，回落到 — 显示。
        // 若 user.group_id 指向 archived（V8 迁移 + invite 防御应已清空，此处兜底），idToName 查不到
        // 就让前端按"无组"展示，避免管理员看到"幽灵成员"。
        Map<Long, String> idToName = groupIds.isEmpty() ? Map.of() :
                groupMapper.selectList(new LambdaQueryWrapper<ShareGroup>()
                                .in(ShareGroup::getId, groupIds)
                                .eq(ShareGroup::getStatus, "active"))
                        .stream()
                        .collect(Collectors.toMap(ShareGroup::getId, ShareGroup::getName));

        List<AuthDtos.UserResponse> users = raw.stream()
                .map(u -> {
                    AuthDtos.UserResponse r = userToUserResponse(u);
                    if (u.getGroupId() != null) {
                        r.setGroupName(idToName.get(u.getGroupId()));
                    }
                    return r;
                })
                .toList();

        Map<String, Long> generationCount = fetchGenerationCount(users.stream()
                .map(AuthDtos.UserResponse::getId)
                .toList());
        users.forEach(u -> u.setTotalGenerations(generationCount.getOrDefault(String.valueOf(u.getId()), 0L)));
        return users;
    }

    private Map<String, Long> fetchGenerationCount(List<Long> userIds) {
        try {
            R<Map<String, Long>> resp = imageStatsClient.generationCount(userIds);
            if (resp == null) {
                log.warn("[Auth] generation count response is null, fallback to empty");
                return Collections.emptyMap();
            }
            if (resp.getCode() != 0) {
                log.warn("[Auth] generation count biz error code={} msg={}", resp.getCode(), resp.getMsg());
                return Collections.emptyMap();
            }
            if (resp.getData() == null) {
                return Collections.emptyMap();
            }
            log.debug("[Auth] fetched generation count, size={}", resp.getData().size());
            return resp.getData();
        } catch (Exception e) {
            log.warn("[Auth] fetch generation count from image failed", e);
            return Collections.emptyMap();
        }
    }

    /**
     * Admin 直接创建用户，跳过 pending 审核。
     */
    @Transactional
    public AuthDtos.UserResponse createUser(AuthDtos.CreateUserRequest req) {
        // SQL: SELECT COUNT(*) FROM auth.sys_user WHERE username = ? AND deleted = 0
        if (userMapper.selectCount(new LambdaQueryWrapper<User>().eq(User::getUsername, req.getUsername())) > 0) {
            throw new BizException(ErrorCode.CONFLICT, "用户名已存在");
        }
        String email = req.getEmail() == null ? null : req.getEmail().trim();
        if (email != null && email.isEmpty()) email = null;
        // 自定义 XML：SELECT EXISTS(... WHERE LOWER(email)=LOWER(?) AND deleted=0)
        if (email != null && userMapper.existsByEmailIgnoreCaseAndNotDeleted(email)) {
            throw new BizException(ErrorCode.CONFLICT, "邮箱已被注册");
        }
        if (req.getPersonalModelCap() != null && req.getPersonalModelCap() <= 0) {
            throw new BizException(ErrorCode.BAD_REQUEST, "个人模特库容量必须是正整数或 null");
        }
        User u = new User();
        u.setUsername(req.getUsername());
        u.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        u.setNickname(req.getNickname());
        u.setEmail(email);
        u.setRoles(req.getRole());
        u.setStatus("active");
        u.setPersonalModelCap(req.getPersonalModelCap());
        userMapper.insert(u);
        return userToUserResponse(u);
    }

    @Transactional
    public void updateStatus(Long id, String status) {
        User u = findUser(id);
        Long currentUserId = UserContextHolder.currentUserId();
        if (currentUserId != null && currentUserId.equals(id)) {
            throw new BizException(ErrorCode.BAD_REQUEST, "不能修改自己的状态");
        }
        u.setStatus(status);
        userMapper.updateById(u);
    }

    public List<AuthDtos.UserResponse> listPendingRegistrations() {
        // SQL: SELECT * FROM auth.sys_user WHERE status = 'pending' AND deleted = 0
        List<User> pending = userMapper.selectList(
                new LambdaQueryWrapper<User>().eq(User::getStatus, "pending"));
        return pending.stream().map(this::userToUserResponse).toList();
    }

    @Transactional
    public void approveRegistration(Long id) {
        User u = findUser(id);
        if (!"pending".equals(u.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "用户当前状态不是 pending，无需审批");
        }
        u.setStatus("active");
        userMapper.updateById(u);
    }

    @Transactional
    public void rejectRegistration(Long id, String note) {
        User u = findUser(id);
        if (!"pending".equals(u.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "用户当前状态不是 pending，无需审批");
        }
        u.setStatus("disabled");
        userMapper.updateById(u);
        log.info("[Admin] reject registration userId={} username={} note={}",
                u.getId(), u.getUsername(), note == null ? "" : note);
    }

    @Transactional
    public void updatePersonalModelCap(Long id, Integer cap) {
        if (cap != null && cap <= 0) {
            throw new BizException(ErrorCode.BAD_REQUEST, "容量必须是正整数或 null");
        }
        User u = findUser(id);
        u.setPersonalModelCap(cap);
        userMapper.updateById(u);
    }

    @Transactional
    public void resetPassword(Long id, String newPassword) {
        User u = findUser(id);
        u.setPasswordHash(passwordEncoder.encode(newPassword));
        userMapper.updateById(u);
    }

    @Transactional
    public void deleteUser(Long id) {
        Long currentUserId = UserContextHolder.currentUserId();
        if (currentUserId != null && currentUserId.equals(id)) {
            throw new BizException(ErrorCode.BAD_REQUEST, "不能删除自己");
        }
        // 先确认用户存在；@TableLogic 会把 deleteById 转成 UPDATE deleted = 1
        findUser(id);
        // SQL (@TableLogic): UPDATE auth.sys_user SET deleted = 1, update_time = now(), update_by = ? WHERE id = ? AND deleted = 0
        userMapper.deleteById(id);
    }

    private User findUser(Long id) {
        // SQL: SELECT * FROM auth.sys_user WHERE id = ? AND deleted = 0
        User u = userMapper.selectById(id);
        if (u == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "用户不存在");
        }
        return u;
    }

    private AuthDtos.UserResponse userToUserResponse(User u) {
        AuthDtos.UserResponse r = new AuthDtos.UserResponse();
        r.setId(u.getId());
        r.setUsername(u.getUsername());
        r.setNickname(u.getNickname());
        r.setEmail(u.getEmail());
        r.setRoles(u.getRoles());
        r.setStatus(u.getStatus());
        r.setLastActiveAt(u.getLastActiveAt());
        r.setCreateTime(u.getCreateTime());
        r.setGroupId(u.getGroupId());
        r.setGroupRole(u.getGroupRole());
        r.setPersonalModelCap(u.getPersonalModelCap());
        if (u.getGroupId() != null) {
            // SQL: SELECT * FROM auth.share_group WHERE id = ? AND deleted = 0
            ShareGroup g = groupMapper.selectById(u.getGroupId());
            if (g != null) r.setGroupName(g.getName());
        }
        return r;
    }
}
