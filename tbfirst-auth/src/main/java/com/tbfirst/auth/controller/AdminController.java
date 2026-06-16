package com.tbfirst.auth.controller;

import com.tbfirst.auth.dto.AuthDtos;
import com.tbfirst.auth.dto.GroupDtos;
import com.tbfirst.auth.service.AdminService;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 管理员控制器，提供用户管理相关接口。
 *
 * <p>架构角色：仅 ADMIN 角色可访问的后台管理接口，供前端管理页面调用，
 * 执行用户列表、新增、状态/权限变更、密码重置、逻辑删除等操作。</p>
 *
 * <p>路由前缀：{@code /api/auth/admin}。建议在网关或 Spring Security 层对
 * 该前缀额外加 ADMIN 角色校验。</p>
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/auth/admin")
public class AdminController {

    private final AdminService adminService;
    private final GroupService groupService;

    /**
     * 获取所有未删除用户列表。
     *
     * @return 用户响应 DTO 列表
     */
    @GetMapping("/users")
    public R<List<AuthDtos.UserResponse>> listUsers() {
        return R.ok(adminService.listUsers());
    }

    /**
     * 管理员创建用户。
     * 与用户注册接口不同，管理员创建的用户直接落 active 状态，不走 pending 审批流程；
     *
     * @param req 创建请求，包含用户名、初始密码、昵称、角色、权限
     * @return 创建后的用户信息
     */
    @PostMapping("/users")
    public R<AuthDtos.UserResponse> createUser(@Valid @RequestBody AuthDtos.CreateUserRequest req) {
        return R.ok(adminService.createUser(req));
    }

    /**
     * 更新用户状态（启用 / 禁用）。
     *
     * @param id  目标用户 ID
     * @param req 新状态，取值 active / disabled
     * @return 空响应体
     */
    @PutMapping("/users/{id}/status")
    public R<Void> updateStatus(@PathVariable Long id, @RequestBody AuthDtos.UpdateStatusRequest req) {
        adminService.updateStatus(id, req.getStatus());
        return R.ok();
    }

    /**
     * 重置用户密码（管理员操作，不需要旧密码）。
     *
     * @param id  目标用户 ID
     * @param req 新密码（明文），服务层用 BCrypt 加密后入库
     * @return 空响应体
     */
    @PutMapping("/users/{id}/password")
    public R<Void> resetPassword(@PathVariable Long id, @Valid @RequestBody AuthDtos.ResetPasswordRequest req) {
        adminService.resetPassword(id, req.getPassword());
        return R.ok();
    }

    /**
     * 根据 id 逻辑删除用户（deleted=1），不做物理删除以便审计回溯。
     *
     * @param id 目标用户 ID
     * @return 空响应体
     */
    @DeleteMapping("/users/{id}")
    public R<Void> deleteUser(@PathVariable Long id) {
        adminService.deleteUser(id);
        return R.ok();
    }

    /** 列出 status='pending' 的待审核注册用户。 */
    @GetMapping("/users/pending")
    public R<List<AuthDtos.UserResponse>> listPendingRegistrations() {
        return R.ok(adminService.listPendingRegistrations());
    }

    /** 批准一条注册申请；通过后用户可用用户名密码登录。 */
    @PostMapping("/users/{id}/approve-registration")
    public R<Void> approveRegistration(@PathVariable Long id) {
        adminService.approveRegistration(id);
        return R.ok();
    }

    /** 拒绝一条注册申请；body 可选传 {note} 用于日志留痕。 */
    @PostMapping("/users/{id}/reject-registration")
    public R<Void> rejectRegistration(@PathVariable Long id,
                                      @RequestBody(required = false) AuthDtos.RejectRegistrationRequest req) {
        String note = req == null ? null : req.getNote();
        adminService.rejectRegistration(id, note);
        return R.ok();
    }

    // ============================================================
    // 一级管理员：资源共享组审批
    // ============================================================

    /**
     * 列出共享组申请（默认 pending）。
     *
     * @param status pending | approved | rejected，省略则默认 pending
     */
    @GetMapping("/group-applications")
    public R<List<GroupDtos.GroupApplicationResponse>> listGroupApplications(
            @RequestParam(value = "status", required = false) String status) {
        return R.ok(groupService.listApplications(status));
    }

    /** 批准申请并建组；body 可选传 finalName 覆盖申请时的组名。 */
    @PostMapping("/group-applications/{id}/approve")
    public R<Long> approveApplication(@PathVariable Long id,
                                      @RequestBody(required = false) GroupDtos.ReviewApplicationRequest req) {
        Long reviewer = requireUserId();
        String finalName = req == null ? null : req.getFinalName();
        return R.ok(groupService.approveApplication(id, reviewer, finalName).getId());
    }

    /** 拒绝申请；body 可选传 reviewNote 返回给申请人。 */
    @PostMapping("/group-applications/{id}/reject")
    public R<Void> rejectApplication(@PathVariable Long id,
                                     @RequestBody(required = false) GroupDtos.ReviewApplicationRequest req) {
        Long reviewer = requireUserId();
        String note = req == null ? null : req.getReviewNote();
        groupService.rejectApplication(id, reviewer, note);
        return R.ok();
    }

    // ============================================================
    // 一级管理员：直接建组 + 浏览全部组 + 调整容量
    // ============================================================

    /** 管理员直接建组（admin 成为该组 leader，跳过申请审批）。 */
    @PostMapping("/groups")
    public R<Long> adminCreateGroup(@Valid @RequestBody GroupDtos.AdminCreateGroupRequest req) {
        Long uid = requireUserId();
        return R.ok(groupService.adminDirectCreate(uid, req.getName().trim(), req.getDescription()).getId());
    }

    /** 列出所有组（含 archived？不含——只返回未软删的 active/archived 共享组）。 */
    @GetMapping("/groups")
    public R<List<GroupDtos.GroupBriefResponse>> listAllGroups() {
        return R.ok(groupService.listAllGroupsForAdmin());
    }

    /** 调整组模特库容量；body {cap: Integer 或 null}。 */
    @PutMapping("/groups/{id}/model-cap")
    public R<Void> updateGroupCap(@PathVariable Long id, @RequestBody AuthDtos.UpdateCapRequest req) {
        groupService.updateGroupModelCap(id, req.getCap());
        return R.ok();
    }

    /** 调整用户个人模特库容量。 */
    @PutMapping("/users/{id}/personal-cap")
    public R<Void> updatePersonalCap(@PathVariable Long id, @RequestBody AuthDtos.UpdateCapRequest req) {
        adminService.updatePersonalModelCap(id, req.getCap());
        return R.ok();
    }

    // ============================================================
    // 一级管理员：共享组扩容申请审批（T6）
    // ============================================================

    /** 列出扩容申请（默认 pending）。 */
    @GetMapping("/group-capacity-applications")
    public R<List<GroupDtos.CapacityApplicationResponse>> listCapacityApplications(
            @RequestParam(value = "status", required = false) String status) {
        return R.ok(groupService.listCapacityApplications(status));
    }

    /** 批准扩容申请：覆盖 share_group.model_cap。 */
    @PostMapping("/group-capacity-applications/{id}/approve")
    public R<Void> approveCapacityApp(@PathVariable Long id,
                                      @RequestBody(required = false) GroupDtos.ReviewCapacityApplicationRequest req) {
        Long reviewer = requireUserId();
        String note = req == null ? null : req.getReviewNote();
        groupService.approveCapacityApplication(id, reviewer, note);
        return R.ok();
    }

    /** 拒绝扩容申请。 */
    @PostMapping("/group-capacity-applications/{id}/reject")
    public R<Void> rejectCapacityApp(@PathVariable Long id,
                                     @RequestBody(required = false) GroupDtos.ReviewCapacityApplicationRequest req) {
        Long reviewer = requireUserId();
        String note = req == null ? null : req.getReviewNote();
        groupService.rejectCapacityApplication(id, reviewer, note);
        return R.ok();
    }

    private Long requireUserId() {
        Long uid = UserContextHolder.currentUserId();
        if (uid == null) throw new BizException(ErrorCode.UNAUTHORIZED, "未登录");
        return uid;
    }
}
