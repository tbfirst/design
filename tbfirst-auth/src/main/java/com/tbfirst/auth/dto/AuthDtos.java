package com.tbfirst.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 认证相关的 DTO 聚合类，包含注册、登录、用户管理等请求与响应对象。
 *
 * <p>架构角色：auth 服务对外契约的 Java 表达。使用静态内部类聚合，
 * 便于在控制器/服务层以 {@code AuthDtos.XxxRequest} 形式引用，减少同名类污染。</p>
 *
 * <p>校验策略：在请求 DTO 字段上使用 Jakarta Bean Validation 注解，
 * 控制器方法参数加 {@code @Valid} 即触发自动校验。</p>
 */
// 认证相关的 DTO 类，包含注册、登录、用户信息等请求和响应对象
public class AuthDtos {

    /** 注册请求：用户名 3-32 位、密码 6-64 位、邮箱必填且唯一。 */
    @Data
    public static class RegisterRequest {
        @NotBlank
        @Size(min = 3, max = 32)
        private String username;
        @NotBlank
        @Size(min = 6, max = 64)
        private String password;
        private String nickname;
        /**
         * 邮箱：必填 + 合法格式 + 最长 64（对齐 auth.sys_user.email 列宽）+ 全局大小写不敏感唯一。
         * 本字段现在承担"按邮箱邀请入组"的查找键职责，因此从选填升级为必填。
         * 真正通过 SMTP 发送邮件（邀请链接 / 激活）的工作参见 errorConclude #40 的 TODO。
         */
        @NotBlank
        @Email
        @Size(max = 64)
        private String email;
        /**
         * 可选：注册时勾选「申请成立资源共享组」；不为 null 时同事务写一条 pending 申请。
         * 当带 applyGroup 时，register 接口不自动签发 token（申请未批准前无意义），
         * 前端仍可用用户名密码登录；批准后再登录时 JWT 才带 groupId。
         */
        private GroupApply applyGroup;

        /** 内嵌结构：申请组的组名与简介（注册时填）。 */
        @Data
        public static class GroupApply {
            @NotBlank
            @Size(min = 2, max = 64)
            private String name;
            @Size(max = 1000)
            private String description;
        }
    }

    /** 登录请求：用户名、密码必填。 */
    @Data
    public static class LoginRequest {
        @NotBlank
        private String username;
        @NotBlank
        private String password;
    }

    /** 登录 / 注册成功后下发的 token 响应，携带用户概要信息便于前端免二次请求。 */
    @Data
    public static class TokenResponse {
        private String token;
        private long expiresAt;
        private String username;
        private Long userId;
        private String roles;
        private String status;
        /** 所属共享组 ID；null = 未加入任何组 */
        private Long groupId;
        /** 组内角色：leader | member；null = 无组 */
        private String groupRole;
        /** 组名，便于前端徽章直接展示，避免二次请求 */
        private String groupName;
        /** 个人模特库容量覆盖值；null = 按角色默认。前端据此渲染 N/{cap}。 */
        private Integer personalModelCap;
        /** 当前组的模特库容量覆盖值；null = 默认 30。 */
        private Integer groupModelCap;
        /**
         * 如果 register 时带了 applyGroup，这里返回 pending 建组申请的 id；前端据此提示
         * "已提交，待审批"并跳转到登录页。未申请时为 null。
         */
        private Long pendingApplicationId;
        /**
         * 普通注册成功（无论是否带 applyGroup）落库后都会返回 user id 作为 pendingRegistrationId，
         * 因为 2026-04-21 起 {@code /api/auth/register} 一律不签 token、status 强制为 pending，
         * 等 admin 通过 {@code /api/auth/admin/users/{id}/approve-registration} 审批后才可登录。
         */
        private Long pendingRegistrationId;
    }

    /**
     * 管理员创建用户请求；role 默认 USER，可显式传 ADMIN。
     *
     * <p>Admin 创建路径与 /register 明确区分：admin 信任自己手动录入的数据，
     * 创建的用户直接 status='active'，不走待审核流程。</p>
     */
    @Data
    public static class CreateUserRequest {
        @NotBlank
        @Size(min = 3, max = 32)
        private String username;
        @NotBlank
        @Size(min = 6, max = 64)
        private String password;
        private String nickname;
        /** 可选：admin 直接指定邮箱；若填写则需通过 Email 校验且全局（大小写不敏感）唯一。 */
        @jakarta.validation.constraints.Email
        @Size(max = 64)
        private String email;
        private String role = "USER";
        /** 可选：直接设置个人模特库容量覆盖值；null = 按角色默认（USER=5 / ADMIN=50）。 */
        private Integer personalModelCap;
    }

    /** 更新用户状态请求：status 取值 active / disabled。 */
    @Data
    public static class UpdateStatusRequest {
        @NotBlank
        private String status;
    }

    /** 通用容量设置 DTO：用于"修改个人库上限"、"修改组库上限"两个端点。 */
    @Data
    public static class UpdateCapRequest {
        /** null 或负数 / 0 均视为非法（后端返 400）；正整数生效 */
        private Integer cap;
    }

    /** 管理员重置密码请求：仅需新密码，长度 6-64 位。 */
    @Data
    public static class ResetPasswordRequest {
        @NotBlank
        @Size(min = 6, max = 64)
        private String password;
    }

    /** 一级管理员拒绝注册申请的可选备注，仅用于日志。 */
    @Data
    public static class RejectRegistrationRequest {
        @Size(max = 1000)
        private String note;
    }

    /** 用户响应 DTO：不含 passwordHash 等敏感字段，用于列表与详情展示。 */
    @Data
    public static class UserResponse {
        private Long id;
        private String username;
        private String nickname;
        /** 邮箱（/admin 用户详情需要展示 & 编辑） */
        private String email;
        private String roles;
        private String status;
        private java.time.LocalDateTime lastActiveAt;
        private java.time.LocalDateTime createTime;
        /**
         * 该用户成功生图的累计次数。
         * 数据来源：通过 Feign 调用 tbfirst-image 的 /api/image/internal/generation-count 实时聚合，
         * 不冗余存到 auth.sys_user，避免跨 schema 一致性问题。未命中时默认 0。
         */
        private Long totalGenerations = 0L;
        /** 组信息：null = 未加入任何组 */
        private Long groupId;
        private String groupRole;
        private String groupName;
        /** 个人模特库容量覆盖值；null = 按角色默认 */
        private Integer personalModelCap;
    }
}
