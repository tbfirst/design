package com.tbfirst.auth.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.auth.entity.ShareGroup;

/**
 * 共享组表 Mapper：对应 {@code auth.share_group}。
 *
 * <p><b>纯 {@link BaseMapper} 能力：</b>没有自定义方法，所有派生查询
 * （按 name、按 leader、按 status 等）在 Service 层用 {@code LambdaQueryWrapper}
 * 按需组装。{@code @TableLogic} 使所有继承方法自动追加 {@code deleted = 0}。</p>
 */
public interface ShareGroupMapper extends BaseMapper<ShareGroup> {
}
