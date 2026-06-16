package com.tbfirst.auth.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.auth.entity.GroupInvitation;

/**
 * 组邀请表 Mapper：对应 {@code auth.group_invitation}。
 *
 * <p>纯 {@link BaseMapper}；按 invitee_id / group_id / status 的派生查询
 * 都在 GroupServiceImpl 中用 LambdaQueryWrapper 组装。</p>
 *
 * <p><b>快照字段提醒：</b>实体字段 {@code inviteeEmail} 是"组长发起邀请时输入的邮箱原文"
 * 的 snapshot（小写归一化），<b>不是</b>外键。即使被邀请人之后改邮箱或注销账号，
 * 本字段仍保留组长当时输入的值。</p>
 */
public interface GroupInvitationMapper extends BaseMapper<GroupInvitation> {
}
