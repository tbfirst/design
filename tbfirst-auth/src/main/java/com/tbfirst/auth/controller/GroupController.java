package com.tbfirst.auth.controller;

import com.tbfirst.auth.dto.GroupDtos;
import com.tbfirst.auth.service.GroupService;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.core.response.R;
import com.tbfirst.common.security.context.UserContextHolder;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 资源共享组 REST 控制器（普通用户 + 组长视角）。
 *
 * <p>路由前缀 {@code /api/auth/groups}；网关按常规 JWT 校验，不用白名单。
 * 一级管理员审批入口放在 {@link AdminController}。</p>
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/auth/groups")
public class GroupController {

    private final GroupService groupService;

    /** 当前用户组详情（无组返回 null）。 */
    @GetMapping("/my")
    public R<GroupDtos.MyGroupResponse> myGroup() {
        Long uid = requireUserId();
        return R.ok(groupService.getMyGroup(uid));
    }

    /** 当前用户待响应的邀请（最多一条，无则 null）。 */
    @GetMapping("/invitations/mine")
    public R<GroupDtos.GroupInvitationResponse> myPendingInvitation() {
        Long uid = requireUserId();
        return R.ok(groupService.getMyPendingInvitation(uid));
    }

    /** 提交"成立组"申请。 */
    @PostMapping("/apply")
    public R<Long> apply(@Valid @RequestBody GroupDtos.ApplyGroupRequest req) {
        Long uid = requireUserId();
        return R.ok(groupService.apply(uid, req.getName(), req.getDescription()).getId());
    }

    /** 组长邀请用户（主路径按邮箱；兼容 id / 用户名）。 */
    @PostMapping("/{groupId}/invite")
    public R<Long> invite(@PathVariable Long groupId, @RequestBody GroupDtos.InviteRequest req) {
        Long uid = requireUserId();
        return R.ok(groupService.invite(groupId, uid,
                req.getInviteeEmail(), req.getInviteeUsername(), req.getInviteeId()).getId());
    }

    /** 被邀请人响应邀请（accept=true 或 false）。 */
    @PostMapping("/invitations/{invitationId}/respond")
    public R<Void> respondInvite(@PathVariable Long invitationId,
                                 @RequestBody GroupDtos.RespondInvitationRequest req) {
        Long uid = requireUserId();
        groupService.respondInvitation(invitationId, uid, req.isAccept());
        return R.ok();
    }

    /**
     * 踢人（组长）or 自退（组员自调接口并传自己 id）。
     * 组员退组更建议用 {@code POST /leave}，语义更清晰。
     */
    @DeleteMapping("/{groupId}/members/{userId}")
    public R<Void> kick(@PathVariable Long groupId, @PathVariable Long userId) {
        Long uid = requireUserId();
        if (uid.equals(userId)) {
            // 自调 → 走 leave
            groupService.leave(uid);
        } else {
            groupService.kick(groupId, uid, userId);
        }
        return R.ok();
    }

    /** 组员主动退组。 */
    @PostMapping("/leave")
    public R<Void> leave() {
        Long uid = requireUserId();
        groupService.leave(uid);
        return R.ok();
    }

    /** 组长解散组。 */
    @PostMapping("/{groupId}/dissolve")
    public R<Void> dissolve(@PathVariable Long groupId) {
        Long uid = requireUserId();
        groupService.dissolve(groupId, uid);
        return R.ok();
    }

    /**
     * 组长提交"模特库扩容"申请。
     * 后端自动定位申请人当前所属组，并做 leader 身份与"唯一 pending"校验。
     */
    @PostMapping("/capacity-applications")
    public R<Long> submitCapacityApp(@Valid @RequestBody GroupDtos.SubmitCapacityApplicationRequest req) {
        Long uid = requireUserId();
        return R.ok(groupService.submitCapacityApplication(uid, req).getId());
    }

    /** 查看我的组历史扩容申请（含 pending / approved / rejected）。 */
    @GetMapping("/capacity-applications/mine")
    public R<java.util.List<GroupDtos.CapacityApplicationResponse>> myCapacityApps() {
        Long uid = requireUserId();
        return R.ok(groupService.listMyGroupCapacityApplications(uid));
    }

    private Long requireUserId() {
        Long uid = UserContextHolder.currentUserId();
        if (uid == null) throw new BizException(ErrorCode.UNAUTHORIZED, "未登录");
        return uid;
    }
}
