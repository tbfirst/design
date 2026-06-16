package com.tbfirst.auth.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.tbfirst.auth.dto.GroupDtos;
import com.tbfirst.auth.entity.GroupApplication;
import com.tbfirst.auth.entity.GroupCapacityApplication;
import com.tbfirst.auth.entity.GroupInvitation;
import com.tbfirst.auth.entity.ShareGroup;
import com.tbfirst.auth.entity.User;
import com.tbfirst.auth.mapper.GroupApplicationMapper;
import com.tbfirst.auth.mapper.GroupCapacityApplicationMapper;
import com.tbfirst.auth.mapper.GroupInvitationMapper;
import com.tbfirst.auth.mapper.ShareGroupMapper;
import com.tbfirst.auth.mapper.UserMapper;
import com.tbfirst.auth.service.GroupService;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 资源共享组业务服务实现。
 *
 * <p><b>职责：</b>{@link GroupService} 的唯一实现。
 * 覆盖"申请成组 / 审批 / 邀请成员 / 响应 / 踢人 / 解散 / 扩容申请"等全部组生命周期操作。</p>
 *
 * <p><b>事务约定：</b>所有写路径均 @Transactional；读路径（listXxx / getMyGroup）无事务。
 * 内部跨 Mapper 的 INSERT/UPDATE（如 approveApplication 同时写 share_group + sys_user + group_application）
 * 依赖同一事务保证原子性。</p>
 *
 * <p><b>依赖 Mapper：</b>5 张表 —— sys_user / share_group / group_application /
 * group_invitation / group_capacity_application；没有实体级 @OneToMany，全部用 Long 外键反规范化。</p>
 *
 * <p><b>重要业务规则：</b></p>
 * <ul>
 *   <li>一人最多在一个组内（user.group_id 唯一约束）；</li>
 *   <li>同一人同一时刻只能有一条 pending 邀请；</li>
 *   <li>leader 不能 leave，只能 dissolve（否则组无主）；</li>
 *   <li>dissolve 走归档（status=archived），不物理删组，保留历史审计性。</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupServiceImpl implements GroupService {

    private final UserMapper userMapper;
    private final ShareGroupMapper groupMapper;
    private final GroupApplicationMapper applicationMapper;
    private final GroupInvitationMapper invitationMapper;
    private final GroupCapacityApplicationMapper capacityApplicationMapper;
    private final StringRedisTemplate redis;

    /** 与 AuthServiceImpl 保持一致的会话键前缀，kick/dissolve 时清掉被波及成员的当前 jti，强制其下线。 */
    private static final String SESSION_KEY_PREFIX = "tbfirst:session:user:";

    // ============================================================
    // 申请 & 审批
    // ============================================================

    /**
     * 用户申请创建共享组。
     * 申请提交后进入 pending 状态，等待管理员审批。
     *
     * @param applicantId
     * @param proposedName
     * @param description
     * @return
     */
    @Transactional
    public GroupApplication apply(Long applicantId, String proposedName, String description) {
        User applicant = requireUser(applicantId);
        if (applicant.getGroupId() != null) {
            throw new BizException(ErrorCode.CONFLICT, "已属于某个组，不能重复申请");
        }
        // SQL: SELECT * FROM auth.group_application
        //      WHERE applicant_id = ? AND status = 'pending' AND deleted = 0 LIMIT 1
        GroupApplication existing = applicationMapper.selectOne(new LambdaQueryWrapper<GroupApplication>()
                .eq(GroupApplication::getApplicantId, applicantId)
                .eq(GroupApplication::getStatus, "pending")
                .last("LIMIT 1"));
        if (existing != null) {
            throw new BizException(ErrorCode.CONFLICT, "已有待审批的申请，请勿重复提交");
        }
        // SQL: SELECT COUNT(*) FROM auth.share_group WHERE name = ? AND deleted = 0
        if (groupMapper.selectCount(new LambdaQueryWrapper<ShareGroup>().eq(ShareGroup::getName, proposedName)) > 0) {
            throw new BizException(ErrorCode.CONFLICT, "组名已被占用");
        }
        GroupApplication app = new GroupApplication();
        app.setApplicantId(applicantId);
        app.setProposedName(proposedName);
        app.setProposedDescription(description);
        app.setStatus("pending");
        applicationMapper.insert(app);
        return app;
    }

    /**
     * 管理员审批组创建申请。
     *
     * @param applicationId
     * @param reviewerId
     * @param finalName
     * @return
     */
    @Transactional
    public ShareGroup approveApplication(Long applicationId, Long reviewerId, String finalName) {
        GroupApplication app = applicationMapper.selectById(applicationId);
        if (app == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "申请不存在");
        }
        if (!"pending".equals(app.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "申请已被处理");
        }
        User applicant = requireUser(app.getApplicantId());
        if (applicant.getGroupId() != null) {
            throw new BizException(ErrorCode.CONFLICT, "申请人已属于其他组，无法创建新组");
        }
        String nameToUse = (finalName != null && !finalName.isBlank())
                ? finalName.trim() : app.getProposedName();
        // SQL: SELECT COUNT(*) FROM auth.share_group WHERE name = ? AND deleted = 0
        if (groupMapper.selectCount(new LambdaQueryWrapper<ShareGroup>().eq(ShareGroup::getName, nameToUse)) > 0) {
            throw new BizException(ErrorCode.CONFLICT, "组名冲突：" + nameToUse);
        }
        ShareGroup g = new ShareGroup();
        g.setName(nameToUse);
        g.setDescription(app.getProposedDescription());
        g.setLeaderId(applicant.getId());
        g.setStatus("active");
        g.setMemberCount(1);
        groupMapper.insert(g);

        applicant.setGroupId(g.getId());
        applicant.setGroupRole("leader");
        userMapper.updateById(applicant);

        app.setStatus("approved");
        app.setReviewerId(reviewerId);
        app.setReviewTime(LocalDateTime.now());
        app.setApprovedGroupId(g.getId());
        applicationMapper.updateById(app);

        log.info("[Group] application {} approved -> group {} ({}), leader = {}",
                applicationId, g.getId(), nameToUse, applicant.getId());
        return g;
    }

    @Transactional
    public void rejectApplication(Long applicationId, Long reviewerId, String note) {
        GroupApplication app = applicationMapper.selectById(applicationId);
        if (app == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "申请不存在");
        }
        if (!"pending".equals(app.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "申请已被处理");
        }
        app.setStatus("rejected");
        app.setReviewerId(reviewerId);
        app.setReviewNote(note);
        app.setReviewTime(LocalDateTime.now());
        applicationMapper.updateById(app);
    }

    @Transactional
    public ShareGroup adminDirectCreate(Long adminUserId, String name, String description) {
        User admin = requireUser(adminUserId);
        if (admin.getGroupId() != null) {
            throw new BizException(ErrorCode.CONFLICT, "你已属于某个组，请先退组或解散后再新建");
        }
        // SQL: SELECT COUNT(*) FROM auth.share_group WHERE name = ? AND deleted = 0
        if (groupMapper.selectCount(new LambdaQueryWrapper<ShareGroup>().eq(ShareGroup::getName, name)) > 0) {
            throw new BizException(ErrorCode.CONFLICT, "组名已被占用");
        }
        ShareGroup g = new ShareGroup();
        g.setName(name);
        g.setDescription(description);
        g.setLeaderId(admin.getId());
        g.setStatus("active");
        g.setMemberCount(1);
        groupMapper.insert(g);

        admin.setGroupId(g.getId());
        admin.setGroupRole("leader");
        userMapper.updateById(admin);

        log.info("[Group] admin {} directly created group {} ({})", adminUserId, g.getId(), name);
        return g;
    }

    public List<GroupDtos.GroupBriefResponse> listAllGroupsForAdmin() {
        // SQL: SELECT * FROM auth.share_group WHERE deleted = 0 ORDER BY id DESC
        List<ShareGroup> all = groupMapper.selectList(
                new LambdaQueryWrapper<ShareGroup>().orderByDesc(ShareGroup::getId));
        if (all.isEmpty()) return List.of();
        List<Long> leaderIds = all.stream().map(ShareGroup::getLeaderId).toList();
        // SQL: SELECT * FROM auth.sys_user WHERE id IN (?, ?, ...) AND deleted = 0
        Map<Long, User> leaders = userMapper.selectBatchIds(leaderIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u));
        return all.stream().map(g -> {
            GroupDtos.GroupBriefResponse r = new GroupDtos.GroupBriefResponse();
            r.setGroupId(g.getId());
            r.setName(g.getName());
            r.setDescription(g.getDescription());
            r.setStatus(g.getStatus());
            r.setMemberCount(g.getMemberCount());
            r.setLeaderId(g.getLeaderId());
            User leader = leaders.get(g.getLeaderId());
            if (leader != null) r.setLeaderUsername(leader.getUsername());
            r.setModelCap(g.getModelCap());
            r.setCreateTime(g.getCreateTime());
            return r;
        }).toList();
    }

    @Transactional
    public void updateGroupModelCap(Long groupId, Integer cap) {
        if (cap != null && cap <= 0) {
            throw new BizException(ErrorCode.BAD_REQUEST, "容量必须是正整数");
        }
        ShareGroup g = requireGroup(groupId);
        g.setModelCap(cap);
        groupMapper.updateById(g);
    }

    public List<GroupDtos.GroupApplicationResponse> listApplications(String status) {
        String s = (status == null || status.isBlank()) ? "pending" : status;
        // SQL: SELECT * FROM auth.group_application
        //      WHERE status = ? AND deleted = 0 ORDER BY id DESC
        List<GroupApplication> apps = applicationMapper.selectList(
                new LambdaQueryWrapper<GroupApplication>()
                        .eq(GroupApplication::getStatus, s)
                        .orderByDesc(GroupApplication::getId));
        if (apps.isEmpty()) return List.of();
        List<Long> ids = apps.stream().map(GroupApplication::getApplicantId).toList();
        // SQL: SELECT * FROM auth.sys_user WHERE id IN (?, ?, ...) AND deleted = 0
        Map<Long, User> userMap = userMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(User::getId, u -> u));
        return apps.stream().map(a -> toApplicationResponse(a, userMap.get(a.getApplicantId()))).toList();
    }

    // ============================================================
    // 邀请 & 接受
    // ============================================================

    @Transactional
    public GroupInvitation invite(Long groupId, Long inviterId, String inviteeEmail,
                                  String inviteeUsername, Long inviteeId) {
        ShareGroup g = requireActiveGroup(groupId);
        if (!g.getLeaderId().equals(inviterId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "只有组长才能邀请");
        }
        User invitee;
        // 组长输入的 email 原文（小写归一化后）要落进 invitation.invitee_email 做 snapshot
        String emailSnapshot = null;
        if (inviteeEmail != null && !inviteeEmail.isBlank()) {
            emailSnapshot = inviteeEmail.trim().toLowerCase();
            // 自定义 XML：SELECT * FROM auth.sys_user
            //             WHERE LOWER(email) = LOWER(?) AND deleted = 0 LIMIT 1
            invitee = userMapper.findByEmailIgnoreCaseAndNotDeleted(emailSnapshot);
            if (invitee == null) {
                throw new BizException(ErrorCode.NOT_FOUND, "未找到该邮箱对应的用户");
            }
        } else if (inviteeId != null) {
            // SQL: SELECT * FROM auth.sys_user WHERE id = ? AND deleted = 0
            invitee = userMapper.selectById(inviteeId);
            if (invitee == null) {
                throw new BizException(ErrorCode.NOT_FOUND, "被邀请人不存在");
            }
            // 走 id 路径也尽量回写 email snapshot，保证字段一致性
            if (invitee.getEmail() != null) emailSnapshot = invitee.getEmail().toLowerCase();
        } else if (inviteeUsername != null && !inviteeUsername.isBlank()) {
            // SQL: SELECT * FROM auth.sys_user WHERE username = ? AND deleted = 0 LIMIT 1
            invitee = userMapper.selectOne(
                    new LambdaQueryWrapper<User>().eq(User::getUsername, inviteeUsername.trim()));
            if (invitee == null) {
                throw new BizException(ErrorCode.NOT_FOUND, "被邀请人不存在");
            }
            if (invitee.getEmail() != null) emailSnapshot = invitee.getEmail().toLowerCase();
        } else {
            throw new BizException(ErrorCode.BAD_REQUEST, "请提供 inviteeEmail（或 inviteeId / inviteeUsername）");
        }
        if (invitee.getId().equals(inviterId)) {
            throw new BizException(ErrorCode.BAD_REQUEST, "不能邀请自己");
        }
        if (isReallyInActiveGroup(invitee)) {
            throw new BizException(ErrorCode.CONFLICT, "该用户已属于某个组");
        }
        // SQL: SELECT * FROM auth.group_invitation
        //      WHERE invitee_id = ? AND status = 'pending' AND deleted = 0 LIMIT 1
        GroupInvitation pending = invitationMapper.selectOne(new LambdaQueryWrapper<GroupInvitation>()
                .eq(GroupInvitation::getInviteeId, invitee.getId())
                .eq(GroupInvitation::getStatus, "pending")
                .last("LIMIT 1"));
        if (pending != null) {
            throw new BizException(ErrorCode.CONFLICT, "该用户已有其他 pending 邀请");
        }

        GroupInvitation inv = new GroupInvitation();
        inv.setGroupId(groupId);
        inv.setInviterId(inviterId);
        inv.setInviteeId(invitee.getId());
        inv.setInviteeEmail(emailSnapshot);
        inv.setStatus("pending");
        invitationMapper.insert(inv);
        return inv;
    }

    @Transactional
    public void respondInvitation(Long invitationId, Long inviteeId, boolean accept) {
        GroupInvitation inv = invitationMapper.selectById(invitationId);
        if (inv == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "邀请不存在");
        }
        if (!inv.getInviteeId().equals(inviteeId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "只有被邀请人可以响应");
        }
        if (!"pending".equals(inv.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "邀请已被处理");
        }
        inv.setStatus(accept ? "accepted" : "rejected");
        inv.setRespondTime(LocalDateTime.now());
        invitationMapper.updateById(inv);

        if (accept) {
            User invitee = requireUser(inviteeId);
            if (isReallyInActiveGroup(invitee)) {
                throw new BizException(ErrorCode.CONFLICT, "你已属于某个组，请先退出后再加入");
            }
            ShareGroup g = requireActiveGroup(inv.getGroupId());
            invitee.setGroupId(g.getId());
            invitee.setGroupRole("member");
            userMapper.updateById(invitee);
            g.setMemberCount(g.getMemberCount() + 1);
            groupMapper.updateById(g);
        }
    }

    public GroupDtos.GroupInvitationResponse getMyPendingInvitation(Long userId) {
        // SQL: SELECT * FROM auth.group_invitation
        //      WHERE invitee_id = ? AND status = 'pending' AND deleted = 0 LIMIT 1
        GroupInvitation inv = invitationMapper.selectOne(new LambdaQueryWrapper<GroupInvitation>()
                .eq(GroupInvitation::getInviteeId, userId)
                .eq(GroupInvitation::getStatus, "pending")
                .last("LIMIT 1"));
        return inv == null ? null : toInvitationResponse(inv);
    }

    // ============================================================
    // 成员管理
    // ============================================================

    @Transactional
    public void kick(Long groupId, Long leaderId, Long targetUserId) {
        ShareGroup g = requireActiveGroup(groupId);
        if (!g.getLeaderId().equals(leaderId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "只有组长才能踢人");
        }
        if (leaderId.equals(targetUserId)) {
            throw new BizException(ErrorCode.BAD_REQUEST, "组长不能踢自己；要解散组请用 dissolve");
        }
        User target = requireUser(targetUserId);
        if (target.getGroupId() == null || !target.getGroupId().equals(groupId)) {
            throw new BizException(ErrorCode.CONFLICT, "目标用户不在本组");
        }
        // MyBatis-Plus updateById 默认 FieldStrategy.NOT_NULL 会跳过 null 字段，
        // 这里必须用 LambdaUpdateWrapper 显式 SET 才能把 group_id / group_role 写成 NULL。
        // MetaObjectHandler.updateFill 在 wrapper 路径下仍触发 update_time / update_by 自动填充。
        int rows = userMapper.update(null, new LambdaUpdateWrapper<User>()
                .set(User::getGroupId, null)
                .set(User::getGroupRole, null)
                .eq(User::getId, target.getId()));
        if (rows != 1) {
            throw new BizException(ErrorCode.CONFLICT, "踢人失败（用户状态已变化）");
        }
        g.setMemberCount(Math.max(1, g.getMemberCount() - 1));
        groupMapper.updateById(g);
        // 清掉被踢用户的当前会话 jti，他下次任意请求经网关即 401，被迫重登，新 JWT 不再含 groupId claim。
        invalidateSessions(List.of(targetUserId));
    }

    @Transactional
    public void leave(Long userId) {
        User u = requireUser(userId);
        if (u.getGroupId() == null) {
            throw new BizException(ErrorCode.CONFLICT, "你当前未加入任何组");
        }
        if ("leader".equals(u.getGroupRole())) {
            throw new BizException(ErrorCode.BAD_REQUEST, "组长请使用解散组操作，而非退组");
        }
        ShareGroup g = requireActiveGroup(u.getGroupId());
        // 同 kick：用 wrapper 显式 SET NULL，绕过 updateById 的 NOT_NULL 默认策略。
        int rows = userMapper.update(null, new LambdaUpdateWrapper<User>()
                .set(User::getGroupId, null)
                .set(User::getGroupRole, null)
                .eq(User::getId, u.getId()));
        if (rows != 1) {
            throw new BizException(ErrorCode.CONFLICT, "退组失败（用户状态已变化）");
        }
        g.setMemberCount(Math.max(1, g.getMemberCount() - 1));
        groupMapper.updateById(g);
    }

    @Transactional
    public void dissolve(Long groupId, Long leaderId) {
        ShareGroup g = requireActiveGroup(groupId);
        if (!g.getLeaderId().equals(leaderId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "只有组长才能解散");
        }
        // 先取被波及成员的 id 集合（不含 leader 自己；leader 前端会自行 refresh 拿新 token 重写 Redis）。
        // SQL: SELECT id FROM auth.sys_user WHERE group_id = ? AND id <> ? AND deleted = 0
        List<Long> impactedMemberIds = userMapper.selectList(new LambdaQueryWrapper<User>()
                        .select(User::getId)
                        .eq(User::getGroupId, groupId)
                        .ne(User::getId, leaderId))
                .stream().map(User::getId).toList();

        // 一条批量 UPDATE 直接清空所有 group_id=:groupId 的用户的 group_id / group_role。
        // 必须用 LambdaUpdateWrapper —— updateById(entity) 默认 NOT_NULL 策略会跳过 null 字段，
        // 这是历史 bug 根因（symptom: 解散后 leader 自己 group_id 仍非 NULL，邀请被拒"已有所属"）。
        // SQL: UPDATE auth.sys_user SET group_id=NULL, group_role=NULL, update_time=?, update_by=?
        //      WHERE (group_id = ?) AND deleted=0
        int rows = userMapper.update(null, new LambdaUpdateWrapper<User>()
                .set(User::getGroupId, null)
                .set(User::getGroupRole, null)
                .eq(User::getGroupId, groupId));
        // share_group.leader_id 不清，作为审计溯源用。
        g.setStatus("archived");
        g.setMemberCount(0);
        groupMapper.updateById(g);
        log.info("[Group] dissolved group {} by leader {}, cleared {} members", groupId, leaderId, rows);

        // 强制下线被波及成员：清掉他们的 Redis 会话 jti，下次任意请求即 401 → 重新登录后 JWT 不再含 groupId。
        // leader 自己不清：前端 refreshJwtAndReload 会立刻签新 token 写新 jti 到 Redis，无需清。
        invalidateSessions(impactedMemberIds);
    }

    /**
     * 批量清掉给定用户的当前会话 jti。Redis 不可达不阻塞业务（DB 已经更新，业务一致性由 DB 兜底）。
     */
    private void invalidateSessions(List<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return;
        }
        try {
            List<String> keys = new ArrayList<>(userIds.size());
            for (Long uid : userIds) {
                keys.add(SESSION_KEY_PREFIX + uid);
            }
            Long deleted = redis.delete(keys);
            log.info("[Group] invalidated {} session keys (requested {})", deleted, keys.size());
        } catch (Exception e) {
            log.warn("[Group] invalidate sessions failed for {} users: {}", userIds.size(), e.getMessage());
        }
    }

    // ============================================================
    // 查询
    // ============================================================

    public GroupDtos.MyGroupResponse getMyGroup(Long userId) {
        User u = requireUser(userId);
        if (u.getGroupId() == null) return null;
        // SQL: SELECT * FROM auth.share_group WHERE id = ? AND deleted = 0
        ShareGroup g = groupMapper.selectById(u.getGroupId());
        if (g == null) return null;
        // 防御兜底：DB 残留脏数据（user.group_id 指向 archived 组）情况下不应返回旧组。
        // 根因（dissolve 用 updateById 跳 null）修复后此分支不应被自然触发，保留以兜底历史/未来回归。
        if ("archived".equals(g.getStatus())) {
            log.warn("[Group] user {} still has group_id={} pointing to archived group; returning null",
                    userId, g.getId());
            return null;
        }
        // SQL: SELECT * FROM auth.sys_user WHERE group_id = ? AND deleted = 0 ORDER BY id ASC
        List<User> members = userMapper.selectList(new LambdaQueryWrapper<User>()
                .eq(User::getGroupId, g.getId())
                .orderByAsc(User::getId));
        GroupDtos.MyGroupResponse resp = new GroupDtos.MyGroupResponse();
        resp.setGroupId(g.getId());
        resp.setName(g.getName());
        resp.setDescription(g.getDescription());
        resp.setStatus(g.getStatus());
        resp.setMemberCount(g.getMemberCount());
        resp.setLeaderId(g.getLeaderId());
        resp.setMyRole(u.getGroupRole());
        resp.setMembers(members.stream().map(this::toMemberResponse).toList());
        if ("leader".equals(u.getGroupRole())) {
            // SQL: SELECT * FROM auth.group_invitation
            //      WHERE group_id = ? AND status = 'pending' AND deleted = 0 ORDER BY id DESC
            List<GroupInvitation> pend = invitationMapper.selectList(new LambdaQueryWrapper<GroupInvitation>()
                    .eq(GroupInvitation::getGroupId, g.getId())
                    .eq(GroupInvitation::getStatus, "pending")
                    .orderByDesc(GroupInvitation::getId));
            resp.setPendingInvitations(pend.stream().map(this::toInvitationResponse).toList());
        } else {
            resp.setPendingInvitations(List.of());
        }
        return resp;
    }

    // ============================================================
    // 辅助
    // ============================================================

    private User requireUser(Long userId) {
        // SQL: SELECT * FROM auth.sys_user WHERE id = ? AND deleted = 0
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "用户不存在");
        }
        return u;
    }

    private ShareGroup requireGroup(Long groupId) {
        // SQL: SELECT * FROM auth.share_group WHERE id = ? AND deleted = 0
        ShareGroup g = groupMapper.selectById(groupId);
        if (g == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "组不存在");
        }
        return g;
    }

    private ShareGroup requireActiveGroup(Long groupId) {
        ShareGroup g = requireGroup(groupId);
        if (!"active".equals(g.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "组已归档");
        }
        return g;
    }

    /**
     * 判断用户当前是否真实位于某个 active 共享组。
     * <p>区分"user.group_id 非空"和"真实在某个 active 组里"——前者可能因历史脏数据指向 archived/已删组。
     * 若发现脏数据（group_id 指向非 active 组），顺手清空 + WARN 日志，自愈下次。
     * <p>调用方必须处于 @Transactional 边界内：清洗 UPDATE 会随调用方事务一起提交/回滚。
     */
    private boolean isReallyInActiveGroup(User u) {
        if (u.getGroupId() == null) {
            return false;
        }
        ShareGroup g = groupMapper.selectById(u.getGroupId());
        if (g != null && "active".equals(g.getStatus())) {
            return true;
        }
        log.warn("[Group] user {} has stale group_id={} pointing to non-active group (status={}); clearing",
                u.getId(), u.getGroupId(),
                g == null ? "(soft-deleted or missing)" : g.getStatus());
        userMapper.update(null, new LambdaUpdateWrapper<User>()
                .set(User::getGroupId, null)
                .set(User::getGroupRole, null)
                .eq(User::getId, u.getId()));
        return false;
    }

    private GroupDtos.GroupApplicationResponse toApplicationResponse(GroupApplication app, User applicant) {
        GroupDtos.GroupApplicationResponse r = new GroupDtos.GroupApplicationResponse();
        r.setId(app.getId());
        r.setApplicantId(app.getApplicantId());
        if (applicant != null) {
            r.setApplicantUsername(applicant.getUsername());
            r.setApplicantNickname(applicant.getNickname());
        }
        r.setProposedName(app.getProposedName());
        r.setProposedDescription(app.getProposedDescription());
        r.setStatus(app.getStatus());
        r.setReviewerId(app.getReviewerId());
        r.setReviewNote(app.getReviewNote());
        r.setReviewTime(app.getReviewTime());
        r.setApprovedGroupId(app.getApprovedGroupId());
        r.setCreateTime(app.getCreateTime());
        return r;
    }

    private GroupDtos.GroupInvitationResponse toInvitationResponse(GroupInvitation inv) {
        GroupDtos.GroupInvitationResponse r = new GroupDtos.GroupInvitationResponse();
        r.setId(inv.getId());
        r.setGroupId(inv.getGroupId());
        // SQL: SELECT * FROM auth.share_group WHERE id = ? AND deleted = 0
        ShareGroup g = groupMapper.selectById(inv.getGroupId());
        if (g != null) r.setGroupName(g.getName());
        r.setInviterId(inv.getInviterId());
        // SQL: SELECT * FROM auth.sys_user WHERE id = ? AND deleted = 0
        User inviter = userMapper.selectById(inv.getInviterId());
        if (inviter != null) r.setInviterUsername(inviter.getUsername());
        r.setInviteeId(inv.getInviteeId());
        // SQL: SELECT * FROM auth.sys_user WHERE id = ? AND deleted = 0
        User invitee = userMapper.selectById(inv.getInviteeId());
        if (invitee != null) r.setInviteeUsername(invitee.getUsername());
        r.setInviteeEmail(inv.getInviteeEmail());
        r.setStatus(inv.getStatus());
        r.setCreateTime(inv.getCreateTime());
        r.setRespondTime(inv.getRespondTime());
        return r;
    }

    private GroupDtos.GroupMemberResponse toMemberResponse(User u) {
        GroupDtos.GroupMemberResponse r = new GroupDtos.GroupMemberResponse();
        r.setUserId(u.getId());
        r.setUsername(u.getUsername());
        r.setNickname(u.getNickname());
        r.setRole(u.getGroupRole());
        r.setJoinTime(u.getUpdateTime() != null ? u.getUpdateTime() : u.getCreateTime());
        return r;
    }

    // ============================================================
    // 组扩容申请
    // ============================================================

    @Transactional
    public GroupCapacityApplication submitCapacityApplication(Long applicantId,
                                                              GroupDtos.SubmitCapacityApplicationRequest req) {
        User applicant = requireUser(applicantId);
        if (applicant.getGroupId() == null || !"leader".equals(applicant.getGroupRole())) {
            throw new BizException(ErrorCode.FORBIDDEN, "只有组长才能申请扩容");
        }
        ShareGroup g = requireActiveGroup(applicant.getGroupId());
        // SQL: SELECT * FROM auth.group_capacity_application
        //      WHERE group_id = ? AND status = 'pending' AND deleted = 0 LIMIT 1
        GroupCapacityApplication existing = capacityApplicationMapper.selectOne(
                new LambdaQueryWrapper<GroupCapacityApplication>()
                        .eq(GroupCapacityApplication::getGroupId, g.getId())
                        .eq(GroupCapacityApplication::getStatus, "pending")
                        .last("LIMIT 1"));
        if (existing != null) {
            throw new BizException(ErrorCode.CONFLICT, "已有待审批的扩容申请，请勿重复提交");
        }
        if (req.getRequestedCap() == null || req.getRequestedCap() <= 0) {
            throw new BizException(ErrorCode.BAD_REQUEST, "目标容量必须是正整数");
        }
        GroupCapacityApplication app = new GroupCapacityApplication();
        app.setGroupId(g.getId());
        app.setApplicantId(applicantId);
        app.setCurrentCap(g.getModelCap());
        app.setRequestedCap(req.getRequestedCap());
        app.setReason(req.getReason());
        app.setFeeAmount(req.getFeeAmount());
        app.setStatus("pending");
        capacityApplicationMapper.insert(app);
        return app;
    }

    public List<GroupDtos.CapacityApplicationResponse> listMyGroupCapacityApplications(Long userId) {
        User u = requireUser(userId);
        if (u.getGroupId() == null) {
            return List.of();
        }
        // SQL: SELECT * FROM auth.group_capacity_application
        //      WHERE group_id = ? AND deleted = 0 ORDER BY id DESC
        List<GroupCapacityApplication> apps = capacityApplicationMapper.selectList(
                new LambdaQueryWrapper<GroupCapacityApplication>()
                        .eq(GroupCapacityApplication::getGroupId, u.getGroupId())
                        .orderByDesc(GroupCapacityApplication::getId));
        return toCapacityApplicationResponses(apps);
    }

    public List<GroupDtos.CapacityApplicationResponse> listCapacityApplications(String status) {
        String s = (status == null || status.isBlank()) ? "pending" : status;
        // SQL: SELECT * FROM auth.group_capacity_application
        //      WHERE status = ? AND deleted = 0 ORDER BY id DESC
        List<GroupCapacityApplication> apps = capacityApplicationMapper.selectList(
                new LambdaQueryWrapper<GroupCapacityApplication>()
                        .eq(GroupCapacityApplication::getStatus, s)
                        .orderByDesc(GroupCapacityApplication::getId));
        return toCapacityApplicationResponses(apps);
    }

    @Transactional
    public void approveCapacityApplication(Long appId, Long reviewerId, String note) {
        GroupCapacityApplication app = capacityApplicationMapper.selectById(appId);
        if (app == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "扩容申请不存在");
        }
        if (!"pending".equals(app.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "申请已被处理");
        }
        ShareGroup g = requireGroup(app.getGroupId());
        g.setModelCap(app.getRequestedCap());
        groupMapper.updateById(g);

        app.setStatus("approved");
        app.setReviewerId(reviewerId);
        app.setReviewNote(note);
        app.setReviewTime(LocalDateTime.now());
        capacityApplicationMapper.updateById(app);
        log.info("[Group] cap-app {} approved: group {} cap {} → {}",
                appId, g.getId(), app.getCurrentCap(), app.getRequestedCap());
    }

    @Transactional
    public void rejectCapacityApplication(Long appId, Long reviewerId, String note) {
        GroupCapacityApplication app = capacityApplicationMapper.selectById(appId);
        if (app == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "扩容申请不存在");
        }
        if (!"pending".equals(app.getStatus())) {
            throw new BizException(ErrorCode.CONFLICT, "申请已被处理");
        }
        app.setStatus("rejected");
        app.setReviewerId(reviewerId);
        app.setReviewNote(note);
        app.setReviewTime(LocalDateTime.now());
        capacityApplicationMapper.updateById(app);
    }

    private List<GroupDtos.CapacityApplicationResponse> toCapacityApplicationResponses(List<GroupCapacityApplication> apps) {
        if (apps.isEmpty()) return List.of();
        List<Long> groupIds = apps.stream().map(GroupCapacityApplication::getGroupId).distinct().toList();
        // SQL: SELECT * FROM auth.share_group WHERE id IN (?, ?, ...) AND deleted = 0
        Map<Long, String> groupNames = groupMapper.selectBatchIds(groupIds).stream()
                .collect(Collectors.toMap(ShareGroup::getId, ShareGroup::getName));
        List<Long> applicantIds = apps.stream().map(GroupCapacityApplication::getApplicantId).distinct().toList();
        // SQL: SELECT * FROM auth.sys_user WHERE id IN (?, ?, ...) AND deleted = 0
        Map<Long, String> applicantNames = userMapper.selectBatchIds(applicantIds).stream()
                .collect(Collectors.toMap(User::getId, User::getUsername));
        return apps.stream().map(a -> {
            GroupDtos.CapacityApplicationResponse r = new GroupDtos.CapacityApplicationResponse();
            r.setId(a.getId());
            r.setGroupId(a.getGroupId());
            r.setGroupName(groupNames.get(a.getGroupId()));
            r.setApplicantId(a.getApplicantId());
            r.setApplicantUsername(applicantNames.get(a.getApplicantId()));
            r.setCurrentCap(a.getCurrentCap());
            r.setRequestedCap(a.getRequestedCap());
            r.setReason(a.getReason());
            r.setFeeAmount(a.getFeeAmount());
            r.setStatus(a.getStatus());
            r.setReviewerId(a.getReviewerId());
            r.setReviewNote(a.getReviewNote());
            r.setReviewTime(a.getReviewTime());
            r.setCreateTime(a.getCreateTime());
            return r;
        }).toList();
    }
}
