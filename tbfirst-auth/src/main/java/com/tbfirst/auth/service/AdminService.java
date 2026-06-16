package com.tbfirst.auth.service;

import com.tbfirst.auth.dto.AuthDtos;

import java.util.List;

/**
 * 一级管理员（ADMIN）业务接口。
 *
 * <p><b>职责：</b>用户全生命周期管理 —— 查询、审核注册、直接建号、停用/启用、
 * 重置密码、调整个人模特库配额、软删用户。与 GroupService 互补：
 * GroupService 管"组"，AdminService 管"人"。</p>
 *
 * <p><b>调用方：</b>只暴露给 AdminController，路由带 /api/auth/admin/** 前缀，
 * 由网关 + ADMIN 角色头准入。</p>
 *
 * <p><b>实现：</b>{@link com.tbfirst.auth.service.impl.AdminServiceImpl}。</p>
 */
public interface AdminService {

    /**
     * 列出全部用户（含已软删除外的所有状态）。
     * <p>为每个用户聚合：所在组名 + 历史生图成功数（调用 image 服务 AuditLogService）。</p>
     */
    List<AuthDtos.UserResponse> listUsers();

    /**
     * 管理员直接建号（免审核路径）。
     * <p>新用户 status=active，可立即登录。</p>
     */
    AuthDtos.UserResponse createUser(AuthDtos.CreateUserRequest req);

    /**
     * 修改用户状态（active/banned 等）。
     *
     * @param id     目标用户 id
     * @param status 目标状态字面量，必须在 CommonConstants.USER_STATUS_* 白名单内
     */
    void updateStatus(Long id, String status);

    /** 列出所有等待审核的注册申请（register 路径产生的 status=pending 用户）。 */
    List<AuthDtos.UserResponse> listPendingRegistrations();

    /**
     * 审核通过一个注册申请 —— 把 status 从 pending 改为 active。
     * <p>若该用户注册时内嵌 applyGroup，<b>本方法不会</b>自动批准成组申请；
     * 成组审批走 GroupService.approveApplication。</p>
     */
    void approveRegistration(Long id);

    /**
     * 拒绝注册申请 —— 把 status 从 pending 改为 rejected，并记审核意见。
     */
    void rejectRegistration(Long id, String note);

    /**
     * 调整用户的个人模特库容量覆盖值（model_cap_override）。
     * <p>null 表示清除覆盖，回落默认 30；非 null 值必须 &gt;= 0。</p>
     */
    void updatePersonalModelCap(Long id, Integer cap);

    /** 管理员强制重置某用户密码（BCrypt 重哈希，不通知用户）。 */
    // todo 后续改为通知用户联系管理员要密码
    void resetPassword(Long id, String newPassword);

    /**
     * 软删用户（deleted=1）。
     * <p>逻辑删除不级联，被删用户所在组/已提交申请/历史生图记录仍保留，
     * 但因登录查询带 deleted=0 条件，用户已无法登录。</p>
     */
    void deleteUser(Long id);
}
