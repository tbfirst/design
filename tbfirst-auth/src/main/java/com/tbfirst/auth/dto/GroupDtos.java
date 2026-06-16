package com.tbfirst.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 资源共享组相关 DTO 聚合类。
 *
 * <p>包含组申请、成员管理、邀请响应等所有入参与响应对象。
 * 与 {@link AuthDtos} 同风格，静态内部类聚合，便于 GroupController 引用。</p>
 */
public class GroupDtos {

    /** 用户提交「成立共享组」申请；注册时也可内嵌此结构作为 RegisterRequest.applyGroup。 */
    @Data
    public static class ApplyGroupRequest {
        @NotBlank
        @Size(min = 2, max = 64)
        private String name;

        @Size(max = 1000)
        private String description;
    }

    /** 一级管理员审批申请时的可选参数（改名 / 拒绝理由）。 */
    @Data
    public static class ReviewApplicationRequest {
        /** 批准时允许把 proposed_name 改成 finalName（防同名冲突） */
        @Size(min = 2, max = 64)
        private String finalName;

        /** 拒绝时的理由，前端展示给申请人 */
        @Size(max = 500)
        private String reviewNote;
    }

    /**
     * 组长发出邀请。
     *
     * <p>当前业务语义（2026-04）："按邮箱邀请加入共享组" 是默认路径，前端表单里用户只会填邮箱。
     * inviteeUsername / inviteeId 保留为**内部兼容字段**（老测试、脚本、以后 admin 直派），
     * 生产流量优先走 inviteeEmail。解析优先级：inviteeEmail &gt; inviteeId &gt; inviteeUsername。</p>
     *
     * <p>TODO(errorConclude #40)：当前只是"按邮箱查用户、走站内邀请表"，并没有真的给该邮箱发邮件。
     * 后续接入 SMTP / JavaMailSender 时在此基础上异步发"点击接受"链接即可，不改接口形态。</p>
     */
    @Data
    public static class InviteRequest {
        /** 被邀请人邮箱（主路径，大小写不敏感匹配 auth.sys_user.email） */
        private String inviteeEmail;

        /** 被邀请人用户名（兼容字段；生产环境建议用 email） */
        private String inviteeUsername;

        /** 被邀请人 id（兼容字段；admin 直派场景用） */
        private Long inviteeId;
    }

    /** 被邀请人响应邀请。 */
    @Data
    public static class RespondInvitationRequest {
        /** true = 接受；false = 拒绝 */
        private boolean accept;
    }

    /** 申请列表条目（ADMIN 审批页 + 申请人本人查看自己状态都用这个 DTO）。 */
    @Data
    public static class GroupApplicationResponse {
        private Long id;
        private Long applicantId;
        private String applicantUsername;
        private String applicantNickname;
        private String proposedName;
        private String proposedDescription;
        private String status;
        private Long reviewerId;
        private String reviewNote;
        private LocalDateTime reviewTime;
        private Long approvedGroupId;
        private LocalDateTime createTime;
    }

    /** 邀请记录响应（被邀请人 or 组长视角都用）。 */
    @Data
    public static class GroupInvitationResponse {
        private Long id;
        private Long groupId;
        private String groupName;
        private Long inviterId;
        private String inviterUsername;
        private Long inviteeId;
        private String inviteeUsername;
        /** 组长发起邀请时输入的 email 快照（小写归一化，非外键） */
        private String inviteeEmail;
        private String status;
        private LocalDateTime createTime;
        private LocalDateTime respondTime;
    }

    /** 组成员摘要（管理页列表单元）。 */
    @Data
    public static class GroupMemberResponse {
        private Long userId;
        private String username;
        private String nickname;
        private String role;             // leader | member
        private LocalDateTime joinTime;  // 用 create_time 粗粒度代替，首次迭代不新建字段
    }

    /** 我的组页面聚合响应。 */
    @Data
    public static class MyGroupResponse {
        private Long groupId;
        private String name;
        private String description;
        private String status;         // active | archived
        private Integer memberCount;
        private Long leaderId;
        /** 当前用户在本组的角色：leader | member */
        private String myRole;
        private List<GroupMemberResponse> members;
        /** 组长视角：本组已发出、等待响应的邀请 */
        private List<GroupInvitationResponse> pendingInvitations;
    }

    /** 组列表条目（一级管理员 /admin 组管理页用）。 */
    @Data
    public static class GroupBriefResponse {
        private Long groupId;
        private String name;
        private String description;
        private String status;
        private Integer memberCount;
        private Long leaderId;
        private String leaderUsername;
        /** 组模特库容量覆盖值；null = 默认 30 */
        private Integer modelCap;
        private java.time.LocalDateTime createTime;
    }

    /** admin 直接建组请求。 */
    @Data
    public static class AdminCreateGroupRequest {
        @jakarta.validation.constraints.NotBlank
        @jakarta.validation.constraints.Size(min = 2, max = 64)
        private String name;
        @jakarta.validation.constraints.Size(max = 1000)
        private String description;
    }

    // ============================================================
    // 组扩容申请（T6：组长提交，一级管理员审批）
    // ============================================================

    /** 组长提交扩容申请。 */
    @Data
    public static class SubmitCapacityApplicationRequest {
        /** 申请扩到的目标容量；必须是正整数 */
        @jakarta.validation.constraints.NotNull
        @jakarta.validation.constraints.Min(1)
        private Integer requestedCap;
        /** 扩容理由，必填 */
        @jakarta.validation.constraints.NotBlank
        @jakarta.validation.constraints.Size(max = 1000)
        private String reason;
        /** TODO 对应费用，当前阶段允许空（支付流程未接入） */
        private java.math.BigDecimal feeAmount;
    }

    /** 审批扩容申请（approve / reject 共用 body；都只需一个可选 note）。 */
    @Data
    public static class ReviewCapacityApplicationRequest {
        @jakarta.validation.constraints.Size(max = 1000)
        private String reviewNote;
    }

    /** 扩容申请列表 / 详情响应。 */
    @Data
    public static class CapacityApplicationResponse {
        private Long id;
        private Long groupId;
        private String groupName;
        private Long applicantId;
        private String applicantUsername;
        private Integer currentCap;
        private Integer requestedCap;
        private String reason;
        private java.math.BigDecimal feeAmount;
        private String status;
        private Long reviewerId;
        private String reviewNote;
        private LocalDateTime reviewTime;
        private LocalDateTime createTime;
    }
}
