package com.tbfirst.auth.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.auth.entity.GroupCapacityApplication;

/**
 * 组模特库扩容申请 Mapper：对应 {@code auth.group_capacity_application}。
 *
 * <p>纯 {@link BaseMapper}，无自定义 SQL；所有按状态 / 组 / 申请人的派生查询都在
 * Service 层用 LambdaQueryWrapper 组装。</p>
 */
public interface GroupCapacityApplicationMapper extends BaseMapper<GroupCapacityApplication> {
}
