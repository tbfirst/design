package com.tbfirst.auth.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.auth.entity.GroupApplication;

/**
 * 成组申请表 Mapper：对应 {@code auth.group_application}。
 *
 * <p>纯 {@link BaseMapper}，无自定义 SQL；派生查询
 * （如 "按申请人 + status=pending 查一条"）在 Service 层用 LambdaQueryWrapper 组装。</p>
 */
public interface GroupApplicationMapper extends BaseMapper<GroupApplication> {
}
