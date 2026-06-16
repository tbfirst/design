package com.tbfirst.auth.service;

import com.tbfirst.auth.dto.GroupDtos;
import com.tbfirst.auth.entity.GroupApplication;
import com.tbfirst.auth.entity.GroupCapacityApplication;
import com.tbfirst.auth.entity.GroupInvitation;
import com.tbfirst.auth.entity.ShareGroup;

import java.util.List;

/**
 * 资源共享组业务服务接口。
 *
 * <p><b>职责：</b>围绕 share_group 聚合根，处理：</p>
 * <ol>
 *   <li>成组申请（apply/approve/reject/adminDirectCreate）；</li>
 *   <li>成员流转（invite/respond/kick/leave/dissolve）；</li>
 *   <li>组容量（updateGroupModelCap 以及扩容申请 submitCapacityApplication 等）；</li>
 *   <li>查询（listAllGroupsForAdmin / listApplications / getMyGroup / getMyPendingInvitation）。</li>
 * </ol>
 *
 * <p><b>权限边界：</b>接口内不做鉴权，具体每个方法在 Impl 内用 userId vs leaderId 比对、
 * 或 status 白名单守卫。对 admin-only 的方法（listAllGroupsForAdmin / approveApplication 等）
 * 依赖上层 Controller 的 @RequireRole("ADMIN") 切面拦截。</p>
 *
 * <p><b>实现：</b>{@link com.tbfirst.auth.service.impl.GroupServiceImpl}。</p>
 */
public interface GroupService {

    /**
     * 用户提交"成立共享组"申请，status=pending 等待 ADMIN 审核。
     * <p>同一申请人若已有 pending 申请会抛 BizException。</p>
     */
    GroupApplication apply(Long applicantId, String proposedName, String description);

    /**
     * ADMIN 审核通过：创建 share_group、自动把申请人提升为 leader、关联申请记录。
     * @param finalName 若非空则覆盖原申请的 proposed_name（避免同名冲突）
     * @return 新建的 share_group
     */
    ShareGroup approveApplication(Long applicationId, Long reviewerId, String finalName);

    /** ADMIN 审核拒绝，记录 review_note。 */
    void rejectApplication(Long applicationId, Long reviewerId, String note);

    /**
     * ADMIN 直接建组（免审核路径）。
     * <p>此时 adminUserId 并不自动成为 leader；leader 字段默认 null，
     * 需后续再通过 invite 路径或另一个接口指派。</p>
     */
    ShareGroup adminDirectCreate(Long adminUserId, String name, String description);

    /** 组管理页（ADMIN）：列出全部共享组及概览信息（组长、成员数、当前 cap）。 */
    List<GroupDtos.GroupBriefResponse> listAllGroupsForAdmin();

    /**
     * ADMIN 直接调整组的模特库容量覆盖值 model_cap。
     * <p>null 表示回落默认（当前默认 30）。</p>
     */
    void updateGroupModelCap(Long groupId, Integer cap);

    /**
     * 列出成组申请。
     * @param status 可选过滤（pending/approved/rejected），传 null 则全列
     */
    List<GroupDtos.GroupApplicationResponse> listApplications(String status);

    /**
     * 组长按邮箱邀请用户入组。
     * <p>解析优先级：inviteeEmail &gt; inviteeId &gt; inviteeUsername，兼容老脚本。
     * 会把 email 小写归一化后存入 group_invitation.invitee_email 作为快照（非外键）。
     * 幂等规则：对同一被邀请人已存在 pending 邀请则抛 BizException。</p>
     */
    GroupInvitation invite(Long groupId, Long inviterId, String inviteeEmail,
                           String inviteeUsername, Long inviteeId);

    /**
     * 被邀请人响应邀请。
     * @param accept true 接受（写入 user.group_id + user.group_role=member），false 拒绝
     */
    void respondInvitation(Long invitationId, Long inviteeId, boolean accept);

    /** 查询当前用户待响应的邀请（最多一条，前端用来弹通知气泡）。 */
    GroupDtos.GroupInvitationResponse getMyPendingInvitation(Long userId);

    /** 组长踢人（清空 target 的 group_id/group_role）。不能踢自己。 */
    void kick(Long groupId, Long leaderId, Long targetUserId);

    /**
     * 成员主动退组。
     * <p>leader 不能直接退组，必须先 dissolve 或转让（当前版本无转让入口，故只能 dissolve）。</p>
     */
    void leave(Long userId);

    /** 组长解散组 —— 把 share_group.status 改为 archived，清空全员 group_id/group_role。 */
    void dissolve(Long groupId, Long leaderId);

    /**
     * 当前用户视角：获取自己所在组的聚合信息。
     * <p>普通成员只返回基本信息 + 成员列表；leader 额外返回 pendingInvitations。
     * 未入组则返回 null。</p>
     */
    GroupDtos.MyGroupResponse getMyGroup(Long userId);

    /**
     * 组长提交扩容申请（status=pending）。
     * <p>requested_cap 必须 &gt; 当前 cap；reason 必填；fee_amount 当前可空（未接支付）。</p>
     */
    GroupCapacityApplication submitCapacityApplication(Long applicantId,
                                                      GroupDtos.SubmitCapacityApplicationRequest req);

    /** 列出本组的扩容申请（组内成员视角，只能看到自己组的）。 */
    List<GroupDtos.CapacityApplicationResponse> listMyGroupCapacityApplications(Long userId);

    /** ADMIN 视角：列出所有扩容申请。status 可选过滤。 */
    List<GroupDtos.CapacityApplicationResponse> listCapacityApplications(String status);

    /** ADMIN 审核通过扩容申请：落库 approved + 同步写 share_group.model_cap = requested_cap。 */
    void approveCapacityApplication(Long appId, Long reviewerId, String note);

    /** ADMIN 拒绝扩容申请，只记 reviewNote 不动 share_group。 */
    void rejectCapacityApplication(Long appId, Long reviewerId, String note);
}
